import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { focusedLine, frames, parseCss, pixelsOf, ratio, settle, shotsDir, useBrowser, type Session } from './j6-helpers';

const { open } = useBrowser();

const dockHex = (page: Page): Promise<string[]> => page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
/** Select the whole field without a platform shortcut. */
const selectAll = async (page: Page): Promise<void> => {
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
};
const activeId = (page: Page): Promise<string> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.id || document.activeElement?.tagName.toLowerCase() || '');

/** Tab order of section 6 in the initial state (accessible roles and names as the engine reports them). */
const PILLS = [
  'Texte sur fond : 15,81 sur 1, niveau AAA',
  'Texte sur surface : 17,36 sur 1, niveau AAA',
  'Accent sur fond : 4,55 sur 1, niveau AA',
  'Succès sur surface : 6,66 sur 1, niveau AA',
  'Alerte sur surface : 6,54 sur 1, niveau AA',
  'Accent secondaire sur fond : 5,56 sur 1, indicatif, seuil 3 sur 1, atteint',
];

async function tabSequence(page: Page, max = 40): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const inPage = await page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body);
    if (!inPage) break;
    seen.push(await focusedLine(page));
  }
  return seen;
}

describe('tab order (section 6), accessible names from the engine', () => {
  it('1440 px: skip link, base colour, hex, harmony, Hasard, mode, Partager, Exporter, 6 pills, dock (one stop), lock (one stop), then out of the page', async () => {
    const { page } = await open();
    const seq = await tabSequence(page);
    expect(seq).toEqual([
      'link "Aller à l\'aperçu"',
      'textbox "Choisir la couleur de base"',
      'textbox "Couleur de base, code hexadécimal"',
      'combobox "Harmonie"',
      'button "Hasard"',
      'button "Palette claire" [pressed]',
      'button "Partager"',
      'button "Exporter"',
      ...PILLS.map((n) => `button "${n}"`),
      'button "Fond #E7F2EF, copier le code"',
      'button "Verrouiller Fond"',
    ]);
  });

  it('390 px with touch emulation: the same order without the hex field (hidden under 760 px)', async () => {
    const { page } = await open({ width: 390, height: 844, touch: true });
    const seq = await tabSequence(page);
    expect(seq.length).toBe(15);
    expect(seq[0]).toBe('link "Aller à l\'aperçu"');
    expect(seq[1]).toBe('textbox "Choisir la couleur de base"');
    expect(seq.slice(2, 7)).toEqual(['combobox "Harmonie"', 'button "Hasard"', 'button "Palette claire" [pressed]', 'button "Partager"', 'button "Exporter"']);
    expect(seq.slice(7, 13).map((l) => l.replace(/^button "/, '').split(' : ')[0])).toEqual(['Texte sur fond', 'Texte sur surface', 'Accent sur fond', 'Succès sur surface', 'Alerte sur surface', 'Accent secondaire sur fond']);
    expect(seq.slice(13)).toEqual(['button "Fond #E7F2EF, copier le code"', 'button "Verrouiller Fond"']);
  });

  it('shift+Tab goes back through the same stops; no stop is inside the mock-ups', async () => {
    const { page } = await open();
    const forward = await tabSequence(page);
    // From the last stop, Shift+Tab walks back to the first.
    await page.locator('.sw-lock').first().focus();
    const back: string[] = [await focusedLine(page)];
    for (let i = 0; i < forward.length - 1; i++) {
      await page.keyboard.press('Shift+Tab');
      back.push(await focusedLine(page));
    }
    expect(back.reverse()).toEqual(forward);
    expect(await page.evaluate(() => document.activeElement?.closest('#stage') === null)).toBe(true);
  });
});

describe('keyboard operation (1440 and 390 with touch)', () => {
  for (const mobile of [false, true]) {
    const label = mobile ? '390 touch' : '1440';
    const opts = mobile ? { width: 390, height: 844, touch: true } : {};

    it(`${label}: harmony by the select, Hasard by Space on the body, lock by L, copy by Enter, arrows in the dock`, async () => {
      const s = await open(opts);
      const { page } = s;
      // Harmony: focus the select by Tab, type-ahead picks "Triade".
      await page.locator('#harm').focus();
      await page.keyboard.type('Tri');
      await settle(page);
      expect(await page.$eval('#harm', (e) => (e as HTMLSelectElement).value)).toBe('triad');
      expect(await page.textContent('#metaHarm')).toBe('Triade');
      // Space on the select keeps its own action: no Hasard.
      const before = await dockHex(page);
      await page.keyboard.press('Space');
      await settle(page);
      expect(await dockHex(page)).toEqual(before);
      // Space with the focus on the body: Hasard.
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      expect(await activeId(page)).toBe('body');
      await page.keyboard.press('Space');
      await settle(page);
      const afterHasard = await dockHex(page);
      expect(afterHasard).not.toEqual(before);
      // Space on a button, a link and a field keeps the native action: nothing changes by Hasard.
      for (const sel of ['#share', '#exportBtn', '.skip', '.pill[data-pair=texte-fond]']) {
        await page.locator(sel).focus();
        const h = await dockHex(page);
        await page.keyboard.press('Space');
        await settle(page);
        if (sel === '#exportBtn' || sel.startsWith('.pill')) await page.keyboard.press('Escape');
        expect(await dockHex(page), sel).toEqual(h);
      }
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());

      // Dock: Tab reaches ONE stop, arrows move, L locks and unlocks the focused colour.
      await page.locator('#pills .pill').last().focus();
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.className)).toBe('sw-copy');
      expect(await page.evaluate(() => document.activeElement?.closest('.sw')?.getAttribute('data-role'))).toBe('fond');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      expect(await page.evaluate(() => document.activeElement?.closest('.sw')?.getAttribute('data-role'))).toBe('texte');
      await page.keyboard.press('End');
      expect(await page.evaluate(() => document.activeElement?.closest('.sw')?.getAttribute('data-role'))).toBe('alerte');
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      expect(await page.evaluate(() => document.activeElement?.closest('.sw')?.getAttribute('data-role'))).toBe('surface');
      const lock = page.locator('.sw[data-role=surface] .sw-lock');
      await page.keyboard.press('l');
      await frames(page);
      expect(await lock.getAttribute('aria-pressed')).toBe('true');
      const locked = await dockHex(page);
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      await page.keyboard.press('Space');
      await settle(page);
      expect((await dockHex(page))[1], 'locked surface kept by Hasard').toBe(locked[1]);
      await page.locator('.sw[data-role=surface] .sw-copy').focus();
      await page.keyboard.press('L');
      await frames(page);
      expect(await lock.getAttribute('aria-pressed')).toBe('false');
      // The lock stop: Tab from the colour reaches the lock of the SAME colour; L works there too.
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Verrouiller Surface');
      await page.keyboard.press('l');
      await frames(page);
      expect(await lock.getAttribute('aria-pressed')).toBe('true');
      await page.keyboard.press('ArrowRight');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Verrouiller Texte');
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('l');
      await frames(page);
      expect(await page.locator('.sw[data-role=texte] .sw-lock').getAttribute('aria-pressed')).toBe('true');

      // Enter copies only on a dock colour: the toast says which colour.
      await page.locator('.sw[data-role=accent] .sw-copy').focus();
      const accent = (await dockHex(page))[3] as string;
      await page.keyboard.press('Enter');
      await page.waitForFunction((t) => document.querySelector('#toast')?.textContent === t, `Copié : ${accent}`);
      expect(await page.textContent('#toast')).toBe(`Copié : ${accent}`);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(accent);
      // Enter on Exporter opens the menu and copies nothing.
      await page.evaluate(() => navigator.clipboard.writeText('sentinelle'));
      await page.locator('#exportBtn').focus();
      await page.keyboard.press('Enter');
      expect(await page.isVisible('#xmenu')).toBe(true);
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('sentinelle');
      expect(s.probe.errors).toEqual([]);
      expect(s.probe.violations).toEqual([]);
    });

    it(`${label}: the base is changed from the keyboard (hex field + Enter at 1440, colour input under 760 px)`, async () => {
      const { page } = await open(opts);
      if (!mobile) {
        await page.locator('#baseHex').focus();
        await selectAll(page);
        await page.keyboard.type('336699');
        await page.keyboard.press('Enter');
        await settle(page);
        expect((await dockHex(page))[3]).toBe('#336699');
        // invalid code: aria-invalid, nothing else changes
        await page.locator('#baseHex').focus();
        await selectAll(page);
        await page.keyboard.type('zzz');
        await page.keyboard.press('Enter');
        expect(await page.getAttribute('#baseHex', 'aria-invalid')).toBe('true');
        expect(await page.textContent('#baseErr')).toMatch(/invalide/);
        expect((await dockHex(page))[3]).toBe('#336699');
        // Space inside the field types a space (no Hasard), a valid code clears aria-invalid
        await selectAll(page);
        await page.keyboard.type('00AA55');
        await page.keyboard.press('Enter');
        expect(await page.getAttribute('#baseHex', 'aria-invalid')).toBeNull();
      } else {
        expect(await page.isVisible('#baseHex')).toBe(false);
        await page.locator('#base').focus();
        await page.fill('#base', '#336699');
        await settle(page);
        expect((await dockHex(page))[3]).toBe('#336699');
      }
    });

    it(`${label}: export menu and contrast dialog by keyboard; focus returns to the opener (Esc, close button, another dialog)`, async () => {
      const { page } = await open(opts);
      // Export: Enter opens, focus on the active format, Esc returns to Exporter.
      await page.locator('#exportBtn').focus();
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('CSS');
      await page.keyboard.press('Escape');
      expect(await activeId(page)).toBe('exportBtn');
      expect(await page.isVisible('#xmenu')).toBe(false);
      // Close button (Enter on it): focus back on Exporter.
      await page.keyboard.press('Enter');
      await page.locator('#xClose').focus();
      await page.keyboard.press('Enter');
      expect(await page.isVisible('#xmenu')).toBe(false);
      expect(await activeId(page)).toBe('exportBtn');
      // Contrast dialog: Enter on a pill opens it, Esc returns to the pill.
      const pill = page.locator('.pill[data-pair=accent-fond]');
      await pill.focus();
      await page.keyboard.press('Enter');
      expect(await page.isVisible('#cdlg')).toBe(true);
      expect(['cdClose', 'cdFix', 'cdFixBg']).toContain(await activeId(page));
      await page.keyboard.press('Escape');
      expect(await page.isVisible('#cdlg')).toBe(false);
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-pair'))).toBe('accent-fond');
      // Close button of the contrast dialog.
      await page.keyboard.press('Enter');
      await page.locator('#cdClose').focus();
      await page.keyboard.press('Enter');
      expect(await page.isVisible('#cdlg')).toBe(false);
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-pair'))).toBe('accent-fond');
      // Opening another dialog: the export menu closes, the focus moves into the new one (never lost to the body).
      await page.locator('#exportBtn').focus();
      await page.keyboard.press('Enter');
      await pill.focus();
      await page.keyboard.press('Enter');
      expect(await page.isVisible('#xmenu')).toBe(false);
      expect(await page.isVisible('#cdlg')).toBe(true);
      expect(await page.evaluate(() => document.activeElement?.closest('#cdlg') !== null)).toBe(true);
      expect(await page.getAttribute('#exportBtn', 'aria-expanded')).toBe('false');
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-pair'))).toBe('accent-fond');
      // ... and the other way round.
      await page.keyboard.press('Enter');
      await page.locator('#exportBtn').focus();
      await page.keyboard.press('Enter');
      expect(await page.isVisible('#cdlg')).toBe(false);
      expect(await page.evaluate(() => document.activeElement?.closest('#xmenu') !== null)).toBe(true);
      expect(await page.getAttribute('.pill[data-pair=accent-fond]', 'aria-expanded')).toBe('false');
      await page.keyboard.press('Escape');
      expect(await activeId(page)).toBe('exportBtn');
      // Esc with nothing open does nothing (and moves nothing).
      await page.keyboard.press('Escape');
      expect(await activeId(page)).toBe('exportBtn');
    });

    it(`${label}: no keyboard trap: with each dialog open, Tab leaves it and the cycle comes back to the start`, async () => {
      const { page } = await open(opts);
      for (const opener of ['export', 'contrast', 'none'] as const) {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        if (opener === 'export') {
          await page.locator('#exportBtn').focus();
          await page.keyboard.press('Enter');
        } else if (opener === 'contrast') {
          await page.locator('.pill[data-pair=accent-fond]').focus();
          await page.keyboard.press('Enter');
        }
        const seen: string[] = [];
        let left = false;
        for (let i = 0; i < 60; i++) {
          await page.keyboard.press('Tab');
          const state = await page.evaluate(() => {
            const a = document.activeElement;
            if (a === null || a === document.body) return 'out';
            return `${a.id || a.className || a.tagName}|${a.closest('#xmenu, #cdlg') !== null ? 'in' : 'page'}`;
          });
          if (state === 'out') {
            left = true;
            break;
          }
          seen.push(state);
        }
        expect(left, `${opener}: focus leaves the page cycle`).toBe(true);
        expect(seen.length, opener).toBeGreaterThan(opener === 'none' ? 14 : 3);
        expect(seen.length, opener).toBeLessThan(45);
        // A page stop comes after the dialog's stops: the dialog does not hold the focus.
        if (opener !== 'none') {
          expect(seen.some((x) => x.endsWith('|in')), opener).toBe(true);
          // Under 760 px the dock is hidden while a sheet is open (it would sit behind it): the cycle ends after the sheet.
          if (!mobile) expect(seen.some((x) => x.endsWith('|page') && x.startsWith('sw-')), opener).toBe(true);
          await page.keyboard.press('Escape');
        }
      }
    });
  }

  it('Esc after Tab left the open dialog: closes it and gives the focus to the opener (documented behaviour)', async () => {
    const { page } = await open();
    await page.locator('#exportBtn').focus();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('#xmenu') === null)).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.isVisible('#xmenu')).toBe(false);
    expect(await activeId(page)).toBe('exportBtn');
  });
});

