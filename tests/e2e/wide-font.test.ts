import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { HUE_WORDS, NOUN_ROWS, agree, paletteName } from '../../src/palette/name';
import { fromOklch } from '../../src/core/gamut';
import { initialState } from '../../src/state/state';
import { encodeHash } from '../../src/state/url';
import type { Mode } from '../../src/palette/roles';
import { fourColours, outcome, pick, png } from './image-helpers';
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
      // J13: the history sheet with the longest harmony name, 3 recents and 2 favourites, and the new bar button
      await page.keyboard.press('Escape');
      await page.selectOption('#harm', 'split-complementary');
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.waitForTimeout(450);
        await page.keyboard.press('Space');
      }
      await page.waitForTimeout(450);
      await page.click('#histBtn');
      await page.locator('#hRec .hstar').nth(0).click();
      await page.locator('#hRec .hstar').nth(1).click();
      await settle(page);
      expect(await page.locator('#hFav .hitem').count()).toBe(2);
      await check('history');
      const cut = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#hmenu .hname, #hmenu .hname b, #hmenu .hname small, #hmenu .hfoot button, #hmenu .hask')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className || e.id));
      expect(cut, 'history: no text clipped').toEqual([]);
      expect(await page.$eval('#hmenu', (e) => e.getBoundingClientRect().right), 'history: the sheet is in the window').toBeLessThanOrEqual(width);
      // J15: the image sheet, empty, with an error message (the longest one), and with candidates whose texts are the longest of the app (a name of two long words, the longest harmony).
      await page.keyboard.press('Escape');
      await page.click('#imgBtn');
      await check('image, empty');
      await pick(page, { name: 'IMG.HEIC', mimeType: 'image/heic', buffer: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(16)]) });
      expect((await outcome(page)).message).toMatch(/^Ce format d'image/);
      await check('image, message');
      await pick(page, png('four.png', fourColours()));
      expect((await outcome(page)).cards).toBeGreaterThanOrEqual(3);
      await page.evaluate(() => {
        for (const card of document.querySelectorAll('#iList .icard')) {
          (card.querySelector('b') as HTMLElement).textContent = 'Porcelaine turquoise';
          (card.querySelector('small') as HTMLElement).textContent = 'Split-complémentaire';
        }
      });
      await settle(page);
      await check('image, candidates');
      const cutImage = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#imenu .hname, #imenu .hname b, #imenu .hname small, #imenu .iuse, #imenu .idrop, #imenu .idrop b, #imenu .idrop span, #imenu .imsg, #imenu #iCount, #imenu #iNote')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className || e.id));
      expect(cutImage, 'image: no text clipped').toEqual([]);
      const box = await page.$eval('#imenu', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; });
      expect(box.right, 'image: the sheet is in the window').toBeLessThanOrEqual(width);
      expect(box.left, 'image: the sheet is in the window').toBeGreaterThanOrEqual(0);
      expect(s.probe.errors).toEqual([]);
    });
  }
});

