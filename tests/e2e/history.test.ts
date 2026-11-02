import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { FIXED_HASH } from '../fixed-hash.mjs';
import { useBrowser } from './j6-helpers';

/**
 * J13: history, favourites, undo / redo. Chrome with a real `localStorage` (a fresh context per test: nothing is shared between tests).
 * Recording waits for 400 ms of calm, so the tests wait 650 ms after a change before they read the list.
 */
const { open } = useBrowser();
const KEY = 'huezz.history.v1';
const SETTLED = 650;

const dockHexes = (page: Page): Promise<string[]> => page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
const toastText = (page: Page): Promise<string> => page.$eval('#toast span', (e) => e.textContent ?? '');
const live = (page: Page): Promise<string> => page.$eval('#live', (e) => e.textContent ?? '');
const lightColours = (page: Page): Promise<string> => page.evaluate(() => /[&#]l=([0-9A-F]{42})/.exec(location.hash)?.[1] ?? '');
const hasard = async (page: Page, n = 1): Promise<void> => {
  // Space on a focused button or select keeps its own action: the focus goes back to the page first.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(SETTLED);
  }
};
const sheetOpen = (page: Page): Promise<boolean> => page.isVisible('#hmenu');
async function openSheet(page: Page): Promise<void> {
  if (!(await sheetOpen(page))) await page.click('#histBtn');
  await page.waitForSelector('#hmenu', { state: 'visible' });
}
async function closeSheet(page: Page): Promise<void> {
  if (await sheetOpen(page)) await page.click('#histBtn');
}
/** Links of a list, read from the open sheet (it is opened and closed here when needed). */
async function links(page: Page, kind: 'rec' | 'fav'): Promise<string[]> {
  const was = await sheetOpen(page);
  await openSheet(page);
  const rows = await page.$$eval(`#${kind === 'rec' ? 'hRec' : 'hFav'} .hrow`, (els) => els.map((e) => (e as HTMLElement).dataset.h ?? ''));
  if (!was) await closeSheet(page);
  return rows;
}
const stored = (page: Page): Promise<string | null> => page.evaluate((k) => localStorage.getItem(k), KEY);
const accentOf = (hash: string): string => /&l=([0-9A-F]{42})/.exec(hash)?.[1]?.slice(18, 24) ?? '';

describe('recording', () => {
  it('the palette on screen is recorded once it has settled; a burst of Hasard leaves its last palette only', async () => {
    const { page, probe } = await open();
    await page.waitForTimeout(SETTLED);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(SETTLED);
    const rec = await links(page, 'rec');
    expect(rec).toHaveLength(2);
    expect(rec[0]).toBe(await page.evaluate(() => location.hash));
    expect(rec[1]).toBe(FIXED_HASH);
    expect(probe.errors).toEqual([]);
  });

  it('a colour drag records its end point, and one undo undoes the whole drag', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    await page.evaluate(async () => {
      const input = document.getElementById('base') as HTMLInputElement;
      for (const v of ['#2255aa', '#3366bb', '#4477cc', '#5588dd', '#6699ee', '#7a3fb0', '#8844c0']) {
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(SETTLED);
    const rec = await links(page, 'rec');
    expect(rec).toHaveLength(2);
    expect(accentOf(rec[0] ?? '')).toBe('8844C0');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(SETTLED);
    expect(await page.evaluate(() => location.hash)).toBe(FIXED_HASH);
  });

  it('adds no line for a lock, a mode switch or Vision; the same palette in the other mode is the same entry', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    await page.click('.sw[data-role=fond] .sw-lock');
    await page.click('.seg button[data-mode=dark]');
    await page.selectOption('#vision', 'tritan');
    await page.waitForTimeout(SETTLED);
    expect(await links(page, 'rec')).toHaveLength(1);
    await hasard(page);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(SETTLED);
    const rec = await links(page, 'rec');
    expect(rec).toHaveLength(2);
    expect(rec[0]?.startsWith('#v=1&m=l&')).toBe(true);
    expect(accentOf(rec[0] ?? '')).toBe(accentOf(FIXED_HASH));
  });

  it('keeps the 20 last palettes; the oldest goes', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    const first = await page.evaluate(() => location.hash);
    for (let i = 0; i < 22; i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(430);
    }
    await page.waitForTimeout(SETTLED);
    const rec = await links(page, 'rec');
    expect(rec).toHaveLength(20);
    expect(rec).not.toContain(first);
    expect(rec[0]).toBe(await page.evaluate(() => location.hash));
  });
});

describe('persistence in the real localStorage', () => {
  it('survives a reload; a favourite too; Tout effacer asks first, then empties the list and the storage', async () => {
    const { page, probe } = await open();
    await page.waitForTimeout(SETTLED);
    await hasard(page, 2);
    await openSheet(page);
    await page.locator('#hRec .hstar').nth(1).click();
    const starred = await page.$eval('#hRec .hstar[aria-pressed=true]', (e) => (e as HTMLElement).dataset.h ?? '');
    await closeSheet(page);
    const before = await links(page, 'rec');
    expect(before).toHaveLength(3);
    const raw = JSON.parse((await stored(page)) ?? 'null') as { v: number; recent: string[]; fav: string[] };
    expect(raw.v).toBe(1);
    expect(raw.recent).toEqual(before);
    expect(raw.fav).toEqual([starred]);

    await page.reload();
    await page.waitForSelector('html.is-ready');
    await page.waitForTimeout(SETTLED);
    expect(await links(page, 'rec')).toEqual(before);
    expect(await links(page, 'fav')).toEqual([starred]);
    await openSheet(page);
    expect(await page.getAttribute('#hFav .hstar', 'aria-pressed')).toBe('true');

    // the confirmation is inline and can be refused
    await page.click('#hClear');
    expect(await page.isVisible('#hAsk')).toBe(true);
    expect(await page.isVisible('#hClear')).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('hNo');
    await page.click('#hNo');
    expect(await page.isVisible('#hAsk')).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('hClear');
    expect(await links(page, 'rec')).toEqual(before);
    await page.click('#hClear');
    await page.click('#hYes');
    expect(await page.locator('.hitem').count()).toBe(0);
    expect(await page.isVisible('#hFavEmpty')).toBe(true);
    expect(await page.isVisible('#hRecEmpty')).toBe(true);
    expect(await stored(page)).toBeNull();
    expect(await toastText(page)).toBe('Historique effacé');
    expect(probe.errors).toEqual([]);

    await page.reload();
    await page.waitForSelector('html.is-ready');
    await page.waitForTimeout(SETTLED);
    expect(await links(page, 'fav')).toEqual([]);
    expect(await links(page, 'rec')).toHaveLength(1);
  });

  it('a favourite is not evicted by new palettes', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    await openSheet(page);
    await page.locator('#hRec .hstar').first().click();
    await closeSheet(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 22; i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(430);
    }
    await page.waitForTimeout(SETTLED);
    expect(await links(page, 'fav')).toEqual([FIXED_HASH]);
    expect(await links(page, 'rec')).not.toContain(FIXED_HASH);
  });
});

