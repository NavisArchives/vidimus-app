import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {
  commentSchema,
  createGlossarySchema,
  createReviewSchema,
  createWorkspaceSchema,
  decisionSchema,
  editSuggestionSchema,
  exportFormatSchema,
  loginSchema,
  providerKeySchema,
  registerSchema,
  updateProviderSchema,
} from '@vidimus/shared';
import type { AppConfig } from './config.js';
import { loadConfig, REPO_ROOT } from './config.js';
import { openDatabase, withTransaction, type Db } from './db/database.js';
import { runMigrations } from './db/migrations.js';
import {
  addFindingComment,
  editFindingSuggestion,
  getDashboardData,
  getDocument,
  getDocumentVersionFile,
  getFindingById,
  getGlossary,
  getReview,
  getReviewSummary,
  listAuditEvents,
  listDocuments,
  listFindings,
  listGlossaries,
  listReviews,
  recordAudit,
  recordFindingDecision,
} from './db/repository.js';
import { DEV_PASSWORD, seedDevelopmentData } from './db/seed.js';
import {
  loadAuthContext,
  requireAuth,
  requireRole,
  SESSION_COOKIE,
  verifyCsrf,
} from './middleware/auth.js';
import { ProviderRegistry } from './providers/registry.js';
import {
  hashPassword,
  newId,
  randomToken,
  sha256Hex,
  verifyPassword,
} from './security/crypto.js';
import {
  filterExportFindings,
  generateCsvExport,
  generateJsonExport,
  generateMarkdownExport,
  generatePdfReport,
} from './services/exports.js';
import { ReviewOrchestrator } from './services/orchestrator.js';
import {
  extractPdf,
  resolveStoredPdfPath,
  storeUploadedPdf,
  validatePdfBuffer,
} from './services/pdf.js';

export interface ServerBundle {
  app: FastifyInstance;
  db: Db;
  config: AppConfig;
  registry: ProviderRegistry;
  orchestrator: ReviewOrchestrator;
}

