import type {
  AnalysisRunDTO,
  AnchorEvidence,
  AnchorStatus,
  AuditEventDTO,
  CommentDTO,
  DashboardDTO,
  DecisionDTO,
  DecisionVerdict,
  DocumentDTO,
  DocumentKind,
  DocumentVersionDTO,
  ExtractionStatus,
  FindingCategory,
  FindingDTO,
  FindingStatus,
  GlossaryDTO,
  GlossaryEntry,
  ProviderKey,
  ProviderMode,
  ProviderOpinion,
  ReviewConfig,
  ReviewDTO,
  ReviewStatus,
  ReviewSummaryDTO,
  ReviewType,
  Role,
  Severity,
  WorkspaceDTO,
} from '@vidimus/shared';
import type { Db } from './database.js';
import { withTransaction } from './database.js';
import { newId } from '../security/crypto.js';
import type { ExtractedPage } from '../services/pdf.js';

export function recordAudit(
  db: Db,
  workspaceId: string,
  actorId: string | null,
  entityType: string,
  entityId: string,
  action: string,
  details: Record<string, unknown> = {}
): void {
  db.prepare(
    `INSERT INTO audit_events (id, workspace_id, actor_id, entity_type, entity_id, action, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId('aud'),
    workspaceId,
    actorId,
    entityType,
    entityId,
    action,
    JSON.stringify(details),
    new Date().toISOString()
  );
}

export function computeFindingStatus(decisions: DecisionDTO[]): {
  status: FindingStatus;
  activeDecisions: Record<string, DecisionDTO>;
} {
  // Latest decision per user determines that user's active stance; 'reopened' clears their active stance
  const active: Record<string, DecisionDTO> = {};
  for (const d of decisions) {
    if (d.verdict === 'reopened') {
      delete active[d.userId];
    } else {
      active[d.userId] = d;
    }
  }
  const verdicts = Object.values(active).map((d) => d.verdict);
  const hasApproved = verdicts.includes('approved');
  const hasRejected = verdicts.includes('rejected');
  const hasDeferred = verdicts.includes('deferred');

  let status: FindingStatus = 'open';
  if (hasApproved && hasRejected) status = 'split';
  else if (hasApproved) status = 'approved';
  else if (hasRejected) status = 'rejected';
  else if (hasDeferred) status = 'deferred';

  return { status, activeDecisions: active };
}

function mapVersionRow(r: Record<string, unknown>): DocumentVersionDTO {
  return {
    id: String(r.id),
    documentId: String(r.document_id),
    role: r.role as 'primary' | 'source' | 'target',
    versionNumber: Number(r.version_number),
    originalFilename: String(r.original_filename),
    sizeBytes: Number(r.size_bytes),
    pageCount: Number(r.page_count),
    extractionStatus: r.extraction_status as ExtractionStatus,
    sha256: String(r.sha256),
    uploadedBy: String(r.uploaded_by),
    uploadedByName: r.uploaded_by_name ? String(r.uploaded_by_name) : undefined,
    createdAt: String(r.created_at),
  };
}

export function listDocuments(db: Db, workspaceId: string, search?: string): DocumentDTO[] {
  const rows = db
    .prepare(
      `SELECT d.* FROM documents d
       WHERE d.workspace_id = ?
       ORDER BY d.updated_at DESC`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  const q = (search || '').trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          String(r.title).toLowerCase().includes(q) ||
          String(r.subtitle || '').toLowerCase().includes(q)
      )
    : rows;

  return filtered.map((r) => hydrateDocument(db, r));
}

export function getDocument(db: Db, workspaceId: string, documentId: string): DocumentDTO | null {
  const row = db
    .prepare('SELECT * FROM documents WHERE id = ? AND workspace_id = ?')
    .get(documentId, workspaceId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return hydrateDocument(db, row, true);
}

function hydrateDocument(db: Db, r: Record<string, unknown>, includeVersions = false): DocumentDTO {
  const id = String(r.id);
  const vRows = db
    .prepare(
      `SELECT v.*, u.name AS uploaded_by_name
       FROM document_versions v
       LEFT JOIN users u ON u.id = v.uploaded_by
       WHERE v.document_id = ?
       ORDER BY v.version_number DESC, v.created_at DESC`
    )
    .all(id) as Array<Record<string, unknown>>;

  const versions = vRows.map(mapVersionRow);
  const latestVersion =
    versions.find((v) => v.role === 'target') ||
    versions.find((v) => v.role === 'primary') ||
    versions[0] ||
    null;
  const sourceVersion = versions.find((v) => v.role === 'source') || null;

  const latestReview = db
    .prepare(
      `SELECT id, status FROM reviews WHERE document_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(id) as { id: string; status: ReviewStatus } | undefined;

  let findingsCount = 0;
  let decidedCount = 0;
  if (latestReview) {
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ('approved', 'rejected', 'deferred') THEN 1 ELSE 0 END) AS decided
         FROM findings WHERE review_id = ?`
      )
      .get(latestReview.id) as { total: number; decided: number | null };
    findingsCount = Number(counts.total || 0);
    decidedCount = Number(counts.decided || 0);
  }

  return {
    id,
    workspaceId: String(r.workspace_id),
    title: String(r.title),
    subtitle: String(r.subtitle || ''),
    kind: r.kind as DocumentKind,
    sourceLang: String(r.source_lang),
    targetLang: r.target_lang ? String(r.target_lang) : null,
    status: String(r.status),
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    latestVersion,
    sourceVersion,
    versions: includeVersions ? versions : undefined,
    latestReviewId: latestReview?.id || null,
    latestReviewStatus: latestReview?.status || null,
    findingsCount,
    decidedCount,
  };
}

export function getDocumentVersionFile(
  db: Db,
  workspaceId: string,
  versionId: string
): { storedFilename: string; originalFilename: string; documentId: string; pages: ExtractedPage[] } | null {
  const row = db
    .prepare(
      `SELECT v.stored_filename, v.original_filename, v.document_id, v.extracted_text_json
       FROM document_versions v
       JOIN documents d ON d.id = v.document_id
       WHERE v.id = ? AND d.workspace_id = ?`
    )
    .get(versionId, workspaceId) as
    | {
        stored_filename: string;
        original_filename: string;
        document_id: string;
        extracted_text_json: string;
      }
    | undefined;
  if (!row) return null;
  return {
    storedFilename: row.stored_filename,
    originalFilename: row.original_filename,
    documentId: row.document_id,
    pages: JSON.parse(row.extracted_text_json || '[]') as ExtractedPage[],
  };
}

export function listGlossaries(db: Db, workspaceId: string): GlossaryDTO[] {
  const rows = db
    .prepare('SELECT * FROM glossaries WHERE workspace_id = ? ORDER BY updated_at DESC')
    .all(workspaceId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    name: String(r.name),
    sourceLang: String(r.source_lang),
    targetLang: String(r.target_lang),
    entries: JSON.parse(String(r.entries_json || '[]')) as GlossaryEntry[],
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export function getGlossary(db: Db, workspaceId: string, glossaryId: string): GlossaryDTO | null {
  const r = db
    .prepare('SELECT * FROM glossaries WHERE id = ? AND workspace_id = ?')
    .get(glossaryId, workspaceId) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    name: String(r.name),
    sourceLang: String(r.source_lang),
    targetLang: String(r.target_lang),
    entries: JSON.parse(String(r.entries_json || '[]')) as GlossaryEntry[],
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function listReviews(db: Db, workspaceId: string): ReviewDTO[] {
  const rows = db
    .prepare(
      `SELECT r.*, d.title AS document_title, d.subtitle AS document_subtitle, d.kind AS document_kind,
              v.page_count
       FROM reviews r
       JOIN documents d ON d.id = r.document_id
       JOIN document_versions v ON v.id = r.document_version_id
       WHERE r.workspace_id = ?
       ORDER BY r.created_at DESC`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;
  return rows.map((r) => hydrateReview(db, r));
}

export function getReview(db: Db, workspaceId: string, reviewId: string): ReviewDTO | null {
  const row = db
    .prepare(
      `SELECT r.*, d.title AS document_title, d.subtitle AS document_subtitle, d.kind AS document_kind,
              v.page_count
       FROM reviews r
       JOIN documents d ON d.id = r.document_id
       JOIN document_versions v ON v.id = r.document_version_id
       WHERE r.id = ? AND r.workspace_id = ?`
    )
    .get(reviewId, workspaceId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return hydrateReview(db, row, true);
}

function hydrateReview(db: Db, r: Record<string, unknown>, includeRuns = false): ReviewDTO {
  const id = String(r.id);
  const runs = includeRuns
    ? (
        db
          .prepare('SELECT * FROM analysis_runs WHERE review_id = ? ORDER BY rowid ASC')
          .all(id) as Array<Record<string, unknown>>
      ).map(
        (ar): AnalysisRunDTO => ({
          id: String(ar.id),
          reviewId: String(ar.review_id),
          providerKey: ar.provider_key as ProviderKey,
          model: String(ar.model || ''),
          promptVersion: String(ar.prompt_version || 'v1'),
          mode: ar.mode as ProviderMode,
          status: ar.status as AnalysisRunDTO['status'],
          findingsCount: Number(ar.findings_count || 0),
          errorMessage: ar.error_message ? String(ar.error_message) : null,
          startedAt: ar.started_at ? String(ar.started_at) : null,
          completedAt: ar.completed_at ? String(ar.completed_at) : null,
        })
      )
    : undefined;

  const c = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('open', 'split') THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN status = 'deferred' THEN 1 ELSE 0 END) AS deferred,
        SUM(CASE WHEN status = 'split' THEN 1 ELSE 0 END) AS split,
        SUM(CASE WHEN severity = 'high' AND status IN ('open', 'split') THEN 1 ELSE 0 END) AS high,
        SUM(CASE WHEN severity = 'medium' AND status IN ('open', 'split') THEN 1 ELSE 0 END) AS medium,
        SUM(CASE WHEN severity = 'low' AND status IN ('open', 'split') THEN 1 ELSE 0 END) AS low
       FROM findings WHERE review_id = ?`
    )
    .get(id) as Record<string, number | null>;

  return {
    id,
    workspaceId: String(r.workspace_id),
    documentId: String(r.document_id),
    documentTitle: r.document_title ? String(r.document_title) : undefined,
    documentSubtitle: r.document_subtitle ? String(r.document_subtitle) : undefined,
    documentKind: r.document_kind as DocumentKind | undefined,
    documentVersionId: String(r.document_version_id),
    sourceVersionId: r.source_version_id ? String(r.source_version_id) : null,
    pageCount: r.page_count != null ? Number(r.page_count) : undefined,
    reviewType: r.review_type as ReviewType,
    config: JSON.parse(String(r.config_json || '{}')) as ReviewConfig,
    status: r.status as ReviewStatus,
    progressPct: Number(r.progress_pct || 0),
    currentStage: String(r.current_stage || ''),
    errorMessage: r.error_message ? String(r.error_message) : null,
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    startedAt: r.started_at ? String(r.started_at) : null,
    completedAt: r.completed_at ? String(r.completed_at) : null,
    runs,
    counts: {
      total: Number(c?.total || 0),
      open: Number(c?.open || 0),
      approved: Number(c?.approved || 0),
      rejected: Number(c?.rejected || 0),
      deferred: Number(c?.deferred || 0),
      split: Number(c?.split || 0),
      high: Number(c?.high || 0),
      medium: Number(c?.medium || 0),
      low: Number(c?.low || 0),
    },
  };
}

