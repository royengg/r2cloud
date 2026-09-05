import { chromium, type Browser } from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';
import pg from 'pg';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { applyTestMigrations } from './migrations';
import { mockGitHub } from '../tests/github-provider';
delete process.env.DATABASE_URL;
const schema = 'auth_browser_' + randomUUID().replaceAll('-', '');
process.env.R2_TEST_SCHEMA = schema;
const { pool } = await import('@r2cloud/database');
const { createIdentity } = await import('../apps/api/src/auth');
const { createHttpServer } = await import('../apps/api/src/app');
const admin = new pg.Pool({ host: resolve('.local/pgsocket'), port: 55439, database: 'postgres' });
await admin.query(`CREATE SCHEMA "${schema}"`);
const db = await admin.connect();
try {
  await db.query(`SET search_path TO "${schema}"`);
  await applyTestMigrations(db);
} finally {
  db.release();
}
const origin = 'http://127.0.0.1:4312';
const { identity } = createIdentity({
  baseURL: origin,
  secret: randomUUID() + randomUUID(),
  githubClientId: 'test-client',
  githubClientSecret: 'test-secret',
});
const { server, io } = createHttpServer({ fixture: true, identity });
await new Promise<void>((r) => server.listen(4312, '127.0.0.1', r));
const github = mockGitHub();
let browser: Browser | undefined;
try {
  browser = await chromium.launch({
    executablePath: process.env.R2_BROWSER_PATH ?? resolve('scripts/chromium.sh'),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: resolve('.local/browser-config'),
      XDG_CACHE_HOME: resolve('.local/browser-cache'),
    },
  });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Only this test intercepts the external authorization screen. No real GitHub request is sent.
  await page.route('https://github.com/login/oauth/authorize**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 302,
      headers: {
        location:
          origin +
          `/api/auth/callback/github?code=${github.issue()}&state=${encodeURIComponent(url.searchParams.get('state')!)}`,
      },
    });
  });
  await mkdir('.local/screenshots', { recursive: true });
  async function audit(label: string) {
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    assert.deepEqual(
      result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      [],
      label,
    );
  }
  await page.goto(origin);
  await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).waitFor();
  assert.equal(await page.locator('input[type=password]').count(), 0);
  await audit('GitHub sign-in');
  await page.screenshot({ path: '.local/screenshots/github-sign-in.png' });
  await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).click();
  await page.getByRole('heading', { name: 'Make room for your project.' }).waitFor();
  await page.getByLabel('Workspace name', { exact: true }).fill('Bright Studio');
  await page.getByLabel('First project', { exact: true }).fill('Our first website');
  await audit('Workspace setup');
  await page.screenshot({ path: '.local/screenshots/workspace-setup.png' });
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByRole('heading', { name: 'Our first website', exact: true }).waitFor();
  await page.getByText('Live', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Make the first step clear');
  await page.getByLabel('Intended outcome', { exact: true }).fill('Visitors know what to do next.');
  await page.getByLabel(/Acceptance criteria/).fill('One clear primary action');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.getByRole('button', { name: 'Start work', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('alert')
    .filter({ hasText: 'Connect a repository' })
    .waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByText('No repository connected', { exact: true }).waitFor();
  await page.getByText('No AI account connected', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Customer portal');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('heading', { name: 'Customer portal', exact: true }).waitFor();
  await page.getByText('Live', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Account options' }).click();
  await page.getByRole('menuitem', { name: 'Connections', exact: true }).waitFor();
  await audit('Account menu');
  await page.screenshot({ path: '.local/screenshots/account-menu.png' });
  await page.keyboard.press('Escape');
  assert.equal(
    await page
      .getByRole('button', { name: 'Account options' })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.getByRole('button', { name: 'Account options' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await audit('Mobile sign-in');
  assert.deepEqual(errors, []);
  console.log(
    'GitHub auth browser journey passed: mocked OAuth exchange, real session, workspace setup, task creation, missing-connection gate and sign-out. Four axe audits passed.',
  );
} finally {
  await browser?.close();
  github.restore();
  await new Promise<void>((r) => io.close(() => r()));
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
