import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { initialState } from '../../src/state/state';
import { encodeHash } from '../../src/state/url';
import { WIDE_FONT, settle, shotsDir, useBrowser, type Session } from './j6-helpers';

const { open } = useBrowser();
const phone = { width: 390, height: 844, touch: true } as const;

const scrollWidths = (page: Page) => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, inner: innerWidth }));

describe('reflow (WCAG 1.4.10): no horizontal scroll', () => {
  for (const [width, height, touch] of [
    [1440, 900, false],
    [1100, 800, false],
    [800, 900, false],
    [961, 900, false],
    [960, 900, false],
    [900, 900, false],
    [800, 900, false],
    [761, 900, false],
    [759, 900, false],
    [390, 844, true],
    [360, 780, true],
    [320, 640, true],
  ] as const) {
    it(`${width} px: the document is not wider than the window, with and without a menu open`, async () => {
      const s = await open({ width, height, touch });
      const { page } = s;
      const check = async (label: string) => {
        const w = await scrollWidths(page);
        expect(w.doc, `${label}: documentElement`).toBeLessThanOrEqual(w.inner);
        expect(w.body, `${label}: body`).toBeLessThanOrEqual(w.inner);
        // nothing sticks out on the right, outside the two internal scrollers (dock, pills) and the decor
        const out = await page.evaluate(() =>
          [...document.querySelectorAll('body *')]
            .filter((e) => !e.closest('.swatches, .pills, #stageWrap, .sr, .skip, .copy-sink'))
            .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')
            .filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5 || e.getBoundingClientRect().left < -0.5)
            .map((e) => `${e.tagName.toLowerCase()}.${(e as HTMLElement).className || (e as HTMLElement).id}`),
        );
        expect(out, `${label}: éléments hors de la fenêtre`).toEqual([]);
      };
      await check('fermé');
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
      await check('contraste');
      expect(s.probe.errors).toEqual([]);
    });
  }

  it('the bar is on 2 lines at 390 (3 at most at 320), the hex field hidden, no text clipped, Hasard text and kbd', async () => {
    for (const [width, maxLines] of [[390, 2], [414, 2], [480, 2], [600, 2], [320, 3]] as const) {
      const { page } = await open({ width, height: 800, touch: true });
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
        return { lines: tops.size, hexVisible: (document.querySelector('#baseHex') as HTMLElement).offsetParent !== null, minLeft: Math.min(...rects.map((r) => r.left)), maxRight: Math.max(...rects.map((r) => r.right)), vw: innerWidth };
      });
      expect(bar.lines, `${width} px`).toBeLessThanOrEqual(maxLines);
      expect(bar.hexVisible).toBe(false);
      expect(bar.minLeft).toBeGreaterThanOrEqual(0);
      expect(bar.maxRight).toBeLessThanOrEqual(bar.vw);
      if (width === 390) expect(bar.lines).toBe(2);
      // No clipped text: every label of the bar fits its box (select: measured with the canvas, for each option).
      const clipped = await page.evaluate(() => {
        const bad: string[] = [];
        for (const e of document.querySelectorAll<HTMLElement>('.bar .brand, .bar #hasard, .bar #share, .bar #exportBtn')) {
          if (e.scrollWidth > e.clientWidth + 1) bad.push(`${e.id || e.className}: ${e.scrollWidth} > ${e.clientWidth}`);
        }
        const sel = document.querySelector<HTMLSelectElement>('#harm') as HTMLSelectElement;
        const cs = getComputedStyle(sel);
        const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
        const room = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        // From 390 px on every option fits; at 320 px the longest ones are cut with an ellipsis (reported, not asserted).
        if (innerWidth >= 390) for (const o of sel.options) if (ctx.measureText(o.textContent ?? '').width > room) bad.push(`select "${o.textContent}": ${Math.round(ctx.measureText(o.textContent ?? '').width)} > ${Math.round(room)}`);
        return bad;
      });
      expect(clipped, `${width} px`).toEqual([]);
    }
  });

  it('1440: the bar keeps its single line with the hex field, Partager and Exporter with their texts (icons only under 960 px)', async () => {
    const { page } = await open();
    const bar = await page.evaluate(() => ({
      h: document.querySelector('.bar')?.getBoundingClientRect().height,
      hex: (document.querySelector('#baseHex') as HTMLElement).offsetParent !== null,
      labels: [...document.querySelectorAll('#share, #exportBtn')].map((e) => (e as HTMLElement).innerText.trim()),
    }));
    expect(bar).toEqual({ h: 60, hex: true, labels: ['Partager', 'Exporter'] });
  });
});

