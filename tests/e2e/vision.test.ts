import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { CVD_PREVIEW_KINDS, simulateCvd, type Cvd } from '../../src/core/cvd';
import { parseHex } from '../../src/core/hex';
import { HARMONIES } from '../../src/core/harmony';
import { ROLES, type Mode } from '../../src/palette/roles';
import { initialState } from '../../src/state/state';
import { encodeHash } from '../../src/state/url';
import { frames, pixelsOf, settle, useBrowser, type Rgb } from './j6-helpers';

// J12 (brief 25): the vision preview. Chrome only (WebKit: nothing claimed here). The tool's own interface is never filtered.
const { open } = useBrowser();

/** The link of a generated palette: same 14 colours at load. */
const hashOf = (seed: number, harmony: (typeof HARMONIES)[number], mode: Mode): string => {
  const s = initialState(mode, seed, harmony);
  return encodeHash({ mode, harmony, seed, locks: 0, theme: s.theme });
};
const pick = async (page: Page, vision: 'normal' | Cvd): Promise<void> => {
  await page.selectOption('#vision', vision);
  await settle(page);
};
const rgbOfHex = (hex: string): Rgb => {
  const c = parseHex(hex) as NonNullable<ReturnType<typeof parseHex>>;
  return [c.r, c.g, c.b];
};

/** Centre-right of each swatch: away from the role name (top left), the hex (bottom left) and the lock button (top right). */
async function swatchPoints(page: Page): Promise<[number, number][]> {
  return page.$$eval('.sw', (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return [Math.round(r.left + r.width * 0.78), Math.round(r.top + r.height * 0.55)] as [number, number];
    }),
  );
}

describe('fidelity: the filtered dock swatches equal simulateCvd() of the engine', () => {
  it('7 palettes (6 harmonies, both modes) x 7 roles x 3 kinds: max channel error reported and bounded', async () => {
    const seeds = [0x01380f55, 0x00c0ffee, 0x12345678, 0xdeadbeef, 0x0badf00d, 0x7e57ab1e, 0x5eed1234];
    let worst = { err: 0, what: '' };
    let count = 0;
    for (const [i, seed] of seeds.entries()) {
      const harmony = HARMONIES[i % HARMONIES.length] as (typeof HARMONIES)[number];
      const mode: Mode = i % 2 === 0 ? 'light' : 'dark';
      const { page, context, probe } = await open({ scheme: mode, hash: hashOf(seed, harmony, mode) });
      const helper = await context.newPage();
      await page.mouse.move(0, 0);
      const theme = initialState(mode, seed, harmony).theme[mode];
      const points = await swatchPoints(page);
      for (const kind of CVD_PREVIEW_KINDS) {
        await pick(page, kind);
        const shot = await page.screenshot();
        const got = await pixelsOf(helper, shot, points);
        for (const [k, role] of ROLES.entries()) {
          const want = rgbOfHex(simulateCvd(theme[role], kind) as string);
          const have = got[k] as Rgb;
          const err = Math.max(...want.map((v, c) => Math.abs(v - (have[c] as number))));
          count++;
          if (err > worst.err) worst = { err, what: `${theme[role]} ${role} ${kind} ${mode}: want ${want} got ${have}` };
        }
      }
      expect(probe.errors).toEqual([]);
      expect(probe.violations).toEqual([]);
    }
    console.log(`J12 fidelity: ${count} samples, max channel error ${worst.err}/255 (${worst.what})`);
    expect(count).toBe(7 * 7 * 3);
    expect(worst.err).toBeLessThanOrEqual(2);
  });
});

const filterOf = (page: Page, selector: string): Promise<string> => page.$eval(selector, (e) => getComputedStyle(e).filter);

