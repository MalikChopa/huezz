import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import axe from 'axe-core';
import { webkit, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportText } from '../../src/export';
import type { ExportInput } from '../../src/export/keys';
import { decodeHash } from '../../src/state/url';
import { pixelsOf, ratio, shotsDir, url, type Rgb } from './j6-helpers';
import { fixedHashFor } from '../fixed-hash.mjs';

// WebKit (the Safari / iPhone engine) through Playwright's WebKit build: an engine, not Safari itself. Skipped only when the executable is missing.
const executable = (() => {
  try {
    return webkit.executablePath();
  } catch {
    return '';
  }
})();
const available = executable !== '' && existsSync(executable);
if (!available) console.warn(`webkit.test.ts SAUTÉ : exécutable WebKit absent (${executable || 'chemin inconnu'})`);

const distFile = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
const ORIGIN = 'https://huezz.test';

/** The one console error WebKit logs on any page that contains a <select> under a style-src CSP (see JOURNAL J7). */
/** Native <select> elements of the page (Harmonie, and Vision since J12): WebKit logs the error once per select and per document load (control test below). */
const SELECTS = 2;
const SELECT_ERROR = /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy\.?$/;

type Probe = { violations: string[]; errors: string[] };
type Session = { page: Page; context: BrowserContext; probe: Probe };
type Options = { width?: number; height?: number; touch?: boolean; scheme?: 'light' | 'dark'; reducedMotion?: boolean; hash?: string; https?: boolean };