/** Focus ring: colour read from the page, then the pixels around the focused element (above its top edge, centre). */
async function ringChecks(s: Session, helper: Page, label: string): Promise<string[]> {
  const { page } = s;
  const problems: string[] = [];
  const vw = page.viewportSize()?.width ?? 1440;
  const info = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const host = el.id === 'baseHex' ? (el.closest('.chip-base') as HTMLElement) : el;
    const cs = getComputedStyle(host);
    const r = host.getBoundingClientRect();
    return { outline: cs.outlineColor, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset), left: r.left, top: r.top, w: r.width };
  });
  if (info.style === 'none' || info.width < 2) return [`${label}: pas d'anneau (${info.style} ${info.width})`];
  const cx = Math.round(Math.min(Math.max(info.left + info.w / 2, 4), vw - 4, info.left + info.w - 4));
  const top = Math.round(info.top);
  const png = await page.screenshot({ clip: { x: cx, y: top - 9, width: 1, height: 9 } });
  // rows: index i is y = top - 9 + i, so "k px above the edge" is row 9 - k
  const px = await pixelsOf(helper, png, [1, 2, 3, 4, 5, 6, 7, 8].map((k) => [0, 9 - k] as [number, number]));
  const at = (k: number) => px[k - 1] as [number, number, number];
  const computed = parseCss(info.outline);
  const distance = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - (b[i] as number))));
  // The stroke occupies [offset, offset + width) above the edge (box-shadow ring in [0, offset)).
  // The stroke occupies [offset, offset + width) above the edge; the edge can sit between two pixel rows, so three rows are read.
  const strokeRows = [info.offset + 1, info.offset + 2, info.offset + 3].map((k) => Math.round(k));
  const nearest = Math.min(...strokeRows.map((k) => distance(at(k), computed)));
  if (nearest > 60) problems.push(`${label}: aucun pixel de l'anneau proche de la couleur calculée ${computed} (écart ${nearest})`);
  // Contrast of the computed ring colour against what the engine paints just inside (box-shadow ring) and just outside it.
  const around = [at(1), at(Math.round(info.offset + info.width + 2)), at(Math.round(info.offset + info.width + 3))];
  const worst = Math.min(...around.map((c) => ratio(computed, c)));
  if (worst < 3) problems.push(`${label}: anneau ${worst.toFixed(2)}:1 contre son entourage`);
  return problems;
}

