import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { REPO_ROOT } from '../config.js';
import type { Db } from './database.js';
import { withTransaction } from './database.js';
import { recordAudit } from './repository.js';
import { hashPassword, newId } from '../security/crypto.js';
import { anchorQuoteToPage, extractPdf, storeUploadedPdf } from '../services/pdf.js';

export const DEV_PASSWORD = 'vidimus-dev-password';

interface SampleFindingJson {
  id: string;
  page: number;
  severity: 'high' | 'medium' | 'low';
  type: 'figures' | 'reference' | 'terminology' | 'consistency' | 'language';
  quote: string;
  suggestion: string;
  title: string;
  note: string;
  agents: string[];
  variants?: Array<{ agent: string; text: string }>;
}

interface SamplePayload {
  document: { title: string; subtitle: string; file: string; pages: number };
  decisions: Array<{ finding: string; by: string; verdict: 'approved' | 'rejected'; minutes_ago: number }>;
  findings: SampleFindingJson[];
}

export async function seedDevelopmentData(db: Db, cfg: AppConfig): Promise<void> {
  const existingUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (existingUsers.n > 0) return;

  const now = Date.now();
  const isoAgo = (mins: number) => new Date(now - mins * 60_000).toISOString();

  const wsId = 'ws_oeverlicht';
  const users = [
    {
      id: 'usr_lena',
      key: 'lena',
      email: 'lena@example.com',
      name: 'Lena Vos',
      title: 'Head of Compliance',
      role: 'admin',
      avatarIndex: 1,
    },
    {
      id: 'usr_sam',
      key: 'sam',
      email: 'sam@example.com',
      name: 'Sam Ortega',
      title: 'Compliance reviewer',
      role: 'reviewer',
      avatarIndex: 0,
    },
    {
      id: 'usr_noah',
      key: 'noah',
      email: 'noah@example.com',
      name: 'Noah Brandt',
      title: 'Legal counsel',
      role: 'reviewer',
      avatarIndex: 2,
    },
    {
      id: 'usr_viewer',
      key: 'viewer',
      email: 'auditor@example.com',
      name: 'Claire De Vries',
      title: 'External observer',
      role: 'viewer',
      avatarIndex: 0,
    },
  ];

  const pwHash = hashPassword(DEV_PASSWORD);

  withTransaction(db, () => {
    db.prepare('INSERT INTO workspaces (id, slug, name, created_at) VALUES (?, ?, ?, ?)').run(
      wsId,
      'oeverlicht-custody',
      'Oeverlicht Custody',
      isoAgo(600)
    );

    for (const u of users) {
      db.prepare(
        `INSERT INTO users (id, email, name, title, role, password_hash, avatar_index, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(u.id, u.email, u.name, u.title, u.role, pwHash, u.avatarIndex, isoAgo(600));

      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?)`
      ).run(wsId, u.id, u.role, isoAgo(600));
    }

    // Seed reusable CAFR compliance glossary
    db.prepare(
      `INSERT INTO glossaries (id, workspace_id, name, source_lang, target_lang, entries_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'gls_cafr',
      wsId,
      'CAFR Regulatory Terminology',
      'en',
      'en',
      JSON.stringify([
        {
          sourceTerm: 'asset-linked token',
          preferredTerm: 'asset-linked tokens',
          forbiddenTerms: ['asset-referenced tokens'],
          notes: 'Section 8 defines asset-linked token; avoid MiCA wording in CAFR filings.',
        },
        {
          sourceTerm: 'white paper',
          preferredTerm: 'white paper',
          forbiddenTerms: ['prospectus'],
          notes: 'Under CAFR an issuer publishes a white paper rather than a prospectus.',
        },
        {
          sourceTerm: 'crypto-asset service provider',
          preferredTerm: 'crypto-asset service provider',
          forbiddenTerms: ['crypto service provider'],
          notes: 'Use the full defined term or the entity name Oeverlicht.',
        },
      ]),
      'usr_lena',
      isoAgo(500),
      isoAgo(500)
    );
  });

  // Import the synthetic compliance note PDF (lab/sample/note.pdf) as a real document
  const samplePdfPath = path.join(REPO_ROOT, 'lab', 'sample', 'note.pdf');
  const sampleJsonPath = path.join(REPO_ROOT, 'lab', 'sample', 'findings.json');

  if (fs.existsSync(samplePdfPath) && fs.existsSync(sampleJsonPath)) {
    const pdfBuf = fs.readFileSync(samplePdfPath);
    const stored = storeUploadedPdf(cfg.uploadsDir, 'Compliance-note-CN-2026-07.pdf', pdfBuf);
    const extracted = await extractPdf(pdfBuf);
    const sample = JSON.parse(fs.readFileSync(sampleJsonPath, 'utf-8')) as SamplePayload;

    const docId = 'doc_cn_2026_07';
    const verId = 'ver_cn_2026_07_v1';
    const revId = 'rev_cn_2026_07_initial';
    const userByKey: Record<string, string> = {
      lena: 'usr_lena',
      sam: 'usr_sam',
      noah: 'usr_noah',
    };

    const pageMap = new Map(extracted.pages.map((p) => [p.page, p]));

    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO documents (id, workspace_id, title, subtitle, kind, source_lang, target_lang, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'single', 'en', NULL, 'in_review', ?, ?, ?)`
      ).run(
        docId,
        wsId,
        sample.document.title,
        sample.document.subtitle,
        'usr_lena',
        isoAgo(240),
        isoAgo(30)
      );

      db.prepare(
        `INSERT INTO document_versions (
          id, document_id, role, version_number, original_filename, stored_filename, sha256,
          mime_type, size_bytes, page_count, extraction_status, extracted_text_json, metadata_json, uploaded_by, created_at
        ) VALUES (?, ?, 'primary', 1, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        verId,
        docId,
        stored.cleanFilename,
        stored.storedFilename,
        stored.sha256,
        stored.sizeBytes,
        extracted.pageCount,
        extracted.extractionStatus,
        JSON.stringify(extracted.pages),
        JSON.stringify(extracted.metadata),
        'usr_lena',
        isoAgo(240)
      );

      db.prepare(
        `INSERT INTO reviews (
          id, workspace_id, document_id, document_version_id, source_version_id, review_type, config_json,
          status, progress_pct, current_stage, created_by, created_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, NULL, 'regulatory', ?, 'completed', 100, 'Completed', ?, ?, ?, ?)`
      ).run(
        revId,
        wsId,
        docId,
        verId,
        JSON.stringify({
          checks: ['figures', 'reference', 'terminology', 'consistency', 'language'],
          providers: ['deterministic'],
          depth: 'standard',
          sourceLang: 'en',
          glossaryId: 'gls_cafr',
          regulatoryRef: 'CAFR Licence Application Framework',
        }),
        'usr_lena',
        isoAgo(180),
        isoAgo(180),
        isoAgo(179)
      );

      db.prepare(
        `INSERT INTO analysis_runs (id, review_id, provider_key, model, prompt_version, mode, status, findings_count, started_at, completed_at)
         VALUES (?, ?, 'deterministic', 'vidimus-rules-v2', 'deterministic-rules-v2', 'fixture', 'completed', ?, ?, ?)`
      ).run('run_seed_det', revId, sample.findings.length, isoAgo(180), isoAgo(179));

      const findingIdMap = new Map<string, string>();
      const insertFinding = db.prepare(
        `INSERT INTO findings (
          id, review_id, document_version_id, key, seq, page, severity, category,
          title, quote, source_quote, suggestion, explanation, anchor_status, anchor_json,
          providers_json, opinions_json, disagreement, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
      );

      sample.findings.forEach((sf, i) => {
        const fid = `fnd_seed_${String(i + 1).padStart(2, '0')}`;
        findingIdMap.set(sf.id, fid);
        const key = `VD-${String(i + 1).padStart(2, '0')}`;
        const anchored = anchorQuoteToPage(pageMap.get(sf.page), sf.quote);
        const opinions = [
          {
            providerKey: 'deterministic',
            model: 'vidimus-rules-v2',
            mode: 'fixture',
            suggestion: sf.suggestion,
            explanation: sf.note,
            severity: sf.severity,
            category: sf.type,
            promptVersion: 'deterministic-rules-v2',
            createdAt: isoAgo(179),
          },
          ...(sf.variants || []).map((v) => ({
            providerKey: 'deterministic',
            model: `vidimus-rules-v2 (${v.agent} variant)`,
            mode: 'fixture',
            suggestion: v.text,
            explanation: `Alternative wording proposed during terminology pass.`,
            severity: sf.severity,
            category: sf.type,
            promptVersion: 'deterministic-rules-v2',
            createdAt: isoAgo(179),
          })),
        ];

        insertFinding.run(
          fid,
          revId,
          verId,
          key,
          i + 1,
          sf.page,
          sf.severity,
          sf.type,
          sf.title,
          sf.quote,
          sf.suggestion,
          sf.note,
          anchored.status,
          anchored.evidence ? JSON.stringify(anchored.evidence) : null,
          JSON.stringify(['deterministic']),
          JSON.stringify(opinions),
          opinions.length > 1 ? 1 : 0,
          isoAgo(179),
          isoAgo(179)
        );
      });

      // Seed initial team decisions and compute aggregate statuses
      const votesPerFinding = new Map<string, Set<string>>();
      for (const dec of sample.decisions) {
        const fid = findingIdMap.get(dec.finding);
        const uid = userByKey[dec.by];
        if (!fid || !uid) continue;
        const at = isoAgo(dec.minutes_ago);
        db.prepare(
          `INSERT INTO finding_decisions (id, finding_id, user_id, verdict, note, created_at)
           VALUES (?, ?, ?, ?, NULL, ?)`
        ).run(newId('dec'), fid, uid, dec.verdict, at);

        const set = votesPerFinding.get(fid) || new Set<string>();
        set.add(dec.verdict);
        votesPerFinding.set(fid, set);

        const sf = sample.findings.find((x) => x.id === dec.finding);
        const seq = sample.findings.findIndex((x) => x.id === dec.finding) + 1;
        db.prepare(
          `INSERT INTO audit_events (id, workspace_id, actor_id, entity_type, entity_id, action, details_json, created_at)
           VALUES (?, ?, ?, 'finding', ?, ?, ?, ?)`
        ).run(
          newId('aud'),
          wsId,
          uid,
          fid,
          `decision.${dec.verdict}`,
          JSON.stringify({
            reviewId: revId,
            key: `VD-${String(seq).padStart(2, '0')}`,
            title: sf?.title || '',
            verdict: dec.verdict,
          }),
          at
        );
      }

      for (const [fid, verdicts] of votesPerFinding.entries()) {
        const st =
          verdicts.has('approved') && verdicts.has('rejected')
            ? 'split'
            : verdicts.has('approved')
              ? 'approved'
              : 'rejected';
        db.prepare('UPDATE findings SET status = ? WHERE id = ?').run(st, fid);
      }

      recordAudit(db, wsId, 'usr_lena', 'document', docId, 'document.uploaded', {
        title: sample.document.title,
        pages: extracted.pageCount,
      });
    });
  }
}