describe('what is filtered, what is not', () => {
  it('Protanopie: the 3 mock-ups and the 7 swatches carry the filter; the bar, the pills, the dialogs, the dock itself and the scene do not; the pills keep the real colours', async () => {
    const { page, context, probe } = await open();
    await page.click('.pill[data-pair=accent-fond]'); // open dialog: part of "the tool"
    await page.keyboard.press('Escape');
    const helper = await context.newPage();
    const dots = await page.$$eval('.pill-dot', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] as [number, number]; }));
    const before = await pixelsOf(helper, await page.screenshot(), dots);
    await pick(page, 'protan');
    expect(await page.getAttribute('html', 'data-vision')).toBe('protan');
    for (const sel of ['.p-web', '.p-dash', '.p-phone']) expect(await filterOf(page, sel), sel).toBe('url("#cvd-protan")');
    expect(await page.$$eval('.sw', (els) => els.map((e) => getComputedStyle(e).filter))).toEqual(Array<string>(7).fill('url("#cvd-protan")'));
    for (const sel of ['.bar', '.pills-box', '.pill', '#cdlg', '#xmenu', '.dock', '.swatches', '#scene', '.stage-wrap', '#stage', 'main', 'body', 'html', '#vision']) expect(await filterOf(page, sel), sel).toBe('none');
    const after = await pixelsOf(helper, await page.screenshot(), dots);
    expect(after, 'the contrast pills show the real palette').toEqual(before);
    expect(probe.errors).toEqual([]);
    expect(probe.violations).toEqual([]);
  });

  it('Normale removes the filter again: attribute, computed filter, note, and the real swatch colours', async () => {
    const { page, context } = await open();
    const helper = await context.newPage();
    const points = await swatchPoints(page);
    const theme = await page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
    for (const kind of CVD_PREVIEW_KINDS) {
      await pick(page, kind);
      expect(await page.isVisible('#visionNote')).toBe(true);
      await pick(page, 'normal');
      expect(await page.getAttribute('html', 'data-vision')).toBeNull();
      expect(await page.isVisible('#visionNote')).toBe(false);
      expect(await page.$$eval('.sw, .piece', (els) => els.map((e) => getComputedStyle(e).filter))).toEqual(Array<string>(10).fill('none'));
    }
    await page.mouse.move(0, 0);
    const got = await pixelsOf(helper, await page.screenshot(), points);
    for (const [k, hex] of theme.entries()) expect(got[k], hex).toEqual(rgbOfHex(hex));
  });

  it('the choice is in memory only: not in the address, not stored, no style attribute, back to Normale after a reload; the live region and the note say it is approximate', async () => {
    const { page, probe } = await open();
    const address = await page.evaluate(() => location.href);
    await page.selectOption('#vision', 'deutan');
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => location.href)).toBe(address);
    // J13: the palette history is the only thing the page keeps (key huezz.history.v1, links only); the Vision choice is in none of it.
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
    const kept = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    expect(Object.keys(kept).every((k) => k === 'huezz.history.v1')).toBe(true);
    expect(JSON.stringify(kept)).not.toMatch(/vision|protan|deutan|tritan/i);
    expect(await page.$$eval('[style]', (els) => els.length), 'no style="" attribute (CSP)').toBe(0);
    expect(await page.textContent('#live')).toMatch(/^Aperçu simulé, deutéranopie, simulation approchée : les contrastes et les exports restent ceux de la vraie palette\s*$/);
    expect(await page.innerText('#visionNote')).toBe('Simulation approchée : contrastes et exports inchangés (palette réelle).');
    // the exports stay those of the real palette
    await page.click('#exportBtn');
    const css = await page.inputValue('#xOut');
    const hexes = await page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
    for (const hex of hexes) expect(css).toContain(hex);
    await page.keyboard.press('Escape');
    await page.selectOption('#vision', 'normal');
    await page.waitForTimeout(900);
    expect(await page.textContent('#live')).toMatch(/^Vision normale : aperçu en couleurs réelles\s*$/);
    await page.selectOption('#vision', 'tritan');
    await page.reload();
    await page.waitForSelector('html.is-ready');
    expect(await page.inputValue('#vision')).toBe('normal');
    expect(await page.getAttribute('html', 'data-vision')).toBeNull();
    expect(await page.isVisible('#visionNote')).toBe(false);
    expect(probe.errors).toEqual([]);
    expect(probe.violations).toEqual([]);
  });

  it('keyboard: the select is reachable by Tab, changes by typing the first letter, and its label is read', async () => {
    const { page } = await open();
    await page.focus('#exportBtn');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('vision');
    expect(await page.$eval('#vision', (e) => (e as HTMLSelectElement).labels?.[0]?.textContent)).toBe('Vision');
    await page.keyboard.press('t'); // type-ahead on the closed select: Tritanopie
    await settle(page);
    expect(await page.getAttribute('html', 'data-vision')).toBe('tritan');
    expect(await page.$$eval('#vision option', (os) => os.map((o) => o.textContent))).toEqual(['Normale', 'Protanopie', 'Deutéranopie', 'Tritanopie']);
  });

  it('phone (390, touch): the select is at least 44 px high, its text is 16 px, nothing overflows, the note shows', async () => {
    const { page } = await open({ width: 390, height: 844, touch: true });
    const box = await page.$eval('#vision', (e) => { const r = e.getBoundingClientRect(); return { h: r.height, w: r.width, px: parseFloat(getComputedStyle(e).fontSize) }; });
    expect(box.h).toBeGreaterThanOrEqual(44);
    expect(box.w).toBeGreaterThanOrEqual(44);
    expect(box.px).toBeGreaterThanOrEqual(16);
    await pick(page, 'tritan');
    expect(await page.isVisible('#visionNote')).toBe(true);
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth])).toSatisfy(([doc, inner]: number[]) => (doc as number) <= (inner as number));
  });
});

