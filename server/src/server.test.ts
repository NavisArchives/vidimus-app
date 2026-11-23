import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type ServerBundle } from './app.js';
import { REPO_ROOT } from './config.js';
import { DEV_PASSWORD } from './db/seed.js';
import { ProviderRegistry } from './providers/registry.js';
import { parseUntrustedModelJson, type ReviewProvider } from './providers/types.js';
import { anchorQuoteToPage, extractPdf } from './services/pdf.js';

async function makeSimplePdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  let y = 780;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 20;
  }
  return Buffer.from(await doc.save());
}

async function makeBlankPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

function buildMultipart(
  fields: Record<string, string>,
  files: Array<{ field: string; filename: string; content: Buffer; mime?: string }>
) {
  const boundary = '----VidimusTestBoundary7MA4YWxkTrZu0gW';
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
      )
    );
  }
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${
          f.mime || 'application/pdf'
        }\r\n\r\n`
      )
    );
    chunks.push(f.content);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function loginAs(bundle: ServerBundle, email: string, password = DEV_PASSWORD) {
  const res = await bundle.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0].split(';')[0] : String(setCookie).split(';')[0];
  const body = res.json();
  return { cookie: cookieHeader, csrf: body.csrfToken as string, user: body.user, workspace: body.activeWorkspace };
}

async function waitForReview(bundle: ServerBundle, cookie: string, reviewId: string) {
  for (let i = 0; i < 40; i++) {
    const res = await bundle.app.inject({
      method: 'GET',
      url: `/api/reviews/${reviewId}`,
      headers: { cookie },
    });
    const rev = res.json().review;
    if (rev.status !== 'queued' && rev.status !== 'running') return rev;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('Review did not finish in time');
}

describe('Vidimus backend integration, security, and provider orchestration', () => {
  let tmpDir: string;
  let bundle: ServerBundle;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidimus-test-'));
    bundle = await buildApp({
      nodeEnv: 'test',
      dbPath: path.join(tmpDir, 'test.sqlite'),
      uploadsDir: path.join(tmpDir, 'uploads'),
      seedDemo: true,
    });
  });

  afterEach(async () => {
    await bundle.app.close();
    bundle.db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts and anchors exact quotes from the synthetic compliance PDF', async () => {
    const pdfBuf = fs.readFileSync(path.join(REPO_ROOT, 'lab', 'sample', 'note.pdf'));
    const extracted = await extractPdf(pdfBuf);
    expect(extracted.pageCount).toBe(4);
    expect(extracted.extractionStatus).toBe('ready');

    const hit = anchorQuoteToPage(extracted.pages[0], 'minimum capital of €150,000');
    expect(hit.status).toBe('exact');
    expect(hit.evidence?.rects.length).toBeGreaterThan(0);

    const miss = anchorQuoteToPage(extracted.pages[0], 'sentence not in pdf');
    expect(miss.status).toBe('unresolved');
    expect(miss.evidence?.rects).toEqual([]);
  });

  it('enforces authentication, CSRF tokens, RBAC, and workspace isolation', async () => {
    // Unauthenticated rejected
    const unauth = await bundle.app.inject({ method: 'GET', url: '/api/documents' });
    expect(unauth.statusCode).toBe(401);

    // Invalid password rejected
    const badLogin = await bundle.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'lena@example.com', password: 'wrong-password' },
    });
    expect(badLogin.statusCode).toBe(401);

    // Viewer can read, but cannot mutate or upload
    const viewer = await loginAs(bundle, 'auditor@example.com');
    const docsRes = await bundle.app.inject({
      method: 'GET',
      url: '/api/documents',
      headers: { cookie: viewer.cookie },
    });
    expect(docsRes.statusCode).toBe(200);

    // Missing CSRF rejected with 403
    const noCsrf = await bundle.app.inject({
      method: 'POST',
      url: '/api/findings/fnd_seed_01/decisions',
      headers: { cookie: viewer.cookie },
      payload: { verdict: 'approved' },
    });
    expect(noCsrf.statusCode).toBe(403);

    // Viewer with valid CSRF still rejected with 403 by RBAC
    const viewerMutate = await bundle.app.inject({
      method: 'POST',
      url: '/api/findings/fnd_seed_01/decisions',
      headers: { cookie: viewer.cookie, 'x-csrf-token': viewer.csrf },
      payload: { verdict: 'approved' },
    });
    expect(viewerMutate.statusCode).toBe(403);

    // Reviewer cannot modify admin-only provider config
    const reviewer = await loginAs(bundle, 'sam@example.com');
    const provForbidden = await bundle.app.inject({
      method: 'PATCH',
      url: '/api/providers/deterministic',
      headers: { cookie: reviewer.cookie, 'x-csrf-token': reviewer.csrf },
      payload: { enabled: false },
    });
    expect(provForbidden.statusCode).toBe(403);

    // New user in isolated workspace cannot see Oeverlicht documents
    const reg = await bundle.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'outsider@example.com',
        name: 'Outsider User',
        password: 'secure-password-123',
      },
    });
    expect(reg.statusCode).toBe(201);
    const outCookie = String(reg.headers['set-cookie']).split(';')[0];
    const stealDoc = await bundle.app.inject({
      method: 'GET',
      url: '/api/documents/doc_cn_2026_07',
      headers: { cookie: outCookie },
    });
    expect(stealDoc.statusCode).toBe(404);
  });

  it('rejects malformed files and detects scanned PDFs as ocr_required', async () => {
    const admin = await loginAs(bundle, 'lena@example.com');

    // Malformed non-PDF upload
    const badMp = buildMultipart(
      { title: 'Not a PDF' },
      [{ field: 'file', filename: 'fake.pdf', content: Buffer.from('plain text not pdf') }]
    );
    const badRes = await bundle.app.inject({
      method: 'POST',
      url: '/api/documents/upload',
      headers: {
        cookie: admin.cookie,
        'x-csrf-token': admin.csrf,
        'content-type': badMp.contentType,
      },
      payload: badMp.body,
    });
    expect(badRes.statusCode).toBe(400);

    // Blank/scanned PDF detected as ocr_required
    const blankPdf = await makeBlankPdf();
    const blankMp = buildMultipart(
      { title: 'Scanned Document' },
      [{ field: 'file', filename: 'scan.pdf', content: blankPdf }]
    );
    const scanRes = await bundle.app.inject({
      method: 'POST',
      url: '/api/documents/upload',
      headers: {
        cookie: admin.cookie,
        'x-csrf-token': admin.csrf,
        'content-type': blankMp.contentType,
      },
      payload: blankMp.body,
    });
    expect(scanRes.statusCode).toBe(201);
    const scanDoc = scanRes.json().document;
    expect(scanDoc.latestVersion.extractionStatus).toBe('ocr_required');

    // Trying to run automated review on ocr_required PDF returns 422
    const runScan = await bundle.app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      payload: { documentId: scanDoc.id, providers: ['deterministic'] },
    });
    expect(runScan.statusCode).toBe(422);
  });

  it('runs end-to-end upload, review, decisions, comments, and all 4 export formats', async () => {
    const admin = await loginAs(bundle, 'lena@example.com');
    const pdfBuf = await makeSimplePdf([
      'Compliance filing submitted on 31 June 2026.',
      'The report covers governance and the the custody controls.',
      'The prospectus states a reserve of EUR 1,000,0000.',
    ]);

    const mp = buildMultipart(
      { title: 'Q4 Compliance Draft', subtitle: 'Synthetic test', sourceLang: 'en' },
      [{ field: 'file', filename: 'q4-draft.pdf', content: pdfBuf }]
    );
    const up = await bundle.app.inject({
      method: 'POST',
      url: '/api/documents/upload',
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, 'content-type': mp.contentType },
      payload: mp.body,
    });
    expect(up.statusCode).toBe(201);
    const doc = up.json().document;
    expect(doc.latestVersion.pageCount).toBe(1);

    // Run review with deterministic analyzer + seeded glossary
    const revCreate = await bundle.app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      payload: {
        documentId: doc.id,
        reviewType: 'regulatory',
        providers: ['deterministic'],
        glossaryId: 'gls_cafr',
      },
    });
    expect(revCreate.statusCode).toBe(201);
    const rev = await waitForReview(bundle, admin.cookie, revCreate.json().review.id);
    expect(rev.status).toBe('completed');

    const findingsRes = await bundle.app.inject({
      method: 'GET',
      url: `/api/reviews/${rev.id}/findings`,
      headers: { cookie: admin.cookie },
    });
    const findings = findingsRes.json().findings;
    expect(findings.length).toBeGreaterThanOrEqual(3); // date + repeated word + glossary violation

    // Approve first, reject second, edit & comment on first
    await bundle.app.inject({
      method: 'POST',
      url: `/api/findings/${findings[0].id}/decisions`,
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      payload: { verdict: 'approved' },
    });
    await bundle.app.inject({
      method: 'PATCH',
      url: `/api/findings/${findings[0].id}/suggestion`,
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      payload: { suggestion: 'submitted on 30 June 2026 (verified)' },
    });
    await bundle.app.inject({
      method: 'POST',
      url: `/api/findings/${findings[0].id}/comments`,
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      payload: { body: 'Confirmed with legal team.' },
    });
    await bundle.app.inject({
      method: 'POST',
      url: `/api/findings/${findings[1].id}/decisions`,
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      payload: { verdict: 'rejected' },
    });

    // Verify CSV, Markdown, JSON, and PDF exports
    const csvRes = await bundle.app.inject({
      method: 'GET',
      url: `/api/reviews/${rev.id}/export?format=csv&scope=approved`,
      headers: { cookie: admin.cookie },
    });
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.body).toContain('submitted on 30 June 2026 (verified)');
    expect(csvRes.body).toContain('Confirmed with legal team.');

    const mdRes = await bundle.app.inject({
      method: 'GET',
      url: `/api/reviews/${rev.id}/export?format=md&scope=all`,
      headers: { cookie: admin.cookie },
    });
    expect(mdRes.statusCode).toBe(200);
    expect(mdRes.body).toContain('## Human-Approved Corrections');
    expect(mdRes.body).toContain('## Unapproved, Rejected, Deferred, and Open Suggestions');

    const jsonRes = await bundle.app.inject({
      method: 'GET',
      url: `/api/reviews/${rev.id}/export?format=json&scope=all`,
      headers: { cookie: admin.cookie },
    });
    expect(jsonRes.statusCode).toBe(200);
    const exportedJson = jsonRes.json();
    expect(exportedJson.approvedCorrections).toHaveLength(1);

    const pdfRes = await bundle.app.inject({
      method: 'GET',
      url: `/api/reviews/${rev.id}/export?format=pdf&scope=all`,
      headers: { cookie: admin.cookie },
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('handles translation pair uploads and detects untranslated text & numeric mismatches', async () => {
    const admin = await loginAs(bundle, 'lena@example.com');
    const srcPdf = await makeSimplePdf([
      'Le capital minimum requis est de 125000 euros.',
      'Tous les actifs des clients doivent rester proteges en conservation froide.',
    ]);
    const tgtPdf = await makeSimplePdf([
      'Het vereiste minimumkapitaal bedraagt 150000 euro.',
      'Tous les actifs des clients doivent rester proteges en conservation froide.',
    ]);

    const mp = buildMultipart(
      { title: 'Custody Policy NL', kind: 'translation', sourceLang: 'fr', targetLang: 'nl' },
      [
        { field: 'file', filename: 'policy-nl.pdf', content: tgtPdf },
        { field: 'sourceFile', filename: 'policy-fr.pdf', content: srcPdf },
      ]
    );
    const up = await bundle.app.inject({
      method: 'POST',
      url: '/api/documents/upload',
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, 'content-type': mp.contentType },
      payload: mp.body,
    });
    expect(up.statusCode).toBe(201);
    const doc = up.json().document;
    expect(doc.kind).toBe('translation');
    expect(doc.sourceVersion).not.toBeNull();

    const revCreate = await bundle.app.inject({
      method: 'POST',
      url: '/api/reviews',
      headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      payload: {
        documentId: doc.id,
        reviewType: 'translation',
        providers: ['deterministic'],
        sourceLang: 'fr',
        targetLang: 'nl',
      },
    });
    const rev = await waitForReview(bundle, admin.cookie, revCreate.json().review.id);
    expect(rev.status).toBe('completed');

    const fRes = await bundle.app.inject({
      method: 'GET',
      url: `/api/reviews/${rev.id}/findings`,
      headers: { cookie: admin.cookie },
    });
    const findings = fRes.json().findings;
    expect(findings.some((f: { category: string }) => f.category === 'translation')).toBe(true);
    expect(findings.some((f: { category: string }) => f.category === 'figures')).toBe(true);
  });

  it('survives partial provider failures, rejects invalid model output, and recovers interrupted jobs', async () => {
    // Parse guard rejects malformed model JSON
    expect(() => parseUntrustedModelJson('not valid json', 'anthropic', 'm', 'live', 4)).toThrow();

    // Register a mock failing provider alongside deterministic analyzer
    const failingMock: ReviewProvider = {
      key: 'openai',
      name: 'OpenAI',
      kind: 'AI model',
      description: 'Mock failing provider',
      externalProcessing: true,
      getStatus: () => ({
        key: 'openai',
        name: 'OpenAI',
        kind: 'AI model',
        description: 'Mock',
        enabled: true,
        configured: true,
        mode: 'live',
        model: 'mock-fail',
        externalProcessing: true,
        notice: 'Mock',
      }),
      analyze: async () => {
        throw new Error('Simulated upstream 429 rate limit');
      },
    };

    const customReg = new ProviderRegistry();
    customReg.register(failingMock);
    const bundle2 = await buildApp(
      {
        nodeEnv: 'test',
        dbPath: path.join(tmpDir, 'test2.sqlite'),
        uploadsDir: path.join(tmpDir, 'uploads2'),
        seedDemo: true,
      },
      customReg
    );

    try {
      const admin = await loginAs(bundle2, 'lena@example.com');
      const revCreate = await bundle2.app.inject({
        method: 'POST',
        url: '/api/reviews',
        headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
        payload: {
          documentId: 'doc_cn_2026_07',
          providers: ['deterministic', 'openai'],
        },
      });
      const rev = await waitForReview(bundle2, admin.cookie, revCreate.json().review.id);
      expect(rev.status).toBe('completed_with_errors');
      expect(rev.errorMessage).toContain('Simulated upstream 429 rate limit');
      expect(rev.counts.total).toBeGreaterThan(0);

      // Simulate interrupted running job & test recovery
      bundle2.db
        .prepare(`UPDATE reviews SET status = 'running' WHERE id = ?`)
        .run(rev.id);
      const recovered = bundle2.orchestrator.recoverInterruptedReviews();
      expect(recovered).toBe(1);
    } finally {
      await bundle2.app.close();
      bundle2.db.close();
    }
  });
});
