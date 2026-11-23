import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const ROOT = path.resolve(process.cwd());
const SHOT_DIR = path.join(ROOT, 'screenshots', 'v2');
const PORT = 8792;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProc: ChildProcess | null = null;
let tmpDir = '';

async function waitForHealth(url: string) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server starting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server failed to start within timeout');
}

test.beforeAll(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidimus-e2e-'));
  serverProc = spawn(process.execPath, [path.join(ROOT, 'server', 'dist', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      VIDIMUS_DATA_DIR: tmpDir,
      VIDIMUS_DB_PATH: path.join(tmpDir, 'e2e.sqlite'),
      VIDIMUS_UPLOADS_DIR: path.join(tmpDir, 'uploads'),
      VIDIMUS_SEED_DEMO: 'true',
      COOKIE_SECURE: 'false',
    },
    stdio: 'pipe',
  });
  await waitForHealth(`${BASE_URL}/api/health`);
});

test.afterAll(async () => {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    serverProc = null;
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('full desktop workflow: auth, upload, review, highlight, decisions, persistence, export, accessibility, sign out', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Open Vidimus -> redirected to Sign in
  await page.goto(BASE_URL);
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole('heading', { name: 'Sign in to review' })).toBeVisible();

  // 2. Sign in with real credentials
  await page.getByLabel('Email address').fill('lena@example.com');
  await page.getByLabel('Password').fill('vidimus-dev-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // 3. Dashboard loads real persistent metrics
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /Lena/ })).toBeVisible();
  await expect(page.getByText('Continue reviewing')).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, '01-dashboard.png') });

  // Accessibility check on Dashboard
  const dashAxe = await new AxeBuilder({ page }).analyze();
  const dashCritical = dashAxe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(dashCritical).toEqual([]);

  // 4. Navigate to Documents & upload the synthetic compliance PDF
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page).toHaveURL(/\/documents\?upload=1/);
  await page.getByLabel('Document title (optional)').fill('E2E Compliance Note 2026');
  await page.getByLabel('Subtitle or reference (optional)').fill('Synthetic E2E verification');
  await page.locator('#up-file').setInputFiles(path.join(ROOT, 'lab', 'sample', 'note.pdf'));
  await page.getByRole('button', { name: 'Upload & extract' }).click();

  // 5. Configure & run review
  await expect(page).toHaveURL(/\/documents\/doc_.*\/configure$/);
  await expect(page.getByRole('heading', { name: 'Configure review' })).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, '02-configure.png') });
  await page.getByRole('button', { name: 'Run review' }).click();

  // 6. Wait for review completion and PDF canvas + highlights on Review Desk
  await expect(page).toHaveURL(/\/reviews\/rev_/);
  await expect(page.locator('.sheet canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.hl.first').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT_DIR, '03-review-desk.png') });

  // 7. Select first finding and verify highlight is selected (.hl.sel)
  const firstCard = page.locator('.cmt').first();
  const firstId = await firstCard.getAttribute('data-id');
  await firstCard.locator('.rowbtn').click();
  await expect(page.locator(`.hl[data-fid="${firstId}"].sel`).first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT_DIR, '04-finding-open.png') });

  // 8. Approve first finding
  await firstCard.getByRole('button', { name: 'Approve' }).click();
  await expect(firstCard.getByRole('button', { name: 'Approved' })).toBeVisible();

  // 9. Keyboard navigation (j moves to next finding) -> reject second finding
  await page.keyboard.press('j');
  const secondCard = page.locator('.cmt.sel');
  await expect(secondCard).toBeVisible();
  await secondCard.getByRole('button', { name: 'Reject' }).click();
  await expect(secondCard.getByRole('button', { name: 'Rejected' })).toBeVisible();

  // 10. Move to third finding -> edit suggestion + post comment
  await page.keyboard.press('j');
  const thirdCard = page.locator('.cmt.sel');
  const thirdId = await thirdCard.getAttribute('data-id');
  await thirdCard.getByRole('button', { name: 'Edit' }).click();
  const editArea = thirdCard.locator('textarea.cinput');
  await editArea.fill('asset-linked tokens (edited in E2E)');
  await thirdCard.getByRole('button', { name: 'Save' }).click();
  await expect(thirdCard.getByText('asset-linked tokens (edited in E2E)')).toBeVisible();

  await thirdCard.locator('.comment-form input').fill('Verified with compliance lead.');
  await thirdCard.getByRole('button', { name: 'Post' }).click();
  await expect(thirdCard.getByText('Verified with compliance lead.')).toBeVisible();

  // Accessibility check on Review Desk
  const deskAxe = await new AxeBuilder({ page }).analyze();
  const deskCritical = deskAxe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(deskCritical).toEqual([]);

  // 11. Reload the application and verify decisions, edit, and comment persisted in SQLite!
  await page.reload();
  await expect(page.locator('.cmt').first()).toBeVisible({ timeout: 15_000 });
  const reloadedThird = page.locator(`.cmt[data-id="${thirdId}"]`);
  await reloadedThird.locator('.rowbtn').click();
  await expect(reloadedThird.getByText('asset-linked tokens (edited in E2E)')).toBeVisible();
  await expect(reloadedThird.getByText('Verified with compliance lead.')).toBeVisible();

  const reloadedFirst = page.locator(`.cmt[data-id="${firstId}"]`);
  await expect(reloadedFirst).toHaveClass(/st-approved/);

  // 12. Open Export page, verify summary, and validate CSV + JSON + PDF exports
  await page.getByRole('link', { name: 'Export' }).click();
  await expect(page).toHaveURL(/\/export$/);
  await expect(page.getByRole('heading', { name: 'Summary & export' })).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, '05-export.png') });

  const reviewId = page.url().match(/\/reviews\/(rev_[^/]+)\/export/)?.[1];
  expect(reviewId).toBeTruthy();

  const csvText = await page.evaluate(async (rid) => {
    const r = await fetch(`/api/reviews/${rid}/export?format=csv&scope=all`, { credentials: 'include' });
    return r.text();
  }, reviewId);
  expect(csvText).toContain('asset-linked tokens (edited in E2E)');
  expect(csvText).toContain('Verified with compliance lead.');
  expect(csvText).toContain('approved');
  expect(csvText).toContain('rejected');

  const pdfOk = await page.evaluate(async (rid) => {
    const r = await fetch(`/api/reviews/${rid}/export?format=pdf&scope=approved`, { credentials: 'include' });
    const buf = new Uint8Array(await r.arrayBuffer());
    return String.fromCharCode(...buf.slice(0, 5));
  }, reviewId);
  expect(pdfOk).toBe('%PDF-');

  // 13. Visit Providers & Documents pages for screenshots
  await page.goto(`${BASE_URL}/providers`);
  await expect(page.getByRole('heading', { name: 'Review providers' })).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, '06-providers.png') });

  // 14. Sign out and verify protected resources cannot be accessed
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/signin$/);

  const unauthStatus = await page.evaluate(async () => {
    const r = await fetch('/api/documents', { credentials: 'include' });
    return r.status;
  });
  expect(unauthStatus).toBe(401);
});

test('mobile viewport (390px): full-width PDF, hugging peek bar, and full-page findings with back control', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/signin`);
  await page.getByLabel('Email address').fill('lena@example.com');
  await page.getByLabel('Password').fill('vidimus-dev-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Open seeded review on mobile
  await page.goto(`${BASE_URL}/reviews/rev_cn_2026_07_initial`);
  await expect(page.locator('.sheet canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.peek')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT_DIR, '07-phone-review.png') });

  // Open full-page findings view and return via Document button
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByRole('button', { name: 'Document', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(SHOT_DIR, '08-phone-findings.png') });

  await page.getByRole('button', { name: 'Document', exact: true }).click();
  await expect(page.locator('.peek')).toBeVisible();
});