describe('focus ring >= 3:1 on every stop, light and dark (pixels read from the engine)', () => {
  for (const [scheme, width, touch] of [
    ['light', 1440, false],
    ['dark', 1440, false],
    ['light', 390, true],
    ['dark', 390, true],
  ] as const) {
    it(`${scheme}, ${width} px: bar, pills, dock, then both dialogs`, async () => {
      const s = await open({ scheme, width, height: width === 390 ? 844 : 900, touch });
      const helper = await s.context.newPage();
      await helper.goto('about:blank');
      await s.page.bringToFront();
      const { page } = s;
      const problems: string[] = [];
      let n = 0;
      const stops = async (label: string, count: number) => {
        for (let i = 0; i < count; i++) {
          await page.keyboard.press('Tab');
          await page.waitForTimeout(40);
          n++;
          problems.push(...(await ringChecks(s, helper, `${label} #${i + 1} ${await focusedLine(page)}`)));
        }
      };
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await stops('barre', width === 390 ? 15 : 16);
      // Export menu stops
      await page.locator('#exportBtn').focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(60);
      problems.push(...(await ringChecks(s, helper, `menu: format ${await focusedLine(page)}`)));
      n++;
      await stops('menu', 5);
      await page.keyboard.press('Escape');
      // Contrast dialog (yellow base to get the Corriger button), stops inside it
      if (width === 1440) {
        await page.locator('#baseHex').focus();
        await selectAll(page);
        await page.keyboard.type('E0A800');
        await page.keyboard.press('Enter');
      } else await page.fill('#base', '#e0a800');
      await settle(page);
      await page.locator('.pill[data-pair=accent-fond]').focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(60);
      problems.push(...(await ringChecks(s, helper, `fenêtre: ${await focusedLine(page)}`)));
      n++;
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(40);
      problems.push(...(await ringChecks(s, helper, `fenêtre: ${await focusedLine(page)}`)));
      n++;
      expect(n).toBeGreaterThan(20);
      expect(problems).toEqual([]);
      if (shotsDir !== null) await page.screenshot({ path: `${shotsDir}/ring-${scheme}-${width}.png` });
    });
  }
});
