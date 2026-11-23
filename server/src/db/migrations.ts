import type { Db } from './database.js';
import { withTransaction } from './database.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Reviewer',
        role TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'viewer')),
        password_hash TEXT NOT NULL,
        avatar_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_memberships (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'reviewer', 'viewer')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'single' CHECK (kind IN ('single', 'translation')),
        source_lang TEXT NOT NULL DEFAULT 'en',
        target_lang TEXT,
        status TEXT NOT NULL DEFAULT 'uploaded',
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'source', 'target')),
        version_number INTEGER NOT NULL DEFAULT 1,
        original_filename TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/pdf',
        size_bytes INTEGER NOT NULL,
        page_count INTEGER NOT NULL DEFAULT 0,
        extraction_status TEXT NOT NULL DEFAULT 'ready' CHECK (extraction_status IN ('ready', 'ocr_required', 'failed')),
        extracted_text_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        uploaded_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        UNIQUE (document_id, role, version_number)
      );
      CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions(document_id, role, version_number DESC);

      CREATE TABLE IF NOT EXISTS glossaries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        source_lang TEXT NOT NULL DEFAULT 'en',
        target_lang TEXT NOT NULL DEFAULT 'en',
        entries_json TEXT NOT NULL DEFAULT '[]',
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_configs (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        provider_key TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        model TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, provider_key)
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
        source_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
        review_type TEXT NOT NULL DEFAULT 'regulatory',
        config_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
        progress_pct INTEGER NOT NULL DEFAULT 0,
        current_stage TEXT NOT NULL DEFAULT 'Queued',
        error_message TEXT,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_workspace ON reviews(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reviews_document ON reviews(document_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS analysis_runs (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        provider_key TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        prompt_version TEXT NOT NULL DEFAULT 'v1',
        mode TEXT NOT NULL DEFAULT 'fixture',
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        findings_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_runs_review ON analysis_runs(review_id);

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        seq INTEGER NOT NULL,
        page INTEGER NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        quote TEXT NOT NULL,
        source_quote TEXT,
        suggestion TEXT NOT NULL,
        edited_suggestion TEXT,
        edited_by TEXT REFERENCES users(id),
        edited_at TEXT,
        explanation TEXT NOT NULL,
        anchor_status TEXT NOT NULL DEFAULT 'unresolved' CHECK (anchor_status IN ('exact', 'ambiguous', 'unresolved')),
        anchor_json TEXT,
        providers_json TEXT NOT NULL DEFAULT '[]',
        opinions_json TEXT NOT NULL DEFAULT '[]',
        disagreement INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected', 'deferred', 'split')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (review_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id, seq ASC);

      CREATE TABLE IF NOT EXISTS finding_decisions (
        id TEXT PRIMARY KEY,
        finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        verdict TEXT NOT NULL CHECK (verdict IN ('approved', 'rejected', 'deferred', 'reopened')),
        note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_finding ON finding_decisions(finding_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS finding_comments (
        id TEXT PRIMARY KEY,
        finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_comments_finding ON finding_comments(finding_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_events(workspace_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS exports (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        format TEXT NOT NULL CHECK (format IN ('csv', 'md', 'json', 'pdf')),
        scope TEXT NOT NULL CHECK (scope IN ('all', 'approved')),
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );
    `,
  },
];

export function runMigrations(db: Db): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const rows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const applied = new Set(rows.map((r) => r.version));
  const newlyApplied: number[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    withTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString()
      );
    });
    newlyApplied.push(migration.version);
  }

  return newlyApplied;
}