describe('undo and redo from the keyboard', () => {
  it('Ctrl/Cmd+Z, Shift+Z and Ctrl+Y walk the palettes; the toast says Annulé / Rétabli with the name; nothing left says so', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    const h0 = await dockHexes(page);
    await hasard(page);
    const h1 = await dockHexes(page);
    await hasard(page);
    const h2 = await dockHexes(page);
    expect(new Set([h0.join(), h1.join(), h2.join()]).size).toBe(3);
    const liveBefore = await live(page);
    const name = (): Promise<string> => page.$eval('.scene-title', (e) => e.textContent ?? '');

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(450);
    expect(await dockHexes(page)).toEqual(h1);
    expect(await toastText(page)).toBe(`Annulé : ${await name()}`);
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(450);
    expect(await dockHexes(page)).toEqual(h0);
    await page.keyboard.press('Control+z');
    expect(await toastText(page)).toBe('Rien à annuler');
    expect(await dockHexes(page)).toEqual(h0);

    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(450);
    expect(await dockHexes(page)).toEqual(h1);
    expect(await toastText(page)).toBe(`Rétabli : ${await name()}`);
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(450);
    expect(await dockHexes(page)).toEqual(h2);
    await page.keyboard.press('Meta+Shift+z');
    expect(await toastText(page)).toBe('Rien à rétablir');

    // the generic sentence of a palette change is not said again for an undo: the toast (a polite live region) is the announcement
    await page.waitForTimeout(900);
    expect(await live(page)).toBe(liveBefore);
    expect(await page.$eval('#toast', (e) => [e.getAttribute('role'), e.getAttribute('aria-live')])).toEqual(['status', 'polite']);
  });

  it('a new change drops the redo list', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    await hasard(page, 2);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(450);
    await hasard(page);
    const now = await dockHexes(page);
    await page.keyboard.press('Control+y');
    expect(await toastText(page)).toBe('Rien à rétablir');
    expect(await dockHexes(page)).toEqual(now);
  });

  it('the mode and Vision are not undone; the palette goes back in the mode of now', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    const fixedLight = await lightColours(page);
    await hasard(page);
    await page.click('.seg button[data-mode=dark]');
    await page.selectOption('#vision', 'deutan');
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(SETTLED);
    expect(await lightColours(page)).toBe(fixedLight);
    expect(await page.getAttribute('.seg button[data-mode=dark]', 'aria-pressed')).toBe('true');
    expect(await page.evaluate(() => document.documentElement.dataset.vision)).toBe('deutan');
    expect(await page.$eval('#metaMode', (e) => e.textContent)).toBe('sombre');
  });

  it('the hex field and the select keep their own undo: Ctrl+Z there changes no palette', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    await hasard(page);
    const hexes = await dockHexes(page);
    await page.focus('#baseHex');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(450);
    expect(await dockHexes(page)).toEqual(hexes);
    await page.focus('#harm');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(450);
    expect(await dockHexes(page)).toEqual(hexes);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(450);
    expect(await dockHexes(page)).not.toEqual(hexes);
  });

  it('a typed base and a harmony change are undone one by one', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    const h0 = await dockHexes(page);
    await page.selectOption('#harm', 'triad');
    await page.waitForTimeout(SETTLED);
    const h1 = await dockHexes(page);
    await page.fill('#baseHex', '#2E86AB');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(SETTLED);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(450);
    expect(await dockHexes(page)).toEqual(h1);
    expect(await page.$eval('#harm', (e) => (e as HTMLSelectElement).value)).toBe('triad');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(450);
    expect(await dockHexes(page)).toEqual(h0);
    expect(await page.$eval('#harm', (e) => (e as HTMLSelectElement).value)).toBe('complementary');
  });
});