export function listFindings(db: Db, workspaceId: string, reviewId: string): FindingDTO[] {
  const rev = db
    .prepare('SELECT id FROM reviews WHERE id = ? AND workspace_id = ?')
    .get(reviewId, workspaceId);
  if (!rev) return [];

  const rows = db
    .prepare(
      `SELECT f.*, u.name AS edited_by_name
       FROM findings f
       LEFT JOIN users u ON u.id = f.edited_by
       WHERE f.review_id = ?
       ORDER BY f.seq ASC`
    )
    .all(reviewId) as Array<Record<string, unknown>>;

  const decRows = db
    .prepare(
      `SELECT d.*, u.name AS user_name, u.avatar_index AS user_avatar_index
       FROM finding_decisions d
       JOIN findings f ON f.id = d.finding_id
       JOIN users u ON u.id = d.user_id
       WHERE f.review_id = ?
       ORDER BY d.created_at ASC`
    )
    .all(reviewId) as Array<Record<string, unknown>>;

  const comRows = db
    .prepare(
      `SELECT c.*, u.name AS user_name, u.avatar_index AS user_avatar_index
       FROM finding_comments c
       JOIN findings f ON f.id = c.finding_id
       JOIN users u ON u.id = c.user_id
       WHERE f.review_id = ?
       ORDER BY c.created_at ASC`
    )
    .all(reviewId) as Array<Record<string, unknown>>;

  const decByFinding = new Map<string, DecisionDTO[]>();
  for (const d of decRows) {
    const fid = String(d.finding_id);
    const list = decByFinding.get(fid) || [];
    list.push({
      id: String(d.id),
      findingId: fid,
      userId: String(d.user_id),
      userName: String(d.user_name),
      userAvatarIndex: Number(d.user_avatar_index || 0),
      verdict: d.verdict as DecisionVerdict,
      note: d.note ? String(d.note) : null,
      createdAt: String(d.created_at),
    });
    decByFinding.set(fid, list);
  }

  const comByFinding = new Map<string, CommentDTO[]>();
  for (const c of comRows) {
    const fid = String(c.finding_id);
    const list = comByFinding.get(fid) || [];
    list.push({
      id: String(c.id),
      findingId: fid,
      userId: String(c.user_id),
      userName: String(c.user_name),
      userAvatarIndex: Number(c.user_avatar_index || 0),
      body: String(c.body),
      createdAt: String(c.created_at),
    });
    comByFinding.set(fid, list);
  }

  return rows.map((r) => {
    const id = String(r.id);
    const decisions = decByFinding.get(id) || [];
    const { status, activeDecisions } = computeFindingStatus(decisions);
    return {
      id,
      reviewId: String(r.review_id),
      documentVersionId: String(r.document_version_id),
      key: String(r.key),
      seq: Number(r.seq),
      page: Number(r.page),
      severity: r.severity as Severity,
      category: r.category as FindingCategory,
      title: String(r.title),
      quote: String(r.quote),
      sourceQuote: r.source_quote ? String(r.source_quote) : null,
      suggestion: String(r.suggestion),
      editedSuggestion: r.edited_suggestion ? String(r.edited_suggestion) : null,
      editedBy: r.edited_by ? String(r.edited_by) : null,
      editedByName: r.edited_by_name ? String(r.edited_by_name) : null,
      editedAt: r.edited_at ? String(r.edited_at) : null,
      explanation: String(r.explanation),
      anchorStatus: r.anchor_status as AnchorStatus,
      anchor: r.anchor_json ? (JSON.parse(String(r.anchor_json)) as AnchorEvidence) : null,
      providers: JSON.parse(String(r.providers_json || '[]')) as ProviderKey[],
      opinions: JSON.parse(String(r.opinions_json || '[]')) as ProviderOpinion[],
      disagreement: Boolean(r.disagreement),
      status,
      decisions,
      activeDecisions,
      comments: comByFinding.get(id) || [],
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  });
}

export function getFindingById(db: Db, workspaceId: string, findingId: string): FindingDTO | null {
  const row = db
    .prepare(
      `SELECT f.review_id FROM findings f
       JOIN reviews r ON r.id = f.review_id
       WHERE f.id = ? AND r.workspace_id = ?`
    )
    .get(findingId, workspaceId) as { review_id: string } | undefined;
  if (!row) return null;
  const all = listFindings(db, workspaceId, row.review_id);
  return all.find((f) => f.id === findingId) || null;
}

export function recordFindingDecision(
  db: Db,
  workspaceId: string,
  findingId: string,
  userId: string,
  verdict: DecisionVerdict,
  note?: string
): FindingDTO | null {
  const existing = getFindingById(db, workspaceId, findingId);
  if (!existing) return null;

  // Toggle behavior: if user clicks same verdict they already hold, reopen/withdraw cleanly
  const currentUserVerdict = existing.activeDecisions[userId]?.verdict;
  const effectiveVerdict: DecisionVerdict =
    currentUserVerdict === verdict && verdict !== 'reopened' ? 'reopened' : verdict;

  const now = new Date().toISOString();
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO finding_decisions (id, finding_id, user_id, verdict, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(newId('dec'), findingId, userId, effectiveVerdict, note || null, now);

    const updated = getFindingById(db, workspaceId, findingId)!;
    db.prepare('UPDATE findings SET status = ?, updated_at = ? WHERE id = ?').run(
      updated.status,
      now,
      findingId
    );

    recordAudit(db, workspaceId, userId, 'finding', findingId, `decision.${effectiveVerdict}`, {
      reviewId: existing.reviewId,
      key: existing.key,
      title: existing.title,
      verdict: effectiveVerdict,
      status: updated.status,
    });
  });

  return getFindingById(db, workspaceId, findingId);
}

