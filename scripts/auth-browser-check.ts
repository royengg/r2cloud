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
const { discoverOne } = await import('@r2cloud/core/repository-connections');
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
const { server, io } = createHttpServer({
  fixture: true,
  identity,
  repositoryConnection: {
    clientId: 'app-client',
    appSlug: 'r2cloud-test',
    callbackURL: origin + '/api/repository-callback',
  },
});
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
  let loginNumber = 0;
  await page.route('https://github.com/login/oauth/authorize**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('client_id') === 'app-client') {
      await route.fulfill({
        status: 302,
        headers: {
          location:
            origin +
            '/api/repository-callback?code=app-code&state=' +
            encodeURIComponent(url.searchParams.get('state')!),
        },
      });
      return;
    }
    await route.fulfill({
      status: 302,
      headers: {
        location:
          origin +
          `/api/auth/callback/github?code=${github.issue(loginNumber++ === 0 ? {} : { id: 'teammate', email: 'teammate@example.com' })}&state=${encodeURIComponent(url.searchParams.get('state')!)}`,
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
  await page.locator('[data-connection="Live"]').waitFor();
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
  await page.locator('[data-connection="Live"]').waitFor();
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
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Choose GitHub repositories', exact: true }).click();
  await page.getByText('Checking your GitHub repositories…', { exact: true }).waitFor();
  await discoverOne({
    discover: async () => [
      {
        id: 42,
        installationId: 9,
        fullName: 'bright-studio/portal',
        defaultBranch: 'main',
        baseSha: 'a'.repeat(40),
      },
    ],
  });
  await page.getByLabel('Repository', { exact: true }).selectOption('42');
  await audit('Repository choice');
  await page.getByRole('button', { name: 'Connect repository', exact: true }).click();
  await page.getByText('bright-studio/portal', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close connections', exact: true }).click();
  await page.getByRole('button', { name: 'View project participants' }).click();
  await page.getByLabel('GitHub email', { exact: true }).fill('teammate@example.com');
  await page.getByLabel('Approve publication', { exact: true }).first().check();
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await page.getByText('Invitation ready.', { exact: false }).waitFor();
  await audit('Team invitation');
  await page.screenshot({ path: '.local/screenshots/team-settings.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await audit('Mobile team settings');
  await page.screenshot({ path: '.local/screenshots/team-settings-mobile.png' });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.getByRole('button', { name: 'Close team settings' }).click();
  await page.getByRole('button', { name: 'Account options' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await audit('Mobile sign-in');
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.getByRole('button', { name: 'Continue with GitHub', exact: true }).click();
  await page.getByRole('heading', { name: 'Your team is here.' }).waitFor();
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.getByRole('button', { name: 'View invitations (1)', exact: true }).click();
  await audit('Invitation acceptance');
  await page.screenshot({ path: '.local/screenshots/invitation-inbox.png' });
  await page.getByRole('button', { name: 'Join Customer portal', exact: true }).click();
  await page.getByRole('heading', { name: 'Customer portal', exact: true }).waitFor();
  await page.locator('[data-connection="Live"]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'New project', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    'GitHub auth browser journey passed: mocked OAuth exchange, real session, workspace setup, task creation, missing-connection gate and sign-out. Eight axe audits passed, including mobile team settings, repository selection, team invitation and recipient acceptance.',
  );
} finally {
  await browser?.close();
  github.restore();
  await new Promise<void>((r) => io.close(() => r()));
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
