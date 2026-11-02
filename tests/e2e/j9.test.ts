import type { CDPSession, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { FIXED_HASH } from '../fixed-hash.mjs';
import { parseCss, ratio, runAxe, settle, shotsDir, useBrowser, type Session } from './j6-helpers';

// J9: corrections after the tester and the product audit (brief 21). Chrome, file://, CSP not bypassed.
const { open } = useBrowser();

const ROLES = ['fond', 'surface', 'texte', 'accent', 'accent2', 'succes', 'alerte'] as const;
const hexes = (page: Page): Promise<string[]> => page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
const lockedRoles = (page: Page): Promise<string[]> =>
  page.$$eval('.sw', (els) => els.filter((e) => e.classList.contains('locked')).map((e) => e.getAttribute('data-role') ?? ''));
const toastText = (page: Page): Promise<string> => page.$eval('#toast span', (e) => e.textContent ?? '');
const live = (page: Page): Promise<string> => page.$eval('#live', (e) => (e.textContent ?? '').trim());
const lock = (page: Page, role: string) => page.locator(`.sw[data-role=${role}] .sw-lock`);

async function typeBase(page: Page, hex: string): Promise<void> {
  await page.fill('#baseHex', hex);
  await page.keyboard.press('Enter');
  await settle(page);
}

const snap = async (s: Session, name: string): Promise<void> => {
  if (shotsDir !== null) await s.page.screenshot({ path: `${shotsDir}/j9-${name}.png` });
};

describe('G1 / I1: a base typed while the accent is locked', () => {
  it('yellow #E0A800, Corriger, then #2E86AB typed: the accent becomes #2E86AB and stays locked, the field shows it, a toast says so', async () => {
    const s = await open();
    const { page } = s;
    await typeBase(page, '#E0A800');
    expect((await hexes(page))[3]).toBe('#E0A800');
    await page.click('.pill[data-pair=accent-fond]');
    await page.click('#cdFix');
    await settle(page);
    expect(await lockedRoles(page)).toEqual(['accent']);
    const fixed = (await hexes(page))[3];
    expect(fixed).toBe('#8B6700');
    expect(await page.inputValue('#baseHex')).toBe('#8B6700');

    const before = await hexes(page);
    await typeBase(page, '#2E86AB');
    const after = await hexes(page);
    expect(after[3]).toBe('#2E86AB');
    expect(await page.inputValue('#baseHex')).toBe('#2E86AB');
    expect(await page.inputValue('#base')).toBe('#2e86ab');
    expect(await lockedRoles(page)).toEqual(['accent']);
    expect(await page.getAttribute('.sw[data-role=accent] .sw-lock', 'aria-pressed')).toBe('true');
    expect(await toastText(page)).toBe('Accent mis à jour : #2E86AB (verrouillé)');
    expect(after).not.toEqual(before);
    // the lock holds: a Hasard keeps the new accent
    await page.click('#hasard');
    await settle(page);
    expect((await hexes(page))[3]).toBe('#2E86AB');
    expect(await page.inputValue('#baseHex')).toBe('#2E86AB');
    expect(s.probe.errors).toEqual([]);
    expect(s.probe.violations).toEqual([]);
    await snap(s, 'locked-accent-base');
  });

  it('the other locked roles are untouched, the unlocked accent keeps the old behaviour (no toast)', async () => {
    const s = await open();
    const { page } = s;
    await lock(page, 'accent').click();
    await lock(page, 'succes').click();
    await lock(page, 'alerte').click();
    await settle(page);
    const first = await hexes(page);
    await typeBase(page, '#2E86AB');
    const second = await hexes(page);
    expect(second[3]).toBe('#2E86AB');
    expect(second[5]).toBe(first[5]);
    expect(second[6]).toBe(first[6]);
    expect(await lockedRoles(page)).toEqual(['accent', 'succes', 'alerte']);
    // unlock the accent: the typed base works as before and says nothing
    await lock(page, 'accent').click();
    await page.waitForTimeout(3200);
    expect(await page.$eval('#toast', (e) => e.classList.contains('show'))).toBe(false);
    await typeBase(page, '#C0392B');
    expect((await hexes(page))[3]).toBe('#C0392B');
    expect(await page.$eval('#toast', (e) => e.classList.contains('show'))).toBe(false);
    await s.context.close();
  });

  it('the colour picker too: one toast when the picker closes, none for each move', async () => {
    const s = await open();
    const { page } = s;
    await lock(page, 'accent').click();
    await page.fill('#base', '#2e86ab');
    await settle(page);
    expect((await hexes(page))[3]).toBe('#2E86AB');
    expect(await toastText(page)).toBe('Accent mis à jour : #2E86AB (verrouillé)');
    expect(await page.inputValue('#baseHex')).toBe('#2E86AB');
    await s.context.close();
  });
});

describe('G2: all 7 roles locked, Hasard says why and never announces a new palette', () => {
  const MESSAGE = 'Les 7 couleurs sont verrouillées : déverrouille-en une pour relancer Hasard.';
  it('click and Space: the toast says why, the palette and the address do not move, the live region stays empty', async () => {
    const s = await open();
    const { page } = s;
    for (const role of ROLES) await lock(page, role).click();
    await settle(page);
    await page.waitForTimeout(900);
    const colours = await hexes(page);
    const hash = await page.evaluate(() => location.hash);
    const said = await live(page);
    expect(said).toMatch(/verrouillée?$/); // the last lock, nothing else yet
    expect(await lockedRoles(page)).toEqual([...ROLES]);

    await page.click('#hasard');
    expect(await toastText(page)).toBe(MESSAGE);
    expect(await page.$eval('#toast', (e) => e.classList.contains('show'))).toBe(true);
    await page.waitForTimeout(1000);
    expect(await live(page)).not.toMatch(/Nouvelle palette/);
    expect(await live(page)).toBe(said);
    await snap(s, 'all-locked-toast');

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(2000);
    await page.keyboard.press('Space');
    await page.waitForTimeout(900);
    expect(await toastText(page)).toBe(MESSAGE);
    expect(await page.$eval('#toast', (e) => e.classList.contains('show'))).toBe(true);
    expect(await live(page)).not.toMatch(/Nouvelle palette/);
    await settle(page);
    expect(await hexes(page)).toEqual(colours);
    expect(await page.evaluate(() => location.hash)).toBe(hash);
    // the toast is a polite live region: its text is what a screen reader says
    expect(await page.$eval('#toast', (e) => [e.getAttribute('role'), e.getAttribute('aria-live')])).toEqual(['status', 'polite']);
    // unlock one: Hasard works again and announces a new palette
    await lock(page, 'fond').click();
    await page.click('#hasard');
    await page.waitForTimeout(1000);
    expect(await live(page)).toMatch(/^Nouvelle palette : \p{Lu}\p{Ll}+ \p{Ll}+, accent #[0-9A-F]{6}/u);
    expect(s.probe.errors).toEqual([]);
    await s.context.close();
  });
});

describe('G3 / G5: the hex field says what is wrong, in view', () => {
  const bubble = (page: Page) =>
    page.evaluate(() => {
      const box = document.querySelector('.base-err') as HTMLElement;
      const text = document.getElementById('baseErr') as HTMLElement;
      const icon = box.querySelector('svg') as SVGElement;
      const r = box.getBoundingClientRect();
      const i = icon.getBoundingClientRect();
      const cs = getComputedStyle(box);
      const field = document.getElementById('baseHex') as HTMLInputElement;
      return {
        text: text.textContent ?? '',
        opacity: Number(cs.opacity),
        color: cs.color,
        background: cs.backgroundColor,
        w: r.width,
        h: r.height,
        bottom: r.bottom,
        top: r.top,
        left: r.left,
        right: r.right,
        icon: [i.width, i.height],
        iconDisplay: getComputedStyle(icon).display,
        role: text.getAttribute('role'),
        describedby: field.getAttribute('aria-describedby'),
        invalid: field.getAttribute('aria-invalid'),
        fieldBottom: field.getBoundingClientRect().bottom,
        vw: innerWidth,
        vh: innerHeight,
      };
    });

  it('invalid code: a visible message with an icon, contrast >= 4.5:1, linked to the field, gone when the code is good', async () => {
    const s = await open();
    const { page } = s;
    await page.fill('#baseHex', 'g12');
    await page.keyboard.press('Enter');
    const b = await bubble(page);
    expect(b.text).toBe('Code invalide : attendu #RRGGBB ou #RGB.');
    expect(b.opacity).toBe(1);
    expect(b.w).toBeGreaterThan(100);
    expect(b.h).toBeGreaterThan(20);
    expect(b.icon[0]).toBeGreaterThan(8);
    expect(b.iconDisplay).not.toBe('none');
    expect(ratio(parseCss(b.color), parseCss(b.background))).toBeGreaterThanOrEqual(4.5);
    expect(b.describedby).toBe('baseErr');
    expect(b.role).toBe('status');
    expect(b.invalid).toBe('true');
    expect(b.top).toBeGreaterThan(b.fieldBottom - 2); // below the field
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(b.vw);
    expect(b.bottom).toBeLessThanOrEqual(b.vh);
    // the palette did not move
    expect((await hexes(page))[3]).toBe('#137A6B');
    await snap(s, 'hex-error');
    // the error is announced: the status span holds the text (polite live region)
    expect(await page.$eval('#baseErr', (e) => e.textContent)).toContain('Code invalide');
    // a good code removes it
    await page.fill('#baseHex', '#2E86AB');
    await page.keyboard.press('Enter');
    await settle(page);
    const ok = await bubble(page);
    expect(ok.text).toBe('');
    expect(ok.opacity).toBe(0);
    expect(ok.invalid).toBeNull();
    expect((await hexes(page))[3]).toBe('#2E86AB');
    await s.context.close();
  });

  it('Escape removes the error and gives the applied value back; typing a good code removes it too', async () => {
    const s = await open();
    const { page } = s;
    await page.fill('#baseHex', 'zzz');
    await page.keyboard.press('Enter');
    expect((await bubble(page)).opacity).toBe(1);
    await page.keyboard.press('Escape');
    const b = await bubble(page);
    expect(b.text).toBe('');
    expect(b.opacity).toBe(0);
    expect(b.invalid).toBeNull();
    expect(await page.inputValue('#baseHex')).toBe('#137A6B');
    await page.fill('#baseHex', 'zzz');
    await page.keyboard.press('Enter');
    expect((await bubble(page)).opacity).toBe(1);
    await page.fill('#baseHex', '#abc');
    expect((await bubble(page)).opacity).toBe(0);
    await s.context.close();
  });

  it('spaces around the code are dropped, the # is optional, nothing is cut short', async () => {
    const s = await open();
    const { page } = s;
    await typeBase(page, '  #2E86AB  ');
    expect((await hexes(page))[3]).toBe('#2E86AB');
    expect(await page.inputValue('#baseHex')).toBe('#2E86AB');
    expect((await bubble(page)).opacity).toBe(0);
    await typeBase(page, 'c0392b');
    expect((await hexes(page))[3]).toBe('#C0392B');
    await typeBase(page, '\t#abc\n');
    expect((await hexes(page))[3]).toBe('#AABBCC');
    // too long: the full text reaches the validation (no maxlength), the message says so, the palette stays
    expect(await page.getAttribute('#baseHex', 'maxlength')).toBeNull();
    for (const long of ['#2E86ABCDEF', '2E86ABCDEF', '#FFFFFFFFFFFFFFFFFFFF']) {
      await page.fill('#baseHex', long);
      expect(await page.inputValue('#baseHex')).toBe(long);
      await page.keyboard.press('Enter');
      const b = await bubble(page);
      expect(b.text).toBe('Code hex trop long : 6 chiffres attendus');
      expect(b.opacity).toBe(1);
      expect(await page.inputValue('#baseHex')).toBe(long);
      expect((await hexes(page))[3]).toBe('#AABBCC');
    }
    // a long paste, through the real clipboard and a real paste shortcut
    await page.evaluate(() => navigator.clipboard.writeText('#2E86ABCDEF'));
    await page.fill('#baseHex', '');
    await page.focus('#baseHex');
    await page.keyboard.press('ControlOrMeta+V');
    expect(await page.inputValue('#baseHex')).toBe('#2E86ABCDEF');
    await page.keyboard.press('Enter');
    expect((await bubble(page)).text).toBe('Code hex trop long : 6 chiffres attendus');
    expect(await page.inputValue('#baseHex')).toBe('#2E86ABCDEF');
    expect(s.probe.errors).toEqual([]);
    await s.context.close();
  });

  it('the typed text is cut by nothing on a real keyboard either', async () => {
    const s = await open();
    const { page } = s;
    await page.fill('#baseHex', '');
    await page.keyboard.type('#2E86ABCDEF');
    expect(await page.inputValue('#baseHex')).toBe('#2E86ABCDEF');
    await s.context.close();
  });
});

describe('G4: short windows (844x390 landscape, 800x450): the sheets stay inside, scroll inside, the close button stays in reach', () => {
  const rects = (page: Page, sel: string, closeSel: string, lastSel: string) =>
    page.evaluate(
      ([s, c, l]) => {
        const d = document.querySelector(s as string) as HTMLElement;
        const r = d.getBoundingClientRect();
        const close = (document.querySelector(c as string) as HTMLElement).getBoundingClientRect();
        const last = (document.querySelector(l as string) as HTMLElement).getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          vh: innerHeight,
          vw: innerWidth,
          scrollable: d.scrollHeight > d.clientHeight,
          scrollTop: d.scrollTop,
          maxScroll: d.scrollHeight - d.clientHeight,
          closeTop: close.top,
          closeBottom: close.bottom,
          lastBottom: last.bottom,
          lastTop: last.top,
        };
      },
      [sel, closeSel, lastSel] as const,
    );

  for (const [width, height] of [
    [844, 390],
    [800, 450],
    [1024, 400],
    [900, 500],
  ] as const) {
    it(`${width}x${height}: export sheet`, async () => {
      const s = await open({ width, height });
      const { page } = s;
      await page.click('#exportBtn');
      await page.waitForSelector('#xmenu:not([hidden])');
      await page.waitForTimeout(100);
      let r = await rects(page, '#xmenu', '#xClose', '.xfoot');
      expect(r.top, 'top inside the viewport').toBeGreaterThanOrEqual(0);
      expect(r.bottom, 'bottom inside the viewport').toBeLessThanOrEqual(r.vh);
      expect(r.right).toBeLessThanOrEqual(r.vw);
      expect(r.scrollable).toBe(true);
      expect(r.closeTop).toBeGreaterThanOrEqual(r.top);
      expect(r.closeBottom).toBeLessThanOrEqual(r.bottom);
      await snap(s, `export-${width}x${height}`);
      // all the way down: the footer is reachable, the close button is still visible without scrolling back
      await page.$eval('#xmenu', (e) => e.scrollTo(0, e.scrollHeight));
      await page.waitForTimeout(150);
      r = await rects(page, '#xmenu', '#xClose', '.xfoot');
      expect(r.scrollTop).toBeGreaterThan(0);
      expect(r.lastBottom).toBeLessThanOrEqual(r.bottom + 0.5);
      expect(r.closeTop).toBeGreaterThanOrEqual(r.top - 0.5);
      expect(r.closeBottom).toBeLessThanOrEqual(r.bottom);
      expect(r.bottom).toBeLessThanOrEqual(r.vh);
      // the Copier button can be reached and used
      await page.$eval('#xmenu', (e) => e.scrollTo(0, 0));
      await page.locator('#xCopy').scrollIntoViewIfNeeded();
      const copy = await page.locator('#xCopy').boundingBox();
      const dlg = await page.locator('#xmenu').boundingBox();
      expect(copy !== null && dlg !== null && copy.y >= dlg.y && copy.y + copy.height <= dlg.y + dlg.height).toBe(true);
      // the close button closes it, focus returns to Exporter
      await page.click('#xClose');
      expect(await page.$eval('#xmenu', (e) => (e as HTMLElement).hidden)).toBe(true);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('exportBtn');
      await s.context.close();
    });

    it(`${width}x${height}: contrast dialog (yellow base, the tallest one)`, async () => {
      const s = await open({ width, height });
      const { page } = s;
      await typeBase(page, '#E0A800');
      await page.click('.pill[data-pair=accent-fond]');
      await page.waitForSelector('#cdlg:not([hidden])');
      await page.waitForTimeout(100);
      let r = await rects(page, '#cdlg', '#cdClose', '#cdFixBox');
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeLessThanOrEqual(r.vh);
      expect(r.closeTop).toBeGreaterThanOrEqual(r.top);
      expect(r.closeBottom).toBeLessThanOrEqual(r.bottom);
      await snap(s, `contrast-${width}x${height}`);
      await page.$eval('#cdlg', (e) => e.scrollTo(0, e.scrollHeight));
      await page.waitForTimeout(150);
      r = await rects(page, '#cdlg', '#cdClose', '#cdFixBox');
      expect(r.lastBottom).toBeLessThanOrEqual(r.bottom + 0.5);
      expect(r.closeTop).toBeGreaterThanOrEqual(r.top - 0.5);
      expect(r.closeBottom).toBeLessThanOrEqual(r.bottom);
      // Corriger is reachable and works from there
      await page.click('#cdFix');
      await settle(page);
      expect((await hexes(page))[3]).toBe('#8B6700');
      await s.context.close();
    });
  }

  it('keyboard focus rules unchanged: opening puts the focus inside, Escape closes and gives it back', async () => {
    const s = await open({ width: 844, height: 390 });
    const { page } = s;
    await page.locator('#exportBtn').focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-f'))).toBe('css');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('exportBtn');
    await s.context.close();
  });
});

describe('toast on phones: never over an open sheet, at most 2 lines at 390 px', () => {
  const phone = { width: 390, height: 844, touch: true } as const;
  const lines = (page: Page) =>
    page.evaluate(() => {
      const span = document.querySelector('#toast span') as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(span);
      const box = (document.getElementById('toast') as HTMLElement).getBoundingClientRect();
      return { n: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size, left: box.left, right: box.right, top: box.top, bottom: box.bottom, vw: innerWidth };
    });

  it('copy from the export sheet: the toast is above the sheet (or at the top), not on it', async () => {
    const s = await open(phone);
    const { page } = s;
    await page.tap('#exportBtn');
    await page.waitForSelector('#xmenu:not([hidden])');
    await page.tap('#xCopy');
    await page.waitForFunction(() => document.getElementById('toast')?.classList.contains('show'));
    await page.waitForTimeout(350);
    const t = await lines(page);
    const sheet = await page.locator('#xmenu').boundingBox();
    expect(sheet).not.toBeNull();
    if (sheet !== null) expect(t.bottom, 'toast above the sheet').toBeLessThanOrEqual(sheet.y + 0.5);
    expect(t.n).toBeLessThanOrEqual(2);
    expect(t.left).toBeGreaterThanOrEqual(0);
    expect(t.right).toBeLessThanOrEqual(t.vw);
    await snap(s, 'phone-toast-sheet');
    await s.context.close();
  });

  it('contrast sheet: the toast of a copy or a link is not on the sheet either', async () => {
    const s = await open(phone);
    const { page } = s;
    await page.tap('.pill[data-pair=accent-fond]');
    await page.waitForSelector('#cdlg:not([hidden])');
    await page.evaluate(() => {
      // a toast is shown while the sheet is open (the share button is behind the sheet: use the page's own toast through a bad hash)
      location.hash = '#v=9&x=1';
    });
    await page.waitForFunction(() => document.getElementById('toast')?.classList.contains('show'));
    await page.waitForTimeout(350);
    const t = await lines(page);
    const sheet = await page.locator('#cdlg').boundingBox();
    if (sheet !== null) expect(t.bottom).toBeLessThanOrEqual(sheet.y + 0.5);
    expect(t.n).toBeLessThanOrEqual(2);
    await s.context.close();
  });

  it('the new messages take at most 2 lines at 390 px, with no sheet open (toast above the dock)', async () => {
    const s = await open(phone);
    const { page } = s;
    for (const role of ROLES) await page.tap(`.sw[data-role=${role}] .sw-lock`);
    await page.tap('#hasard');
    await page.waitForFunction(() => /^Les 7 couleurs/.test(document.querySelector('#toast span')?.textContent ?? ''));
    await page.waitForTimeout(350);
    const t = await lines(page);
    expect(t.n, 'all locked').toBeLessThanOrEqual(2);
    await snap(s, 'phone-toast-all-locked');
    expect(t.right).toBeLessThanOrEqual(t.vw);
    await s.context.close();
  });

  it('the accent toast takes at most 2 lines at 390 px', async () => {
    const s = await open(phone);
    const { page } = s;
    await page.tap('.sw[data-role=accent] .sw-lock');
    await page.fill('#base', '#2e86ab');
    await page.waitForFunction(() => /^Accent mis à jour/.test(document.querySelector('#toast span')?.textContent ?? ''));
    await page.waitForTimeout(350);
    expect((await lines(page)).n).toBeLessThanOrEqual(2);
    await s.context.close();
  });
});

describe('lock buttons: a tooltip on hover and keyboard focus, names unchanged, one polite sentence per change', () => {
  const tip = (page: Page, role: string) =>
    page.evaluate((r) => {
      const el = document.querySelector(`.sw[data-role=${r}] .sw-lock`) as HTMLElement;
      const cs = getComputedStyle(el, '::after');
      return { content: cs.content, opacity: Number(cs.opacity), color: cs.color, background: cs.backgroundColor, display: cs.display };
    }, role);

  it('hover and focus-visible show Verrouiller / Déverrouiller with a readable contrast; the accessible name is the old one', async () => {
    const s = await open();
    const { page } = s;
    await page.mouse.move(5, 5);
    expect((await tip(page, 'fond')).opacity).toBe(0);
    // the hovered swatch widens (0.35 s) and moves its lock: hover the swatch, let it settle, then the lock
    await page.hover('.sw[data-role=fond]');
    await page.waitForTimeout(600);
    await page.hover('.sw[data-role=fond] .sw-lock');
    await page.waitForTimeout(300);
    const t = await tip(page, 'fond');
    expect(t.content).toBe('"Verrouiller"');
    expect(t.opacity).toBe(1);
    expect(ratio(parseCss(t.color), parseCss(t.background))).toBeGreaterThanOrEqual(4.5);
    await snap(s, 'lock-tooltip');
    expect(await page.getAttribute('.sw[data-role=fond] .sw-lock', 'aria-label')).toBe('Verrouiller Fond');
    await page.click('.sw[data-role=fond] .sw-lock');
    await page.waitForTimeout(300);
    expect((await tip(page, 'fond')).content).toBe('"Déverrouiller"');
    expect(await page.getAttribute('.sw[data-role=fond] .sw-lock', 'aria-label')).toBe('Verrouiller Fond');
    expect(await page.getAttribute('.sw[data-role=fond] .sw-lock', 'aria-pressed')).toBe('true');
    // keyboard focus
    await page.mouse.move(5, 5);
    await page.locator('.sw[data-role=texte] .sw-lock').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    expect((await tip(page, 'texte')).opacity).toBe(1);
    await s.context.close();
  });

  it('a lock and an unlock each say one sentence in the live region; a burst says only the last one', async () => {
    const s = await open();
    const { page } = s;
    await lock(page, 'fond').click();
    await page.waitForTimeout(900);
    expect(await live(page)).toBe('Fond verrouillé');
    await lock(page, 'fond').click();
    await page.waitForTimeout(900);
    expect(await live(page)).toBe('Fond déverrouillé');
    await lock(page, 'surface').click();
    await page.waitForTimeout(900);
    expect(await live(page)).toBe('Surface verrouillée');
    // a burst of presses on L: nothing is said until it is quiet, then only the last state
    await page.locator('.sw[data-role=alerte] .sw-copy').focus();
    await page.evaluate(() => {
      const w = window as unknown as { __liveWrites: number };
      w.__liveWrites = 0;
      new MutationObserver(() => w.__liveWrites++).observe(document.getElementById('live') as HTMLElement, { childList: true, characterData: true, subtree: true });
    });
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('l');
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1200);
    const writes = await page.evaluate(() => (window as unknown as { __liveWrites: number }).__liveWrites);
    expect(writes).toBeLessThanOrEqual(2);
    expect(await live(page)).toBe('Alerte verrouillée'); // 5 toggles from unlocked = locked
    await s.context.close();
  });
});

