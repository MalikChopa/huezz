import { fileURLToPath, pathToFileURL } from 'node:url';
import axe from 'axe-core';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll } from 'vitest';
import { fixedHashFor } from '../fixed-hash.mjs';

export const url = pathToFileURL(fileURLToPath(new URL('../../dist/index.html', import.meta.url))).href;

/** Where screenshots go (never the repository): HUEZZ_SHOTS, else nothing is written. */
export const shotsDir = process.env.HUEZZ_SHOTS ?? null;

export type Probe = { violations: string[]; errors: string[] };
export type Session = { page: Page; context: BrowserContext; probe: Probe };
export type OpenOptions = {
  scheme?: 'light' | 'dark';
  width?: number;
  height?: number;
  /** Touch emulation: isMobile + hasTouch (the viewport meta is honoured). */
  touch?: boolean;
  reducedMotion?: boolean;
  forcedColors?: boolean;
  /** Default: the fixed starting link (J9, the product opens on a random palette). '' opens the page with no link at all. */
  hash?: string;
  clipboard?: boolean;
};

/** One Chrome per test file, closed afterwards; each `open` gives a fresh context watched for CSP violations and console errors. */
export function useBrowser(): { open(options?: OpenOptions): Promise<Session> } {
  let browser: Browser;
  const contexts: BrowserContext[] = [];
  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  });
  afterAll(async () => {
    for (const c of contexts) await c.close();
    await browser?.close();
  });
  return {
    async open(options = {}) {
      const context = await browser.newContext({
        colorScheme: options.scheme ?? 'light',
        viewport: { width: options.width ?? 1440, height: options.height ?? 900 },
        isMobile: options.touch === true,
        hasTouch: options.touch === true,
        reducedMotion: options.reducedMotion === true ? 'reduce' : 'no-preference',
        forcedColors: options.forcedColors === true ? 'active' : 'none',
      });
      contexts.push(context);
      if (options.clipboard !== false) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const page = await context.newPage();
      const probe: Probe = { violations: [], errors: [] };
      await page.exposeFunction('__huezzViolation', (directive: string, blocked: string) => probe.violations.push(`${directive} ${blocked}`));
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          (window as unknown as { __huezzViolation(d: string, b: string): void }).__huezzViolation(e.effectiveDirective, e.blockedURI);
        });
      });
      page.on('console', (m) => m.type() === 'error' && probe.errors.push(m.text()));
      page.on('pageerror', (e) => probe.errors.push(String(e)));
      await page.goto(url + (options.hash ?? fixedHashFor(options.scheme)));
      await page.waitForSelector('html.is-ready');
      return { page, context, probe };
    },
  };
}

export const frames = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
/** The palette fade lasts 0.3 s: read colours after it. */
export async function settle(page: Page): Promise<void> {
  await frames(page);
  await page.waitForTimeout(450);
}

export type AxeSummary = { serious: string[]; all: string[]; incomplete: string[] };
/** axe on the whole page: serious and critical violations, every violation, and the "incomplete" items. */
export async function runAxe(page: Page): Promise<AxeSummary> {
  await page.evaluate(axe.source);
  return page.evaluate(async () => {
    type R = { violations: { id: string; impact: string | null; nodes: { target: unknown }[] }[]; incomplete: { id: string; nodes: unknown[] }[] };
    const r = await (window as unknown as { axe: { run(): Promise<R> } }).axe.run();
    const line = (v: { id: string; impact: string | null; nodes: { target: unknown }[] }) => `${v.id}[${v.impact}] ${JSON.stringify(v.nodes.map((n) => n.target))}`;
    return {
      serious: r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map(line),
      all: r.violations.map(line),
      incomplete: r.incomplete.map((v) => `${v.id}(${v.nodes.length})`),
    };
  });
}

// Independent colour maths (nothing imported from the app).
export type Rgb = [number, number, number];
export function parseCss(css: string): Rgb {
  const n = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  if (n.length < 3) throw new Error(`couleur illisible : ${css}`);
  return [n[0] as number, n[1] as number, n[2] as number];
}
const lum = ([r, g, b]: Rgb): number => {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
export const ratio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [Math.max(lum(a), lum(b)), Math.min(lum(a), lum(b))];
  return (hi + 0.05) / (lo + 0.05);
};

/** Decodes PNG bytes in a blank page (canvas) and returns the pixels at the given points. Needs deviceScaleFactor 1. */
export async function pixelsOf(helper: Page, png: Buffer, points: readonly [number, number][]): Promise<Rgb[]> {
  return helper.evaluate(
    async ([b64, pts]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx === null) throw new Error('canvas');
      ctx.drawImage(img, 0, 0);
      return (pts as [number, number][]).map(([x, y]) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0] as [number, number, number];
      });
    },
    [png.toString('base64'), points] as const,
  );
}

/** Role and accessible name of the focused element, from the engine (aria snapshot of `:focus`): `button "Hasard"`, value and children left out. */
export async function focusedLine(page: Page): Promise<string> {
  try {
    const snap = await page.locator(':focus').ariaSnapshot({ timeout: 1500 });
    const first = (snap.split('\n')[0] ?? '').replace(/^- /, '');
    const quoted = /^'((?:[^']|'')*)'(?::\s.*|:)?$/.exec(first);
    if (quoted !== null) return (quoted[1] ?? '').replace(/''/g, "'");
    const at = first.indexOf(': ');
    return (at >= 0 ? first.slice(0, at) : first.replace(/:$/, '')).trim();
  } catch {
    return '(rien)';
  }
}