describe('the sheet', () => {
  it('opens by keyboard with the focus inside, Tab goes through rows then stars, Escape closes and gives the focus back', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    await hasard(page, 2);
    await page.focus('#histBtn');
    await page.keyboard.press('Enter');
    expect(await sheetOpen(page)).toBe(true);
    expect(await page.getAttribute('#histBtn', 'aria-expanded')).toBe('true');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('hClose');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.className)).toBe('hrow');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.className)).toBe('hstar');
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => [document.activeElement?.className, document.activeElement?.getAttribute('aria-pressed')])).toEqual(['hstar', 'true']);
    expect(await page.locator('#hFav .hitem').count()).toBe(1);
    // the same star, found again in the rebuilt list, still has the focus; pressing it again unstars
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => [document.activeElement?.className, document.activeElement?.getAttribute('aria-pressed')])).toEqual(['hstar', 'false']);
    expect(await page.locator('#hFav .hitem').count()).toBe(0);
    await page.keyboard.press('Escape');
    expect(await sheetOpen(page)).toBe(false);
    expect(await page.getAttribute('#histBtn', 'aria-expanded')).toBe('false');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('histBtn');
  });

  it('unstarring the only favourite keeps the focus inside the sheet', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    await openSheet(page);
    await page.locator('#hRec .hstar').first().click();
    await page.locator('#hFav .hstar').first().focus();
    await page.keyboard.press('Enter');
    expect(await page.locator('#hFav .hitem').count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.closest('#hmenu') !== null)).toBe(true);
  });

  it('a row restores the palette in the mode of now, closes the sheet, gives the focus back, and the restore can be undone', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    const fixedLight = await lightColours(page);
    await hasard(page, 2);
    const h2 = await lightColours(page);
    await page.click('.seg button[data-mode=dark]');
    await openSheet(page);
    const rows = page.locator('#hRec .hrow');
    expect(await rows.count()).toBe(3);
    const label = await rows.nth(2).getAttribute('aria-label');
    await rows.nth(2).click();
    await page.waitForTimeout(SETTLED);
    expect(await sheetOpen(page)).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('histBtn');
    expect(await lightColours(page)).toBe(fixedLight);
    expect(await page.getAttribute('.seg button[data-mode=dark]', 'aria-pressed')).toBe('true');
    expect(await toastText(page)).toMatch(/^Restaurée : \S+( \S+)?$/);
    expect(label?.startsWith((await toastText(page)).replace('Restaurée : ', ''))).toBe(true);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(SETTLED);
    expect(await lightColours(page)).toBe(h2);
    // the palette on screen is the top of the list: choosing it again changes nothing
    await openSheet(page);
    await page.locator('#hRec .hrow').first().click();
    expect(await toastText(page)).toMatch(/^Déjà affichée : /);
    expect(await lightColours(page)).toBe(h2);
  });

  it('the strip of a row shows the 7 role colours of the current mode, and follows the mode while the sheet is open', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    await openSheet(page);
    const strip = (): Promise<string[]> => page.$$eval('#hRec .hrow rect', (els) => els.slice(0, 7).map((e) => (e.getAttribute('fill') ?? '').toUpperCase()));
    const light = await strip();
    const hash = (await links(page, 'rec'))[0] ?? '';
    const l = /&l=([0-9A-F]{42})/.exec(hash)?.[1] ?? '';
    const d = /&d=([0-9A-F]{42})/.exec(hash)?.[1] ?? '';
    const split = (x: string): string[] => Array.from({ length: 7 }, (_, i) => `#${x.slice(i * 6, i * 6 + 6)}`);
    expect(light).toEqual(split(l));
    // by keyboard: a click on the mode button would close the sheet (a click outside does)
    await page.focus('.seg button[data-mode=light]');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(SETTLED);
    expect(await sheetOpen(page)).toBe(true);
    expect(await strip()).toEqual(split(d));
  });

  it('opening the export menu or a contrast pill closes it, and it closes them; a click outside closes it', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    await openSheet(page);
    await page.click('#exportBtn');
    expect(await sheetOpen(page)).toBe(false);
    expect(await page.isVisible('#xmenu')).toBe(true);
    await page.click('#histBtn');
    expect(await page.isVisible('#xmenu')).toBe(false);
    expect(await sheetOpen(page)).toBe(true);
    await page.click('.pill[data-pair=accent-fond]');
    expect(await sheetOpen(page)).toBe(false);
    await page.keyboard.press('Escape');
    await page.click('#histBtn');
    await page.mouse.click(300, 600);
    expect(await sheetOpen(page)).toBe(false);
  });

  it('writes no style attribute and breaks no CSP rule with the sheet full', async () => {
    const { page, probe } = await open();
    await page.waitForTimeout(SETTLED);
    await hasard(page, 4);
    await openSheet(page);
    for (const i of [0, 2]) await page.locator('#hRec .hstar').nth(i).click();
    expect(await page.$$eval('[style]', (e) => e.length)).toBe(0);
    expect(probe.violations).toEqual([]);
    expect(probe.errors).toEqual([]);
  });
});