export function editFindingSuggestion(
  db: Db,
  workspaceId: string,
  findingId: string,
  userId: string,
  suggestion: string
): FindingDTO | null {
  const existing = getFindingById(db, workspaceId, findingId);
  if (!existing) return null;
  const now = new Date().toISOString();
  withTransaction(db, () => {
    db.prepare(
      `UPDATE findings SET edited_suggestion = ?, edited_by = ?, edited_at = ?, updated_at = ? WHERE id = ?`
    ).run(suggestion.trim(), userId, now, now, findingId);
    recordAudit(db, workspaceId, userId, 'finding', findingId, 'suggestion.edited', {
      reviewId: existing.reviewId,
      key: existing.key,
      title: existing.title,
    });
  });
  return getFindingById(db, workspaceId, findingId);
}

export function addFindingComment(
  db: Db,
  workspaceId: string,
  findingId: string,
  userId: string,
  body: string
): FindingDTO | null {
  const existing = getFindingById(db, workspaceId, findingId);
  if (!existing) return null;
  const now = new Date().toISOString();
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO finding_comments (id, finding_id, user_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(newId('cmt'), findingId, userId, body.trim(), now);
    recordAudit(db, workspaceId, userId, 'finding', findingId, 'comment.added', {
      reviewId: existing.reviewId,
      key: existing.key,
      title: existing.title,
    });
  });
  return getFindingById(db, workspaceId, findingId);
}