describe('target size at 390 (WCAG 2.5.8 minimum 24 x 24; 44 x 44 for the main controls)', () => {
  const MEASURE = `
    [...document.querySelectorAll('a[href], button, input, select, textarea, [role=radio], [tabindex]')]
      .filter((e) => !e.closest('[hidden]') && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')
      .filter((e) => !e.matches('.skip') && !e.closest('.copy-sink'))
      .map((e) => { const r = e.getBoundingClientRect(); const own = e.id || e.getAttribute('data-pair') || e.getAttribute('data-f') || e.getAttribute('data-v') || (/^sw-(copy|lock)$/.test(e.className) ? e.className : '') || e.getAttribute('aria-label') || e.className || e.tagName; return { name: String(own).slice(0, 40), tag: e.tagName.toLowerCase(), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; })`;
  type Box = { name: string; tag: string; w: number; h: number };
  const measure = (page: Page): Promise<Box[]> => page.evaluate(MEASURE) as Promise<Box[]>;

  it('every interactive element is at least 24 x 24, and the main controls at least 44 x 44, in the closed page and with each menu open', async () => {
    const s = await open(phone);
    const { page } = s;
    const all: Box[] = [];
    const take = async (label: string) => {
      for (const b of await measure(page)) all.push({ ...b, name: `${label}/${b.name}` });
    };
    await take('page');
    await page.click('#exportBtn');
    await settle(page);
    for (const f of ['css', 'tailwind', 'json', 'swift', 'figma', 'png']) {
      await page.click(`#xFormats [data-f=${f}]`);
      await take(`menu-${f}`);
    }
    await page.click('#xClose');
    await page.click('#base', { trial: true }).catch(() => undefined);
    await page.fill('#base', '#e0a800');
    await settle(page);
    await page.click('.pill[data-pair=accent-fond]');
    await settle(page);
    await take('contraste');
    // The checked elements really exist: bar, pills, dock, both menus.
    const names = new Set(all.map((b) => b.name.split('/')[1]));
    for (const must of ['base', 'harm', 'vision', 'hasard', 'share', 'exportBtn', 'texte-fond', 'xClose', 'xCopy', 'xDownload', 'cdClose', 'cdFix', 'xFigma2025', 'xOut']) expect(names.has(must), must).toBe(true);
    expect(all.length).toBeGreaterThan(100);
    const small = all.filter((b) => b.w < 24 || b.h < 24);
    expect(small, 'sous 24 x 24').toEqual([]);
    const MAIN = /^(base|harm|vision|hasard|share|exportBtn|xClose|cdClose|xCopy|xDownload|cdFix|cdFixBg|texte-fond|texte-surface|accent-fond|succes-surface|alerte-surface|accent2-fond|css|tailwind|json|swift|figma|png|v4|v3|sw-copy|sw-lock|Palette (claire|sombre))$/;
    const mainSmall = all.filter((b) => MAIN.test(b.name.split('/')[1] ?? '') && (b.w < 44 || b.h < 44));
    expect(mainSmall, 'contrôles principaux sous 44 x 44').toEqual([]);
    // Dock colours (copy buttons) are whole swatches.
    const copies = all.filter((b) => b.name.endsWith('sw-copy'));
    expect(copies.length).toBeGreaterThanOrEqual(7);
    for (const c of copies) {
      expect(c.w).toBeGreaterThanOrEqual(92);
      expect(c.h).toBeGreaterThanOrEqual(82);
    }
    // What is below 44 x 44 (informative): the checkbox (24 x 24; its label is 44 high).
    const under44 = [...new Set(all.filter((b) => b.w < 44 || b.h < 44).map((b) => `${b.name.split('/')[1]} ${b.w}x${b.h}`))];
    console.log('sous 44 x 44 à 390 px :', JSON.stringify(under44));
  });

  it('inputs, selects and textareas are at least 16 px (iOS does not zoom on focus) under 760 px, and not at 1440 where it is not needed', async () => {
    const { page } = await open(phone);
    // #baseHex is display:none under 760 px (the colour input does the job), so it never takes the focus.
    const sizes = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=color]):not(#baseHex), select, textarea')].map((e) => ({ id: e.id, px: parseFloat(getComputedStyle(e).fontSize) })));
    expect(sizes.map((s) => s.id).sort()).toEqual(['harm', 'manualField', 'vision', 'xOut']);
    for (const s of sizes) expect(s.px, s.id).toBeGreaterThanOrEqual(16);
  });
});

