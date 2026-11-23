import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { runLayoutAudit, type LayoutAuditResult } from './layout-audit.js';

const ROOT = path.resolve(process.cwd());
const QA_DIR = path.join(ROOT, 'qa', 'visual');
const PHASE = process.env.VIDIMUS_QA_PHASE || 'current';
const SHOT_DIR = path.join(QA_DIR, 'screenshots', PHASE);
const DISCOVERY_MODE = process.env.VIDIMUS_QA_DISCOVER === '1';

const PORT = 8794;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const VIEWPORTS = [
  { name: '320-small-mobile', width: 320, height: 568 },
  { name: '360-android', width: 360, height: 800 },
  { name: '375-iphone', width: 375, height: 812 },
  { name: '390-modern-iphone', width: 390, height: 844 },
  { name: '430-large-mobile', width: 430, height: 932 },
  { name: '768-tablet', width: 768, height: 1024 },
  { name: '1024-small-laptop', width: 1024, height: 768 },
  { name: '1280-laptop', width: 1280, height: 800 },
  { name: '1440-desktop', width: 1440, height: 900 },
  { name: '1920-large-desktop', width: 1920, height: 1080 },
];

const BREAKPOINT_EDGE_WIDTHS = [
  { name: '761-post-mobile', width: 761, height: 900 },
  { name: '960-mid-tablet', width: 960, height: 860 },
  { name: '1020-dash-stack', width: 1020, height: 800 },
  { name: '1180-narrow-desk', width: 1180, height: 840 },
];

let serverProc: ChildProcess | null = null;
let tmpDir = '';
const auditLog: LayoutAuditResult[] = [];

async function waitForHealth(url: string) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('QA server failed to start');
}

