import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { WIDE_FONT, settle, useBrowser, type OpenOptions } from './j6-helpers';

/**
 * Wide-font check, on every platform. The Linux, Windows and Android system fonts are wider than the Mac one, and a static font has no weight between Regular and Bold: the weights 550 to 620 of the interface render Bold there.
 * The page font is replaced by Verdana (Regular up to 500, Bold from 501), through the browser protocol, so a Mac reproduces what the GitHub Linux runner showed (brief 22).
 * Here the layout must hold: no overflow of the document, the bar on its lines, toasts on 2 lines at most, nothing clipped, every pill reachable.
 */
const { open } = useBrowser();
const wide = (width: number, height: number, touch = width <= 760): OpenOptions => ({ width, height, touch, font: WIDE_FONT });

/** Proves the override took effect: weight 550 is now much wider than 500 (Bold instead of the fine variable weight of the Mac). */
async function expectWideFont(page: Page): Promise<void> {
  const r = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    const text = 'Split-complémentaire';
    ctx.font = '500 16px Wide';
    const regular = ctx.measureText(text).width;
    ctx.font = '550 16px Wide';
    return { family: getComputedStyle(document.body).fontFamily, regular, medium: ctx.measureText(text).width };
  });
  expect(r.family).toMatch(/^Wide/);
  expect(r.medium / r.regular, 'weight 550 renders Bold').toBeGreaterThan(1.08);
}

const overflow = (page: Page) =>
  page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: innerWidth,
    out: [...document.querySelectorAll('body *')]
      .filter((e) => !e.closest('.swatches, .pills, #stageWrap, .sr, .skip, .copy-sink'))
      .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5 || e.getBoundingClientRect().left < -0.5)
      .map((e) => `${e.tagName.toLowerCase()}.${(e as HTMLElement).className || (e as HTMLElement).id}`),
  }));

describe('wide font: the document never overflows', () => {
  for (const [width, height] of [
    [1440, 900],
    [1100, 800],
    [1061, 800],
    [1060, 800],
    [1000, 800],
    [961, 900],
    [960, 900],
    [800, 900],
    [761, 900],
    [759, 900],
    [414, 896],
    [390, 844],
    [360, 780],
    [320, 640],
  ] as const) {
    it(`${width} px: closed, export menu (all formats) and contrast dialog`, async () => {
      const s = await open(wide(width, height));
      const { page } = s;
      await expectWideFont(page);
      const check = async (label: string) => {
        const w = await overflow(page);
        expect(w.doc, `${label}: documentElement`).toBeLessThanOrEqual(w.inner);
        expect(w.body, `${label}: body`).toBeLessThanOrEqual(w.inner);
        expect(w.out, `${label}: elements outside the window`).toEqual([]);
      };
      await check('closed');
      if (width > 960) expect(await page.$eval('.bar', (e) => e.getBoundingClientRect().height), 'the bar keeps one line').toBeLessThanOrEqual(64);
      await page.click('#exportBtn');
      await settle(page);
      await check('menu');
      for (const f of ['tailwind', 'figma', 'png']) {
        await page.click(`#xFormats [data-f=${f}]`);
        await check(`menu ${f}`);
      }
      await page.keyboard.press('Escape');
      await page.click('.pill[data-pair=texte-fond]');
      await settle(page);
      await check('contrast');
      expect(s.probe.errors).toEqual([]);
    });
  }
});

describe('wide font: the bar on a phone', () => {
  for (const [width, maxLines] of [
    [390, 2],
    [414, 2],
    [480, 2],
    [600, 2],
    [320, 3],
  ] as const) {
    it(`${width} px: ${maxLines} lines at most, nothing clipped, every harmony name fits from 390 px`, async () => {
      const { page } = await open(wide(width, 800));
      await expectWideFont(page);
      const bar = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.bar .brand, .bar #base, .bar #harm, .bar #hasard, .bar .seg, .bar #share, .bar #exportBtn')];
        const centres = items.map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }).sort((a, b) => a - b);
        const tops = new Set<number>();
        let line = -100;
        for (const c of centres) {
          if (c - line > 12) tops.add(c);
          line = c;
        }
        const rects = items.map((e) => e.getBoundingClientRect());
        return { lines: tops.size, minLeft: Math.min(...rects.map((r) => r.left)), maxRight: Math.max(...rects.map((r) => r.right)), vw: innerWidth };
      });
      expect(bar.lines).toBeLessThanOrEqual(maxLines);
      if (width === 390) expect(bar.lines).toBe(2);
      expect(bar.minLeft).toBeGreaterThanOrEqual(0);
      expect(bar.maxRight).toBeLessThanOrEqual(bar.vw);
      const clipped = await page.evaluate(() => {
        const bad: string[] = [];
        for (const e of document.querySelectorAll<HTMLElement>('.bar .brand, .bar #hasard, .bar #share, .bar #exportBtn')) {
          if (e.scrollWidth > e.clientWidth + 1) bad.push(`${e.id || e.className}: ${e.scrollWidth} > ${e.clientWidth}`);
        }
        const sel = document.querySelector('#harm') as HTMLSelectElement;
        const cs = getComputedStyle(sel);
        const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
        const room = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        if (innerWidth >= 390) for (const o of sel.options) if (ctx.measureText(o.textContent ?? '').width > room) bad.push(`select "${o.textContent}": ${Math.round(ctx.measureText(o.textContent ?? '').width)} > ${Math.round(room)}`);
        return bad;
      });
      expect(clipped).toEqual([]);
    });
  }
});