describe('bottom sheets, toast, safe areas, snapping at 390', () => {
  async function sheetState(page: Page, id: string) {
    return page.$eval(id, (e) => {
      const el = e as HTMLElement;
      const r = el.getBoundingClientRect();
      const close = el.querySelector('.cdlg-x') as HTMLElement;
      const pills = (document.querySelector('#pills') as HTMLElement).getBoundingClientRect();
      return {
        l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight,
        overflowY: getComputedStyle(el).overflowY, scrollable: el.scrollHeight > el.clientHeight,
        closeW: close.getBoundingClientRect().width, closeH: close.getBoundingClientRect().height,
        overlapsPills: r.top < pills.bottom && r.bottom > pills.top && r.left < pills.right && r.right > pills.left,
        pillsBottom: pills.bottom,
      };
    });
  }

  it('the export menu is a sheet inside the window, scrollable, closable, never over the pills, with focus inside', async () => {
    const { page } = await open(phone);
    await page.click('#exportBtn');
    await settle(page);
    for (const f of ['css', 'tailwind', 'figma', 'png']) {
      await page.click(`#xFormats [data-f=${f}]`);
      const r = await sheetState(page, '#xmenu');
      expect(r.l, f).toBeGreaterThanOrEqual(0);
      expect(r.r, f).toBeLessThanOrEqual(r.vw);
      expect(r.t, f).toBeGreaterThanOrEqual(0);
      expect(r.b, f).toBeLessThanOrEqual(r.vh);
      expect(r.overflowY).toBe('auto');
      expect(r.closeW).toBeGreaterThanOrEqual(44);
      expect(r.overlapsPills, `${f}: ne couvre pas les pastilles (haut de la feuille ${Math.round(r.t)}, bas des pastilles ${Math.round(r.pillsBottom)})`).toBe(false);
    }
    expect(await page.evaluate(() => document.activeElement?.closest('#xmenu') !== null)).toBe(true);
    await page.click('#xClose');
    expect(await page.isVisible('#xmenu')).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('exportBtn');
  });

  // J14: on a phone the sheet is bottom-anchored and its height follows its content, so whether it reaches the pills depended on the font (CI: 6 px over them with a wider font at 390).
  // The product now measures the pills and caps the sheet under them (it scrolls inside itself). Checked at four widths, with the system font and with the wide font, for the 6 export formats, a full history and the contrast sheet.
  const savedLinks = (n: number): string[] => Array.from({ length: n }, (_, i) => encodeHash({ ...initialState('light', 0x01380f55 + i * 977, 'split-complementary'), mode: 'light' }));
  for (const font of [undefined, WIDE_FONT]) {
    for (const width of [320, 360, 390, 430]) {
      it(`sheets stay under the pills at ${width} x 844 (${font === undefined ? 'system font' : 'wide font'}): 6 export formats, a full history, the contrast sheet`, async () => {
        const saved = JSON.stringify({ v: 1, recent: savedLinks(20), fav: savedLinks(30).slice(20) });
        const { page } = await open({ width, height: 844, touch: true, font, initScript: `try{localStorage.setItem('huezz.history.v1',${JSON.stringify(saved)})}catch(e){}` });
        const gap = (id: string): Promise<number> =>
          page.evaluate((sheetId) => (document.querySelector(sheetId) as HTMLElement).getBoundingClientRect().top - (document.querySelector('#pills') as HTMLElement).getBoundingClientRect().bottom, id);
        await page.click('#exportBtn');
        await settle(page);
        for (const f of ['css', 'tailwind', 'figma', 'json', 'swift', 'png']) {
          await page.click(`#xFormats [data-f=${f}]`);
          expect(await gap('#xmenu'), `export ${f}`).toBeGreaterThanOrEqual(-0.5);
        }
        await page.click('#xClose');
        await page.click('#histBtn');
        await settle(page);
        expect(await page.locator('#hRec .hitem').count()).toBe(20);
        expect(await gap('#hmenu'), 'history (20 recent + 10 favourites)').toBeGreaterThanOrEqual(-0.5);
        expect(await page.$eval('#hmenu', (e) => e.scrollHeight > e.clientHeight), 'a full history scrolls inside its sheet').toBe(true);
        await page.click('#hClose');
        await page.click('.pill[data-pair=accent-fond]');
        await settle(page);
        expect(await gap('#cdlg'), 'contrast').toBeGreaterThanOrEqual(-0.5);
      });
    }
  }

  it('the contrast sheet: inside the window, closable, never over the pills; the dock is hidden behind it (not reachable by Tab)', async () => {
    const { page } = await open(phone);
    await page.click('.pill[data-pair=accent-fond]');
    await settle(page);
    const r = await sheetState(page, '#cdlg');
    expect(r.l).toBeGreaterThanOrEqual(0);
    expect(r.r).toBeLessThanOrEqual(r.vw);
    expect(r.b).toBeLessThanOrEqual(r.vh);
    expect(r.t).toBeGreaterThanOrEqual(0);
    expect(r.closeW).toBeGreaterThanOrEqual(44);
    expect(r.overlapsPills).toBe(false);
    expect(await page.$eval('.dock', (e) => getComputedStyle(e).visibility)).toBe('hidden');
    await page.click('#cdClose');
    expect(await page.$eval('.dock', (e) => getComputedStyle(e).visibility)).toBe('visible');
  });

  it('a sheet taller than a short screen scrolls inside itself (375 x 440, a landscape-like short screen)', async () => {
    const { page } = await open({ width: 375, height: 440, touch: true });
    await page.click('#exportBtn');
    await page.click('#xFormats [data-f=tailwind]');
    const r = await sheetState(page, '#xmenu');
    expect(r.t).toBeGreaterThanOrEqual(0);
    expect(r.b).toBeLessThanOrEqual(r.vh);
    expect(r.scrollable).toBe(true);
    await page.$eval('#xmenu', (e) => e.scrollTo(0, 9999));
    expect(await page.$eval('#xmenu', (e) => e.scrollTop)).toBeGreaterThan(0);
    expect(await page.isVisible('#xTw')).toBe(true);
  });

  it('the manual copy panel (last-resort copy) fits at 390, has a 16 px field, and a tap outside closes it (no Esc on a phone)', async () => {
    const { page } = await open({ ...phone, clipboard: false });
    await page.addInitScript(() => {
      Object.defineProperty(window, 'isSecureContext', { value: false });
      document.execCommand = () => false;
    });
    await page.reload();
    await page.waitForSelector('html.is-ready');
    await page.locator('.sw-copy').first().click();
    await page.waitForSelector('#manual:not([hidden])');
    const r = await page.evaluate(() => {
      const b = (document.querySelector('#manual') as HTMLElement).getBoundingClientRect();
      const f = document.querySelector('#manualField') as HTMLInputElement;
      return { l: b.left, r: b.right, vw: innerWidth, fs: parseFloat(getComputedStyle(f).fontSize), fh: f.getBoundingClientRect().height, sel: f.value.slice(f.selectionStart ?? 0, f.selectionEnd ?? 0) };
    });
    expect(r.l).toBeGreaterThanOrEqual(0);
    expect(r.r).toBeLessThanOrEqual(r.vw);
    expect(r.fs).toBeGreaterThanOrEqual(16);
    expect(r.fh).toBeGreaterThanOrEqual(44);
    expect(r.sel).toMatch(/^#[0-9A-F]{6}$/);
    await page.touchscreen.tap(200, 330);
    expect(await page.isVisible('#manual')).toBe(false);
  });

  it('toasts take at most 2 lines at 390 and 320 px (longest messages of the app)', async () => {
    for (const width of [390, 320]) {
      const s = await open({ width, height: 800, touch: true });
      const { page } = s;
      const lines = () =>
        page.evaluate(() => {
          const span = document.querySelector('#toast span') as HTMLElement;
          const range = document.createRange();
          range.selectNodeContents(span);
          const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          const box = (document.querySelector('#toast') as HTMLElement).getBoundingClientRect();
          return { lines: tops.size, text: span.textContent, l: box.left, r: box.right, vw: innerWidth };
        });
      const seen: { text: string | null; lines: number }[] = [];
      // 1. fix toast (the longest of J4)
      await page.fill('#base', '#e0a800');
      await settle(page);
      await page.click('.pill[data-pair=accent-fond]');
      await page.click('#cdFix');
      await page.waitForFunction(() => document.querySelector('#toast')?.classList.contains('show') && /corrigé/.test(document.querySelector('#toast')?.textContent ?? ''));
      seen.push(await lines());
      // 2. Partager in file://
      await page.click('#share');
      await page.waitForFunction(() => /Lien indisponible/.test(document.querySelector('#toast')?.textContent ?? ''));
      seen.push(await lines());
      // 3. copied colour, then the clipboard message of the menu
      await page.locator('.sw-copy').first().click();
      await page.waitForFunction(() => /^Copié : /.test(document.querySelector('#toast')?.textContent ?? ''));
      seen.push(await lines());
      expect(seen.length).toBe(3);
      for (const t of seen) {
        expect(t.lines, `${width} px: « ${t.text} »`).toBeLessThanOrEqual(2);
      }
      const box = await lines();
      expect(box.l).toBeGreaterThanOrEqual(0);
      expect(box.r).toBeLessThanOrEqual(box.vw);
      expect(await page.getAttribute('#toast', 'aria-live')).toBe('polite');
      // A bad link: its message too.
      const bad = await open({ width, height: 800, touch: true, hash: '#v=9' });
      await bad.page.waitForFunction(() => /version plus récente/.test(document.querySelector('#toast')?.textContent ?? ''));
      const b = await bad.page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('#toast span') as HTMLElement);
        return { n: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size, text: document.querySelector('#toast span')?.textContent };
      });
      // The longest message (83 characters) takes 3 lines in the 256 px of a 320 px screen: 2 lines are required from 390 px.
      expect(b.n, `${width} px: « ${b.text} »`).toBeLessThanOrEqual(width === 320 ? 3 : 2);
    }
  });

  it('safe areas: viewport-fit=cover, and with simulated insets the dock sits above the home indicator and the bar below the notch', async () => {
    const s = await open(phone);
    const { page, context } = s;
    expect(await page.getAttribute('meta[name=viewport]', 'content')).toContain('viewport-fit=cover');
    const css = await page.evaluate(() => {
      const out: string[] = [];
      const walk = (rules: CSSRuleList) => {
        for (const r of rules) {
          if ('cssRules' in r && (r as CSSGroupingRule).cssRules.length > 0) walk((r as CSSGroupingRule).cssRules);
          if (r.cssText.includes('safe-area-inset')) out.push(r.cssText.slice(0, 60));
        }
      };
      for (const sheet of document.styleSheets) walk(sheet.cssRules);
      return out;
    });
    for (const sel of ['.bar', '.dock', '.scene-area', '.cdlg', '.toast']) expect(css.some((c) => c.startsWith(sel)), sel).toBe(true);
    const base = await page.evaluate(() => ({ dock: innerHeight - (document.querySelector('.dock') as HTMLElement).getBoundingClientRect().bottom, bar: (document.querySelector('.bar') as HTMLElement).getBoundingClientRect().height }));
    expect(base.dock).toBe(10);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
    await page.waitForTimeout(250);
    const cut = await page.evaluate(() => ({ dock: innerHeight - (document.querySelector('.dock') as HTMLElement).getBoundingClientRect().bottom, bar: (document.querySelector('.bar') as HTMLElement).getBoundingClientRect().height, sw: document.documentElement.scrollWidth }));
    expect(cut.dock).toBe(44);
    expect(cut.bar - base.bar).toBe(47);
    expect(cut.sw).toBeLessThanOrEqual(390);
    await page.click('#exportBtn');
    const sheetBottom = await page.$eval('#xmenu', (e) => innerHeight - e.getBoundingClientRect().bottom);
    expect(sheetBottom).toBe(42);
    await page.click('#xClose');
    // Landscape-like side insets keep the bar content inside them.
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 21, left: 47, right: 47 } });
    await page.waitForTimeout(250);
    const side = await page.evaluate(() => { const b = (document.querySelector('.brand') as HTMLElement).getBoundingClientRect(); const e = (document.querySelector('#exportBtn') as HTMLElement).getBoundingClientRect(); return { left: b.left, right: innerWidth - e.right }; });
    expect(side.left).toBeGreaterThanOrEqual(47);
    expect(side.right).toBeGreaterThanOrEqual(47);
  });

  it('the dock and the pills scroll horizontally and snap (92 px colours)', async () => {
    const { page } = await open(phone);
    const dock = await page.evaluate(() => {
      const sw = document.querySelector('.swatches') as HTMLElement;
      const first = document.querySelector('.sw') as HTMLElement;
      return { type: getComputedStyle(sw).scrollSnapType, overflowX: getComputedStyle(sw).overflowX, scrollable: sw.scrollWidth > sw.clientWidth, w: first.getBoundingClientRect().width, align: getComputedStyle(first).scrollSnapAlign };
    });
    expect(dock).toEqual({ type: 'x mandatory', overflowX: 'auto', scrollable: true, w: 92, align: 'start' });
    // A programmatic scroll to an in-between offset ends on a colour boundary.
    await page.$eval('.swatches', (e) => e.scrollTo({ left: 150, behavior: 'instant' }));
    await page.waitForTimeout(500);
    const snapped = await page.evaluate(() => {
      const c = (document.querySelector('.swatches') as HTMLElement).getBoundingClientRect();
      return [...document.querySelectorAll('.sw')].map((e) => Math.round(e.getBoundingClientRect().left - c.left)).filter((x) => x >= 0 && x < 20);
    });
    expect(snapped.length).toBeGreaterThan(0);
    const pills = await page.evaluate(() => {
      const p = document.querySelector('#pills') as HTMLElement;
      return { type: getComputedStyle(p).scrollSnapType, overflowX: getComputedStyle(p).overflowX, scrollable: p.scrollWidth > p.clientWidth, wrap: getComputedStyle(p).flexWrap };
    });
    expect({ ...pills, type: pills.type.replace(' proximity', '') }).toEqual({ type: 'x', overflowX: 'auto', scrollable: true, wrap: 'nowrap' });
    // Focusing a hidden colour or pill scrolls it into view (the keyboard never loses its target).
    await page.locator('.sw[data-role=alerte] .sw-copy').focus();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => { const r = (document.activeElement as HTMLElement).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })).toBe(true);
    await page.locator('.pill[data-pair=accent2-fond]').focus();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => { const r = (document.activeElement as HTMLElement).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })).toBe(true);
  });
});

