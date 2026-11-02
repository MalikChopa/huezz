import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import axe from 'axe-core';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedHashFor } from '../fixed-hash.mjs';

const distFile = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
const url = pathToFileURL(distFile).href;

type Probe = { violations: string[]; errors: string[] };
type Session = { page: Page; probe: Probe };

let browser: Browser;
const opened: BrowserContext[] = [];

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  for (const c of opened) await c.close();
  await browser?.close();
});

async function open(options: { scheme?: 'light' | 'dark'; width?: number; height?: number; reducedMotion?: boolean } = {}): Promise<Session> {
  const context = await browser.newContext({
    colorScheme: options.scheme ?? 'light',
    viewport: { width: options.width ?? 1440, height: options.height ?? 900 },
    ...(options.reducedMotion ? { reducedMotion: 'reduce' as const } : {}),
  });
  opened.push(context);
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
  await page.goto(url + fixedHashFor(options.scheme));
  await page.waitForSelector('html.is-ready');
  return { page, probe };
}

/** One distinctive element per mock-up, and the role variable its colour must equal. */
const PROBES = [
  { name: 'site CTA background', selector: '.m-site .m-cta .m-btn', prop: 'backgroundColor', variable: '--accent' },
  { name: 'site CTA label', selector: '.m-site .m-cta .m-btn', prop: 'color', variable: '--sur-accent' },
  { name: 'phone card background', selector: '.m-phone .m-card', prop: 'backgroundColor', variable: '--accent' },
  { name: 'phone avatar background', selector: '.m-phone .m-avatar', prop: 'backgroundColor', variable: '--accent2' },
  { name: 'dashboard bars (series 1)', selector: '.m-dash .m-bars i:nth-child(1)', prop: 'backgroundColor', variable: '--accent' },
  { name: 'dashboard bars (series 2)', selector: '.m-dash .m-bars i:nth-child(2)', prop: 'backgroundColor', variable: '--accent2' },
  { name: 'dashboard KPI background', selector: '.m-dash .m-kpi', prop: 'backgroundColor', variable: '--surface' },
  { name: 'dashboard KPI trend', selector: '.m-dash .m-kpi .up', prop: 'color', variable: '--succes' },
  { name: 'dashboard KPI alert', selector: '.m-dash .m-kpi .bad', prop: 'color', variable: '--alerte' },
  { name: 'site page background', selector: '.m-site', prop: 'backgroundColor', variable: '--fond' },
  { name: 'phone text', selector: '.m-phone .m-apphead b', prop: 'color', variable: '--texte' },
] as const;

type Reading = { name: string; actual: string; expected: string };

/** Waits for the 0.3 s fade, then reads each probe and the computed value of its variable. */
async function read(page: Page): Promise<Reading[]> {
  await page.waitForTimeout(500);
  return page.evaluate((probes) => {
    const root = getComputedStyle(document.documentElement);
    return probes.map((p) => {
      const el = document.querySelector(p.selector);
      if (el === null) throw new Error(`missing ${p.selector}`);
      return { name: p.name, actual: (getComputedStyle(el) as unknown as Record<string, string>)[p.prop] ?? '', expected: root.getPropertyValue(p.variable).trim() };
    });
  }, PROBES);
}

/** The colours are compared as numbers: the variable and the property may serialise differently. */
const channels = (css: string): string => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map((n) => Math.round(Number(n))).join(',');
function expectFollowing(readings: Reading[]): void {
  for (const r of readings) {
    expect(channels(r.expected), `${r.name}: variable is empty`).not.toBe('');
    expect(channels(r.actual), r.name).toBe(channels(r.expected));
  }
}
const actuals = (readings: Reading[], names: string[]): string[] => readings.filter((r) => names.includes(r.name)).map((r) => channels(r.actual));
const DISTINCTIVE = ['site CTA background', 'phone card background', 'dashboard bars (series 1)', 'dashboard bars (series 2)'];

const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