describe('reduced motion, forced colours, and the J11 animations with a filter active', () => {
  it('reduced motion: the filter applies, nothing animates, no error', async () => {
    const { page, context, probe } = await open({ reducedMotion: true, hash: hashOf(0x01380f55, 'complementary', 'light') });
    const helper = await context.newPage();
    const theme = initialState('light', 0x01380f55, 'complementary').theme.light;
    await pick(page, 'tritan');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await settle(page);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await page.getAttribute('html', 'data-vision')).toBe('tritan');
    const now = await page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
    expect(now).not.toEqual(ROLES.map((r) => theme[r]));
    await page.mouse.move(0, 0);
    const got = await pixelsOf(helper, await page.screenshot(), await swatchPoints(page));
    for (const [k, hex] of now.entries()) {
      const want = rgbOfHex(simulateCvd(hex, 'tritan') as string);
      expect(Math.max(...want.map((v, c) => Math.abs(v - ((got[k] as Rgb)[c] as number)))), hex).toBeLessThanOrEqual(2);
    }
    expect(probe.errors).toEqual([]);
  });

  it('forced colours: the page still works with a simulation chosen (no error, select, note, swatches coloured)', async () => {
    const { page, probe } = await open({ forcedColors: true });
    await pick(page, 'protan');
    expect(await page.isVisible('#visionNote')).toBe(true);
    expect(await page.getAttribute('html', 'data-vision')).toBe('protan');
    const colours = await page.$$eval('.sw', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
    expect(new Set(colours).size, 'the swatches keep their own colours (forced-color-adjust: none)').toBeGreaterThan(3);
    await pick(page, 'normal');
    expect(await page.isVisible('#visionNote')).toBe(false);
    expect(probe.errors).toEqual([]);
    expect(probe.violations).toEqual([]);
  });

  it('J11 with a filter active: is-ready stays, Hasard runs the wave, the mode runs the circle, a base change runs the OKLCH morph; every one ends and the filter is still on', async () => {
    const { page, context, probe } = await open();
    const helper = await context.newPage();
    await pick(page, 'deutan');
    await page.evaluate(() => {
      const w = window as unknown as { __seen: Set<string>; __vt: { started: number; finished: number } };
      w.__seen = new Set();
      w.__vt = { started: 0, finished: 0 };
      const original = Document.prototype.startViewTransition;
      Document.prototype.startViewTransition = function (this: Document, ...args: Parameters<Document['startViewTransition']>): ViewTransition {
        const vt = original.apply(this, args);
        w.__vt.started++;
        const end = (): void => void w.__vt.finished++;
        vt.finished.then(end, end);
        return vt;
      } as typeof original;
      new MutationObserver(() => document.documentElement.className.split(' ').forEach((c) => w.__seen.add(c))).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    });
    expect(await page.evaluate(() => document.documentElement.classList.contains('is-ready'))).toBe(true);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await page.waitForFunction(() => { const w = window as unknown as { __vt: { started: number; finished: number } }; return w.__vt.started === 1 && w.__vt.finished === 1; });
    await page.click('[data-mode=dark]');
    await page.waitForFunction(() => { const w = window as unknown as { __vt: { started: number; finished: number } }; return w.__vt.started === 2 && w.__vt.finished === 2; });
    await page.fill('#baseHex', '#c0392b');
    await page.keyboard.press('Enter');
    await settle(page);
    // The 300 ms morph starts on the next painted frame and ends on the one after its end: with a heavy filter on a slow runner that is later than settle() waits (CI saw 'morph' still there).
    // Poll for "the morph was seen and every motion class is gone" with a generous limit: a class that stays forever still fails, after the limit.
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __seen: Set<string> };
        return w.__seen.has('morph') && !['vt', 'vt-wave', 'vt-circle', 'morph'].some((c) => document.documentElement.classList.contains(c));
      },
      null,
      { timeout: 20_000 },
    );
    const seen = await page.evaluate(() => [...(window as unknown as { __seen: Set<string> }).__seen]);
    expect(seen).toEqual(expect.arrayContaining(['vt-wave', 'vt-circle', 'morph']));
    expect(await page.evaluate(() => document.documentElement.className.split(' ').filter((c) => ['vt', 'vt-wave', 'vt-circle', 'morph'].includes(c)))).toEqual([]);
    expect(await page.getAttribute('html', 'data-vision')).toBe('deutan');
    expect(await page.$$eval('.sw', (els) => els.map((e) => getComputedStyle(e).filter))).toEqual(Array<string>(7).fill('url("#cvd-deutan")'));
    // after all that the swatches still show the simulated version of the current palette
    await page.mouse.move(0, 0);
    const hexes = await page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
    const got = await pixelsOf(helper, await page.screenshot(), await swatchPoints(page));
    for (const [k, hex] of hexes.entries()) {
      const want = rgbOfHex(simulateCvd(hex, 'deutan') as string);
      expect(Math.max(...want.map((v, c) => Math.abs(v - ((got[k] as Rgb)[c] as number)))), hex).toBeLessThanOrEqual(2);
    }
    await frames(page);
    expect(probe.errors).toEqual([]);
    expect(probe.violations).toEqual([]);
  });
});