async function seedStressFixtures(page: import('@playwright/test').Page) {
  // Sign in as Lena (admin) and create realistic long-content stress records via real API
  await page.goto(`${BASE_URL}/signin`);
  await page.getByLabel('Email address').fill('lena@example.com');
  await page.getByLabel('Password').fill('vidimus-dev-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Create a stress document with a long title, long subtitle, and run a review + record rich audit events
  await page.goto(`${BASE_URL}/documents?upload=1`);
  await page
    .getByLabel('Document title (optional)')
    .fill(
      'Cross-Border Crypto-Asset Custody, Segregation and Operational Resilience Assessment 2026-Q4 (REF-CAFR-2026-00018492019-APPENDIX-B)'
    );
  await page
    .getByLabel('Subtitle or reference (optional)')
    .fill(
      'Oeverlicht Custody B.V. · Multi-jurisdictional supervisory submission for Digital Assets Supervisory Authority'
    );
  await page.locator('#up-file').setInputFiles(path.join(ROOT, 'lab', 'sample', 'note.pdf'));
  await page.getByRole('button', { name: 'Upload & extract' }).click();
  await expect(page).toHaveURL(/\/documents\/doc_.*\/configure$/);
  await page.getByRole('button', { name: 'Run review' }).click();
  await expect(page).toHaveURL(/\/reviews\/rev_/);
  await expect(page.locator('.sheet canvas').first()).toBeVisible({ timeout: 20_000 });

  // Add several decisions & long comments to populate Audit History with rich realistic data
  const firstCard = page.locator('.cmt').first();
  await firstCard.locator('.rowbtn').click();
  await firstCard.getByRole('button', { name: 'Approve' }).click();
  await firstCard
    .locator('.comment-form input')
    .fill(
      'Verified figure against Table 1 and quarterly treasury statement REF-TREAS-2026-998877665544332211.'
    );
  await firstCard.getByRole('button', { name: 'Post' }).click();

  // Also register a second user with a long name and sign back in as Lena
  await page.evaluate(async () => {
    const meRes = await fetch('/api/auth/me', { credentials: 'include' });
    const me = await meRes.json();
    // Add extra decisions on seeded review to populate history
    for (const fid of ['fnd_seed_02', 'fnd_seed_03', 'fnd_seed_04']) {
      await fetch(`/api/findings/${fid}/decisions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrfToken },
        body: JSON.stringify({ verdict: fid === 'fnd_seed_03' ? 'deferred' : 'approved' }),
      });
    }
  });
}

test.beforeAll(async ({ browser }) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidimus-vqa-'));
  serverProc = spawn(process.execPath, [path.join(ROOT, 'server', 'dist', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      VIDIMUS_DATA_DIR: tmpDir,
      VIDIMUS_DB_PATH: path.join(tmpDir, 'vqa.sqlite'),
      VIDIMUS_UPLOADS_DIR: path.join(tmpDir, 'uploads'),
      VIDIMUS_SEED_DEMO: 'true',
      COOKIE_SECURE: 'false',
      VIDIMUS_RATE_LIMIT_MAX: '5000',
    },
    stdio: 'pipe',
  });
  await waitForHealth(`${BASE_URL}/api/health`);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await seedStressFixtures(page);
  await ctx.close();
});

test.afterAll(async () => {
  fs.writeFileSync(
    path.join(QA_DIR, `run-${PHASE}.json`),
    JSON.stringify({ phase: PHASE, timestamp: new Date().toISOString(), results: auditLog }, null, 2)
  );
  if (serverProc) {
    serverProc.kill('SIGTERM');
    serverProc = null;
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

async function signIn(page: import('@playwright/test').Page) {
  await page.goto(`${BASE_URL}/signin`);
  await page.getByLabel('Email address').fill('lena@example.com');
  await page.getByLabel('Password').fill('vidimus-dev-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('audit all 10 responsive viewports + breakpoint edges across primary routes', async ({ page }) => {
  await signIn(page);

  const routes = [
    { slug: 'dashboard', url: '/dashboard', ready: 'h1' },
    { slug: 'reviews', url: '/reviews', ready: '.alist' },
    { slug: 'documents', url: '/documents', ready: '.doctable' },
    { slug: 'providers', url: '/providers', ready: '.toolsgrid' },
    { slug: 'glossaries', url: '/glossaries', ready: 'h1' },
    { slug: 'review-desk', url: '/reviews/rev_cn_2026_07_initial', ready: '.sheet canvas' },
    { slug: 'export', url: '/reviews/rev_cn_2026_07_initial/export', ready: '.ex-table' },
  ];

  const keyWidthsForAllRoutes = new Set([320, 390, 768, 1024, 1440, 1920]);
  const allTargets = [...VIEWPORTS, ...BREAKPOINT_EDGE_WIDTHS];

  for (const vp of allTargets) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const routeSet = keyWidthsForAllRoutes.has(vp.width)
      ? routes
      : routes.filter((r) => r.slug === 'dashboard' || r.slug === 'reviews' || r.slug === 'review-desk');

    for (const r of routeSet) {
      await page.goto(`${BASE_URL}${r.url}`);
      await expect(page.locator(r.ready).first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(150);

      const res = await runLayoutAudit(page, {
        route: r.url,
        width: vp.width,
        height: vp.height,
        theme: 'light',
      });
      auditLog.push(res);

      // Capture representative screenshots across key widths
      if (
        (vp.width === 320 || vp.width === 390 || vp.width === 768 || vp.width === 1024 || vp.width === 1280 || vp.width === 1440) &&
        (r.slug === 'dashboard' || r.slug === 'reviews' || r.slug === 'documents' || r.slug === 'review-desk' || r.slug === 'export')
      ) {
        await page.screenshot({
          path: path.join(SHOT_DIR, `${r.slug}-${vp.width}.png`),
          animations: 'disabled',
        });
      }
    }
  }

  if (!DISCOVERY_MODE) {
    const blocking = auditLog.flatMap((r) =>
      r.findings
        .filter((f) => f.severity === 'P0' || f.severity === 'P1')
        .map((f) => `${r.route}@${r.viewport.width}px [${f.check}]: ${f.detail}`)
    );
    expect(blocking, `Blocking P0/P1 layout defects:\n${blocking.join('\n')}`).toEqual([]);
  }
});

test('interactive components: account menu, sidebar, upload modal, filter dropdowns, keyboard & focus return', async ({
  page,
}) => {
  await signIn(page);

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${BASE_URL}/dashboard`);
    await expect(page.getByRole('heading', { name: /Lena/ })).toBeVisible();

    // Open Account Menu -> verify bounds, screenshot, test Escape + focus return!
    const trigger = page.locator('.avbtn');
    await trigger.click();
    const menu = page.locator('.usermenu');
    await expect(menu).toBeVisible();
    await page.waitForTimeout(100);

    const audit = await runLayoutAudit(page, {
      route: '/dashboard#account-menu',
      width,
      height: 844,
      theme: 'light',
    });
    auditLog.push(audit);

    if (width === 320 || width === 390 || width === 1024 || width === 1440) {
      await page.screenshot({
        path: path.join(SHOT_DIR, `account-menu-${width}.png`),
        animations: 'disabled',
      });
    }

    // Escape closes menu and returns focus to trigger
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    if (!DISCOVERY_MODE) {
      const focusedClass = await page.evaluate(() => document.activeElement?.className || '');
      expect(focusedClass).toContain('avbtn');
    }

    // Outside click closes menu
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.locator('h1').click({ position: { x: 10, y: 10 } });
    await expect(menu).toBeHidden();
  }

  // Test Sidebar open on desktop 1024px (competing with content!) and mobile 390px drawer
  for (const width of [390, 1024, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${BASE_URL}/reviews`);
    await expect(page.locator('.alist').first()).toBeVisible();
    const sideBtn = page.getByRole('button', { name: 'Show or hide the sidebar' });
    await sideBtn.click();
    await page.waitForTimeout(280);
    const audit = await runLayoutAudit(page, {
      route: '/reviews#sidebar-open',
      width,
      height: 844,
      theme: 'light',
    });
    auditLog.push(audit);
    await page.screenshot({
      path: path.join(SHOT_DIR, `reviews-sidebar-${width}.png`),
      animations: 'disabled',
    });
    if (width <= 760) {
      await page.getByRole('button', { name: 'Close navigation' }).click();
    } else {
      await sideBtn.click();
    }
    await page.waitForTimeout(250);
  }

  // Test Upload modal open + validation error state
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/documents?upload=1`);
  await expect(page.locator('.modal-card')).toBeVisible();
  await page.getByRole('button', { name: 'Upload & extract' }).click();
  await expect(page.locator('.errbanner')).toBeVisible();
  auditLog.push(
    await runLayoutAudit(page, {
      route: '/documents#upload-error',
      width: 390,
      height: 844,
      theme: 'light',
    })
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, 'upload-modal-error-390.png'),
    animations: 'disabled',
  });

  if (!DISCOVERY_MODE) {
    const interactiveBlockers = auditLog
      .filter((r) => r.route.includes('#'))
      .flatMap((r) =>
        r.findings
          .filter((f) => f.severity === 'P0' || f.severity === 'P1')
          .map((f) => `${r.route}@${r.viewport.width}px [${f.check}]: ${f.detail}`)
      );
    expect(interactiveBlockers).toEqual([]);
  }
});

test('dark theme, browser zoom (100%-200%), and empty workspace state', async ({ page }) => {
  await signIn(page);

  // Switch to Dark Theme via real Account Menu
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.avbtn').click();
  await page.getByRole('menuitem', { name: /dark theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  for (const r of [
    { slug: 'dashboard-dark', url: '/dashboard', ready: 'h1' },
    { slug: 'reviews-dark', url: '/reviews', ready: '.alist' },
    { slug: 'review-desk-dark', url: '/reviews/rev_cn_2026_07_initial', ready: '.sheet canvas' },
    { slug: 'export-dark', url: '/reviews/rev_cn_2026_07_initial/export', ready: '.ex-table' },
  ]) {
    await page.goto(`${BASE_URL}${r.url}`);
    await expect(page.locator(r.ready).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(150);
    auditLog.push(
      await runLayoutAudit(page, {
        route: r.url,
        width: 1440,
        height: 900,
        theme: 'dark',
      })
    );
    await page.screenshot({
      path: path.join(SHOT_DIR, `${r.slug}-1440.png`),
      animations: 'disabled',
    });
  }

  // Switch back to Light Theme
  await page.locator('.avbtn').click();
  await page.getByRole('menuitem', { name: /light theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Browser zoom / scaling tests (100%, 125%, 150%, 200%) on Dashboard & Reviews
  for (const zoomPct of [100, 125, 150, 200]) {
    const effW = Math.round(1440 / (zoomPct / 100));
    const effH = Math.round(900 / (zoomPct / 100));
    await page.setViewportSize({ width: effW, height: effH });
    await page.goto(`${BASE_URL}/reviews`);
    await expect(page.locator('.alist').first()).toBeVisible();
    await page.waitForTimeout(120);
    auditLog.push(
      await runLayoutAudit(page, {
        route: '/reviews',
        width: effW,
        height: effH,
        theme: 'light',
        zoom: zoomPct,
      })
    );
    if (zoomPct === 150 || zoomPct === 200) {
      await page.screenshot({
        path: path.join(SHOT_DIR, `reviews-zoom-${zoomPct}.png`),
        animations: 'disabled',
      });
    }
  }

  // Test empty state by creating a fresh workspace
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}/dashboard`);
  await page.getByRole('button', { name: 'Show or hide the sidebar' }).click();
  await page.locator('.wsbtn').click();
  await page.getByPlaceholder('New workspace name').fill('Empty QA Workspace');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText('No reviews started yet')).toBeVisible();
  auditLog.push(
    await runLayoutAudit(page, {
      route: '/dashboard#empty',
      width: 1280,
      height: 800,
      theme: 'light',
    })
  );
  await page.screenshot({
    path: path.join(SHOT_DIR, 'dashboard-empty-1280.png'),
    animations: 'disabled',
  });

  if (!DISCOVERY_MODE) {
    const blockers = auditLog.flatMap((r) =>
      r.findings
        .filter((f) => f.severity === 'P0' || f.severity === 'P1')
        .map((f) => `${r.route}@${r.viewport.width}px (${r.theme}, ${r.zoom}%): [${f.check}] ${f.detail}`)
    );
    expect(blockers, `Blocking defects:\n${blockers.join('\n')}`).toEqual([]);
  }
});
