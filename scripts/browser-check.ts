import { applyTestMigrations } from './migrations';
import AxeBuilder from '@axe-core/playwright';
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
  await applyTestMigrations(db);
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
  async function audit(label: string) {
    // Assess settled surfaces, not the transparent frames of an entering dialog.
    await page.evaluate(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    await Bun.write(
      `.local/screenshots/accessibility-${label}.json`,
      JSON.stringify(result.violations, null, 2),
    );
    assert.deepEqual(
      result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      [],
      `Accessibility: ${label}`,
    );
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4310');
  await audit('sign-in');
  await page.request.post('http://127.0.0.1:4310/api/local-session', { data: { userId: 'maya' } });
  await page.reload();
  await page.getByRole('button', { name: 'Website launch', exact: true }).click();
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
  await audit('review');
  await page.screenshot({ path: '.local/screenshots/task-review.png' });
  await page.getByRole('button', { name: 'Publish changes for code review', exact: true }).click();
  await audit('publication');
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
  await audit('board-desktop');
  await page.screenshot({ path: '.local/screenshots/board-desktop.png', fullPage: true });
  await page
    .getByRole('button', { name: 'New task', exact: true })
    .screenshot({ path: '.local/screenshots/raised-button.png' });
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
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page
    .getByLabel('Task feedback', { exact: true })
    .fill('Keep the answers short and friendly.');
  await page.getByRole('button', { name: 'Send feedback', exact: true }).last().click();
  await page
    .locator('article.comment p')
    .filter({ hasText: 'Keep the answers short and friendly.' })
    .waitFor();
  await page.getByRole('button', { name: 'Close task details', exact: true }).last().click();
  await page.setViewportSize({ width: 720, height: 525 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    '200% desktop-equivalent reflow',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/screenshots/board-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await audit('board-mobile');
  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    '320px reflow',
  );
  const menu = page.getByRole('button', { name: 'Show sidebar', exact: true });
  await menu.click();
  await page.getByRole('dialog', { name: 'Workspace navigation', exact: true }).waitFor();
  await audit('mobile-navigation');
  await page.keyboard.press('Escape');
  assert.equal(
    await menu.evaluate((el) => el === document.activeElement),
    true,
    'Sidebar restores focus',
  );
  await page.getByRole('button', { name: 'Ongoing', exact: false }).first().click();
  await page.getByRole('button', { name: /Make pricing easier to compare/ }).click();
  await audit('mobile-review');
  assert.equal(
    await page.locator('.task-detail').evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
    'Review reflow',
  );
  await page.screenshot({ path: '.local/screenshots/review-mobile-320.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  assert.equal(
    await page
      .getByRole('dialog', { name: 'Create a task' })
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    '0s',
  );
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole('button', { name: /Polish navigation on smaller screens/ }).click();
  await page.getByRole('button', { name: 'Start work', exact: true }).click();
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: 'Another change' }).waitFor();
  await page.keyboard.press('Escape');
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState: await context.storageState(),
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto('http://127.0.0.1:4310');
  const touchButton = touchPage.getByRole('button', { name: 'New task', exact: true });
  await touchButton.waitFor();
  assert.equal(
    await touchButton.evaluate((el) => el.getBoundingClientRect().height >= 44),
    true,
    'Touch target',
  );
  await touchContext.close();
  assert.deepEqual(errors, []);
  console.log(
    'Browser journey passed: sign-in, exclusive start, private preview, correction, publication, separate verified merge, task creation and feedback. Desktop/mobile reflow, keyboard focus, reduced motion, touch targets, inline recovery and seven axe audits passed. Screenshots saved.',
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