describe('copy on a swatch: the confirmation is a polite live region and its text changes at every click', () => {
  it('«Copié : #…» is written into #toast (role status, aria-live polite, in the accessibility tree) after one click, and again after a second click on the same colour', async () => {
    const s = await open();
    const { page, context } = s;
    await page.evaluate(() => {
      const w = window as unknown as { __toastLog: string[] };
      w.__toastLog = [];
      new MutationObserver(() => w.__toastLog.push(document.querySelector('#toast span')?.textContent ?? '')).observe(document.querySelector('#toast span') as HTMLElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    await page.click('.sw[data-role=fond] .sw-copy');
    await page.waitForFunction(() => /^Copié : #/.test(document.querySelector('#toast span')?.textContent ?? ''));
    expect(await toastText(page)).toBe('Copié : #E7F2EF');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#E7F2EF');
    expect(await page.$eval('#toast', (e) => [e.getAttribute('role'), e.getAttribute('aria-live'), e.hasAttribute('hidden'), e.getAttribute('aria-hidden')])).toEqual(['status', 'polite', false, null]);
    // Chrome's accessibility tree: a status node, live=polite, not ignored, whose text is the confirmation
    const cdp: CDPSession = await context.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: { nodeId: string; ignored?: boolean; role?: { value: string }; name?: { value: string }; childIds?: string[]; properties?: { name: string; value: { value: unknown } }[] }[] };
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const text = (id: string): string => {
      const n = byId.get(id);
      if (n === undefined) return '';
      return (n.role?.value === 'StaticText' ? n.name?.value ?? '' : '') + (n.childIds ?? []).map(text).join('');
    };
    const status = nodes.filter((n) => n.role?.value === 'status' && text(n.nodeId).startsWith('Copié : #'));
    expect(status).toHaveLength(1);
    const props = Object.fromEntries((status[0]?.properties ?? []).map((p) => [p.name, p.value.value]));
    expect(props['live']).toBe('polite');
    expect(status[0]?.ignored).toBe(false);
    // the same colour again: the text node is written again (a new change for the live region)
    const before = await page.evaluate(() => (window as unknown as { __toastLog: string[] }).__toastLog.length);
    await page.waitForTimeout(2200);
    await page.click('.sw[data-role=fond] .sw-copy');
    await page.waitForTimeout(300);
    const log = await page.evaluate(() => (window as unknown as { __toastLog: string[] }).__toastLog);
    expect(log.length).toBeGreaterThan(before);
    expect(log.filter((t) => t === 'Copié : #E7F2EF').length).toBeGreaterThanOrEqual(2);
    expect(s.probe.errors).toEqual([]);
  });
});

describe('the first palette is random at every visit; a link restores one exactly', () => {
  it('200 fresh loads: at least 150 distinct accents, 7 valid roles, the 5 control pairs pass AA (or the failing pair is reported), 0 console error', async () => {
    const s = await open({ hash: '' });
    const { page } = s;
    const accents = new Set<string>();
    const seeds = new Set<string>();
    const failures: string[] = [];
    for (let i = 0; i < 200; i++) {
      if (i > 0) await page.goto(page.url().split('#')[0] ?? '');
      await page.waitForSelector('html.is-ready');
      const got = await page.evaluate(() => ({
        hexes: [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent ?? ''),
        fails: [...document.querySelectorAll('.pill.fail:not(.pill-info)')].map((e) => e.getAttribute('data-pair')),
        hash: location.hash,
        pills: document.querySelectorAll('.pill:not(.pill-info)').length,
      }));
      if (got.hexes.length !== 7 || !got.hexes.every((h) => /^#[0-9A-F]{6}$/.test(h))) failures.push(`#${i} hexes ${got.hexes.join(',')}`);
      if (got.pills !== 5) failures.push(`#${i} pills ${got.pills}`);
      if (got.fails.length > 0) failures.push(`#${i} ${got.hash} échoue : ${got.fails.join(',')}`);
      accents.add(got.hexes[3] ?? '');
      seeds.add(/[#&]s=([0-9a-f]{8})/.exec(got.hash)?.[1] ?? 'none');
    }
    expect(failures).toEqual([]);
    expect(accents.size).toBeGreaterThanOrEqual(150);
    expect(seeds.has('none')).toBe(false);
    console.log(`200 chargements : ${accents.size} accents distincts, ${seeds.size} graines distinctes`);
    expect(s.probe.errors).toEqual([]);
    expect(s.probe.violations).toEqual([]);
  });

  it('a valid link always wins: the fixed link gives the same palette every time; the address of a random one restores it exactly', async () => {
    const a = await open({ hash: FIXED_HASH });
    const b = await open({ hash: FIXED_HASH });
    expect(await hexes(a.page)).toEqual(await hexes(b.page));
    expect((await hexes(a.page))[3]).toBe('#137A6B');
    const r = await open({ hash: '' });
    await settle(r.page);
    const link = await r.page.evaluate(() => location.hash);
    const here = await hexes(r.page);
    const again = await open({ hash: link });
    expect(await hexes(again.page)).toEqual(here);
    const dark = await open({ hash: '', scheme: 'dark' });
    expect(await dark.page.getAttribute('[data-mode=dark]', 'aria-pressed')).toBe('true');
    // a bad link: a fresh random palette and a message (never the old default)
    const bad = await open({ hash: '#v=1&nonsense' });
    expect(await toastText(bad.page)).toMatch(/^Lien invalide/);
    expect(await hexes(bad.page)).not.toEqual(await hexes(a.page));
  });
});

describe('M5: the favicon is inline, no request goes out for it', () => {
  it('one request in all (the document), a data: icon link, no favicon request', async () => {
    const s = await open({ hash: '' });
    const requests: string[] = [];
    s.page.on('request', (r) => requests.push(r.url()));
    await s.page.reload();
    await s.page.waitForSelector('html.is-ready');
    await settle(s.page);
    expect(requests.filter((u) => !u.startsWith('file://') && !u.startsWith('data:'))).toEqual([]);
    expect(requests.filter((u) => /favicon/i.test(u))).toEqual([]);
    expect(await s.page.$$eval('link[rel~=icon]', (els) => els.map((e) => e.getAttribute('href')?.slice(0, 27)))).toEqual(['data:image/svg+xml;base64,P']);
    expect(await s.page.$$eval('link', (els) => els.length)).toBe(1);
    expect(s.probe.violations).toEqual([]);
    expect(s.probe.errors).toEqual([]);
  });
});

describe('axe-core on the new surfaces (every level of violation, not only serious and critical)', () => {
  it('hex error shown, lock tooltip shown, short window with the export sheet scrolled', async () => {
    const s = await open();
    const { page } = s;
    await page.fill('#baseHex', '#2E86ABCDEF');
    await page.keyboard.press('Enter');
    expect((await runAxe(page)).all, 'hex error').toEqual([]);
    await page.keyboard.press('Escape');
    await page.hover('.sw[data-role=fond]');
    await page.waitForTimeout(600);
    await page.hover('.sw[data-role=fond] .sw-lock');
    await page.waitForTimeout(300);
    expect((await runAxe(page)).all, 'tooltip').toEqual([]);
    const short = await open({ width: 844, height: 390 });
    await short.page.click('#exportBtn');
    await short.page.$eval('#xmenu', (e) => e.scrollTo(0, e.scrollHeight));
    await short.page.waitForTimeout(200);
    expect(await short.page.$eval('#xmenu', (e) => e.classList.contains('is-scrolled'))).toBe(true);
    expect((await runAxe(short.page)).all, 'short window, sheet scrolled').toEqual([]);
    await short.page.$eval('#xmenu', (e) => e.scrollTo(0, 0));
    await short.page.waitForTimeout(200);
    expect(await short.page.$eval('#xmenu', (e) => e.classList.contains('is-scrolled'))).toBe(false);
  });
});
