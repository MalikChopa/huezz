import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportText, type OutputId } from '../../src/export';
import type { ExportInput } from '../../src/export/keys';
import { decodeHash } from '../../src/state/url';
import { pixelsOf, ratio, parseCss, type Rgb } from './j6-helpers';
import { FIXED_HASH } from '../fixed-hash.mjs';

// Offline proof (ARCHITECTURE section 8, F8): dist/index.html is served on a fictitious https origin by interception (no server),
// the network is cut after the load, every function is used. Exactly 1 request (the document) and 0 failure are required.
const distFile = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
const ORIGIN = 'https://huezz.test';
const HTTPS = `${ORIGIN}/`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  await browser?.close();
});

const settle = async (page: Page): Promise<void> => {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.waitForTimeout(450);
};
const dockHex = (page: Page): Promise<string[]> => page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
const vars = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return ['--fond', '--surface', '--texte', '--accent', '--accent2', '--succes', '--alerte'].map((v) => cs.getPropertyValue(v).trim());
  });
const toastText = (page: Page): Promise<string> => page.$eval('#toast span', (e) => e.textContent ?? '');

async function liveInput(page: Page): Promise<ExportInput> {
  await settle(page);
  const r = decodeHash(await page.evaluate(() => location.hash));
  if (r.kind !== 'ok') throw new Error('le hash vivant est illisible');
  return { harmony: r.value.harmony, mode: r.value.mode, theme: r.value.theme };
}

type Log = { requests: string[]; failed: string[]; errors: string[]; violations: string[] };