describe('screenshots (written only when HUEZZ_SHOTS names a folder)', () => {
  const shoot = async (s: Session, name: string) => {
    if (shotsDir !== null) await s.page.screenshot({ path: `${shotsDir}/${name}.png` });
  };
  it('390 x 844 light and dark, dock scrolled, export sheet, contrast sheet; 1440', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const s = await open({ ...phone, scheme });
      await shoot(s, `j6-390-${scheme}`);
      await s.page.$eval('.swatches', (e) => e.scrollTo({ left: 400, behavior: 'instant' }));
      await s.page.waitForTimeout(400);
      await shoot(s, `j6-390-${scheme}-dock`);
      await s.page.click('#exportBtn');
      await s.page.click('#xFormats [data-f=tailwind]');
      await shoot(s, `j6-390-${scheme}-export`);
      await s.page.click('#xClose');
      await s.page.click('.pill[data-pair=accent-fond]');
      await shoot(s, `j6-390-${scheme}-contrast`);
      const wide = await open({ scheme });
      await shoot(wide, `j6-1440-${scheme}`);
      await wide.page.click('.pill[data-pair=accent-fond]');
      await shoot(wide, `j6-1440-${scheme}-contrast`);
      await wide.page.click('#exportBtn');
      await shoot(wide, `j6-1440-${scheme}-export`);
    }
  });
});
