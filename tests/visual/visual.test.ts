import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contrastRatio } from '../../src/core/contrast';
import { FIXED_HASH } from '../fixed-hash.mjs';
import { compareImages, readPng, type Region } from './compare';

// Private milestone: macOS only (fonts and rendering engine), NOT part of `npm run check`. Run: npx vitest run tests/visual
const here = dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(join(here, '../../dist/index.html')).href;
const outDir = process.env['HUEZZ_VISUAL_OUT'] ?? join(here, 'out');

/** Palette « Lagune » of mock-up B (maquette/b/index.html, array P, id 'lagune'). Not producible by the generator. */
const LAGUNE = {
  light: { fond: '#F5F8F7', surface: '#FFFFFF', texte: '#0E1F1D', accent: '#0F7C74', accent2: '#D95A4E', succes: '#2C7A3F', alerte: '#B93A2B' },
  dark: { fond: '#0B1413', surface: '#142120', texte: '#E4EFED', accent: '#42C2B3', accent2: '#F08D7F', succes: '#62C97F', alerte: '#F2796A' },
} as const;
const ROLES = ['fond', 'surface', 'texte', 'accent', 'accent2', 'succes', 'alerte'] as const;

// The maquette picks white or #111111 for text on a colour (not the pure black of the generator).
const onColour = (hex: string): string => ((contrastRatio(hex, '#FFFFFF') ?? 0) >= (contrastRatio(hex, '#111111') ?? 0) ? '#FFFFFF' : '#111111');
const paperOf = (ink: string): string => (ink === '#FFFFFF' ? '#111111' : '#FFFFFF');

/** The CSS pushed after load: the 14 hex of Lagune (light mode applied) and what the maquette derives from them. */
function lagunecss(): string {
  const p = LAGUNE.light;
  const decl: string[] = [];
  for (const role of ROLES) {
    decl.push(`--${role}:${p[role]}`);
    const ink = onColour(p[role]);
    decl.push(`--ink-${role}:${ink}`, `--paper-${role}:${paperOf(ink)}`);
  }
  decl.push(`--sur-accent:${onColour(p.accent)}`, `--sur-accent2:${onColour(p.accent2)}`, `--ui-accent:${p.accent}`, `--ui-on-accent:${onColour(p.accent)}`);
  return `:root{${decl.join(';')}}`;
}

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

async function capture(width: number, height: number): Promise<{ png: Buffer; scene: Region; page: Page }> {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'light' });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(url + FIXED_HASH);
  await page.waitForSelector('html.is-ready');
  await page.evaluate(
    ({ css, hex }) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      // Texts that mirror the colours, so that the figure measures the rendering and not the generator's own hex.
      document.querySelectorAll('.sw-hex').forEach((el, i) => (el.textContent = hex[i] ?? ''));
      const field = document.querySelector<HTMLInputElement>('#baseHex');
      if (field !== null) field.value = hex[3] ?? '';
      const colour = document.querySelector<HTMLInputElement>('#base');
      if (colour !== null) colour.value = (hex[3] ?? '').toLowerCase();
    },
    { css: lagunecss(), hex: ROLES.map((r) => LAGUNE.light[r]) },
  );
  await page.waitForTimeout(700); // the 0.3 s fade of the variables
  await page.mouse.move(0, 0);
  const png = await page.screenshot();
  const box = await page.$eval('#stageWrap', (e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  return { png, scene: box, page };
}

describe.skipIf(process.platform !== 'darwin')('visual: Lagune against the approved mock-up B screenshots (darwin only)', () => {
  it('1440 x 900: at most 5 % of differing pixels in the scene region', async () => {
    const { png, scene } = await capture(1440, 900);
    writeFileSync(join(outDir, 'app-1440.png'), png);
    const host = await (await browser.newContext()).newPage();
    const result = await compareImages(host, readPng(join(here, 'ref/b-1440.png')), png, scene);
    writeFileSync(join(outDir, 'diff-1440.png'), Buffer.from(result.diffImage.split(',')[1] ?? '', 'base64'));
    console.log(
      `visual 1440: whole viewport ${result.differing}/${result.width * result.height} = ${result.percent.toFixed(2)} % | scene region ${JSON.stringify(scene)}: ${result.regionDiffering} = ${result.regionPercent.toFixed(2)} %`,
    );
    expect(result.width).toBe(1440);
    expect(result.height).toBe(900);
    expect(result.regionPercent).toBeLessThanOrEqual(5);
  });

  it('390 x 844: figure reported, not asserted (the mobile layout is milestone J6)', async () => {
    const { png, scene } = await capture(390, 844);
    writeFileSync(join(outDir, 'app-390.png'), png);
    const host = await (await browser.newContext()).newPage();
    const result = await compareImages(host, readPng(join(here, 'ref/b-390.png')), png, scene);
    writeFileSync(join(outDir, 'diff-390.png'), Buffer.from(result.diffImage.split(',')[1] ?? '', 'base64'));
    console.log(
      `visual 390: whole viewport ${result.differing}/${result.width * result.height} = ${result.percent.toFixed(2)} % | scene region ${JSON.stringify(scene)}: ${result.regionPercent.toFixed(2)} %`,
    );
    expect(result.width).toBe(390);
    expect(result.height).toBe(844);
  });
});
