import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import axe from 'axe-core';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedHashFor } from '../fixed-hash.mjs';

const distFile = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
const url = pathToFileURL(distFile).href;
const ROLES = ['fond', 'surface', 'texte', 'accent', 'accent2', 'succes', 'alerte'] as const;
const VARS = ROLES.map((r) => `--${r}`);

type Probe = { violations: string[]; errors: string[]; requests: string[] };
type Session = { page: Page; probe: Probe; context: BrowserContext };

let browser: Browser;
const opened: BrowserContext[] = [];

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  for (const c of opened) await c.close();
  await browser?.close();
});

async function open(options: { colorScheme?: 'light' | 'dark'; init?: string; hash?: string } = {}): Promise<Session> {
  const context = await browser.newContext({ colorScheme: options.colorScheme ?? 'light', viewport: { width: 1440, height: 900 } });
  opened.push(context);
  const page = await context.newPage();
  const probe: Probe = { violations: [], errors: [], requests: [] };
  await page.exposeFunction('__huezzViolation', (directive: string, blocked: string) => probe.violations.push(`${directive} ${blocked}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __huezzViolation(d: string, b: string): void }).__huezzViolation(e.effectiveDirective, e.blockedURI);
    });
  });
  if (options.init) await page.addInitScript(options.init);
  page.on('console', (m) => m.type() === 'error' && probe.errors.push(m.text()));
  page.on('pageerror', (e) => probe.errors.push(String(e)));
  page.on('request', (r) => probe.requests.push(r.url()));
  await page.goto(url + (options.hash ?? fixedHashFor(options.colorScheme)));
  await page.waitForSelector('html.is-ready');
  return { page, probe, context };
}

const hexes = (page: Page) => page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Role variables once the 0.3 s fade has ended (computed values move during the transition). */
async function rgbVars(page: Page): Promise<string[]> {
  await page.waitForTimeout(450);
  return page.evaluate((names) => names.map((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()), VARS);
}
const toRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

describe('shell (file://, Chrome headless, CSP not bypassed)', () => {
  it('loads with no console error, no CSP violation, no request outside file://', async () => {
    const { page, probe } = await open();
    await page.waitForTimeout(200);
    expect(probe.errors).toEqual([]);
    expect(probe.violations).toEqual([]);
    expect(probe.requests.filter((u) => !u.startsWith('file://'))).toEqual([]);
  });

  it('has 0 element with a style attribute (live DOM after the first render, and the built file)', async () => {
    const { page, probe } = await open();
    expect(await page.$$eval('[style]', (els) => els.length)).toBe(0);
    expect(readFileSync(distFile, 'utf8')).not.toMatch(/\sstyle\s*=/i);
    expect(probe.violations.filter((v) => v.startsWith('style-src'))).toEqual([]);
  });

  it('shows 7 dock swatches (uppercase hex) and sets the 7 role variables on :root', async () => {
    const { page } = await open();
    const list = await hexes(page);
    expect(list).toHaveLength(7);
    for (const hex of list) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    const bg = await page.$$eval('.sw', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
    expect(bg).toEqual(list.map((h) => `rgb(${toRgb(h).join(', ')})`));
    const vars = await rgbVars(page);
    for (const v of vars) expect(v).not.toBe('');
    const uiVars = await page.evaluate(() => ['--sur-accent', '--sur-accent2', '--ui-accent', '--ui-on-accent'].map((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()));
    for (const v of uiVars) expect(v).not.toBe('');
    expect(await page.locator('.sw').count()).toBe(7);
  });

  it('has a harmony select with 6 options', async () => {
    const { page } = await open();
    const options = await page.$$eval('#harm option', (os) => os.map((o) => [o.getAttribute('value'), o.textContent]));
    expect(options).toEqual([
      ['complementary', 'Complémentaire'],
      ['analogous', 'Analogue'],
      ['triad', 'Triade'],
      ['tetrad', 'Tétrade'],
      ['monochrome', 'Monochrome'],
      ['split-complementary', 'Split-complémentaire'],
    ]);
    const before = await hexes(page);
    await page.selectOption('#harm', 'triad');
    await frames(page);
    expect(await hexes(page)).not.toEqual(before);
  });

  it('Hasard (click) changes the palette variables; Space on the body does too', async () => {
    const { page } = await open();
    const v0 = await rgbVars(page);
    const h0 = await hexes(page);
    await page.click('#hasard');
    await frames(page);
    const v1 = await rgbVars(page);
    const h1 = await hexes(page);
    expect(v1).not.toEqual(v0);
    expect(h1).not.toEqual(h0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await frames(page);
    expect(await hexes(page)).not.toEqual(h1);
    expect(await rgbVars(page)).not.toEqual(v1);
  });

  it('Space does NOT shuffle when the focus is in the hex field or on the select', async () => {
    const { page } = await open();
    const h0 = await hexes(page);
    await page.focus('#baseHex');
    await page.keyboard.press('Space');
    await frames(page);
    expect(await hexes(page)).toEqual(h0);
    await page.focus('#harm');
    await page.keyboard.press('Space');
    await frames(page);
    expect(await hexes(page)).toEqual(h0);
  });

  it('a locked colour (button, then key L) survives 20 Hasard presses', async () => {
    const { page } = await open();
    await page.click('.sw[data-role="fond"] .sw-lock');
    await page.focus('.sw[data-role="texte"] .sw-copy');
    await page.keyboard.press('l');
    await frames(page);
    expect(await page.getAttribute('.sw[data-role="fond"] .sw-lock', 'aria-pressed')).toBe('true');
    expect(await page.getAttribute('.sw[data-role="texte"] .sw-lock', 'aria-pressed')).toBe('true');
    const start = await hexes(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let changed = 0;
    let last = start;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Space');
      await frames(page);
      const now = await hexes(page);
      expect(now[0]).toBe(start[0]);
      expect(now[2]).toBe(start[2]);
      if (now.join() !== last.join()) changed++;
      last = now;
    }
    expect(changed).toBe(20);
    expect(last[3]).not.toBe(start[3]);
    await page.focus('.sw[data-role="texte"] .sw-copy');
    await page.keyboard.press('l');
    await frames(page);
    expect(await page.getAttribute('.sw[data-role="texte"] .sw-lock', 'aria-pressed')).toBe('false');
  });

  it('an invalid hex sets aria-invalid and changes nothing; a valid one is applied as the light accent', async () => {
    const { page } = await open();
    const h0 = await hexes(page);
    const v0 = await rgbVars(page);
    await page.fill('#baseHex', 'zzz');
    await page.keyboard.press('Enter');
    await frames(page);
    expect(await page.getAttribute('#baseHex', 'aria-invalid')).toBe('true');
    expect(await hexes(page)).toEqual(h0);
    expect(await rgbVars(page)).toEqual(v0);
    await page.fill('#baseHex', '336699');
    await page.keyboard.press('Enter');
    await frames(page);
    expect(await page.getAttribute('#baseHex', 'aria-invalid')).toBeNull();
    expect((await hexes(page))[3]).toBe('#336699');
    expect(await page.inputValue('#base')).toBe('#336699');
    expect(await page.inputValue('#baseHex')).toBe('#336699');
  });

  it('the colour input drags without fade (is-dragging) and commits on change', async () => {
    const { page } = await open();
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#base');
      if (!input) return;
      input.value = '#aa3355';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await frames(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains('is-dragging'))).toBe(true);
    expect((await hexes(page))[3]).toBe('#AA3355');
    await page.evaluate(() => document.querySelector('#base')?.dispatchEvent(new Event('change', { bubbles: true })));
    expect(await page.evaluate(() => document.documentElement.classList.contains('is-dragging'))).toBe(false);
  });

  it('follows the system theme (tool tokens) independently of the palette mode', async () => {
    // no link on purpose: the system theme alone decides (the palette itself is random since J9)
    const light = await open({ colorScheme: 'light', hash: '' });
    const dark = await open({ colorScheme: 'dark', hash: '' });
    const tokens = (page: Page) => page.evaluate(() => {
      return { body: getComputedStyle(document.body).backgroundColor, field: getComputedStyle(document.querySelector('.chip-base') as Element).borderTopColor };
    });
    expect(await tokens(light.page)).toEqual({ body: 'rgb(255, 255, 255)', field: 'rgb(138, 138, 138)' });
    expect(await tokens(dark.page)).toEqual({ body: 'rgb(12, 12, 12)', field: 'rgb(107, 107, 107)' });
    expect(await dark.page.getAttribute('.seg [data-mode="dark"]', 'aria-pressed')).toBe('true');
    expect(await light.page.getAttribute('.seg [data-mode="light"]', 'aria-pressed')).toBe('true');
    const seedOf = (page: Page) => page.evaluate(() => /[#&]s=([0-9a-f]{8})/.exec(location.hash)?.[1] ?? null);
    await dark.page.waitForFunction(() => /[#&]s=[0-9a-f]{8}/.test(location.hash));
    const seedBefore = await seedOf(dark.page);
    await dark.page.click('.seg [data-mode="light"]');
    await frames(dark.page);
    expect((await tokens(dark.page)).body).toBe('rgb(12, 12, 12)');
    expect(await dark.page.getAttribute('.seg [data-mode="light"]', 'aria-pressed')).toBe('true');
    // switching the mode does not regenerate: same seed
    await dark.page.waitForTimeout(450);
    expect(await seedOf(dark.page)).toBe(seedBefore);
  });

  it('keyboard: one tab stop in the dock, arrows move, Enter copies, Escape closes', async () => {
    const { page } = await open();
    expect(await page.$$eval('.sw-copy', (els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length)).toBe(1);
    expect(await page.$$eval('.sw-lock', (els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length)).toBe(1);
    await page.focus('.sw[data-role="fond"] .sw-copy');
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => document.activeElement?.closest('.sw')?.getAttribute('data-role'))).toBe('surface');
    await page.keyboard.press('End');
    expect(await page.evaluate(() => document.activeElement?.closest('.sw')?.getAttribute('data-role'))).toBe('alerte');
    await page.keyboard.press('Home');
    expect(await page.evaluate(() => document.activeElement?.closest('.sw')?.getAttribute('data-role'))).toBe('fond');
    expect(await page.$$eval('.sw-copy', (els) => els.map((e) => (e as HTMLElement).tabIndex))).toEqual([0, -1, -1, -1, -1, -1, -1]);
    expect(await page.textContent('#toast span')).toBe('');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /^Copié : #[0-9A-F]{6}$/.test(document.querySelector('#toast span')?.textContent ?? ''));
    expect(await page.textContent('#toast span')).toBe(`Copié : ${(await hexes(page))[0]}`);
    await page.focus('#hasard');
    await page.keyboard.press('Escape');
    expect(await page.isHidden('#manual')).toBe(true);
  });

  it('click on a swatch copies its hex (Clipboard API, then execCommand, then manual) and the toast appears only after success', async () => {
    const secure = await open();
    const isSecure = await secure.page.evaluate(() => window.isSecureContext);
    console.log('file:// isSecureContext =', isSecure);
    await secure.context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    const hex = (await hexes(secure.page))[3];
    await secure.page.click('.sw[data-role="accent"] .sw-copy');
    await secure.page.waitForFunction(() => document.querySelector('#toast.show') !== null);
    expect(await secure.page.textContent('#toast span')).toBe(`Copié : ${hex}`);
    const path = await secure.page.getAttribute('#toast', 'data-path');
    console.log('copy path under file:// with grantPermissions =', path);
    expect(['clipboard', 'execCommand']).toContain(path);
    const clip = await secure.page.evaluate(() => navigator.clipboard.readText()).catch(() => 'unreadable');
    console.log('clipboard content read back =', clip);
    if (clip !== 'unreadable') expect(clip).toBe(hex);

    const insecure = await open({ init: "Object.defineProperty(window, 'isSecureContext', { value: false })" });
    expect(await insecure.page.evaluate(() => window.isSecureContext)).toBe(false);
    await insecure.page.click('.sw[data-role="accent"] .sw-copy');
    await insecure.page.waitForFunction(() => document.querySelector('#toast.show') !== null);
    expect(await insecure.page.getAttribute('#toast', 'data-path')).toBe('execCommand');
    expect(await insecure.page.evaluate(() => document.querySelector('textarea.copy-sink'))).toBeNull();

    const failing = await open({ init: "Object.defineProperty(window, 'isSecureContext', { value: false }); document.execCommand = () => false;" });
    await failing.page.click('.sw[data-role="accent"] .sw-copy');
    await failing.page.waitForSelector('#manual:not([hidden])');
    expect(await failing.page.inputValue('#manualField')).toBe((await hexes(failing.page))[3]);
    expect(await failing.page.textContent('#toast span')).toBe('');
    expect(await failing.page.evaluate(() => document.activeElement?.id)).toBe('manualField');
    await failing.page.keyboard.press('Escape');
    expect(await failing.page.isHidden('#manual')).toBe(true);
    expect(await failing.page.evaluate(() => document.activeElement?.closest('.sw')?.getAttribute('data-role'))).toBe('accent');
    expect(failing.probe.errors).toEqual([]);
  });

  for (const scheme of ['light', 'dark'] as const) {
    it(`axe-core: 0 serious or critical violation on the initial state (system theme ${scheme})`, async () => {
      const { page, probe } = await open({ colorScheme: scheme });
      await page.evaluate(axe.source);
      const result = await page.evaluate(async () => {
        const r = await (window as unknown as { axe: { run(): Promise<{ violations: { id: string; impact: string | null; nodes: { target: unknown }[] }[]; incomplete: { id: string; nodes: unknown[] }[]; passes: unknown[] }> } }).axe.run();
        return {
          violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: JSON.stringify(v.nodes[0]?.target) })),
          incomplete: r.incomplete.map((v) => `${v.id}(${v.nodes.length})`),
          passes: r.passes.length,
        };
      });
      console.log(`axe ${scheme}: violations`, JSON.stringify(result.violations), 'incomplete', result.incomplete.join(','), 'passes', result.passes);
      expect(result.passes).toBeGreaterThan(0);
      expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
      expect(probe.errors).toEqual([]);
      expect(probe.violations).toEqual([]);
    });
  }
});
