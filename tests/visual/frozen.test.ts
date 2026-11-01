import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareImages, readPng } from './compare';

// Frozen references of the CURRENT app (J7). macOS only, NOT part of `npm run check`. Run: npx vitest run tests/visual
// Update a reference on purpose: UPDATE_VISUAL=1 npx vitest run tests/visual/frozen.test.ts, then LOOK at the images and read the diff.
// The exact captured state is written in tests/visual/ref/README.md.
const here = dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(join(here, '../../dist/index.html')).href;
const outDir = process.env['HUEZZ_VISUAL_OUT'] ?? join(here, 'out');
const update = process.env['UPDATE_VISUAL'] === '1';
const MAX_PERCENT = 0.5;

// Fixed colours (a hand-made valid link: the 14 hex of the Lagune palette, seed 00c0ffee, complementary harmony).
const LIGHT = 'F5F8F7FFFFFF0E1F1D0F7C74D95A4E2C7A3FB93A2B';
const DARK = '0B1413142120E4EFED42C2B3F08D7F62C97FF2796A';
const hash = (mode: 'l' | 'd') => `#v=1&m=${mode}&h=co&s=00c0ffee&k=00&l=${LIGHT}&d=${DARK}`;

type Shot = { name: string; width: number; height: number; scheme: 'light' | 'dark'; hash: string; open?: (page: Page) => Promise<void> };
const SHOTS: Shot[] = [
  { name: 'frozen-1440-light', width: 1440, height: 900, scheme: 'light', hash: hash('l') },
  { name: 'frozen-1440-dark', width: 1440, height: 900, scheme: 'dark', hash: hash('d') },
  { name: 'frozen-390-light', width: 390, height: 844, scheme: 'light', hash: hash('l') },
  {
    name: 'frozen-390-export',
    width: 390,
    height: 844,
    scheme: 'light',
    hash: hash('l'),
    open: async (page) => {
      await page.click('#exportBtn');
      await page.waitForSelector('#xmenu:not([hidden])');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    },
  },
];

let browser: Browser;
const contexts: BrowserContext[] = [];
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  mkdirSync(outDir, { recursive: true });
});
afterAll(async () => {
  for (const c of contexts) await c.close();
  await browser?.close();
});

async function capture(shot: Shot): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 1, colorScheme: shot.scheme, reducedMotion: 'no-preference' });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(url + shot.hash);
  await page.waitForSelector('html.is-ready');
  await page.waitForTimeout(800);
  if (shot.open) {
    await shot.open(page);
    await page.waitForTimeout(500);
  }
  await page.mouse.move(0, 0);
  const png = await page.screenshot();
  await context.close();
  return png;
}

describe.skipIf(process.platform !== 'darwin')('visual: frozen references of the current app (darwin only)', () => {
  for (const shot of SHOTS) {
    it(`${shot.name}: at most ${MAX_PERCENT} % of differing pixels, and two captures agree`, async () => {
      const png = await capture(shot);
      writeFileSync(join(outDir, `${shot.name}.png`), png);
      const refPath = join(here, 'ref', `${shot.name}.png`);
      if (update) writeFileSync(refPath, png);
      expect(existsSync(refPath), `référence absente : ${refPath} (UPDATE_VISUAL=1 pour la créer)`).toBe(true);
      const host = await (await browser.newContext()).newPage();
      const result = await compareImages(host, readPng(refPath), png, { x: 0, y: 0, w: shot.width, h: shot.height });
      writeFileSync(join(outDir, `diff-${shot.name}.png`), Buffer.from(result.diffImage.split(',')[1] ?? '', 'base64'));
      const again = await compareImages(host, png, await capture(shot), { x: 0, y: 0, w: shot.width, h: shot.height });
      console.log(`frozen ${shot.name}: against the reference ${result.differing}/${result.width * result.height} = ${result.percent.toFixed(3)} % ; second capture against the first ${again.differing} = ${again.percent.toFixed(3)} %`);
      expect(result.width).toBe(shot.width);
      expect(result.height).toBe(shot.height);
      expect(result.percent).toBeLessThanOrEqual(MAX_PERCENT);
      expect(again.percent).toBeLessThanOrEqual(MAX_PERCENT);
    });
  }
});