export function listAuditEvents(db: Db, workspaceId: string, limit = 30): AuditEventDTO[] {
  const rows = db
    .prepare(
      `SELECT a.*, u.name AS actor_name, u.avatar_index AS actor_avatar_index
       FROM audit_events a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.workspace_id = ?
       ORDER BY a.created_at DESC
       LIMIT ?`
    )
    .all(workspaceId, limit) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    actorId: r.actor_id ? String(r.actor_id) : null,
    actorName: r.actor_name ? String(r.actor_name) : 'System',
    actorAvatarIndex: Number(r.actor_avatar_index || 0),
    entityType: String(r.entity_type),
    entityId: String(r.entity_id),
    action: String(r.action),
    details: JSON.parse(String(r.details_json || '{}')) as Record<string, unknown>,
    createdAt: String(r.created_at),
  }));
}

export function getReviewSummary(
  db: Db,
  workspaceId: string,
  reviewId: string
): ReviewSummaryDTO | null {
  const review = getReview(db, workspaceId, reviewId);
  if (!review) return null;
  const findings = listFindings(db, workspaceId, reviewId);
  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  const byCategory: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  let unresolvedAnchors = 0;
  let providerAgreements = 0;
  let providerDisagreements = 0;

  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    for (const p of f.providers) {
      byProvider[p] = (byProvider[p] || 0) + 1;
    }
    if (f.anchorStatus !== 'exact') unresolvedAnchors += 1;
    if (f.providers.length > 1) {
      if (f.disagreement) providerDisagreements += 1;
      else providerAgreements += 1;
    }
  }

  return {
    review,
    totals: {
      total: findings.length,
      open: findings.filter((f) => f.status === 'open' || f.status === 'split').length,
      approved: findings.filter((f) => f.status === 'approved').length,
      rejected: findings.filter((f) => f.status === 'rejected').length,
      deferred: findings.filter((f) => f.status === 'deferred').length,
      split: findings.filter((f) => f.status === 'split').length,
      unresolvedAnchors,
      providerAgreements,
      providerDisagreements,
    },
    bySeverity,
    byCategory,
    byProvider,
  };
}