export async function buildApp(
  configOverrides: Partial<AppConfig> = {},
  customRegistry?: ProviderRegistry
): Promise<ServerBundle> {
  const config = loadConfig(configOverrides);
  const db = openDatabase(config.dbPath);
  runMigrations(db);
  if (config.seedDemo) {
    await seedDevelopmentData(db, config);
  }

  const registry = customRegistry || new ProviderRegistry();
  const orchestrator = new ReviewOrchestrator(db, config, registry);
  orchestrator.recoverInterruptedReviews();

  const app = Fastify({
    logger: config.nodeEnv === 'test' ? false : { level: 'info' },
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    hsts: config.cookieSecure ? undefined : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  await app.register(cookie, {
    secret: config.sessionSecret,
  });

  await app.register(rateLimit, {
    max: config.nodeEnv === 'test' ? 1000 : 240,
    timeWindow: '1 minute',
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 3,
      fields: 20,
    },
  });

  // Attach authenticated user context + enforce CSRF on mutating API calls
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const rawCookie = req.cookies[SESSION_COOKIE];
    const wsHeader =
      typeof req.headers['x-workspace-id'] === 'string' ? req.headers['x-workspace-id'] : undefined;
    req.auth = loadAuthContext(db, rawCookie, wsHeader);
    if (!verifyCsrf(req, reply)) {
      return reply;
    }
  });

  const issueSession = (reply: import('fastify').FastifyReply, userId: string) => {
    const rawToken = randomToken(32);
    const tokenHash = sha256Hex(rawToken);
    const csrfToken = randomToken(24);
    const now = new Date();
    const expires = new Date(now.getTime() + config.sessionTtlHours * 3600_000);
    db.prepare(
      `INSERT INTO sessions (id, token_hash, user_id, csrf_token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(newId('ses'), tokenHash, userId, csrfToken, expires.toISOString(), now.toISOString());

    reply.setCookie(SESSION_COOKIE, rawToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      expires,
    });
    return { rawToken, csrfToken };
  };

  /* ==================== Health ==================== */
  app.get('/api/health', async () => ({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  }));

  /* ==================== Auth ==================== */
  app.get('/api/auth/dev-accounts', async (_req, reply) => {
    if (!config.seedDemo) {
      return reply.code(404).send({ error: 'Not available' });
    }
    const users = db
      .prepare('SELECT email, name, title, role, avatar_index FROM users ORDER BY created_at ASC LIMIT 6')
      .all() as Array<{
      email: string;
      name: string;
      title: string;
      role: string;
      avatar_index: number;
    }>;
    return {
      devMode: true,
      hintPassword: DEV_PASSWORD,
      accounts: users.map((u) => ({
        email: u.email,
        name: u.name,
        title: u.title,
        role: u.role,
        avatarIndex: u.avatar_index,
      })),
    };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    return {
      user: auth.user,
      csrfToken: auth.csrfToken,
      workspaces: auth.workspaces,
      activeWorkspace: auth.activeWorkspace,
    };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Please provide a valid email and password.' });
    }
    const email = parsed.data.email.trim().toLowerCase();
    const user = db
      .prepare('SELECT * FROM users WHERE lower(email) = ?')
      .get(email) as
      | {
          id: string;
          email: string;
          name: string;
          title: string;
          role: string;
          password_hash: string;
          avatar_index: number;
        }
      | undefined;

    if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
      return reply.code(401).send({ error: 'Invalid email or password.' });
    }

    const { rawToken } = issueSession(reply, user.id);
    const auth = loadAuthContext(db, rawToken)!;
    recordAudit(db, auth.activeWorkspace.id, user.id, 'session', auth.sessionId, 'auth.login', {});
    return {
      user: auth.user,
      csrfToken: auth.csrfToken,
      workspaces: auth.workspaces,
      activeWorkspace: auth.activeWorkspace,
    };
  });

  app.post('/api/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Invalid registration data' });
    }
    const email = parsed.data.email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
    if (existing) {
      return reply.code(409).send({ error: 'An account with this email already exists.' });
    }

    const userId = newId('usr');
    const wsId = newId('ws');
    const now = new Date().toISOString();
    const avatarIndex = Math.floor(Math.random() * 3);

    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO users (id, email, name, title, role, password_hash, avatar_index, created_at)
         VALUES (?, ?, ?, ?, 'reviewer', ?, ?, ?)`
      ).run(
        userId,
        email,
        parsed.data.name.trim(),
        parsed.data.title?.trim() || 'Reviewer',
        hashPassword(parsed.data.password),
        avatarIndex,
        now
      );

      const slug = `${parsed.data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'workspace'}-${userId.slice(-4)}`;
      db.prepare('INSERT INTO workspaces (id, slug, name, created_at) VALUES (?, ?, ?, ?)').run(
        wsId,
        slug,
        `${parsed.data.name.trim()}'s Workspace`,
        now
      );
      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
         VALUES (?, ?, 'admin', ?)`
      ).run(wsId, userId, now);
    });

    const { rawToken } = issueSession(reply, userId);
    const auth = loadAuthContext(db, rawToken)!;
    return reply.code(201).send({
      user: auth.user,
      csrfToken: auth.csrfToken,
      workspaces: auth.workspaces,
      activeWorkspace: auth.activeWorkspace,
    });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    db.prepare('DELETE FROM sessions WHERE id = ?').run(auth.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /* ==================== Workspaces & Dashboard ==================== */
  app.post('/api/workspaces', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const parsed = createWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Workspace name must be at least 2 characters.' });
    }
    const id = newId('ws');
    const slug = `${parsed.data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'workspace'}-${id.slice(-4)}`;
    const now = new Date().toISOString();
    withTransaction(db, () => {
      db.prepare('INSERT INTO workspaces (id, slug, name, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        slug,
        parsed.data.name.trim(),
        now
      );
      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
         VALUES (?, ?, 'admin', ?)`
      ).run(id, auth.user.id, now);
      recordAudit(db, id, auth.user.id, 'workspace', id, 'workspace.created', {
        name: parsed.data.name.trim(),
      });
    });
    return reply.code(201).send({ id, slug, name: parsed.data.name.trim(), role: 'admin' });
  });

  app.get('/api/dashboard', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const statuses = registry.listStatuses(db, auth.activeWorkspace.id, config);
    const connected = statuses.filter((s) => s.enabled && s.configured).length;
    return getDashboardData(db, auth.activeWorkspace, connected, statuses.length);
  });

  app.get('/api/audit', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    return { events: listAuditEvents(db, auth.activeWorkspace.id, 60) };
  });

  /* ==================== Documents & Uploads ==================== */
  app.get('/api/documents', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const q = (req.query as { q?: string })?.q;
    return { documents: listDocuments(db, auth.activeWorkspace.id, q) };
  });

  app.get('/api/documents/:id', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const doc = getDocument(db, auth.activeWorkspace.id, id);
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    return { document: doc };
  });

  app.post('/api/documents/upload', async (req, reply) => {
    const auth = requireRole(req, reply, ['admin', 'reviewer']);
    if (!auth) return;

    const fields: Record<string, string> = {};
    let primaryFile: { filename: string; buffer: Buffer } | null = null;
    let sourceFile: { filename: string; buffer: Buffer } | null = null;

    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          if (part.fieldname === 'sourceFile') {
            sourceFile = { filename: part.filename || 'source.pdf', buffer: buf };
          } else {
            primaryFile = { filename: part.filename || 'document.pdf', buffer: buf };
          }
        } else {
          fields[part.fieldname] = String(part.value || '');
        }
      }
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'Failed to parse uploaded file' });
    }

    if (!primaryFile) {
      return reply.code(400).send({ error: 'A PDF file is required.' });
    }

    const v1 = validatePdfBuffer(primaryFile.buffer, config.maxUploadBytes);
    if (!v1.ok) return reply.code(400).send({ error: v1.error });

    if (sourceFile) {
      const v2 = validatePdfBuffer(sourceFile.buffer, config.maxUploadBytes);
      if (!v2.ok) return reply.code(400).send({ error: `Source PDF: ${v2.error}` });
    }

    let extractedPrimary;
    let extractedSource = null;
    try {
      extractedPrimary = await extractPdf(primaryFile.buffer);
      if (sourceFile) {
        extractedSource = await extractPdf(sourceFile.buffer);
      }
    } catch {
      return reply
        .code(422)
        .send({ error: 'The uploaded file could not be parsed as a valid PDF document.' });
    }

    const storedPrimary = storeUploadedPdf(config.uploadsDir, primaryFile.filename, primaryFile.buffer);
    const storedSource = sourceFile
      ? storeUploadedPdf(config.uploadsDir, sourceFile.filename, sourceFile.buffer)
      : null;

    const kind = sourceFile || fields.kind === 'translation' ? 'translation' : 'single';
    const title =
      fields.title?.trim() ||
      extractedPrimary.metadata.title ||
      storedPrimary.cleanFilename.replace(/\.pdf$/i, '');
    const subtitle = fields.subtitle?.trim() || '';
    const sourceLang = fields.sourceLang?.trim() || 'en';
    const targetLang = kind === 'translation' ? fields.targetLang?.trim() || 'nl' : null;

    const docId = newId('doc');
    const verId = newId('ver');
    const srcVerId = storedSource ? newId('ver') : null;
    const now = new Date().toISOString();

    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO documents (id, workspace_id, title, subtitle, kind, source_lang, target_lang, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        docId,
        auth.activeWorkspace.id,
        title.slice(0, 200),
        subtitle.slice(0, 240),
        kind,
        sourceLang,
        targetLang,
        extractedPrimary.extractionStatus === 'ocr_required' ? 'ocr_required' : 'uploaded',
        auth.user.id,
        now,
        now
      );

      db.prepare(
        `INSERT INTO document_versions (
          id, document_id, role, version_number, original_filename, stored_filename, sha256,
          mime_type, size_bytes, page_count, extraction_status, extracted_text_json, metadata_json, uploaded_by, created_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        verId,
        docId,
        kind === 'translation' ? 'target' : 'primary',
        storedPrimary.cleanFilename,
        storedPrimary.storedFilename,
        storedPrimary.sha256,
        storedPrimary.sizeBytes,
        extractedPrimary.pageCount,
        extractedPrimary.extractionStatus,
        JSON.stringify(extractedPrimary.pages),
        JSON.stringify(extractedPrimary.metadata),
        auth.user.id,
        now
      );

      if (storedSource && extractedSource && srcVerId) {
        db.prepare(
          `INSERT INTO document_versions (
            id, document_id, role, version_number, original_filename, stored_filename, sha256,
            mime_type, size_bytes, page_count, extraction_status, extracted_text_json, metadata_json, uploaded_by, created_at
          ) VALUES (?, ?, 'source', 1, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          srcVerId,
          docId,
          storedSource.cleanFilename,
          storedSource.storedFilename,
          storedSource.sha256,
          storedSource.sizeBytes,
          extractedSource.pageCount,
          extractedSource.extractionStatus,
          JSON.stringify(extractedSource.pages),
          JSON.stringify(extractedSource.metadata),
          auth.user.id,
          now
        );
      }

      recordAudit(db, auth.activeWorkspace.id, auth.user.id, 'document', docId, 'document.uploaded', {
        title,
        pages: extractedPrimary.pageCount,
        extractionStatus: extractedPrimary.extractionStatus,
        kind,
      });
    });

    return reply.code(201).send({ document: getDocument(db, auth.activeWorkspace.id, docId) });
  });

  app.post('/api/documents/:id/versions', async (req, reply) => {
    const auth = requireRole(req, reply, ['admin', 'reviewer']);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const doc = getDocument(db, auth.activeWorkspace.id, id);
    if (!doc) return reply.code(404).send({ error: 'Document not found' });

    let filePart: { filename: string; buffer: Buffer } | null = null;
    let role: 'primary' | 'source' | 'target' = doc.kind === 'translation' ? 'target' : 'primary';

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        filePart = { filename: part.filename || 'document.pdf', buffer: await part.toBuffer() };
      } else if (part.fieldname === 'role' && ['primary', 'source', 'target'].includes(String(part.value))) {
        role = String(part.value) as 'primary' | 'source' | 'target';
      }
    }

    if (!filePart) return reply.code(400).send({ error: 'PDF file is required.' });
    const check = validatePdfBuffer(filePart.buffer, config.maxUploadBytes);
    if (!check.ok) return reply.code(400).send({ error: check.error });

    let extracted;
    try {
      extracted = await extractPdf(filePart.buffer);
    } catch {
      return reply.code(422).send({ error: 'Could not parse uploaded PDF.' });
    }

    const stored = storeUploadedPdf(config.uploadsDir, filePart.filename, filePart.buffer);
    const maxRow = db
      .prepare('SELECT COALESCE(MAX(version_number), 0) AS n FROM document_versions WHERE document_id = ? AND role = ?')
      .get(id, role) as { n: number };
    const nextVer = Number(maxRow.n) + 1;
    const verId = newId('ver');
    const now = new Date().toISOString();

    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO document_versions (
          id, document_id, role, version_number, original_filename, stored_filename, sha256,
          mime_type, size_bytes, page_count, extraction_status, extracted_text_json, metadata_json, uploaded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        verId,
        id,
        role,
        nextVer,
        stored.cleanFilename,
        stored.storedFilename,
        stored.sha256,
        stored.sizeBytes,
        extracted.pageCount,
        extracted.extractionStatus,
        JSON.stringify(extracted.pages),
        JSON.stringify(extracted.metadata),
        auth.user.id,
        now
      );
      db.prepare('UPDATE documents SET updated_at = ? WHERE id = ?').run(now, id);
      recordAudit(db, auth.activeWorkspace.id, auth.user.id, 'document', id, 'document.version_uploaded', {
        versionNumber: nextVer,
        role,
      });
    });

    return reply.code(201).send({ document: getDocument(db, auth.activeWorkspace.id, id) });
  });

  app.get('/api/documents/:id/versions/:versionId/file', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id, versionId } = req.params as { id: string; versionId: string };
    const info = getDocumentVersionFile(db, auth.activeWorkspace.id, versionId);
    if (!info || info.documentId !== id) {
      return reply.code(404).send({ error: 'Document version not found' });
    }
    const fullPath = resolveStoredPdfPath(config.uploadsDir, info.storedFilename);
    if (!fs.existsSync(fullPath)) {
      return reply.code(404).send({ error: 'Stored file not found' });
    }
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${info.originalFilename.replace(/"/g, '')}"`);
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.send(fs.createReadStream(fullPath));
  });

  app.get('/api/documents/:id/versions/:versionId/pages', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id, versionId } = req.params as { id: string; versionId: string };
    const info = getDocumentVersionFile(db, auth.activeWorkspace.id, versionId);
    if (!info || info.documentId !== id) {
      return reply.code(404).send({ error: 'Document version not found' });
    }
    return {
      pages: info.pages.map((p) => ({
        page: p.page,
        width: p.width,
        height: p.height,
        charCount: p.folded.length,
        excerpt: p.text.slice(0, 400),
      })),
    };
  });

  /* ==================== Glossaries ==================== */
  app.get('/api/glossaries', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    return { glossaries: listGlossaries(db, auth.activeWorkspace.id) };
  });

  app.post('/api/glossaries', async (req, reply) => {
    const auth = requireRole(req, reply, ['admin', 'reviewer']);
    if (!auth) return;
    const parsed = createGlossarySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Invalid glossary' });
    }
    const id = newId('gls');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO glossaries (id, workspace_id, name, source_lang, target_lang, entries_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      auth.activeWorkspace.id,
      parsed.data.name.trim(),
      parsed.data.sourceLang,
      parsed.data.targetLang,
      JSON.stringify(parsed.data.entries),
      auth.user.id,
      now,
      now
    );
    recordAudit(db, auth.activeWorkspace.id, auth.user.id, 'glossary', id, 'glossary.created', {
      name: parsed.data.name.trim(),
      count: parsed.data.entries.length,
    });
    return reply.code(201).send({ glossary: getGlossary(db, auth.activeWorkspace.id, id) });
  });

  app.put('/api/glossaries/:id', async (req, reply) => {
    const auth = requireRole(req, reply, ['admin', 'reviewer']);
    if (!auth) return;
    const { id } = req.params as { id: string };
    if (!getGlossary(db, auth.activeWorkspace.id, id)) {
      return reply.code(404).send({ error: 'Glossary not found' });
    }
    const parsed = createGlossarySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Invalid glossary' });
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE glossaries SET name = ?, source_lang = ?, target_lang = ?, entries_json = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    ).run(
      parsed.data.name.trim(),
      parsed.data.sourceLang,
      parsed.data.targetLang,
      JSON.stringify(parsed.data.entries),
      now,
      id,
      auth.activeWorkspace.id
    );
    return { glossary: getGlossary(db, auth.activeWorkspace.id, id) };
  });

  app.delete('/api/glossaries/:id', async (req, reply) => {
    const auth = requireRole(req, reply, ['admin', 'reviewer']);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const res = db
      .prepare('DELETE FROM glossaries WHERE id = ? AND workspace_id = ?')
      .run(id, auth.activeWorkspace.id);
    if (!res.changes) return reply.code(404).send({ error: 'Glossary not found' });
    return { ok: true };
  });

  /* ==================== Providers ==================== */
  app.get('/api/providers', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    return { providers: registry.listStatuses(db, auth.activeWorkspace.id, config) };
  });

  app.patch('/api/providers/:key', async (req, reply) => {
    const auth = requireRole(req, reply, ['admin']);
    if (!auth) return;
    const keyParsed = providerKeySchema.safeParse((req.params as { key: string }).key);
    if (!keyParsed.success) {
      return reply.code(400).send({ error: 'Unknown provider key' });
    }
    const bodyParsed = updateProviderSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({ error: 'Invalid provider settings' });
    }
    registry.updateWorkspaceConfig(
      db,
      auth.activeWorkspace.id,
      keyParsed.data,
      bodyParsed.data.enabled,
      bodyParsed.data.model
    );
    recordAudit(
      db,
      auth.activeWorkspace.id,
      auth.user.id,
      'provider',
      keyParsed.data,
      bodyParsed.data.enabled ? 'provider.enabled' : 'provider.disabled',
      { model: bodyParsed.data.model }
    );
    return { providers: registry.listStatuses(db, auth.activeWorkspace.id, config) };
  });

  /* ==================== Reviews ==================== */
  app.get('/api/reviews', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    return { reviews: listReviews(db, auth.activeWorkspace.id) };
  });

  app.post('/api/reviews', async (req, reply) => {
    const auth = requireRole(req, reply, ['admin', 'reviewer']);
    if (!auth) return;
    const parsed = createReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message || 'Invalid review configuration' });
    }
    const input = parsed.data;
    const doc = getDocument(db, auth.activeWorkspace.id, input.documentId);
    if (!doc || !doc.latestVersion) {
      return reply.code(404).send({ error: 'Document not found' });
    }

    const versionId = input.documentVersionId || doc.latestVersion.id;
    const verValid = doc.versions?.find((v) => v.id === versionId);
    if (!verValid) {
      return reply.code(400).send({ error: 'Selected document version does not belong to this document.' });
    }
    if (verValid.extractionStatus === 'ocr_required') {
      return reply.code(422).send({
        error:
          'This document appears to be a scanned image PDF with no extractable text. OCR is required before running automated review.',
      });
    }

    const sourceVersionId =
      input.sourceVersionId !== undefined
        ? input.sourceVersionId
        : doc.sourceVersion?.id || null;

    const reviewId = newId('rev');
    const now = new Date().toISOString();

    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO reviews (
          id, workspace_id, document_id, document_version_id, source_version_id,
          review_type, config_json, status, progress_pct, current_stage, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 5, 'Queued for analysis', ?, ?)`
      ).run(
        reviewId,
        auth.activeWorkspace.id,
        doc.id,
        versionId,
        sourceVersionId,
        input.reviewType,
        JSON.stringify({
          checks: input.checks,
          providers: input.providers,
          depth: input.depth,
          sourceLang: input.sourceLang,
          targetLang: input.targetLang ?? doc.targetLang ?? null,
          instructions: input.instructions,
          glossaryId: input.glossaryId ?? null,
          regulatoryRef: input.regulatoryRef ?? null,
        }),
        auth.user.id,
        now
      );

      recordAudit(db, auth.activeWorkspace.id, auth.user.id, 'review', reviewId, 'review.started', {
        documentTitle: doc.title,
        providers: input.providers,
        reviewType: input.reviewType,
      });
    });

    orchestrator.enqueue(reviewId, auth.activeWorkspace.id, auth.user.id);
    return reply.code(201).send({ review: getReview(db, auth.activeWorkspace.id, reviewId) });
  });

  app.get('/api/reviews/:id', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const review = getReview(db, auth.activeWorkspace.id, id);
    if (!review) return reply.code(404).send({ error: 'Review not found' });
    return { review };
  });

  app.post('/api/reviews/:id/cancel', async (req, reply) => {
    const auth = requireRole(req, reply, ['admin', 'reviewer']);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const review = getReview(db, auth.activeWorkspace.id, id);
    if (!review) return reply.code(404).send({ error: 'Review not found' });
    const cancelled = orchestrator.cancel(id, auth.activeWorkspace.id, auth.user.id);
    return { cancelled, review: getReview(db, auth.activeWorkspace.id, id) };
  });

  app.get('/api/reviews/:id/findings', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const review = getReview(db, auth.activeWorkspace.id, id);
    if (!review) return reply.code(404).send({ error: 'Review not found' });
    return { review, findings: listFindings(db, auth.activeWorkspace.id, id) };
  });

  app.get('/api/reviews/:id/summary', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const summary = getReviewSummary(db, auth.activeWorkspace.id, id);
    if (!summary) return reply.code(404).send({ error: 'Review not found' });
    return summary;
  });

  app.get('/api/reviews/:id/export', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const query = req.query as { format?: string; scope?: string };
    const fmtParsed = exportFormatSchema.safeParse(query.format || 'csv');
    if (!fmtParsed.success) {
      return reply.code(400).send({ error: 'Unsupported export format. Use csv, md, json, or pdf.' });
    }
    const format = fmtParsed.data;
    const scope: 'all' | 'approved' = query.scope === 'approved' ? 'approved' : 'all';

    const summary = getReviewSummary(db, auth.activeWorkspace.id, id);
    if (!summary) return reply.code(404).send({ error: 'Review not found' });

    const allFindings = listFindings(db, auth.activeWorkspace.id, id);
    const findings = filterExportFindings(allFindings, scope);
    const slug = (summary.review.documentTitle || 'vidimus-review')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);

    db.prepare(
      `INSERT INTO exports (id, review_id, format, scope, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(newId('exp'), id, format, scope, auth.user.id, new Date().toISOString());

    recordAudit(db, auth.activeWorkspace.id, auth.user.id, 'review', id, 'review.exported', {
      format,
      scope,
      count: findings.length,
    });

    if (format === 'csv') {
      const body = generateCsvExport(findings);
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${slug}-${scope}.csv"`);
      return reply.send(body);
    }
    if (format === 'md') {
      const body = generateMarkdownExport(summary.review, summary, findings, auth.user.name, scope);
      reply.header('Content-Type', 'text/markdown; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${slug}-${scope}.md"`);
      return reply.send(body);
    }
    if (format === 'json') {
      const body = generateJsonExport(summary.review, summary, findings, auth.user.name, scope);
      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${slug}-${scope}.json"`);
      return reply.send(body);
    }

    const pdfBuf = await generatePdfReport(summary.review, summary, findings, auth.user.name, scope);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${slug}-${scope}-report.pdf"`);
    return reply.send(pdfBuf);
  });

  /* ==================== Finding Actions ==================== */
  app.post('/api/findings/:id/decisions', async (req, reply) => {
    const auth = requireRole(req, reply, ['admin', 'reviewer']);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid decision verdict.' });
    }
    const updated = recordFindingDecision(
      db,
      auth.activeWorkspace.id,
      id,
      auth.user.id,
      parsed.data.verdict,
      parsed.data.note
    );
    if (!updated) return reply.code(404).send({ error: 'Finding not found' });
    return { finding: updated };
  });

  app.patch('/api/findings/:id/suggestion', async (req, reply) => {
    const auth = requireRole(req, reply, ['admin', 'reviewer']);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = editSuggestionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Suggestion text cannot be empty.' });
    }
    const updated = editFindingSuggestion(
      db,
      auth.activeWorkspace.id,
      id,
      auth.user.id,
      parsed.data.suggestion
    );
    if (!updated) return reply.code(404).send({ error: 'Finding not found' });
    return { finding: updated };
  });

  app.post('/api/findings/:id/comments', async (req, reply) => {
    const auth = requireRole(req, reply, ['admin', 'reviewer']);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Comment body cannot be empty.' });
    }
    const updated = addFindingComment(db, auth.activeWorkspace.id, id, auth.user.id, parsed.data.body);
    if (!updated) return reply.code(404).send({ error: 'Finding not found' });
    return { finding: updated };
  });

  app.get('/api/findings/:id', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const finding = getFindingById(db, auth.activeWorkspace.id, id);
    if (!finding) return reply.code(404).send({ error: 'Finding not found' });
    return { finding };
  });

  /* ==================== Static Frontend (production build) ==================== */
  const webDist = path.join(REPO_ROOT, 'web', 'dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Endpoint not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler(async (req, reply) => {
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return { app, db, config, registry, orchestrator };
}
