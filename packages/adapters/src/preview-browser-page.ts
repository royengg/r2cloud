import { createRequire } from 'node:module';
import type { chromium as Chromium } from 'playwright-core';

const load = createRequire('/opt/r2cloud/browser/package.json');
const { chromium } = load('playwright-core') as { chromium: typeof Chromium };
const config = JSON.parse(process.argv.at(-1)!);
const origin = `http://127.0.0.1:${config.port}`;
const browser = await chromium.launch({
  executablePath: '/tmp/chromium',
  headless: true,
  args: [
    '--disable-dev-shm-usage',
    '--no-zygote',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LD_LIBRARY_PATH: '/tmp/al2023/lib',
    FONTCONFIG_PATH: '/tmp/fonts',
  },
});
try {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (errors.length < 20) errors.push(error.message.slice(0, 1000));
  });
  page.on('dialog', (dialog) => void dialog.dismiss());
  const response = await page.goto(origin + config.path, { waitUntil: 'load', timeout: 15000 });
  const screenshot = await page.screenshot({ type: 'png', timeout: 10000, animations: 'disabled' });
  if (screenshot.length > 512 * 1024) throw Error('Screenshot exceeded the size limit');
  process.stdout.write(
    JSON.stringify({
      path: new URL(page.url()).pathname,
      status: response?.status(),
      snapshot: (await page.locator('body').ariaSnapshot({ timeout: 5000 })).slice(0, 32000),
      errors,
      screenshot: screenshot.toString('base64'),
    }),
  );
} finally {
  await browser.close();
}