export function getDashboardData(
  db: Db,
  workspace: WorkspaceDTO,
  connectedProvidersCount: number,
  totalProvidersCount: number
): DashboardDTO {
  const docs = listDocuments(db, workspace.id);
  const reviews = listReviews(db, workspace.id);

  const activeReviews = reviews.filter((r) => {
    const open = r.counts?.open || 0;
    return r.status === 'running' || r.status === 'queued' || (r.status === 'completed' && open > 0);
  });

  const completedReviews = reviews.filter(
    (r) =>
      (r.status === 'completed' || r.status === 'completed_with_errors') &&
      (r.counts?.total || 0) > 0 &&
      (r.counts?.open || 0) === 0
  );

  const attentionReviews = reviews.filter(
    (r) =>
      r.status === 'failed' ||
      r.status === 'completed_with_errors' ||
      (r.counts?.high || 0) > 0 ||
      (r.counts?.split || 0) > 0
  );

  const pendingDecisionsCount = reviews.reduce((sum, r) => sum + (r.counts?.open || 0), 0);
  const highSeverityOpenCount = reviews.reduce((sum, r) => sum + (r.counts?.high || 0), 0);

  const continueReview = activeReviews[0] || reviews[0] || null;
  const recentActivity = listAuditEvents(db, workspace.id, 8);

  return {
    workspace,
    metrics: {
      documentsCount: docs.length,
      activeReviewsCount: activeReviews.length,
      completedReviewsCount: completedReviews.length,
      pendingDecisionsCount,
      highSeverityOpenCount,
      connectedProvidersCount,
      totalProvidersCount,
    },
    continueReview,
    attentionReviews: attentionReviews.slice(0, 4),
    recentDocuments: docs.slice(0, 6),
    recentActivity,
  };
}
