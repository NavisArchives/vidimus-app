import type { CandidateFinding, ProviderKey, ReviewConfig, ReviewType } from '@vidimus/shared';
import { consolidateFindings } from '@vidimus/shared';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/database.js';
import { withTransaction } from '../db/database.js';
import { getGlossary, recordAudit } from '../db/repository.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { ProviderContext } from '../providers/types.js';
import { newId } from '../security/crypto.js';
import type { ExtractedPage } from './pdf.js';
import { anchorQuoteToPage } from './pdf.js';

interface QueuedJob {
  reviewId: string;
  workspaceId: string;
  actorId: string;
}

export class ReviewOrchestrator {
  private readonly queue: QueuedJob[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly maxConcurrent: number;

  constructor(
    private readonly db: Db,
    private readonly cfg: AppConfig,
    private readonly registry: ProviderRegistry
  ) {
    this.maxConcurrent = Math.max(1, cfg.maxConcurrentReviews);
  }

  /**
   * On server startup, any jobs left in `running` or `queued` state from a prior
   * abrupt exit are explicitly marked failed so reviewers see an honest recovery state.
   */
  recoverInterruptedReviews(): number {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE reviews
         SET status = 'failed',
             current_stage = 'Interrupted by server restart',
             error_message = 'Analysis was interrupted before completion. Start a new review to retry.',
             completed_at = ?
         WHERE status IN ('queued', 'running')`
      )
      .run(now);
    this.db
      .prepare(
        `UPDATE analysis_runs
         SET status = 'failed',
             error_message = 'Interrupted by server restart',
             completed_at = ?
         WHERE status IN ('queued', 'running')`
      )
      .run(now);
    return Number(res.changes || 0);
  }

  enqueue(reviewId: string, workspaceId: string, actorId: string): void {
    this.queue.push({ reviewId, workspaceId, actorId });
    this.pump();
  }

  cancel(reviewId: string, workspaceId: string, actorId: string): boolean {
    const idx = this.queue.findIndex((j) => j.reviewId === reviewId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      this.markCancelled(reviewId, workspaceId, actorId);
      return true;
    }
    const ctrl = this.active.get(reviewId);
    if (ctrl) {
      ctrl.abort();
      this.markCancelled(reviewId, workspaceId, actorId);
      return true;
    }
    return false;
  }

  private markCancelled(reviewId: string, workspaceId: string, actorId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE reviews SET status = 'cancelled', current_stage = 'Cancelled', completed_at = ? WHERE id = ?`
      )
      .run(now, reviewId);
    this.db
      .prepare(
        `UPDATE analysis_runs SET status = 'cancelled', completed_at = ? WHERE review_id = ? AND status IN ('queued', 'running')`
      )
      .run(now, reviewId);
    recordAudit(this.db, workspaceId, actorId, 'review', reviewId, 'review.cancelled', {});
  }