describe('offline after load, on a fictitious https origin', () => {
  let context: BrowserContext;
  let page: Page;
  let helper: Page;
  const log: Log = { requests: [], failed: [], errors: [], violations: [] };
  let routed = 0;

  beforeAll(async () => {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', acceptDownloads: true });
    await context.route(`${ORIGIN}/**`, (route) => {
      routed++;
      return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(distFile) });
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    context.on('request', (r) => log.requests.push(`${r.method()} ${r.url()} ${r.resourceType()}`));
    context.on('requestfailed', (r) => log.failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
    helper = await context.newPage();
    page = await context.newPage();
    await page.exposeFunction('__huezzViolation', (directive: string, blocked: string) => log.violations.push(`${directive} ${blocked}`));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __huezzViolation(d: string, b: string): void }).__huezzViolation(e.effectiveDirective, e.blockedURI);
      });
    });
    page.on('console', (m) => m.type() === 'error' && log.errors.push(m.text()));
    page.on('pageerror', (e) => log.errors.push(String(e)));
    await page.goto(HTTPS + FIXED_HASH);
    await page.waitForSelector('html.is-ready');
    await settle(page);
  });
  afterAll(async () => {
    await context?.close();
  });

  it('loads with exactly one request (the document) and no failure', () => {
    // The helper page is blank (about:blank): it makes no request. Only the document is requested.
    expect(log.requests).toEqual([`GET ${HTTPS} document`]);
    expect(log.failed).toEqual([]);
    expect(routed).toBe(1);
  });

  it('every function works with the network cut', async () => {
    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);

    // Hasard: click, then Space.
    const h0 = await dockHex(page);
    await page.click('#hasard');
    await settle(page);
    const h1 = await dockHex(page);
    expect(h1).not.toEqual(h0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await settle(page);
    const h2 = await dockHex(page);
    expect(h2).not.toEqual(h1);

    // Harmony.
    await page.selectOption('#harm', 'triad');
    await settle(page);
    expect(await page.textContent('#metaHarm')).toBe('Triade');
    expect(await dockHex(page)).not.toEqual(h2);

    // Mode.
    const light = await vars(page);
    await page.click('.seg button[data-mode="dark"]');
    await settle(page);
    const dark = await vars(page);
    expect(dark).not.toEqual(light);
    expect(await page.textContent('#metaMode')).toBe('sombre');
    await page.click('.seg button[data-mode="light"]');
    await settle(page);
    expect(await vars(page)).toEqual(light);

    // Base colour: the hex field, then the native input (input + change events).
    await page.fill('#baseHex', '#E0A800');
    await page.press('#baseHex', 'Enter');
    await settle(page);
    expect((await dockHex(page))[3]).toBe('#E0A800');
    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('#base');
      if (el === null) throw new Error('#base');
      el.value = '#336699';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(page);
    expect((await dockHex(page))[3]).toBe('#336699');
    await page.fill('#baseHex', '#E0A800');
    await page.press('#baseHex', 'Enter');
    await settle(page);

    // Lock with the button; the role stays through Hasard.
    await page.click('.sw[data-role="alerte"] .sw-lock');
    await settle(page);
    expect(await page.getAttribute('.sw[data-role="alerte"] .sw-lock', 'aria-pressed')).toBe('true');
    const alerte = (await dockHex(page))[6];
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await settle(page);
    expect((await dockHex(page))[6]).toBe(alerte);
    await page.click('.sw[data-role="alerte"] .sw-lock');
    await settle(page);
    expect(await page.getAttribute('.sw[data-role="alerte"] .sw-lock', 'aria-pressed')).toBe('false');

    // Keyboard shortcut L: lock the targeted colour (focus on a swatch), then unlock.
    await page.focus('.sw[data-role="succes"] .sw-copy');
    await page.keyboard.press('l');
    await settle(page);
    expect(await page.getAttribute('.sw[data-role="succes"] .sw-lock', 'aria-pressed')).toBe('true');
    await page.keyboard.press('l');
    await settle(page);
    expect(await page.getAttribute('.sw[data-role="succes"] .sw-lock', 'aria-pressed')).toBe('false');

    // Enter on a colour copies it (clipboard API on a secure origin).
    await page.focus('.sw[data-role="texte"] .sw-copy');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /^Copié : #/.test(document.querySelector('#toast span')?.textContent ?? ''));
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe((await dockHex(page))[2]);

    // Contrast pill + dialog + Corriger on the yellow base (accent/fond fails), then Escape closes it.
    await page.fill('#baseHex', '#E0A800');
    await page.press('#baseHex', 'Enter');
    await settle(page);
    await page.click('.pill[data-pair="accent-fond"]');
    await page.waitForSelector('#cdlg:not([hidden])');
    await page.click('#cdFix');
    await settle(page);
    const c = Object.fromEntries((await vars(page)).map((v, i) => [i, parseCss(v)])) as Record<number, Rgb>;
    expect(ratio(c[3] as Rgb, c[0] as Rgb)).toBeGreaterThanOrEqual(4.5);
    expect(await toastText(page)).toMatch(/^Accent corrigé : #E0A800 → #[0-9A-F]{6} \(verrouillé\)\. 5 sur 5 contrastes AA\.$/);
    await page.keyboard.press('Escape');
    expect(await page.isVisible('#cdlg')).toBe(false);

    // Every export format: the text equals the one computed from the live hash; Copier works offline.
    await page.click('#exportBtn');
    await page.waitForSelector('#xmenu:not([hidden])');
    const input = await liveInput(page);
    const formats: { click: string; extra?: string; out: Exclude<OutputId, 'png'> }[] = [
      { click: 'css', out: 'css' },
      { click: 'tailwind', extra: '#xTw [data-v=v4]', out: 'tailwind-v4' },
      { click: 'tailwind', extra: '#xTw [data-v=v3]', out: 'tailwind-v3' },
      { click: 'json', out: 'json' },
      { click: 'swift', out: 'swift' },
      { click: 'figma', out: 'figma' },
    ];
    for (const f of formats) {
      await page.click(`#xFormats [data-f=${f.click}]`);
      if (f.extra !== undefined) await page.click(f.extra);
      const shown = await page.inputValue('#xOut');
      expect(shown).toBe(exportText(f.out, input));
      expect(shown.length).toBeGreaterThan(100);
    }
    await page.click('#xFigma2025');
    expect(await page.inputValue('#xOut')).toBe(exportText('figma-2025.10', input));
    await page.click('#xFigma2025');
    await page.click('#xFormats [data-f=css]');
    await page.click('#xCopy');
    await page.waitForFunction(() => /Copié/.test(document.querySelector('#toast span')?.textContent ?? ''));
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(exportText('css', input));

    // PNG download: signature, 1400 x 400.
    await page.click('#xFormats [data-f=png]');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#xDownload')]);
    expect(download.suggestedFilename()).toBe('huezz.png');
    const path = await download.path();
    const png = readFileSync(path);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(1400);
    expect(png.readUInt32BE(20)).toBe(400);
    const px = await pixelsOf(helper, png, [0, 1, 2, 3, 4, 5, 6].map((i) => [100 + 200 * i, 200] as [number, number]));
    const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    expect(px.map(hex)).toEqual(await dockHex(page));
    await page.keyboard.press('Escape');
    expect(await page.isVisible('#xmenu')).toBe(false);

    // Share: copies the live address with the hash, toast.
    await page.click('#share');
    await page.waitForFunction(() => /^Lien copié/.test(document.querySelector('#toast span')?.textContent ?? ''));
    await settle(page);
    const href = await page.evaluate(() => location.href);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(href);
    expect(href.startsWith(`${HTTPS}#v=1&`)).toBe(true);

    // URL hash: a valid change loads, a hostile one leaves the state and shows the message.
    const before = await dockHex(page);
    await page.evaluate(() => {
      location.hash = '#v=1&m=d&h=tr&s=00c0ffee&k=00&l=F5F8F7FFFFFF0E1F1D0F7C74D95A4E2C7A3FB93A2B&d=0B1413142120E4EFED42C2B3F08D7F62C97FF2796A';
    });
    await settle(page);
    expect(await page.textContent('#metaMode')).toBe('sombre');
    expect(await dockHex(page)).toEqual(['#0B1413', '#142120', '#E4EFED', '#42C2B3', '#F08D7F', '#62C97F', '#F2796A']);
    expect(await dockHex(page)).not.toEqual(before);
    const kept = await dockHex(page);
    await page.evaluate(() => {
      location.hash = '#v=1&<script>';
    });
    await settle(page);
    expect(await dockHex(page)).toEqual(kept);
    expect(await toastText(page)).toMatch(/Lien invalide|plus récente/);

    // J13: history (localStorage), a star, a restore, undo and redo, Tout effacer: no request either.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    const beforeRestore = await dockHex(page);
    await page.click('#histBtn');
    expect(await page.locator('#hRec .hitem').count()).toBeGreaterThan(2);
    await page.locator('#hRec .hstar').nth(1).click();
    expect(await page.locator('#hFav .hitem').count()).toBe(1);
    await page.locator('#hRec .hrow').nth(1).click();
    await settle(page);
    expect(await dockHex(page)).not.toEqual(beforeRestore);
    await page.keyboard.press('Control+z');
    await settle(page);
    expect(await dockHex(page)).toEqual(beforeRestore);
    await page.keyboard.press('Control+y');
    await settle(page);
    expect(await dockHex(page)).not.toEqual(beforeRestore);
    await page.click('#histBtn');
    await page.click('#hClear');
    await page.click('#hYes');
    expect(await page.locator('.hitem').count()).toBe(0);
  }, 120_000);

  it('still one request and no failure: the whole session made no network traffic', () => {
    expect(log.requests).toEqual([`GET ${HTTPS} document`]);
    expect(log.failed).toEqual([]);
    expect(routed).toBe(1);
  });

  it('reload from the address (hash) offline: served by the interception; it restores the 14 colours', async () => {
    const hash = await page.evaluate(() => location.hash);
    const before = await dockHex(page);
    await page.reload();
    await page.waitForSelector('html.is-ready');
    await settle(page);
    expect(await page.evaluate(() => location.hash)).toBe(hash);
    expect(await dockHex(page)).toEqual(before);
    // The reload is a second document request (the fragment is not sent), fulfilled by the interception (no server, no HTTP cache involved).
    expect(log.requests).toEqual([`GET ${HTTPS} document`, `GET ${HTTPS} document`]);
    expect(log.failed).toEqual([]);
  });

  it('without the interception a real offline reload has nothing to fall back on (R10, no service worker): recorded, not asserted', async () => {
    await context.unroute(`${ORIGIN}/**`);
    let outcome: string;
    try {
      await page.reload({ timeout: 5000 });
      outcome = 'the reload succeeded (served from a cache)';
    } catch (e) {
      outcome = `the reload failed: ${String(e).split('\n')[0]}`;
    }
    console.log(`offline reload without interception: ${outcome}`);
    expect(typeof outcome).toBe('string');
  });

  it('no console error, no CSP violation during the session', () => {
    expect(log.errors).toEqual([]);
    expect(log.violations).toEqual([]);
  });
});