describe('storage that cannot be trusted or used', () => {
  const BLOCKED = `Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });`;
  const FULL = `Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };`;

  it('localStorage blocked: the page works, nothing is thrown, undo works, the sheet says it is not saved', async () => {
    const { page, probe } = await open({ initScript: BLOCKED });
    await page.waitForTimeout(SETTLED);
    await hasard(page, 2);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(450);
    await openSheet(page);
    expect(await page.locator('#hRec .hitem').count()).toBe(3);
    expect(await page.isVisible('#hWarn')).toBe(true);
    expect(await page.textContent('#hWarn')).toMatch(/^Historique non enregistré sur cet appareil/);
    expect(await page.isVisible('#hNote')).toBe(false);
    await page.locator('#hRec .hstar').first().click();
    expect(await page.locator('#hFav .hitem').count()).toBe(1);
    await page.click('#hClear');
    await page.click('#hYes');
    expect(await page.locator('.hitem').count()).toBe(0);
    expect(probe.errors).toEqual([]);
    expect(probe.violations).toEqual([]);
  });

  it('a full storage (every write throws): the page works and the sheet says it is not saved', async () => {
    const { page, probe } = await open({ initScript: FULL });
    await page.waitForTimeout(SETTLED);
    await hasard(page);
    await openSheet(page);
    expect(await page.locator('#hRec .hitem').count()).toBe(2);
    expect(await page.isVisible('#hWarn')).toBe(true);
    expect(probe.errors).toEqual([]);
  });

  it('with storage working the hint is not shown and the note is', async () => {
    const { page } = await open();
    await page.waitForTimeout(SETTLED);
    await openSheet(page);
    expect(await page.isVisible('#hWarn')).toBe(false);
    expect(await page.textContent('#hNote')).toContain('Enregistré uniquement sur cet appareil, dans ce navigateur.');
  });

  for (const [name, value] of [
    ['broken JSON', '{"recent":['],
    ['wrong types', '{"recent":5,"fav":{"a":1},"v":"x"}'],
    ['a bare array', '[1,2,3]'],
    ['10 000 junk entries', JSON.stringify({ v: 1, recent: Array.from({ length: 10000 }, (_, i) => `#v=1&m=l&x=${i}`), fav: Array.from({ length: 10000 }, () => 7) })],
    ['hostile strings', JSON.stringify({ v: 1, recent: ['<img src=x onerror=alert(1)>', '#v=1&m=l&h=co&s=00000000&k=00&l=<script>&d=x', 'javascript:alert(1)', { toString: 1 }], fav: ['__proto__', '#'] })],
    ['a value of 200 000 characters', 'x'.repeat(200000)],
  ] as const) {
    it(`a hostile stored value (${name}): the page works with an empty list and no console error`, async () => {
      const { page, probe } = await open({ initScript: `try { localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(value)}); } catch (e) {}` });
      await page.waitForTimeout(SETTLED);
      await hasard(page);
      await openSheet(page);
      expect(await page.locator('#hFav .hitem').count()).toBe(0);
      expect(await page.locator('#hRec .hitem').count()).toBe(2);
      expect(await page.locator('#hmenu img, #hmenu script').count()).toBe(0);
      expect(await page.isVisible('#hWarn')).toBe(false);
      expect(probe.errors).toEqual([]);
      expect(probe.violations).toEqual([]);
    });
  }

  it('good entries among bad ones are kept, and rewritten as clean links', async () => {
    const good = `${FIXED_HASH}`;
    const value = JSON.stringify({ v: 1, recent: ['nope', good, `${good}&zz=1`, 42], fav: [good, 'x'], extra: { a: 1 } });
    const { page, probe } = await open({ hash: '#v=1&m=l&h=tr&s=00000001&k=00&l=E7F2EFF7FBFA071916137A6B845060206720B01F29&d=060E0D0F1917E1E9E76EBCADC792A179CF8DEE7063', initScript: `try { localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(value)}); } catch (e) {}` });
    await page.waitForTimeout(SETTLED);
    expect(await links(page, 'fav')).toEqual([good]);
    const rec = await links(page, 'rec');
    expect(rec).toHaveLength(2);
    expect(rec[1]).toBe(good);
    expect(probe.errors).toEqual([]);
  });
});