describe('wide font: toasts on 2 lines at most (longest messages of the app)', () => {
  for (const width of [390, 320]) {
    it(`${width} px`, async () => {
      const { page } = await open(wide(width, 800));
      await expectWideFont(page);
      const seen: { text: string; lines: number; left: number; right: number }[] = [];
      const read = async (pattern: RegExp) => {
        await page.waitForFunction((p) => document.querySelector('#toast')?.classList.contains('show') && new RegExp(p).test(document.querySelector('#toast span')?.textContent ?? ''), pattern.source);
        await page.waitForTimeout(300);
        seen.push(
          await page.evaluate(() => {
            const span = document.querySelector('#toast span') as HTMLElement;
            const range = document.createRange();
            range.selectNodeContents(span);
            const box = (document.querySelector('#toast') as HTMLElement).getBoundingClientRect();
            return { text: span.textContent ?? '', lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size, left: box.left, right: box.right };
          }),
        );
      };
      // Fix of the accent (the longest message of the fix dialog).
      await page.fill('#base', '#e0a800');
      await settle(page);
      await page.click('.pill[data-pair=accent-fond]');
      await page.click('#cdFix');
      await read(/corrigé/);
      // Share outside http(s).
      await page.click('#share');
      await read(/Lien indisponible/);
      // A copied colour.
      await page.locator('.sw-copy').first().click();
      await read(/^Copié : /);
      // The fix locked the accent: a typed base now updates it and says so.
      await page.fill('#base', '#2e86ab');
      await read(/^Accent mis à jour/);
      // Seven locks and Hasard.
      await page.evaluate(() => document.querySelectorAll<HTMLElement>('.sw .sw-lock').forEach((b) => (b.getAttribute('aria-pressed') === 'true' ? undefined : b.click())));
      await page.click('#hasard');
      await read(/^Les 7 couleurs/);
      // Bad links.
      await page.evaluate(() => { location.hash = '#v=9'; });
      await read(/version plus récente/);
      await page.evaluate(() => { location.hash = '#v=1&m=zz'; });
      await read(/Lien invalide/);
      expect(seen.length).toBe(7);
      for (const t of seen) {
        expect(t.lines, `${width} px: « ${t.text} »`).toBeLessThanOrEqual(2);
        expect(t.left, `${width} px: « ${t.text} »`).toBeGreaterThanOrEqual(0);
        expect(t.right, `${width} px: « ${t.text} »`).toBeLessThanOrEqual(width);
      }
    });
  }
});

describe('wide font: the pills and the dock stay reachable on a phone', () => {
  for (const width of [390, 360, 320]) {
    it(`${width} px: the longest pill fits the window and the hidden ones come into view when focused`, async () => {
      const { page } = await open(wide(width, 800));
      await expectWideFont(page);
      const inside = () => page.evaluate(() => { const r = (document.activeElement as HTMLElement).getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth }; });
      // A pill can always fit in the window (it wraps its name if it must) ...
      const widest = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.pill')].map((e) => e.getBoundingClientRect().width)));
      expect(widest).toBeLessThanOrEqual(width - 24 + 0.5);
      // ... and the last one, hidden at first, comes fully into view.
      await page.locator('.pill[data-pair=accent2-fond]').focus();
      await page.waitForTimeout(300);
      const last = await inside();
      expect(last.left).toBeGreaterThanOrEqual(0);
      expect(last.right).toBeLessThanOrEqual(last.vw);
      await page.locator('.sw[data-role=alerte] .sw-copy').focus();
      await page.waitForTimeout(300);
      const dock = await inside();
      expect(dock.left).toBeGreaterThanOrEqual(0);
      expect(dock.right).toBeLessThanOrEqual(dock.vw);
    });
  }
});
