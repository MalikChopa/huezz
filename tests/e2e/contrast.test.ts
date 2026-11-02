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

async function open(options: { scheme?: 'light' | 'dark'; width?: number; height?: number } = {}): Promise<Session> {
  const context = await browser.newContext({ colorScheme: options.scheme ?? 'light', viewport: { width: options.width ?? 1440, height: options.height ?? 900 } });
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

const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
/** The palette fade lasts 0.3 s: read colours after it. */
const settle = async (page: Page) => {
  await frames(page);
  await page.waitForTimeout(450);
};

/** Types the base like a user: field + Enter at desktop width, colour input below 760 px (the hex field is hidden there). */
async function typeBase(page: Page, hex: string): Promise<void> {
  if ((page.viewportSize()?.width ?? 1440) > 760) {
    await page.fill('#baseHex', hex);
    await page.keyboard.press('Enter');
  } else await page.fill('#base', hex.toLowerCase());
  await settle(page);
}

// Independent recomputation (own formulas, nothing imported from the app).
type Rgb = [number, number, number];
const parseCss = (css: string): Rgb => {
  const n = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  if (n.length < 3) throw new Error(`couleur illisible : ${css}`);
  return [n[0] as number, n[1] as number, n[2] as number];
};
const lum = ([r, g, b]: Rgb): number => {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [Math.max(lum(a), lum(b)), Math.min(lum(a), lum(b))];
  return (hi + 0.05) / (lo + 0.05);
};
const trunc = (x: number, d: number): string => (Math.floor(x * 10 ** d + 1e-9) / 10 ** d).toFixed(d).replace('.', ',');

const PAIRS = [
  { id: 'texte-fond', fg: '--texte', bg: '--fond', info: false },
  { id: 'texte-surface', fg: '--texte', bg: '--surface', info: false },
  { id: 'accent-fond', fg: '--accent', bg: '--fond', info: false },
  { id: 'succes-surface', fg: '--succes', bg: '--surface', info: false },
  { id: 'alerte-surface', fg: '--alerte', bg: '--surface', info: false },
  { id: 'accent2-fond', fg: '--accent2', bg: '--fond', info: true },
] as const;

type PillInfo = { id: string; ratio: string; badge: string; fail: boolean; label: string; text: string };

async function readPills(page: Page): Promise<PillInfo[]> {
  return page.$$eval('#pills .pill', (els) =>
    els.map((e) => ({
      id: (e as HTMLElement).dataset.pair ?? '',
      ratio: getComputedStyle(e.querySelector('.pill-ratio') as Element, '::before').content.replace(/"/g, ''),
      badge: getComputedStyle(e.querySelector('.pill-lv') as Element, '::before').content.replace(/"/g, ''),
      fail: e.classList.contains('fail'),
      label: e.getAttribute('aria-label') ?? '',
      text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })),
  );
}

async function colours(page: Page): Promise<Record<string, Rgb>> {
  const raw = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(['--fond', '--surface', '--texte', '--accent', '--accent2', '--succes', '--alerte'].map((v) => [v, cs.getPropertyValue(v).trim()]));
  });
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, parseCss(v)]));
}

async function expectPillsMatch(page: Page): Promise<void> {
  const [pills, c] = [await readPills(page), await colours(page)];
  expect(pills.map((p) => p.id)).toEqual(PAIRS.map((p) => p.id));
  for (const spec of PAIRS) {
    const pill = pills.find((p) => p.id === spec.id) as PillInfo;
    const r = ratio(c[spec.fg] as Rgb, c[spec.bg] as Rgb);
    expect(pill.ratio, `${spec.id} ratio (exact ${r})`).toBe(trunc(r, 2));
    const passes = r >= (spec.info ? 3 : 4.5);
    expect(pill.fail, `${spec.id} fail flag at ${r}`).toBe(!passes);
    const expectedBadge = spec.info ? (passes ? 'OK' : 'Échec') : r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : 'Échec';
    expect(pill.badge, `${spec.id} badge`).toBe(expectedBadge);
    expect(pill.label.startsWith(pill.text), 'visible text is the start of the accessible name').toBe(true);
    expect(pill.label).toContain(`${trunc(r, 2)} sur 1`);
  }
  const checkedOk = PAIRS.filter((p) => !p.info).filter((p) => ratio(c[p.fg] as Rgb, c[p.bg] as Rgb) >= 4.5).length;
  const meta = await page.$eval('#metaAa', (e) => e.textContent ?? '');
  expect(meta).toBe(`${checkedOk}/5`);
}