describe('phones and short windows', () => {
  it('390 px touch: every target of the bar button and of the sheet is at least 44 px; nothing overflows', async () => {
    const { page } = await open({ width: 390, height: 844, touch: true });
    await page.waitForTimeout(SETTLED);
    await hasard(page, 2);
    await openSheet(page);
    await page.locator('#hRec .hstar').first().tap();
    const small = await page.evaluate(() =>
      ['#histBtn', '#hClose', '#hClear', '#hRec .hrow', '#hRec .hstar', '#hFav .hrow', '#hFav .hstar'].flatMap((sel) =>
        [...document.querySelectorAll(sel)].map((e) => {
          const r = e.getBoundingClientRect();
          return r.width >= 43.5 && r.height >= 43.5 ? '' : `${sel} ${Math.round(r.width)}x${Math.round(r.height)}`;
        }),
      ).filter(Boolean),
    );
    expect(small).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    const box = await page.$eval('#hmenu', (e) => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; });
    expect(box[0]).toBeGreaterThanOrEqual(0);
    expect(box[1]).toBeLessThanOrEqual(390);
    expect(box[3]).toBeLessThanOrEqual(844);
  });

  for (const [width, height] of [[844, 390], [800, 450]] as const) {
    it(`${width}x${height}: the sheet stays inside the window, scrolls inside, keeps its close button reachable; the toast goes to the top`, async () => {
      const { page } = await open({ width, height });
      await page.waitForTimeout(SETTLED);
      await hasard(page, 5);
      await openSheet(page);
      const r = await page.$eval('#hmenu', (e) => { const b = e.getBoundingClientRect(); const el = e as HTMLElement; return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, scrolls: el.scrollHeight > el.clientHeight }; });
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeLessThanOrEqual(height);
      expect(r.right).toBeLessThanOrEqual(width);
      expect(r.scrolls).toBe(true);
      await page.evaluate(() => { document.getElementById('hmenu')!.scrollTop = 9999; });
      const close = await page.$eval('#hClose', (e) => { const b = e.getBoundingClientRect(); return [b.top, b.bottom]; });
      expect(close[0]).toBeGreaterThanOrEqual(0);
      expect(close[1]).toBeLessThanOrEqual(height);
      await page.locator('#hRec .hstar').last().click();
      await page.click('#hClear');
      await page.click('#hYes');
      expect(await page.$eval('#toast', (e) => e.getBoundingClientRect().top)).toBeLessThan(60);
    });
  }
});