  private pump(): void {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      const ctrl = new AbortController();
      this.active.set(job.reviewId, ctrl);
      this.executeJob(job, ctrl)
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.db
            .prepare(
              `UPDATE reviews SET status = 'failed', current_stage = 'Failed', error_message = ?, completed_at = ? WHERE id = ?`
            )
            .run(msg.slice(0, 500), new Date().toISOString(), job.reviewId);
        })
        .finally(() => {
          this.active.delete(job.reviewId);
          this.pump();
        });
    }
  }

  async executeJob(job: QueuedJob, ctrl: AbortController): Promise<void> {
    const { reviewId, workspaceId, actorId } = job;
    const reviewRow = this.db
      .prepare('SELECT * FROM reviews WHERE id = ? AND workspace_id = ?')
      .get(reviewId, workspaceId) as Record<string, unknown> | undefined;
    if (!reviewRow || reviewRow.status === 'cancelled') return;

    const config = JSON.parse(String(reviewRow.config_json || '{}')) as ReviewConfig;
    const reviewType = String(reviewRow.review_type) as ReviewType;
    const versionId = String(reviewRow.document_version_id);
    const sourceVersionId = reviewRow.source_version_id ? String(reviewRow.source_version_id) : null;

    const versionRow = this.db
      .prepare('SELECT extraction_status, extracted_text_json FROM document_versions WHERE id = ?')
      .get(versionId) as { extraction_status: string; extracted_text_json: string } | undefined;

    if (!versionRow) {
      throw new Error('Document version not found');
    }
    if (versionRow.extraction_status === 'ocr_required') {
      throw new Error(
        'This PDF contains no extractable text (scanned document). OCR processing is required before automated analysis.'
      );
    }

    const pages = JSON.parse(versionRow.extracted_text_json || '[]') as ExtractedPage[];
    let sourcePages: ExtractedPage[] | null = null;
    if (sourceVersionId) {
      const srcRow = this.db
        .prepare('SELECT extracted_text_json FROM document_versions WHERE id = ?')
        .get(sourceVersionId) as { extracted_text_json: string } | undefined;
      if (srcRow) {
        sourcePages = JSON.parse(srcRow.extracted_text_json || '[]') as ExtractedPage[];
      }
    }

    const glossary = config.glossaryId ? getGlossary(this.db, workspaceId, config.glossaryId) : null;

    const startTime = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE reviews SET status = 'running', progress_pct = 15, current_stage = 'Preparing document sections', started_at = ? WHERE id = ?`
      )
      .run(startTime, reviewId);

    const providerKeys: ProviderKey[] = config.providers?.length ? config.providers : ['deterministic'];
    const statuses = new Map(
      this.registry.listStatuses(this.db, workspaceId, this.cfg).map((s) => [s.key, s])
    );

    const runIds = new Map<ProviderKey, string>();
    for (const pk of providerKeys) {
      const rid = newId('run');
      runIds.set(pk, rid);
      const st = statuses.get(pk);
      this.db
        .prepare(
          `INSERT INTO analysis_runs (id, review_id, provider_key, model, prompt_version, mode, status, started_at)
           VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`
        )
        .run(rid, reviewId, pk, st?.model || '', 'v2', st?.mode || 'unconfigured', new Date().toISOString());
    }

    this.db
      .prepare(`UPDATE reviews SET progress_pct = 35, current_stage = ? WHERE id = ?`)
      .run(`Running ${providerKeys.length} provider${providerKeys.length === 1 ? '' : 's'}`, reviewId);

    const ctx: ProviderContext = {
      reviewId,
      reviewType,
      checks: config.checks || ['figures', 'reference', 'terminology', 'consistency', 'language'],
      depth: config.depth || 'standard',
      sourceLang: config.sourceLang || 'en',
      targetLang: config.targetLang || null,
      instructions: config.instructions || '',
      regulatoryRef: config.regulatoryRef || null,
      glossary,
      pages,
      sourcePages,
      signal: ctrl.signal,
    };

    const allCandidates: CandidateFinding[] = [];
    let succeededCount = 0;
    let failedCount = 0;
    const providerErrors: string[] = [];

    const results = await Promise.allSettled(
      providerKeys.map(async (pk) => {
        const provider = this.registry.get(pk);
        if (!provider) {
          throw new Error(`Unknown provider '${pk}'`);
        }
        const st = statuses.get(pk);
        const result = await provider.analyze(ctx, this.cfg, st?.model);
        return { pk, result };
      })
    );

    if (ctrl.signal.aborted) return;

    for (let i = 0; i < providerKeys.length; i++) {
      const pk = providerKeys[i];
      const rid = runIds.get(pk)!;
      const settled = results[i];
      const doneAt = new Date().toISOString();

      if (settled.status === 'fulfilled') {
        succeededCount += 1;
        const { result } = settled.value;
        allCandidates.push(...result.findings);
        this.db
          .prepare(
            `UPDATE analysis_runs
             SET status = 'completed', model = ?, prompt_version = ?, mode = ?, findings_count = ?, completed_at = ?
             WHERE id = ?`
          )
          .run(result.model, result.promptVersion, result.mode, result.findings.length, doneAt, rid);
      } else {
        failedCount += 1;
        const errMsg =
          settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        providerErrors.push(`${pk}: ${errMsg}`);
        this.db
          .prepare(
            `UPDATE analysis_runs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`
          )
          .run(errMsg.slice(0, 500), doneAt, rid);
      }
    }

    if (succeededCount === 0) {
      const doneAt = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE reviews SET status = 'failed', progress_pct = 100, current_stage = 'All selected providers failed', error_message = ?, completed_at = ? WHERE id = ?`
        )
        .run(providerErrors.join('; ').slice(0, 800), doneAt, reviewId);
      recordAudit(this.db, workspaceId, actorId, 'review', reviewId, 'review.failed', {
        errors: providerErrors,
      });
      return;
    }

    this.db
      .prepare(`UPDATE reviews SET progress_pct = 75, current_stage = 'Consolidating and anchoring findings' WHERE id = ?`)
      .run(reviewId);

    const consolidated = consolidateFindings(allCandidates);
    const pageMap = new Map(pages.map((p) => [p.page, p]));
    const now = new Date().toISOString();

    withTransaction(this.db, () => {
      // Clear any prior findings if re-run
      this.db.prepare('DELETE FROM findings WHERE review_id = ?').run(reviewId);

      const insertStmt = this.db.prepare(
        `INSERT INTO findings (
          id, review_id, document_version_id, key, seq, page, severity, category,
          title, quote, source_quote, suggestion, explanation, anchor_status, anchor_json,
          providers_json, opinions_json, disagreement, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
      );

      consolidated.forEach((f, idx) => {
        const seq = idx + 1;
        const key = `VD-${String(seq).padStart(2, '0')}`;
        const pageData = pageMap.get(f.page);
        const anchored = anchorQuoteToPage(pageData, f.quote);
        const evidence = anchored.evidence
          ? {
              ...anchored.evidence,
              ...(f.sourceQuote
                ? {
                    sourcePage: f.page,
                    sourceQuote: f.sourceQuote,
                    alignmentConfidence: 'approximate' as const,
                  }
                : {}),
            }
          : null;

        insertStmt.run(
          newId('fnd'),
          reviewId,
          versionId,
          key,
          seq,
          f.page,
          f.severity,
          f.category,
          f.title,
          f.quote,
          f.sourceQuote,
          f.suggestion,
          f.explanation,
          anchored.status,
          evidence ? JSON.stringify(evidence) : null,
          JSON.stringify(f.providers),
          JSON.stringify(f.opinions),
          f.disagreement ? 1 : 0,
          now,
          now
        );
      });

      const finalStatus = failedCount > 0 ? 'completed_with_errors' : 'completed';
      const stage =
        failedCount > 0
          ? `Completed with ${failedCount} provider error${failedCount === 1 ? '' : 's'}`
          : 'Completed';

      this.db
        .prepare(
          `UPDATE reviews
           SET status = ?, progress_pct = 100, current_stage = ?, error_message = ?, completed_at = ?
           WHERE id = ?`
        )
        .run(
          finalStatus,
          stage,
          providerErrors.length ? providerErrors.join('; ').slice(0, 800) : null,
          now,
          reviewId
        );

      this.db
        .prepare(`UPDATE documents SET status = 'in_review', updated_at = ? WHERE id = ?`)
        .run(now, String(reviewRow.document_id));

      recordAudit(this.db, workspaceId, actorId, 'review', reviewId, 'review.completed', {
        findingsCount: consolidated.length,
        status: finalStatus,
      });
    });
  }
}