describe('wide font: the bar on a phone', () => {
  for (const [width, maxLines] of [
    [390, 3],
    [414, 3],
    [430, 2],
    [480, 2],
    [600, 2],
    [320, 3],
  ] as const) {
    it(`${width} px: ${maxLines} lines at most, nothing clipped, every harmony name fits from 390 px`, async () => {
      const { page } = await open(wide(width, 800));
      await expectWideFont(page);
      const bar = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.bar .brand, .bar #base, .bar #harm, .bar #hasard, .bar .seg, .bar #imgBtn, .bar #histBtn, .bar #share, .bar #exportBtn')];
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
      expect(bar.minLeft).toBeGreaterThanOrEqual(0);
      expect(bar.maxRight).toBeLessThanOrEqual(bar.vw);
      const clipped = await page.evaluate(() => {
        const bad: string[] = [];
        for (const e of document.querySelectorAll<HTMLElement>('.bar .brand, .bar #hasard, .bar #imgBtn, .bar #histBtn, .bar #share, .bar #exportBtn')) {
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

/** J12: the palette name is the scene title. The longest names (by characters, both modes) must fit from 320 to 1440 px with the wide font, with the vision note shown too. */
function longestNames(): { name: string; mode: Mode; accent: string; fond: string }[] {
  const out: { name: string; mode: Mode; accent: string; fond: string }[] = [];
  const lightness = { light: [0.3, 0.55, 0.8], dark: [0.3, 0.55, 0.8] } as const;
  for (const mode of ['light', 'dark'] as const) {
    for (const fond of mode === 'light' ? ['#FFFFFF', '#E7F2EF'] : ['#000000', '#0B1110']) {
      for (const l of lightness[mode]) for (const c of [0.06, 0.095, 0.115, 0.15]) for (let sector = 0; sector < 16; sector++) {
        const accent = fromOklch({ l, c, h: sector * 22.5 });
        out.push({ name: paletteName({ accent, fond }, mode), mode, accent, fond });
      }
    }
  }
  return out.sort((a, b) => b.name.length - a.name.length).filter((x, i, all) => all.findIndex((y) => y.name === x.name) === i).slice(0, 3);
}

describe('wide font: the longest palette names fit the title (J12)', () => {
  it('the candidates are real: a name of the lists, 21 or 22 characters at most', () => {
    const [first] = longestNames();
    console.log(`J12 longest names tested: ${longestNames().map((n) => `${n.name} (${n.mode}, ${n.name.length})`).join(' ; ')}`);
    expect(first?.name.length).toBeGreaterThanOrEqual(19);
    expect(first?.name.length).toBeLessThanOrEqual(22);
    expect(NOUN_ROWS.flat().length).toBe(48);
    expect(agree(HUE_WORDS[10] as string, 'f')).toBe('céruléenne');
  });
  for (const width of [1440, 1100, 961, 800, 761, 390, 360, 320]) {
    it(`${width} px: the 3 longest names stay inside the window on at most 2 lines, with and without the vision note`, async () => {
      for (const cand of longestNames()) {
        const base = initialState(cand.mode, 0x01380f55, 'complementary');
        const theme = { ...base.theme, [cand.mode]: { ...base.theme[cand.mode], accent: cand.accent, fond: cand.fond } };
        const hash = encodeHash({ mode: cand.mode, harmony: 'complementary', seed: 0x01380f55, locks: 0, theme });
        const { page } = await open({ ...wide(width, 900), scheme: cand.mode, hash });
        await expectWideFont(page);
        for (const note of [false, true]) {
          if (note) {
            await page.selectOption('#vision', 'deutan');
            await settle(page);
          }
          expect(await page.textContent('.scene-title'), 'the page shows the name that was computed').toBe(cand.name);
          const r = await page.evaluate(() => {
            const t = document.querySelector('.scene-title') as HTMLElement;
            const box = t.getBoundingClientRect();
            const lines = new Set([...(() => { const g = document.createRange(); g.selectNodeContents(t); return g.getClientRects(); })()].map((q) => Math.round(q.top))).size;
            const v = (document.querySelector('#vision') as HTMLElement).getBoundingClientRect();
            return { left: box.left, right: box.right, lines, clip: t.scrollWidth - t.clientWidth, doc: document.documentElement.scrollWidth, inner: innerWidth, vLeft: v.left, vRight: v.right };
          });
          const label = `${width} px, « ${cand.name} », note ${note}`;
          expect(r.left, label).toBeGreaterThanOrEqual(0);
          expect(r.right, label).toBeLessThanOrEqual(r.inner);
          expect(r.lines, label).toBeLessThanOrEqual(2);
          expect(r.clip, label).toBeLessThanOrEqual(0);
          expect(r.doc, label).toBeLessThanOrEqual(r.inner);
          expect(r.vLeft, `${label}: the Vision select`).toBeGreaterThanOrEqual(0);
          expect(r.vRight, `${label}: the Vision select`).toBeLessThanOrEqual(r.inner);
          const out = await overflow(page);
          expect(out.out, label).toEqual([]);
        }
      }
    });
  }
});