describe.skipIf(!available)('WebKit engine (Playwright build; not Safari itself)', () => {
  let browser: Browser;
  const contexts: BrowserContext[] = [];
  beforeAll(async () => {
    browser = await webkit.launch();
  });
  afterAll(async () => {
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
  });

  async function open(o: Options = {}): Promise<Session> {
    const context = await browser.newContext({
      viewport: { width: o.width ?? 1440, height: o.height ?? 900 },
      deviceScaleFactor: o.touch === true ? 3 : 1,
      isMobile: o.touch === true,
      hasTouch: o.touch === true,
      colorScheme: o.scheme ?? 'light',
      reducedMotion: o.reducedMotion === true ? 'reduce' : 'no-preference',
      acceptDownloads: true,
    });
    contexts.push(context);
    if (o.https === true) await context.route(`${ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(distFile) }));
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
    await page.goto((o.https === true ? `${ORIGIN}/` : url) + (o.hash ?? fixedHashFor(o.scheme)));
    await page.waitForSelector('html.is-ready');
    return { page, context, probe };
  }

  const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const settle = async (page: Page) => {
    await frames(page);
    await page.waitForTimeout(450);
  };
  const dockHex = (page: Page): Promise<string[]> => page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
  const roleVars = ['--fond', '--surface', '--texte', '--accent', '--accent2', '--succes', '--alerte'] as const;
  const varsOf = (page: Page): Promise<string[]> =>
    page.evaluate((names) => {
      const cs = getComputedStyle(document.documentElement);
      const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      if (c === null) throw new Error('canvas');
      return names.map((n) => {
        c.clearRect(0, 0, 1, 1);
        c.fillStyle = cs.getPropertyValue(n).trim();
        c.fillRect(0, 0, 1, 1);
        const d = c.getImageData(0, 0, 1, 1).data;
        return `#${[d[0], d[1], d[2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
      });
    }, roleVars);
  const toast = (page: Page): Promise<string> => page.$eval('#toast span', (e) => e.textContent ?? '');

  /**
   * Console errors and CSP violations of a page: only the WebKit <select> artefact is tolerated, once per document load.
   * Call it BEFORE taking a screenshot: Playwright's WebKit screenshot injects an inline <style> that this CSP refuses (control page, JOURNAL J7).
   */
  function expectClean(p: Probe, loads = 1): void {
    expect(p.errors.filter((e) => !SELECT_ERROR.test(e))).toEqual([]);
    expect(p.errors).toHaveLength(loads * SELECTS);
    expect(p.violations).toEqual(Array<string>(loads * SELECTS).fill('style-src-attr inline'));
  }

  describe('the console error and the CSP violation of WebKit', () => {
    const csp = "default-src 'none'; script-src 'none'; style-src 'sha256-AAAA'; img-src data: blob:";
    const probeOf = async (body: string): Promise<{ errors: string[]; violations: string[] }> => {
      const context = await browser.newContext();
      contexts.push(context);
      await context.route('https://control.test/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><title>x</title><body>${body}</body>` }),
      );
      const page = await context.newPage();
      const out = { errors: [] as string[], violations: [] as string[] };
      await page.exposeFunction('__v', (d: string, b: string) => out.violations.push(`${d} ${b}`));
      await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __v(d: string, b: string): void }).__v(e.effectiveDirective, e.blockedURI)));
      page.on('console', (m) => m.type() === 'error' && out.errors.push(m.text()));
      await page.goto('https://control.test/');
      await page.waitForTimeout(400);
      return out;
    };

    it('comes from the native <select> alone: a bare page with the same kind of CSP is silent without a <select> and logs exactly that error with one', async () => {
      const without = await probeOf('<button>b</button><input type="color"><input type="text"><textarea></textarea><canvas></canvas>');
      expect(without).toEqual({ errors: [], violations: [] });
      const withSelect = await probeOf('<select><option>a</option></select>');
      expect(withSelect.errors).toHaveLength(1);
      expect(withSelect.errors[0]).toMatch(SELECT_ERROR);
      expect(withSelect.violations).toEqual(['style-src-attr inline']);
      // J12: a second select gives a second error, so the count of Huezz (2 selects) is not a new problem but 2 x the known one
      const withTwo = await probeOf('<select><option>a</option></select><select><option>b</option></select>');
      expect(withTwo.errors).toHaveLength(2);
      expect(withTwo.errors.every((e) => SELECT_ERROR.test(e))).toBe(true);
      expect(withTwo.violations).toEqual(['style-src-attr inline', 'style-src-attr inline']);
    });

    it('Huezz logs that error once per native select (2) at load and nothing else, at 1440 and at 390 with touch', async () => {
      for (const o of [{}, { width: 390, height: 844, touch: true }]) {
        const { page, probe } = await open(o);
        await settle(page);
        expectClean(probe);
        expect(probe.errors).toHaveLength(SELECTS);
        // Nothing visual or functional is lost: the select shows the harmony and changes it (see "harmony select" below).
        expect(await page.$eval('#harm', (e) => (e as HTMLSelectElement).value)).toBe('complementary');
      }
    });
  });

  describe('palette, Hasard, locks, harmony, base colour', () => {
    it('1440: 7 palette variables set, equal to the dock; Hasard (click and Space) changes them', async () => {
      const { page, probe } = await open();
      await settle(page);
      const v0 = await varsOf(page);
      expect(v0).toHaveLength(7);
      for (const v of v0) expect(v).toMatch(/^#[0-9A-F]{6}$/);
      expect(v0).toEqual(await dockHex(page));
      await page.click('#hasard');
      await settle(page);
      const v1 = await varsOf(page);
      expect(v1).not.toEqual(v0);
      expect(v1).toEqual(await dockHex(page));
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Space');
      await settle(page);
      const v2 = await varsOf(page);
      expect(v2).not.toEqual(v1);
      expect(v2).toEqual(await dockHex(page));
      expectClean(probe);
    });

    it('a locked role keeps its colour through Hasard (button, then key L on a focused colour)', async () => {
      const { page, probe } = await open();
      await page.click('.sw[data-role="fond"] .sw-lock');
      await settle(page);
      expect(await page.getAttribute('.sw[data-role="fond"] .sw-lock', 'aria-pressed')).toBe('true');
      const fond = (await dockHex(page))[0];
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('Space');
        await settle(page);
        expect((await dockHex(page))[0]).toBe(fond);
      }
      await page.focus('.sw[data-role="alerte"] .sw-copy');
      await page.keyboard.press('l');
      await settle(page);
      expect(await page.getAttribute('.sw[data-role="alerte"] .sw-lock', 'aria-pressed')).toBe('true');
      const alerte = (await dockHex(page))[6];
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Space');
      await settle(page);
      expect((await dockHex(page))[6]).toBe(alerte);
      expectClean(probe);
    });

    it('harmony select: the 6 harmonies are listed and choosing one regenerates the palette', async () => {
      const { page, probe } = await open();
      expect(await page.$$eval('#harm option', (o) => o.length)).toBe(6);
      const before = await dockHex(page);
      await page.selectOption('#harm', 'triad');
      await settle(page);
      expect(await page.textContent('#metaHarm')).toBe('Triade');
      expect(await dockHex(page)).not.toEqual(before);
      expectClean(probe);
    });

    it('base colour: the hex field at 1440 and the native colour input (input + change events) at 390', async () => {
      const wide = await open();
      await wide.page.fill('#baseHex', '#336699');
      await wide.page.press('#baseHex', 'Enter');
      await settle(wide.page);
      expect((await dockHex(wide.page))[3]).toBe('#336699');
      await wide.page.fill('#baseHex', 'zzz');
      await wide.page.press('#baseHex', 'Enter');
      expect(await wide.page.getAttribute('#baseHex', 'aria-invalid')).toBe('true');
      expectClean(wide.probe);

      const phone = await open({ width: 390, height: 844, touch: true });
      await phone.page.evaluate(() => {
        const el = document.querySelector<HTMLInputElement>('#base');
        if (el === null) throw new Error('#base');
        el.value = '#e0a800';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await settle(phone.page);
      expect((await dockHex(phone.page))[3]).toBe('#E0A800');
      expectClean(phone.probe);
    });
  });

  describe('contrast and exports', () => {
    it('yellow base #E0A800: the accent/fond pill fails, the dialog opens, Corriger brings it to >= 4.5', async () => {
      const { page, probe } = await open();
      await page.fill('#baseHex', '#E0A800');
      await page.press('#baseHex', 'Enter');
      await settle(page);
      expect(await page.textContent('#metaAa')).toBe('4/5');
      await page.click('.pill[data-pair="accent-fond"]');
      await page.waitForSelector('#cdlg:not([hidden])');
      expect(await page.textContent('#cdTitle')).toBe('Accent sur fond');
      expect(await page.textContent('#cdFg')).toBe('#E0A800');
      await page.click('#cdFix');
      await settle(page);
      const v = await varsOf(page);
      const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
      expect(ratio(rgb(v[3] as string), rgb(v[0] as string))).toBeGreaterThanOrEqual(4.5);
      expect(await page.textContent('#metaAa')).toBe('5/5');
      expect(await toast(page)).toMatch(/^Accent corrigé : #E0A800 → #[0-9A-F]{6} \(verrouillé\)\. 5 sur 5 contrastes AA\.$/);
      expectClean(probe);
    });

    it('export menu: the 6 formats are listed and each text equals the one computed from the live address', async () => {
      const { page, probe } = await open();
      await page.click('#exportBtn');
      await page.waitForSelector('#xmenu:not([hidden])');
      expect(await page.$$eval('#xFormats [role=radio]', (els) => els.map((e) => e.textContent))).toEqual(['CSS', 'Tailwind', 'JSON', 'Swift', 'Figma', 'PNG']);
      await settle(page);
      const r = decodeHash(await page.evaluate(() => location.hash));
      if (r.kind !== 'ok') throw new Error('hash');
      const input: ExportInput = { harmony: r.value.harmony, mode: r.value.mode, theme: r.value.theme };
      for (const [f, extra, out] of [
        ['css', undefined, 'css'],
        ['tailwind', '#xTw [data-v=v4]', 'tailwind-v4'],
        ['tailwind', '#xTw [data-v=v3]', 'tailwind-v3'],
        ['json', undefined, 'json'],
        ['swift', undefined, 'swift'],
        ['figma', undefined, 'figma'],
      ] as const) {
        await page.click(`#xFormats [data-f=${f}]`);
        if (extra !== undefined) await page.click(extra);
        expect(await page.inputValue('#xOut')).toBe(exportText(out, input));
      }
      expectClean(probe);
    });

    it('PNG: the download decodes to 1400 x 400 and the 7 band centres equal the 7 colours of the dock (dark mode)', async () => {
      const { page, context, probe } = await open({ scheme: 'dark' });
      const helper = await context.newPage();
      await page.click('#exportBtn');
      await page.click('#xFormats [data-f=png]');
      await settle(page);
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#xDownload')]);
      expect(download.suggestedFilename()).toBe('huezz.png');
      const png = readFileSync(await download.path());
      expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1400, 400]);
      const px = await pixelsOf(helper, png, [0, 1, 2, 3, 4, 5, 6].map((i) => [100 + 200 * i, 200] as [number, number]));
      const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
      expect(px.map(hex)).toEqual(await dockHex(page));
      expectClean(probe);
    });

    it('copy: Enter on a colour and Copier in the export menu give a "Copié" message on the https origin (the content of the clipboard cannot be read in WebKit here)', async () => {
      const { page, probe } = await open({ https: true });
      await page.focus('.sw[data-role="texte"] .sw-copy');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /^Copié : #/.test(document.querySelector('#toast span')?.textContent ?? ''));
      const path = await page.$eval('#toast', (e) => e.getAttribute('data-path'));
      console.log(`webkit: copy path for a colour = ${path}`);
      await page.click('#share');
      await page.waitForFunction(() => /^Lien copié/.test(document.querySelector('#toast span')?.textContent ?? ''));
      console.log(`webkit: share path = ${await page.$eval('#toast', (e) => e.getAttribute('data-path'))}`);
      expectClean(probe);
    });
  });

  describe('address, layout, motion, accessibility', () => {
    it('hash: a hand-made link is loaded (14 colours), then restored by a reload', async () => {
      const hash = '#v=1&m=d&h=tr&s=00c0ffee&k=00&l=F5F8F7FFFFFF0E1F1D0F7C74D95A4E2C7A3FB93A2B&d=0B1413142120E4EFED42C2B3F08D7F62C97FF2796A';
      const { page, probe } = await open({ hash });
      await settle(page);
      expect(await dockHex(page)).toEqual(['#0B1413', '#142120', '#E4EFED', '#42C2B3', '#F08D7F', '#62C97F', '#F2796A']);
      expect(await page.textContent('#metaMode')).toBe('sombre');
      expect(await page.evaluate(() => location.hash)).toBe(hash);
      await page.reload();
      await page.waitForSelector('html.is-ready');
      await settle(page);
      expect(await dockHex(page)).toEqual(['#0B1413', '#142120', '#E4EFED', '#42C2B3', '#F08D7F', '#62C97F', '#F2796A']);
      await page.evaluate(() => {
        location.hash = '#v=1&<script>';
      });
      await settle(page);
      expect(await toast(page)).toMatch(/Lien invalide/);
      expect(await dockHex(page)).toEqual(['#0B1413', '#142120', '#E4EFED', '#42C2B3', '#F08D7F', '#62C97F', '#F2796A']);
      expectClean(probe, 2);
    });

    it('J9: no link opens on a random palette (two loads differ, the address gets the link) and the inline icon makes no request', async () => {
      const a = await open({ hash: '' });
      const requests: string[] = [];
      a.page.on('request', (r) => requests.push(r.url()));
      await settle(a.page);
      const first = await dockHex(a.page);
      const hashA = await a.page.evaluate(() => location.hash);
      expect(first).toHaveLength(7);
      for (const hex of first) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(hashA).toMatch(/^#v=1&m=l&h=co&s=[0-9a-f]{8}&k=00&l=/);
      await a.page.goto(a.page.url().split('#')[0] ?? '');
      await a.page.waitForSelector('html.is-ready');
      await settle(a.page);
      expect(await dockHex(a.page)).not.toEqual(first);
      expect(requests.filter((u) => /favicon/i.test(u))).toEqual([]);
      expect(requests.filter((u) => !u.startsWith('file://') && !u.startsWith('data:'))).toEqual([]);
      expect(await a.page.$$eval('link', (els) => els.map((e) => `${e.getAttribute('rel')} ${(e.getAttribute('href') ?? '').slice(0, 27)}`))).toEqual(['icon data:image/svg+xml;base64,P']);
      // the link restores the first palette exactly
      const b = await open({ hash: hashA });
      await settle(b.page);
      expect(await dockHex(b.page)).toEqual(first);
      expectClean(a.probe, 2);
      expectClean(b.probe);
    });

    for (const [width, height] of [
      [390, 844],
      [320, 640],
    ] as const) {
      it(`${width} px with touch: the document is not wider than the window, closed and with the export sheet and the contrast sheet open`, async () => {
        const { page, probe } = await open({ width, height, touch: true });
        const w = () => page.evaluate(() => [document.documentElement.scrollWidth, document.body.scrollWidth, innerWidth]);
        const check = async () => {
          const [doc, body, inner] = await w();
          expect(doc).toBeLessThanOrEqual(inner as number);
          expect(body).toBeLessThanOrEqual(inner as number);
        };
        expect((await w())[2]).toBe(width);
        await check();
        await page.click('#exportBtn');
        await settle(page);
        await check();
        await page.keyboard.press('Escape');
        await page.click('.pill[data-pair=texte-fond]');
        await settle(page);
        await check();
        expectClean(probe);
      });
    }

    it('390 with touch: every interactive element is at least 24 x 24 and the main controls at least 44 x 44, closed and with each sheet open', async () => {
      const { page, probe } = await open({ width: 390, height: 844, touch: true });
      type Box = { name: string; w: number; h: number };
      const measure = (): Promise<Box[]> =>
        page.evaluate(() =>
          [...document.querySelectorAll('a[href], button, input, select, textarea, [role=radio]')]
            .filter((e) => !e.closest('[hidden]') && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')
            .filter((e) => !e.matches('.skip') && !e.closest('.copy-sink'))
            .map((e) => {
              const r = e.getBoundingClientRect();
              const name = e.id || e.getAttribute('data-pair') || e.getAttribute('data-f') || e.getAttribute('data-v') || String(e.className);
              return { name, w: Math.round(r.width), h: Math.round(r.height) };
            }),
        );
      const all: Box[] = [...(await measure())];
      await page.click('#exportBtn');
      await settle(page);
      all.push(...(await measure()));
      await page.keyboard.press('Escape');
      await page.click('.pill[data-pair=texte-fond]');
      await settle(page);
      all.push(...(await measure()));
      expect(all.length).toBeGreaterThan(40);
      expect(all.filter((b) => b.w < 24 || b.h < 24)).toEqual([]);
      const MAIN = /^(base|harm|hasard|share|exportBtn|xClose|cdClose|xCopy|texte-fond|texte-surface|accent-fond|succes-surface|alerte-surface|accent2-fond|css|tailwind|json|swift|figma|png)$/;
      expect(all.filter((b) => MAIN.test(b.name) && (b.w < 44 || b.h < 44))).toEqual([]);
      expectClean(probe);
    });

    it('prefers-reduced-motion: no animation after Hasard and the fade time is 0; without it the fade is 0.3 s', async () => {
      const calm = await open({ reducedMotion: true });
      await calm.page.click('#hasard');
      await frames(calm.page);
      expect(await calm.page.evaluate(() => document.getAnimations().length)).toBe(0);
      expect(await calm.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t').trim())).toBe('0s');
      const lively = await open();
      await lively.page.click('#hasard');
      await frames(lively.page);
      expect(await lively.page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
      // Hasard is a view transition: --t is 0 while it runs and comes back to .3 s after.
      await lively.page.waitForFunction(() => !document.documentElement.classList.contains('vt'));
      expect(await lively.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t').trim())).toBe('.3s');
      expectClean(calm.probe);
      expectClean(lively.probe);
    });

    for (const [width, height, touch] of [
      [1440, 900, false],
      [390, 844, true],
    ] as const) {
      it(`axe-core at ${width}: 0 serious or critical violation on the initial state and with the contrast dialog open`, async () => {
        const { page, probe } = await open({ width, height, touch });
        const run = async (): Promise<string[]> => {
          await page.evaluate(axe.source);
          return page.evaluate(async () => {
            type R = { violations: { id: string; impact: string | null; nodes: { target: unknown }[] }[] };
            const r = await (window as unknown as { axe: { run(): Promise<R> } }).axe.run();
            return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}[${v.impact}] ${JSON.stringify(v.nodes.map((n) => n.target))}`);
          });
        };
        await settle(page);
        expect(await run()).toEqual([]);
        await page.click('.pill[data-pair="texte-fond"]');
        await page.waitForSelector('#cdlg:not([hidden])');
        await settle(page);
        expect(await run()).toEqual([]);
        await page.keyboard.press('Escape');
        await page.click('#exportBtn');
        await page.waitForSelector('#xmenu:not([hidden])');
        await settle(page);
        expect(await run()).toEqual([]);
        expectClean(probe);
      });
    }
  });

  describe('differences with Chrome (measured and recorded)', () => {
    it('@property fade, scroll snap, safe area, dock snapping and screenshots', async () => {
      const wide = await open();
      // @property: the colour is between the old and the new value 120 ms after Hasard (the registered custom property is animated).
      const before = (await varsOf(wide.page))[3] as string;
      await wide.page.click('#hasard');
      await wide.page.waitForTimeout(120);
      const mid = await wide.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
      await settle(wide.page);
      const after = (await varsOf(wide.page))[3] as string;
      console.log(`webkit: @property fade: accent ${before} -> mid(120 ms) ${mid} -> ${after}; animates = ${mid.toLowerCase() !== before.toLowerCase() && mid.toLowerCase() !== after.toLowerCase()}`);
      const phone = await open({ width: 390, height: 844, touch: true });
      const info = await phone.page.evaluate(() => {
        const dock = document.querySelector<HTMLElement>('.swatches');
        const pills = document.querySelector<HTMLElement>('.pills');
        const probe = document.createElement('div');
        document.body.append(probe);
        const cs = (el: Element | null) => (el === null ? null : getComputedStyle(el).scrollSnapType);
        return { dockSnap: cs(dock), pillsSnap: cs(pills), dockClient: dock?.clientWidth ?? 0, dockScroll: dock?.scrollWidth ?? 0, viewportFit: document.querySelector('meta[name=viewport]')?.getAttribute('content'), dvh: CSS.supports('height', '100dvh'), has: CSS.supports('selector(:has(a))'), colorMix: CSS.supports('color', 'color-mix(in srgb, red, blue)') };
      });
      console.log(`webkit: ${JSON.stringify(info)}`);
      expect(info.dockSnap).toContain('mandatory');
      await phone.page.evaluate(() => document.querySelector('.swatches')?.scrollTo({ left: 150, behavior: 'instant' }));
      await phone.page.waitForTimeout(500);
      const snapped = await phone.page.evaluate(() => {
        const c = (document.querySelector('.swatches') as HTMLElement).getBoundingClientRect();
        return { left: (document.querySelector('.swatches') as HTMLElement).scrollLeft, edges: [...document.querySelectorAll('.sw')].map((e) => Math.round(e.getBoundingClientRect().left - c.left)).filter((x) => x >= 0 && x < 20) };
      });
      console.log(`webkit: dock after a programmatic scroll to 150: scrollLeft ${snapped.left}, colour edges at ${JSON.stringify(snapped.edges)} px from the dock edge (the same criterion as Chrome: a colour starts within 20 px)`);
      expect(snapped.edges.length).toBeGreaterThan(0);
      expectClean(wide.probe);
      expectClean(phone.probe);
      if (shotsDir !== null) {
        await settle(wide.page);
        await wide.page.screenshot({ path: `${shotsDir}/j7-webkit-1440.png` });
        await settle(phone.page);
        await phone.page.screenshot({ path: `${shotsDir}/j7-webkit-390.png` });
      }
    });
  });
});
