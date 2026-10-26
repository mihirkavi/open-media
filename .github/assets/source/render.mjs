// Renders the README images in this folder to PNG at 2x.
// Needs Playwright with a Chromium (`npx playwright install chromium`), or set CHROME_PATH to any Chrome.
// Usage: node .github/assets/source/render.mjs
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..');
const shots = [
  { page: 'banner.html', file: 'banner-light.png', width: 1600, height: 600 },
  { page: 'banner.html?theme=dark', file: 'banner-dark.png', width: 1600, height: 600 },
  { page: 'api-terminal.html', file: 'api-terminal.png', width: 1600, height: 760 },
  { page: 'cli-terminal.html', file: 'cli-terminal.png', width: 1600, height: 640 },
];

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const shot of shots) {
  await page.setViewportSize({ width: shot.width, height: shot.height });
  const [name, query = ''] = shot.page.split('?');
  await page.goto(pathToFileURL(join(here, name)).href + (query && `?${query}`));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, shot.file) });
  console.log('wrote', shot.file);
}
await browser.close();