describe('scene and mock-ups (file://, Chrome headless, CSP not bypassed)', () => {
  it('shows the 3 mock-ups, each role="img" with a label, in the accessibility tree (J6: no inert)', async () => {
    const { page } = await open();
    const info = await page.$$eval('#stage [role="img"]', (els) => els.map((e) => ({ label: e.getAttribute('aria-label') ?? '', w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
    expect(info).toHaveLength(3);
    for (const i of info) {
      expect(i.label.length).toBeGreaterThan(10);
      expect(i.w).toBeGreaterThan(100);
      expect(i.h).toBeGreaterThan(100);
    }
    for (const sel of ['.m-site', '.m-dash', '.m-phone']) expect(await page.isVisible(sel)).toBe(true);
    expect(await page.$eval('#stageWrap', (e) => (e as HTMLElement).inert)).toBe(false);
    expect(await page.$eval('#stage', (e) => e.closest('[inert]') === null)).toBe(true);
    expect(await page.$eval('#scene', (e) => (e as HTMLElement).inert)).toBe(false);
    // the stage holds nothing the keyboard can reach
    const focusable = await page.$$eval('#stage a, #stage button, #stage input, #stage select, #stage [tabindex]', (els) => els.length);
    expect(focusable).toBe(0);
    const head = await page.$eval('.scene-titles', (e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
    expect(head).toBe('Argile turquoise Complémentaire · clair · 7 rôles · 5/5 contrastes AA');
  });

  it('the scene head follows the state: harmony, mode, number of AA pairs', async () => {
    const { page } = await open();
    await page.selectOption('#harm', 'triad');
    await page.click('.seg button[data-mode="dark"]');
    await frames(page);
    const head = await page.$eval('.scene-titles', (e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
    expect(head).toMatch(/^\p{Lu}\p{Ll}+ \p{Ll}+ Triade · sombre · 7 rôles · [0-5]\/5 contrastes AA$/u);
  });

  it('the mock-up colours equal the role variables at load, and after each Hasard they change and still equal them', async () => {
    const { page, probe } = await open();
    let before = await read(page);
    expectFollowing(before);
    for (let i = 0; i < 3; i++) {
      await page.click('#hasard');
      await frames(page);
      const after = await read(page);
      expectFollowing(after);
      for (const name of DISTINCTIVE) {
        const was = actuals(before, [name])[0];
        const now = actuals(after, [name])[0];
        expect(now, `${name} after Hasard ${i + 1}`).not.toBe(was);
      }
      before = after;
    }
    expect(probe.errors).toEqual([]);
    expect(probe.violations).toEqual([]);
  });

  it('typing a base colour changes the mock-ups: the site button takes exactly that colour', async () => {
    const { page } = await open();
    const before = await read(page);
    await page.fill('#baseHex', '336699');
    await page.keyboard.press('Enter');
    await frames(page);
    const after = await read(page);
    expectFollowing(after);
    expect(actuals(after, ['site CTA background'])[0]).toBe('51,102,153');
    expect(actuals(after, ['phone card background'])[0]).toBe('51,102,153');
    expect(actuals(after, DISTINCTIVE)).not.toEqual(actuals(before, DISTINCTIVE));
  });

  it('the light/dark palette toggle switches the mock-ups to the dark colours, and back', async () => {
    const { page } = await open();
    const light = await read(page);
    await page.click('.seg button[data-mode="dark"]');
    await frames(page);
    const dark = await read(page);
    expectFollowing(dark);
    expect(actuals(dark, ['site page background', 'dashboard KPI background', 'phone text', ...DISTINCTIVE])).not.toEqual(
      actuals(light, ['site page background', 'dashboard KPI background', 'phone text', ...DISTINCTIVE]),
    );
    // the dock shows the dark accent: the site button is exactly that colour
    const dockAccent = await page.$eval('.sw[data-role="accent"] .sw-hex', (e) => e.textContent ?? '');
    const n = parseInt(dockAccent.slice(1), 16);
    expect(actuals(dark, ['site CTA background'])[0]).toBe(`${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`);
    await page.click('.seg button[data-mode="light"]');
    await frames(page);
    const back = await read(page);
    expectFollowing(back);
    expect(actuals(back, DISTINCTIVE)).toEqual(actuals(light, DISTINCTIVE));
  });

  it('a locked colour stays in the mock-ups through 5 Hasard presses', async () => {
    const { page } = await open();
    const start = await read(page);
    await page.click('.sw[data-role="accent"] .sw-lock');
    await blur(page);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Space');
      await frames(page);
    }
    const after = await read(page);
    expectFollowing(after);
    for (const name of ['site CTA background', 'phone card background', 'dashboard bars (series 1)']) {
      expect(actuals(after, [name])[0], name).toBe(actuals(start, [name])[0]);
    }
    expect(actuals(after, ['dashboard bars (series 2)'])[0]).not.toBe(actuals(start, ['dashboard bars (series 2)'])[0]);
  });

  it('adds or removes no node in #scene over 20 Hasard presses (MutationObserver installed after load)', async () => {
    const { page, probe } = await open();
    await page.evaluate(() => {
      const w = window as unknown as { __mut: { added: number; removed: number; attributes: number; characterData: number } };
      w.__mut = { added: 0, removed: 0, attributes: 0, characterData: 0 };
      const scene = document.querySelector('#scene');
      if (scene === null) throw new Error('no scene');
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'childList') {
            w.__mut.added += r.addedNodes.length;
            w.__mut.removed += r.removedNodes.length;
          } else if (r.type === 'attributes') w.__mut.attributes++;
          else w.__mut.characterData++;
        }
      }).observe(scene, { childList: true, subtree: true, attributes: true, characterData: true });
    });
    await blur(page);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Space');
      await frames(page);
    }
    await page.click('.seg button[data-mode="dark"]');
    await frames(page);
    await page.waitForTimeout(100);
    const mut = await page.evaluate(() => (window as unknown as { __mut: Record<string, number> }).__mut);
    console.log('mutations in #scene after 20 Hasard + 1 mode change:', JSON.stringify(mut));
    expect(mut.added).toBe(0);
    expect(mut.removed).toBe(0);
    expect(probe.errors).toEqual([]);
  });

  it('has 0 element with a style attribute (also after interactions), 0 CSP violation, 0 console error', async () => {
    const { page, probe } = await open();
    await page.click('#hasard');
    await page.fill('#baseHex', '8844cc');
    await page.keyboard.press('Enter');
    await page.click('.seg button[data-mode="dark"]');
    await page.selectOption('#harm', 'tetrad');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    expect(await page.$$eval('[style]', (els) => els.length)).toBe(0);
    expect(await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => (e.getAttribute('style') ?? '').length > 0).length)).toBe(0);
    expect(readFileSync(distFile, 'utf8')).not.toMatch(/\sstyle\s*=/i);
    expect(probe.violations).toEqual([]);
    expect(probe.errors).toEqual([]);
  });

  it('a new base colour fades in 0.3 s through OKLCH on the mock-ups (neither the old nor the new colour in between), and at once with prefers-reduced-motion', async () => {
    const cta = (page: Page): Promise<string> => page.evaluate(() => getComputedStyle(document.querySelector('.m-site .m-cta .m-btn')!).backgroundColor);
    const setBase = async (page: Page): Promise<void> => {
      await page.fill('#baseHex', '#B02060');
      await page.press('#baseHex', 'Enter');
    };
    const { page } = await open();
    const before = await cta(page);
    await setBase(page);
    await page.waitForTimeout(120);
    const mid = await cta(page);
    await page.waitForTimeout(500);
    const end = await cta(page);
    expect(end).not.toBe(before);
    expect(mid, 'mid-fade colour is neither the old nor the new one').not.toBe(before);
    expect(mid).not.toBe(end);
    expect(await page.evaluate(() => document.documentElement.classList.contains('morph')), 'the class of the fade is gone at rest').toBe(false);

    const reduced = await open({ reducedMotion: true });
    const b2 = await cta(reduced.page);
    await setBase(reduced.page);
    await reduced.page.waitForTimeout(120);
    const m2 = await cta(reduced.page);
    expect(m2).not.toBe(b2);
    await reduced.page.waitForTimeout(400);
    expect(await cta(reduced.page)).toBe(m2);
  });

  for (const mode of ['light', 'dark'] as const) {
    it(`axe-core: 0 serious or critical violation with the ${mode} palette (system theme ${mode})`, async () => {
      const { page, probe } = await open({ scheme: mode });
      if (mode === 'dark') await page.click('.seg button[data-mode="dark"]');
      await page.waitForTimeout(500);
      await page.evaluate(axe.source);
      const result = await page.evaluate(async () => {
        type R = { violations: { id: string; impact: string | null; nodes: { target: unknown }[] }[]; incomplete: { id: string; nodes: { target: unknown }[] }[]; passes: unknown[] };
        const r = await (window as unknown as { axe: { run(): Promise<R> } }).axe.run();
        return {
          violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: JSON.stringify(v.nodes[0]?.target) })),
          incomplete: r.incomplete.map((v) => `${v.id}(${v.nodes.length}:${v.nodes.map((n) => JSON.stringify(n.target)).join(',')})`),
          passes: r.passes.length,
        };
      });
      console.log(`axe ${mode}: violations`, JSON.stringify(result.violations), '| incomplete', result.incomplete.join(' ; '), '| passes', result.passes);
      expect(result.passes).toBeGreaterThan(0);
      expect(result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
      expect(probe.errors).toEqual([]);
      expect(probe.violations).toEqual([]);
    });
  }

  it('informative: axe on the mock-up content itself (inert removed in memory), not asserted', async () => {
    const { page } = await open();
    await page.evaluate(() => document.querySelector('#stageWrap')?.removeAttribute('inert'));
    await page.evaluate(axe.source);
    const result = await page.evaluate(async () => {
      type R = { violations: { id: string; impact: string | null; nodes: { target: unknown }[] }[]; incomplete: { id: string; nodes: unknown[] }[] };
      const r = await (window as unknown as { axe: { run(c: string): Promise<R> } }).axe.run('#stage');
      return { violations: r.violations.map((v) => `${v.id}[${v.impact}](${v.nodes.length})`), incomplete: r.incomplete.map((v) => `${v.id}(${v.nodes.length})`) };
    });
    console.log('axe on #stage (inert removed):', JSON.stringify(result));
    expect(Array.isArray(result.violations)).toBe(true);
  });

  for (const width of [1440, 390]) {
    it(`has no horizontal scroll at ${width} px, and the stage stays inside the window`, async () => {
      const { page } = await open({ width, height: width === 390 ? 844 : 900 });
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const st = document.querySelector('#stage')!.getBoundingClientRect();
        const wrap = document.querySelector('#stageWrap')!.getBoundingClientRect();
        const offenders = [...document.querySelectorAll('body *')].filter((e) => !e.closest('#stage, .swatches, .pills')).map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && (r.right > innerWidth + 1 || r.left < -1));
        return {
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          inner: innerWidth,
          stageLeft: st.left,
          stageRight: st.right,
          wrapW: wrap.width,
          offenders: offenders.map(({ e }) => e.className || e.tagName).slice(0, 5),
        };
      });
      console.log(`layout at ${width}:`, JSON.stringify(m));
      expect(m.doc).toBeLessThanOrEqual(m.inner);
      expect(m.body).toBeLessThanOrEqual(m.inner);
      expect(m.stageLeft).toBeGreaterThanOrEqual(-1);
      expect(m.stageRight).toBeLessThanOrEqual(m.inner + 1);
      expect(m.offenders).toEqual([]);
    });
  }
});