async function clean({ page, probe }: Session): Promise<void> {
  expect(probe.errors).toEqual([]);
  expect(probe.violations).toEqual([]);
  expect(await page.$$eval('[style]', (els) => els.length)).toBe(0);
}

async function axeSerious(page: Page): Promise<{ id: string; impact: string | null; nodes: string }[]> {
  await page.evaluate(axe.source);
  const result = await page.evaluate(async () => {
    type R = { violations: { id: string; impact: string | null; nodes: { target: unknown }[] }[] };
    const r = await (window as unknown as { axe: { run(): Promise<R> } }).axe.run();
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: JSON.stringify(v.nodes.map((n) => n.target)) }));
  });
  if (result.length > 0) console.log('axe violations', JSON.stringify(result));
  return result.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

const dialogRect = (page: Page) => page.$eval('#cdlg', (e) => {
  const r = e.getBoundingClientRect();
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight, hidden: (e as HTMLElement).hidden };
});
const activeIs = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  return a === null ? '' : a.id || a.dataset.pair || a.tagName;
});
const noScroll = (page: Page) => page.evaluate(() => [document.documentElement.scrollWidth, innerWidth] as const);

describe('contrast pills (file://, Chrome headless, CSP not bypassed)', () => {
  it('shows 5 control pills + 1 informative pill in a labelled group, outside the inert stage', async () => {
    const s = await open();
    const { page } = s;
    expect(await page.$$eval('#pills .pill', (e) => e.length)).toBe(6);
    expect(await page.$$eval('#pills .pill:not(.pill-info)', (e) => e.length)).toBe(5);
    expect(await page.$eval('#pills', (e) => [e.getAttribute('role'), document.getElementById(e.getAttribute('aria-labelledby') ?? '')?.textContent])).toEqual(['group', 'Contraste WCAG']);
    expect(await page.$$eval('#pills .pill', (els) => els.some((e) => e.closest('#stageWrap') !== null || e.closest('[inert]') !== null))).toBe(false);
    const info = await page.$eval('.pill-info', (e) => ({ tag: getComputedStyle(e.querySelector('.pill-tag') as Element, '::before').content, label: e.getAttribute('aria-label') }));
    expect(info.tag).toContain('indicatif');
    expect(info.tag).toContain('3:1');
    expect(info.label).toMatch(/^Accent secondaire sur fond : \d,\d\d sur 1, indicatif, seuil 3 sur 1, (atteint|non atteint)$/);
    const first = await page.$eval('#pills .pill', (e) => e.getAttribute('aria-label'));
    expect(first).toMatch(/^Texte sur fond : \d+,\d\d sur 1, niveau (AAA|AA)$/);
    await clean(s);
  });

  for (const mode of ['light', 'dark'] as const) {
    it(`ratios, badges and the n/5 count match an independent recomputation, ${mode} palette, over 8 palettes`, async () => {
      const s = await open({ scheme: mode });
      await settle(s.page);
      await expectPillsMatch(s.page);
      for (let i = 0; i < 7; i++) {
        await s.page.click('#hasard');
        await settle(s.page);
        await expectPillsMatch(s.page);
      }
      await clean(s);
    });
  }

  it('the pills are updated in place: 0 node added or removed in #pills over 10 Hasard + a mode change', async () => {
    const s = await open();
    await s.page.evaluate(() => {
      const w = window as unknown as { __m: { n: number } };
      w.__m = { n: 0 };
      new MutationObserver((r) => {
        for (const x of r) if (x.type === 'childList') w.__m.n += x.addedNodes.length + x.removedNodes.length;
      }).observe(document.querySelector('#pills') as Element, { childList: true, subtree: true });
    });
    for (let i = 0; i < 10; i++) {
      await s.page.click('#hasard');
      await frames(s.page);
    }
    await s.page.click('.seg button[data-mode="dark"]');
    await settle(s.page);
    expect(await s.page.evaluate(() => (window as unknown as { __m: { n: number } }).__m.n)).toBe(0);
    await clean(s);
  });
});

