import { chromium } from 'playwright-core';
import pg from 'pg';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
delete process.env.DATABASE_URL;
const schema = 'browser_' + randomUUID().replaceAll('-', '');
process.env.R2_TEST_SCHEMA = schema;
const { pool } = await import('@r2cloud/database');
const { createHttpServer } = await import('../apps/api/src/app');
const { executeOne, publishOne } = await import('@r2cloud/core/workflow');
const { FixtureExecution, FixturePublisher } = await import('@r2cloud/adapters/fixture');
const admin = new pg.Pool({ host: resolve('.local/pgsocket'), port: 55439, database: 'postgres' });
await admin.query(`CREATE SCHEMA "${schema}"`);
const db = await admin.connect();
try {
  await db.query(`SET search_path TO "${schema}"`);
  await db.query(
    await readFile(
      'packages/database/prisma/migrations/202609050001_initial/migration.sql',
      'utf8',
    ),
  );
} finally {
  db.release();
}
const seed = Bun.spawn([process.execPath, 'scripts/setup.ts'], {
  env: { ...process.env, R2_MODE: 'fixture' },
  stdout: 'ignore',
  stderr: 'pipe',
});
if (await seed.exited) throw Error(await new Response(seed.stderr).text());
const { server, io } = createHttpServer({ fixture: true });
await new Promise<void>((r) => server.listen(4310, '127.0.0.1', r));
const preview = Bun.spawn([process.execPath, 'apps/api/src/preview-main.ts'], {
  env: { ...process.env, R2_MODE: 'fixture' },
  stdout: 'ignore',
  stderr: 'pipe',
});
await mkdir('.local/screenshots', { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.R2_BROWSER_PATH ?? resolve('scripts/chromium.sh'),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: resolve('.local/browser-config'),
    XDG_CACHE_HOME: resolve('.local/browser-cache'),
  },
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4310');
  await page.getByRole('button', { name: /Maya Chen/ }).click();
  await page.getByRole('heading', { name: /^Website launch/ }).waitFor();
  await page.getByText('Live', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Make the first visit feel effortless/ }).click();
  await page.getByRole('button', { name: 'Start work', exact: true }).click();
  await page.getByText('Working toward your outcome').waitFor();
  await executeOne(new FixtureExecution());
  await page.getByRole('button', { name: 'Try the preview', exact: true }).waitFor();
  const [tab] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: 'Try the preview', exact: true }).click(),
  ]);
  await tab
    .getByText('This is a simulated review artifact, not a running repository application.')
    .waitFor();
  assert.equal(new URL(tab.url()).origin, 'http://127.0.0.1:4311');
  assert.equal((await tab.evaluate(() => document.cookie)).includes('r2session'), false);
  await tab.close();
  await page.getByRole('button', { name: 'Request changes', exact: true }).click();
  await page.getByLabel('What should be different?').fill('Make the primary action more specific.');
  await page.getByRole('button', { name: 'Request correction and resume' }).click();
  await page.getByText('Working toward your outcome').waitFor();
  await executeOne(new FixtureExecution());
  await page
    .getByRole('button', { name: 'Publish changes for code review', exact: true })
    .waitFor();
  await page.screenshot({ path: '.local/screenshots/task-review.png', fullPage: true });
  await page.getByRole('button', { name: 'Publish changes for code review', exact: true }).click();
  await page.getByRole('button', { name: 'Approve publication', exact: true }).click();
  await page.getByText('Publishing for code review', { exact: true }).last().waitFor();
  await publishOne(new FixturePublisher());
  await page.getByRole('button', { name: 'Authorise merge', exact: true }).waitFor();
  assert.equal(
    (await pool.query("SELECT state FROM tasks WHERE id='welcome'")).rows[0].state,
    'code_review',
  );
  await page.getByRole('button', { name: 'Authorise merge', exact: true }).click();
  await page.getByRole('button', { name: 'Approve merge', exact: true }).click();
  await page.getByText('Verifying merge', { exact: true }).last().waitFor();
  await publishOne(new FixturePublisher());
  await page.getByText('Merge verified · fixture', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close task details', exact: true }).last().click();
  await page.getByRole('button', { name: /Make pricing easier to compare/ }).click();
  await page.getByRole('button', { name: 'Start work', exact: true }).click();
  await page.getByText('Working toward your outcome').waitFor();
  await executeOne(new FixtureExecution());
  await page.getByRole('button', { name: 'Try the preview', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close task details', exact: true }).last().click();
  await page.screenshot({ path: '.local/screenshots/board-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Make helpful answers easy to find');
  await page
    .getByLabel('Intended outcome', { exact: true })
    .fill('Visitors can answer common questions without waiting.');
  await page
    .getByLabel(/Acceptance criteria/)
    .fill('Questions are searchable\nAnswers work on mobile');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Make helpful answers easy to find', exact: true })
    .waitFor();
  await page
    .getByLabel('Task feedback', { exact: true })
    .fill('Keep the answers short and friendly.');
  await page.getByRole('button', { name: 'Send feedback', exact: true }).last().click();
  await page
    .locator('article.comment p')
    .filter({ hasText: 'Keep the answers short and friendly.' })
    .waitFor();
  await page.getByRole('button', { name: 'Close task details', exact: true }).last().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/screenshots/board-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log(
    'Browser journey passed: sign-in, exclusive start, private preview, correction, publication, separate verified merge, task creation and feedback. Desktop and mobile screenshots saved.',
  );
} finally {
  await browser.close();
  preview.kill();
  await preview.exited;
  await new Promise<void>((r) => io.close(() => r()));
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