describe('failing pair, detail dialog and one-click fix (yellow base #E0A800, light palette)', () => {
  it('typing #E0A800 makes accent/fond fail (pill, badge, count), the informative pill stays out of the count', async () => {
    const s = await open();
    const before = await s.page.$eval('#metaAa', (e) => e.textContent);
    expect(before).toBe('5/5');
    await typeBase(s.page, '#E0A800');
    const pills = await readPills(s.page);
    const p = pills.find((x) => x.id === 'accent-fond') as PillInfo;
    expect(p.fail).toBe(true);
    expect(p.badge).toBe('Échec');
    expect(p.label).toContain('niveau échec');
    expect(await s.page.$eval('#metaAa', (e) => e.textContent)).toBe('4/5');
    await expectPillsMatch(s.page);
    await clean(s);
  });

  it('click opens a non-modal dialog on the pill, focus on "Corriger"; contents match the colours; Corriger brings the pair to >= 4.5', async () => {
    const s = await open();
    const { page } = s;
    await typeBase(page, '#E0A800');
    const c0 = await colours(page);
    const r0 = ratio(c0['--accent'] as Rgb, c0['--fond'] as Rgb);
    await page.click('.pill[data-pair="accent-fond"]');
    expect(await activeIs(page)).toBe('cdFix');
    expect(await page.$eval('#cdlg', (e) => [e.getAttribute('role'), e.getAttribute('aria-modal'), (e as HTMLElement).hidden])).toEqual(['dialog', null, false]);
    expect(await page.$eval('.pill[data-pair="accent-fond"]', (e) => e.getAttribute('aria-expanded'))).toBe('true');
    const texts = await page.evaluate(() => {
      const t = (id: string) => document.getElementById(id)?.textContent ?? '';
      return { title: t('cdTitle'), fg: t('cdFg'), bg: t('cdBg'), ratio: t('cdRatio'), shown: t('cdShown'), levels: [...document.querySelectorAll('#cdlg .cdlg-levels li')].map((li) => [`${li.querySelector('.lv-name')?.textContent} ${li.querySelector('.lv-text')?.textContent}`, li.classList.contains('fail')]) };
    });
    expect(texts.title).toBe('Accent sur fond');
    expect(texts.fg).toBe('#E0A800');
    expect(texts.ratio).toBe(trunc(r0, 4));
    expect(texts.shown).toBe(trunc(r0, 2));
    expect(texts.levels).toEqual([
      ['AA, texte courant (4,5:1) Échec', true],
      ['AAA, texte courant (7:1) Échec', true],
      ['AA, grand texte (3:1) Échec', true],
      ['AAA, grand texte (4,5:1) Échec', true],
    ]);
    const rect = await dialogRect(page);
    expect(rect.l).toBeGreaterThanOrEqual(0);
    expect(rect.t).toBeGreaterThanOrEqual(0);
    expect(rect.r).toBeLessThanOrEqual(rect.vw);
    expect(rect.b).toBeLessThanOrEqual(rect.vh);

    await page.click('#cdFix');
    await settle(page);
    const c1 = await colours(page);
    expect(ratio(c1['--accent'] as Rgb, c1['--fond'] as Rgb)).toBeGreaterThanOrEqual(4.5);
    const toast = await page.$eval('#toast', (e) => ({ text: e.textContent ?? '', live: e.getAttribute('aria-live') }));
    expect(toast.live).toBe('polite');
    const m = /^Accent corrigé : #E0A800 → (#[0-9A-F]{6}) \(verrouillé\)\. 5 sur 5 contrastes AA\.$/.exec(toast.text);
    expect(m, toast.text).not.toBeNull();
    const fixedHex = m?.[1] ?? '';
    expect(await page.inputValue('#baseHex')).toBe(fixedHex);
    expect(await page.$eval('#metaAa', (e) => e.textContent)).toBe('5/5');
    expect(await page.$eval('.sw[data-role="accent"] .sw-lock', (e) => e.getAttribute('aria-pressed'))).toBe('true');
    expect(await page.$eval('#cdlg', (e) => (e as HTMLElement).hidden)).toBe(true);
    expect(await activeIs(page)).toBe('accent-fond');
    await expectPillsMatch(page);
    await clean(s);

    // the correction is a colour set by the user: it survives 20 Hasard presses
    const fixedRgb = c1['--accent'] as Rgb;
    for (let i = 0; i < 20; i++) {
      await page.click('#hasard');
      await frames(page);
    }
    await settle(page);
    expect((await colours(page))['--accent']).toEqual(fixedRgb);
    expect(await page.inputValue('#baseHex')).toBe(fixedHex);
    expect(await page.$eval('.sw[data-role="accent"] .sw-lock', (e) => e.getAttribute('aria-pressed'))).toBe('true');
    await clean(s);
  });

  it('the fix changes the light palette only: the dark palette is identical before and after', async () => {
    const s = await open();
    const { page } = s;
    await typeBase(page, '#E0A800');
    await page.click('.seg button[data-mode="dark"]');
    await settle(page);
    const dark0 = await colours(page);
    await page.click('.seg button[data-mode="light"]');
    await settle(page);
    await page.click('.pill[data-pair="accent-fond"]');
    await page.click('#cdFix');
    await page.click('.seg button[data-mode="dark"]');
    await settle(page);
    expect(await colours(page)).toEqual(dark0);
    await clean(s);
  });

  it('Esc closes the dialog and returns the focus to the pill; so do the close button and a second click', async () => {
    const s = await open();
    const { page } = s;
    await page.click('.pill[data-pair="texte-fond"]');
    expect(await activeIs(page)).toBe('cdClose');
    expect(await page.$eval('#cdWarn', (e) => (e as HTMLElement).hidden)).toBe(true);
    await page.keyboard.press('Escape');
    expect((await dialogRect(page)).hidden).toBe(true);
    expect(await activeIs(page)).toBe('texte-fond');
    expect(await page.$eval('.pill[data-pair="texte-fond"]', (e) => e.getAttribute('aria-expanded'))).toBe('false');

    await page.click('.pill[data-pair="succes-surface"]');
    await page.click('#cdClose');
    expect((await dialogRect(page)).hidden).toBe(true);
    expect(await activeIs(page)).toBe('succes-surface');

    await page.click('.pill[data-pair="alerte-surface"]');
    expect((await dialogRect(page)).hidden).toBe(false);
    await page.click('.pill[data-pair="alerte-surface"]');
    expect((await dialogRect(page)).hidden).toBe(true);
    expect(await activeIs(page)).toBe('alerte-surface');

    await page.click('.pill[data-pair="texte-fond"]');
    await page.click('.pill[data-pair="texte-surface"]');
    expect(await page.$eval('#cdTitle', (e) => e.textContent)).toBe('Texte sur surface');
    expect(await page.$$eval('#pills .pill[aria-expanded="true"]', (e) => e.length)).toBe(1);
    await clean(s);
  });

  it('keyboard only: Tab to the pill, Enter opens (focus on Corriger), Enter fixes, focus back on the pill', async () => {
    const s = await open();
    const { page } = s;
    await typeBase(page, '#E0A800');
    await page.focus('#hasard');
    const order: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      order.push(await activeIs(page));
    }
    expect(order[0]).toBe('BUTTON'); // the active mode button
    // J5: Partager and Exporter sit between the mode toggle and the pills (section 6 tab order); J12: the Vision select comes just before the pills
    expect(order.slice(1)).toEqual(['share', 'exportBtn', 'vision', 'texte-fond', 'texte-surface', 'accent-fond', 'succes-surface']);
    await page.keyboard.press('Shift+Tab');
    expect(await activeIs(page)).toBe('accent-fond');
    await page.keyboard.press('Enter');
    expect(await activeIs(page)).toBe('cdFix');
    expect((await dialogRect(page)).hidden).toBe(false);
    await page.keyboard.press('Enter');
    await settle(page);
    expect((await dialogRect(page)).hidden).toBe(true);
    expect(await activeIs(page)).toBe('accent-fond');
    const c = await colours(page);
    expect(ratio(c['--accent'] as Rgb, c['--fond'] as Rgb)).toBeGreaterThanOrEqual(4.5);
    expect(await page.$eval('#toast', (e) => e.textContent)).toMatch(/^Accent corrigé : #E0A800 → #[0-9A-F]{6} \(verrouillé\)\. 5 sur 5 contrastes AA\.$/);
    // Esc after a re-open: back on the pill
    await page.keyboard.press('Enter');
    expect(await activeIs(page)).toBe('cdClose');
    await page.keyboard.press('Escape');
    expect(await activeIs(page)).toBe('accent-fond');
    await clean(s);
  });

  it('the focus ring of the pills is visible (outline >= 2 px)', async () => {
    const s = await open();
    await s.page.focus('.pill[data-pair="texte-fond"]');
    await s.page.keyboard.press('Shift+Tab');
    await s.page.keyboard.press('Tab');
    const o = await s.page.$eval('.pill[data-pair="texte-fond"]', (e) => ({ w: getComputedStyle(e).outlineWidth, st: getComputedStyle(e).outlineStyle }));
    expect(o.st).toBe('solid');
    expect(parseFloat(o.w)).toBeGreaterThanOrEqual(2);
  });

  for (const [scheme, width, height] of [
    ['light', 1440, 900],
    ['dark', 1440, 900],
    ['light', 390, 844],
    ['dark', 390, 844],
  ] as const) {
    it(`axe: 0 serious/critical with the dialog open, ${scheme} theme, ${width} px; dialog inside the viewport; no horizontal scroll`, async () => {
      const s = await open({ scheme, width, height });
      const { page } = s;
      if (scheme === 'light') await typeBase(page, '#E0A800');
      await page.click(`.pill[data-pair="${scheme === 'light' ? 'accent-fond' : 'texte-surface'}"]`);
      await settle(page);
      expect(await activeIs(page)).toBe(scheme === 'light' ? 'cdFix' : 'cdClose');
      const rect = await dialogRect(page);
      expect(rect.hidden).toBe(false);
      expect(rect.l).toBeGreaterThanOrEqual(0);
      expect(rect.t).toBeGreaterThanOrEqual(0);
      expect(rect.r).toBeLessThanOrEqual(rect.vw);
      expect(rect.b).toBeLessThanOrEqual(rect.vh);
      expect(await axeSerious(page)).toEqual([]);
      const [sw, iw] = await noScroll(page);
      expect(sw).toBeLessThanOrEqual(iw);
      await clean(s);
    });
  }

  it('no horizontal scroll with a failing pill at 1440 and 390 px (dialog closed)', async () => {
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      const s = await open({ width: w, height: h });
      await typeBase(s.page, '#E0A800');
      const [sw, iw] = await noScroll(s.page);
      expect(sw).toBeLessThanOrEqual(iw);
      await clean(s);
    }
  });

  it('at 390 px the fix works from the colour input (hex field hidden) and the focus returns to the pill', async () => {
    const s = await open({ width: 390, height: 844 });
    const { page } = s;
    await typeBase(page, '#E0A800');
    await page.click('.pill[data-pair="accent-fond"]');
    expect(await activeIs(page)).toBe('cdFix');
    await page.click('#cdFix');
    await settle(page);
    expect(await activeIs(page)).toBe('accent-fond');
    const c = await colours(page);
    expect(ratio(c['--accent'] as Rgb, c['--fond'] as Rgb)).toBeGreaterThanOrEqual(4.5);
    await clean(s);
  });

  it('the mock-ups still follow the fix (accent button = the corrected accent)', async () => {
    const s = await open();
    const { page } = s;
    await typeBase(page, '#E0A800');
    await page.click('.pill[data-pair="accent-fond"]');
    await page.click('#cdFix');
    await settle(page);
    const [btn, accent] = await page.evaluate(() => [getComputedStyle(document.querySelector('.m-site .m-cta .m-btn') as Element).backgroundColor, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()]);
    expect(parseCss(btn as string)).toEqual(parseCss(accent as string));
  });
});

describe('mock-up text (decor un-inerted in memory): axe finds no color-contrast violation', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`${scheme}: 0 color-contrast violation on #stage`, async () => {
      const s = await open({ scheme });
      await s.page.evaluate(() => document.querySelector('#stageWrap')?.removeAttribute('inert'));
      await settle(s.page);
      await s.page.evaluate(axe.source);
      const violations = await s.page.evaluate(async () => {
        type R = { violations: { id: string; nodes: { target: unknown }[] }[] };
        const r = await (window as unknown as { axe: { run(c: string, o: unknown): Promise<R> } }).axe.run('#stage', { runOnly: ['color-contrast'] });
        return r.violations.map((v) => `${v.id}: ${JSON.stringify(v.nodes.map((n) => n.target))}`);
      });
      expect(violations).toEqual([]);
    });
  }
});

describe('built file', () => {
  it('has no style= attribute', () => {
    const html = readFileSync(distFile, 'utf8');
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });
});
