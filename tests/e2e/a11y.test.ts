import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { fourColours, openImageSheet, outcome, pick, png } from './image-helpers';
import { parseCss, runAxe, settle, shotsDir, useBrowser, type OpenOptions } from './j6-helpers';

const { open } = useBrowser();

describe('axe-core: 20 states (system theme x [export menu | contrast dialog | history sheet | empty image sheet | image sheet with candidates] x [1440 | 390]), decor in the accessibility tree', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const what of ['export', 'contrast', 'history', 'image-empty', 'image-cards'] as const) {
      for (const [width, height, touch] of [[1440, 900, false], [390, 844, true]] as const) {
        it(`${scheme}, ${what} open, ${width} px: 0 serious or critical violation`, async () => {
          const s = await open({ scheme, width, height, touch });
          const { page } = s;
          if (what === 'history') {
            // Three favourites and four recents, so the rows, the strips and the stars are all in the page.
            for (let i = 0; i < 3; i++) {
              await page.keyboard.press('Space');
              await page.waitForTimeout(500);
            }
            await page.click('#histBtn');
            for (const i of [0, 1, 2]) await page.locator('#hRec .hstar').nth(i).click();
          } else if (what === 'export') await page.click('#exportBtn');
          else if (what === 'image-empty') await openImageSheet(page);
          else if (what === 'image-cards') {
            await openImageSheet(page);
            await pick(page, png('four.png', fourColours()));
            expect((await outcome(page)).cards).toBeGreaterThanOrEqual(3);
          } else await page.click('.pill[data-pair=accent-fond]');
          await settle(page);
          expect(await page.isVisible(what === 'export' ? '#xmenu' : what === 'history' ? '#hmenu' : what.startsWith('image') ? '#imenu' : '#cdlg')).toBe(true);
          if (what === 'history') expect(await page.locator('#hRec .hitem').count()).toBeGreaterThan(2);
          expect(await page.$eval('#stageWrap', (e) => (e as HTMLElement).inert)).toBe(false);
          const r = await runAxe(page);
          console.log(`axe ${scheme} ${what} ${width}: violations=${JSON.stringify(r.all)} incomplete=${JSON.stringify(r.incomplete)}`);
          expect(r.serious).toEqual([]);
          expect(s.probe.errors).toEqual([]);
          expect(s.probe.violations).toEqual([]);
        });
      }
    }
  }

  it('extra states with a failing base (#E0A800, the decor shows an accent that fails): 0 serious in the whole page at 1440 and 390, both themes', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const [width, height, touch] of [[1440, 900, false], [390, 844, true]] as const) {
        const { page } = await open({ scheme, width, height, touch });
        await page.fill(width === 1440 ? '#baseHex' : '#base', width === 1440 ? '#E0A800' : '#e0a800');
        if (width === 1440) await page.keyboard.press('Enter');
        await settle(page);
        const r = await runAxe(page);
        expect(r.serious, `${scheme} ${width}`).toEqual([]);
      }
    }
  });
});

describe('axe-core: the image sheet with an error message and with the drag-over state, both themes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`${scheme}: 0 serious or critical violation`, async () => {
      const { page, probe } = await open({ scheme });
      await openImageSheet(page);
      await pick(page, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
      expect((await outcome(page)).message).toMatch(/n'est pas une image/);
      const err = await runAxe(page);
      expect(err.serious, 'error state').toEqual([]);
      await page.evaluate(() => document.getElementById('iDrop')?.classList.add('is-over'));
      const over = await runAxe(page);
      expect(over.serious, 'drag-over state').toEqual([]);
      expect(probe.errors).toEqual([]);
    });
  }
});

describe('mock-ups in the accessibility tree (J3b reserve): no inert, no focusable descendant, img + short French label', () => {
  it('is proved by the DOM, by Tab and by the Chrome accessibility tree (CDP)', async () => {
    for (const width of [1440, 390]) {
      const s = await open({ width, height: width === 1440 ? 900 : 844, touch: width === 390 });
      const { page, context } = s;
      const dom = await page.evaluate(() => {
        const stage = document.querySelector('#stage') as HTMLElement;
        const focusable = stage.querySelectorAll('a, button, input, select, textarea, summary, iframe, [tabindex], [contenteditable], [role=button], [role=link], [role=checkbox], [role=textbox], [role=menuitem]');
        const inert = [...stage.querySelectorAll('*'), stage, document.querySelector('#stageWrap'), document.querySelector('#scene')].filter((e) => (e as HTMLElement).inert || e?.hasAttribute('inert'));
        const aria = [...stage.querySelectorAll('[aria-hidden=true]')].filter((e) => e.closest('[role=img]') === null).length;
        return {
          focusable: focusable.length,
          inert: inert.length,
          hiddenInDecor: aria,
          imgs: [...stage.querySelectorAll('[role=img]')].map((e) => ({ label: e.getAttribute('aria-label') ?? '', nested: e.querySelectorAll('[role=img]').length })),
          lang: document.documentElement.lang,
        };
      });
      expect(dom.focusable).toBe(0);
      expect(dom.inert).toBe(0);
      expect(dom.imgs.map((i) => i.label)).toEqual(["Aperçu : page d'accueil d'un site", 'Aperçu : tableau de bord', "Aperçu : écran d'application mobile"]);
      for (const i of dom.imgs) {
        expect(i.label.length).toBeLessThan(45);
        expect(i.nested).toBe(0);
      }
      // Tab never enters the decor, a full lap in both directions.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      let visited = 0;
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        const state = await page.evaluate(() => ({ body: document.activeElement === document.body, inStage: document.activeElement?.closest('#stageWrap') != null }));
        expect(state.inStage).toBe(false);
        if (state.body) break;
        visited++;
      }
      expect(visited).toBeGreaterThan(10);
      // Chrome's own tree: three "image" nodes with these names, not ignored (inert used to remove them).
      const cdp = await context.newCDPSession(page);
      await cdp.send('Accessibility.enable');
      const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: { role?: { value: string }; name?: { value: string }; ignored?: boolean }[] };
      const images = nodes.filter((n) => n.role?.value === 'image' && n.ignored !== true).map((n) => n.name?.value);
      expect(images).toEqual(dom.imgs.map((i) => i.label));
    }
  });
});

describe('landmarks, headings, names, roles and states', () => {
  it('lang, landmarks, one h1, heading order, names of the main controls (aria snapshot and Chrome tree)', async () => {
    const { page, context } = await open();
    expect(await page.getAttribute('html', 'lang')).toBe('fr');
    expect(await page.title()).toBe('Huezz : générateur de palettes');
    // Open both dialogs in turn so that their headings are in the page when read.
    const headings = async () => page.evaluate(() => [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => (h as HTMLElement).offsetParent !== null || h.closest('[hidden]') === null).map((h) => [Number(h.tagName[1]), h.textContent?.trim() ?? '']));
    expect(await headings()).toEqual([[1, 'Huezz'], [2, 'Argile turquoise'], [3, 'Cultive ton quartier, une parcelle à la fois.']]);
    await page.click('#exportBtn');
    await page.keyboard.press('Escape');
    await page.click('.pill[data-pair=accent-fond]');
    await page.waitForTimeout(100);
    const all = await page.evaluate(() => [...document.querySelectorAll('h1, h2, h3')].map((h) => [Number(h.tagName[1]), h.closest('[hidden]') !== null ? 'caché' : 'visible']));
    expect(all.filter((h) => h[0] === 1)).toHaveLength(1);
    // Document order never jumps down by more than one level.
    const levels = all.map((h) => h[0] as number);
    for (let i = 1; i < levels.length; i++) expect((levels[i] as number) - (levels[i - 1] as number)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');

    const snap = await page.locator('body').ariaSnapshot();
    for (const line of [
      '- banner:',
      '  - heading "Huezz" [level=1]',
      '- main:',
      '  - heading "Argile turquoise" [level=2]',
      '    - textbox "Couleur de base, code hexadécimal": "#137A6B"',
      '    - combobox "Harmonie":',
      '    - button "Hasard"',
      '    - group "Mode de la palette":',
      '      - button "Palette claire" [pressed]',
      '      - button "Palette sombre"',
      '  - button "Partager"',
      '  - button "Exporter"',
      '  - group "Contraste WCAG":',
      '- \'region "Palette : clique une couleur pour copier son code"\':',
      '      - button "Verrouiller Fond"',
    ]) expect(snap, line).toContain(line.trim().replace(/^- /, '').replace(/^'/, ''));
    expect(snap).toMatch(/- banner:/);
    expect(snap).toMatch(/- main:/);
    expect(snap.match(/heading "[^"]*" \[level=1\]/g)).toHaveLength(1);
    expect(snap.match(/button "Verrouiller [^"]+"/g)).toHaveLength(7);
    expect(snap.match(/button "[^"]+ #[0-9A-F]{6}, copier le code"/g)).toHaveLength(7);
    expect(snap.match(/button "[^"]+ : [\d,]+ sur 1, /g)).toHaveLength(6);

    // Chrome's accessibility tree: landmarks, states.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    type AxNode = { role?: { value: string }; name?: { value: string }; ignored?: boolean; properties?: { name: string; value: { value: unknown } }[] };
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: AxNode[] };
    const live = nodes.filter((n) => n.ignored !== true).map((n) => ({ role: n.role?.value, name: n.name?.value, props: Object.fromEntries((n.properties ?? []).map((p) => [p.name, p.value.value])) }));
    expect(live.filter((n) => n.role === 'banner')).toHaveLength(1);
    expect(live.filter((n) => n.role === 'main')).toHaveLength(1);
    const pressed = live.filter((n) => n.role === 'button' && n.props.pressed !== undefined).map((n) => `${n.name}=${n.props.pressed}`);
    expect(pressed).toContain('Palette claire=true');
    expect(pressed).toContain('Palette sombre=false');
    expect(pressed.filter((p) => p.startsWith('Verrouiller'))).toHaveLength(7);
    expect(live.filter((n) => n.role === 'status' && n.props.live === 'polite').length).toBeGreaterThanOrEqual(3);
    const combos = live.filter((n) => n.role === 'combobox').map((n) => n.name ?? '');
    expect(combos).toContain('Harmonie');
    // the visible label is drawn in capitals by CSS and Chrome's name keeps the capitals; the aria snapshot (keyboard.test.ts) says «Vision»
    expect(combos.map((n) => n.toLowerCase()).sort()).toEqual(['harmonie', 'vision']);
    const expanded = live.filter((n) => n.role === 'button' && (n.name === 'Exporter' || /^Texte sur fond/.test(n.name ?? ''))).map((n) => [n.props.expanded, n.props.hasPopup]);
    expect(expanded).toEqual([[false, 'dialog'], [false, 'dialog']]);
  });

  it('dialogs are named and labelled, non modal; the toast and the live region are polite', async () => {
    const { page } = await open();
    await page.click('#exportBtn');
    expect(await page.$eval('#xmenu', (e) => [e.getAttribute('role'), e.getAttribute('aria-modal'), document.getElementById(e.getAttribute('aria-labelledby') ?? '')?.textContent])).toEqual(['dialog', null, 'Exporter']);
    expect(await page.getAttribute('#xClose', 'aria-label')).toBe("Fermer l'export");
    expect(await page.getAttribute('#xFormats', 'role')).toBe('radiogroup');
    expect(await page.$$eval('#xFormats [role=radio]', (els) => els.map((e) => e.getAttribute('aria-checked')))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    await page.keyboard.press('Escape');
    await page.click('.pill[data-pair=accent-fond]');
    expect(await page.$eval('#cdlg', (e) => [e.getAttribute('role'), e.getAttribute('aria-modal'), document.getElementById(e.getAttribute('aria-labelledby') ?? '')?.textContent])).toEqual(['dialog', null, 'Accent sur fond']);
    expect(await page.getAttribute('#cdClose', 'aria-label')).toBe('Fermer le détail du contraste');
    expect(await page.$eval('#toast', (e) => [e.getAttribute('role'), e.getAttribute('aria-live')])).toEqual(['status', 'polite']);
    expect(await page.$eval('#live', (e) => [e.getAttribute('role'), e.getAttribute('aria-live'), e.getAttribute('aria-atomic'), e.classList.contains('sr'), e.hasAttribute('aria-hidden')])).toEqual(['status', 'polite', 'true', true, false]);
  });

  it('aria-pressed follows lock and mode, aria-invalid follows the hex field', async () => {
    const { page } = await open();
    const lock = page.locator('.sw[data-role=accent] .sw-lock');
    expect(await lock.getAttribute('aria-pressed')).toBe('false');
    await lock.click();
    await settle(page);
    expect(await lock.getAttribute('aria-pressed')).toBe('true');
    expect(await lock.getAttribute('aria-label')).toBe('Verrouiller Accent');
    await page.click('[data-mode=dark]');
    await settle(page);
    expect(await page.$$eval('.seg button', (els) => els.map((e) => e.getAttribute('aria-pressed')))).toEqual(['false', 'true']);
    expect(await page.$$eval('.seg button', (els) => els.map((e) => (e as HTMLButtonElement).tabIndex))).toEqual([-1, 0]);
    await page.fill('#baseHex', 'zzz');
    await page.keyboard.press('Enter');
    expect(await page.getAttribute('#baseHex', 'aria-invalid')).toBe('true');
    expect(await page.getAttribute('#baseHex', 'aria-describedby')).toBe('baseErr');
    expect(await page.textContent('#baseErr')).toMatch(/Code invalide/);
    await page.fill('#baseHex', '#336699');
    await page.keyboard.press('Enter');
    expect(await page.getAttribute('#baseHex', 'aria-invalid')).toBeNull();
    expect(await page.textContent('#baseErr')).toBe('');
  });
});

describe('live region: one short sentence per burst of changes', () => {
  async function record(page: Page): Promise<void> {
    await page.evaluate(() => {
      const w = window as unknown as { __live: string[] };
      w.__live = [];
      new MutationObserver(() => w.__live.push((document.querySelector('#live') as HTMLElement).textContent ?? '')).observe(document.querySelector('#live') as Node, { childList: true, characterData: true, subtree: true });
    });
  }
  const log = (page: Page) => page.evaluate(() => (window as unknown as { __live: string[] }).__live.map((t) => t.replace(/ /g, '')));

  it('20 rapid Hasard presses: at most 2 announcements, the last says the final palette', async () => {
    const { page } = await open();
    await record(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 20; i++) await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    await settle(page);
    const said = await log(page);
    expect(said.length).toBeGreaterThanOrEqual(1);
    expect(said.length).toBeLessThanOrEqual(2);
    const accent = (await page.textContent('.sw[data-role=accent] .sw-hex')) as string;
    const aa = (await page.textContent('#metaAa')) as string;
    const [ok, total] = aa.split('/');
    const title = (await page.textContent('.scene-title')) as string;
    expect(said[said.length - 1]).toBe(`Nouvelle palette : ${title}, accent ${accent}, ${ok} sur ${total} contrastes AA`);
    expect((said[said.length - 1] as string).length).toBeLessThan(80);
  });

  it('harmony, mode, base and lock each say one sentence; copy says nothing here (the toast does, see j9.test.ts)', async () => {
    const { page } = await open();
    await record(page);
    const sayings = async () => {
      await page.waitForTimeout(1000);
      return log(page);
    };
    await page.selectOption('#harm', 'triad');
    await settle(page);
    let said = await sayings();
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^Harmonie triade : \p{Lu}\p{Ll}+ \p{Ll}+, accent #[0-9A-F]{6}, \d sur 5 contrastes AA$/u);
    await page.click('[data-mode=dark]');
    await settle(page);
    said = await sayings();
    expect(said).toHaveLength(2);
    expect(said[1]).toMatch(/^Palette sombre : \p{Lu}\p{Ll}+ \p{Ll}+, accent #[0-9A-F]{6}, \d sur 5 contrastes AA$/u);
    await page.fill('#baseHex', '#336699');
    await page.keyboard.press('Enter');
    await settle(page);
    said = await sayings();
    expect(said).toHaveLength(3);
    expect(said[2]).toMatch(/^Couleur de base appliquée : \p{Lu}\p{Ll}+ \p{Ll}+, accent #[0-9A-F]{6}, \d sur 5 contrastes AA$/u);
    await page.click('.sw[data-role=fond] .sw-lock');
    await settle(page);
    said = await sayings();
    expect(said).toHaveLength(4);
    expect(said[3]).toBe('Fond verrouillé');
    await page.locator('.sw-copy').first().click();
    await settle(page);
    said = await sayings();
    expect(said).toHaveLength(4);
    expect(await page.textContent('#toast')).toMatch(/^Copié : #/);
  });

  it('nothing is announced at load', async () => {
    const { page } = await open();
    await record(page);
    await page.waitForTimeout(1200);
    expect(await log(page)).toEqual([]);
    expect(await page.textContent('#live')).toBe('');
  });
});

describe('prefers-reduced-motion', () => {
  it('no fade, no stagger, no transition when reduced; both happen when not reduced (same actions)', async () => {
    for (const reduced of [true, false]) {
      const { page } = await open({ reducedMotion: reduced });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Space');
      const during = await page.evaluate(
        () =>
          new Promise<{ animations: number; t: string; viewTransition: boolean; btnTransition: string; toastTransition: string; swatchTransition: string; fadeSample: string | null }>((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const cs = getComputedStyle(document.documentElement);
                resolve({
                  animations: document.getAnimations().length,
                  t: cs.getPropertyValue('--t').trim(),
                  viewTransition: document.documentElement.classList.contains('vt'),
                  btnTransition: getComputedStyle(document.querySelector('#hasard') as Element).transitionDuration,
                  toastTransition: getComputedStyle(document.querySelector('#toast') as Element).transitionDuration,
                  swatchTransition: getComputedStyle(document.querySelector('.sw') as Element).transitionDuration,
                  fadeSample: null,
                });
              }),
            ),
          ),
      );
      if (reduced) {
        expect(during.animations).toBe(0);
        expect(during.t).toBe('0s');
        expect(during.viewTransition).toBe(false);
        expect(during.btnTransition).toBe('0s');
        expect(during.toastTransition).toBe('0s');
        expect(during.swatchTransition).toBe('0s');
      } else {
        expect(during.animations).toBeGreaterThan(0);
        // Hasard is a view transition now: the colour variables change at once (--t is 0 meanwhile) and come back to .3 s when it is over.
        expect(during.viewTransition).toBe(true);
        expect(during.btnTransition).not.toBe('0s');
        await page.waitForFunction(() => !document.documentElement.classList.contains('vt'));
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t').trim())).toBe('.3s');
      }
    }
  });

  it('with reduced motion the new palette is on screen at once (no intermediate colour)', async () => {
    const { page } = await open({ reducedMotion: true });
    const before = await page.$eval('.sw[data-role=accent]', (e) => getComputedStyle(e).backgroundColor);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await page.waitForFunction((b) => getComputedStyle(document.querySelector('.sw[data-role=accent]') as Element).backgroundColor !== b, before);
    const a = await page.$eval('.sw[data-role=accent]', (e) => getComputedStyle(e).backgroundColor);
    // Read at once, then again later: the same colour, and the mock-ups already show it.
    expect(await page.$eval('.m-site .m-btn', (e) => getComputedStyle(e).backgroundColor)).toBe(a);
    await page.waitForTimeout(150);
    expect(await page.$eval('.sw[data-role=accent]', (e) => getComputedStyle(e).backgroundColor)).toBe(a);
  });
});

describe('forced-colors: active (Windows high contrast)', () => {
  const highlight = async (page: Page): Promise<string> =>
    page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'Highlight';
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });

  for (const [width, touch] of [[1440, false], [390, true]] as const) {
    it(`${width} px: focus ring, borders, selected states and palette colours stay visible`, async () => {
      const opts: OpenOptions = { width, height: width === 1440 ? 900 : 844, touch, forcedColors: true };
      const s = await open(opts);
      const { page } = s;
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
      const hl = parseCss(await highlight(page));
      // Selected mode button: Highlight background.
      const mode = await page.$eval('.seg button[aria-pressed=true]', (e) => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color }));
      expect(parseCss(mode.bg)).toEqual(hl);
      expect(mode.fg).not.toBe(mode.bg);
      // Borders: buttons, select, pills, dock swatches keep a visible border.
      for (const sel of ['#share', '#exportBtn', '#harm', '.pill', '.sw[data-role=fond]', '.dock']) {
        const b = await page.$eval(sel, (e) => ({ w: parseFloat(getComputedStyle(e).borderTopWidth), style: getComputedStyle(e).borderTopStyle }));
        expect(b.w, sel).toBeGreaterThanOrEqual(1);
        expect(b.style, sel).toBe('solid');
      }
      // Palette colours are kept (swatches, decor).
      const palette = await page.evaluate(() => ({ sw: getComputedStyle(document.querySelector('.sw[data-role=accent]') as Element).backgroundColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), site: getComputedStyle(document.querySelector('.m-btn') as Element).backgroundColor }));
      expect(palette.sw).toBe(palette.site);
      expect(parseCss(palette.sw)).toEqual([0x13, 0x7a, 0x6b]);
      // Focus ring: solid, >= 2 px, Highlight.
      for (let i = 0; i < (width === 1440 ? 4 : 3); i++) await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('harm');
      const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement as Element); return { style: cs.outlineStyle, w: parseFloat(cs.outlineWidth), c: cs.outlineColor }; });
      expect(ring.style).toBe('solid');
      expect(ring.w).toBeGreaterThanOrEqual(2);
      expect(parseCss(ring.c)).toEqual(hl);
      // Lock state: pressed lock is not drawn with colour only (padlock closed + outline).
      await page.click('.sw[data-role=surface] .sw-lock');
      await settle(page);
      const lock = await page.$eval('.sw[data-role=surface]', (e) => ({ closed: getComputedStyle(e.querySelector('.i-lock') as Element).display, open: getComputedStyle(e.querySelector('.i-unlock') as Element).display, outline: getComputedStyle(e.querySelector('.sw-lock') as Element).outlineStyle }));
      expect(lock).toEqual({ closed: 'block', open: 'none', outline: 'solid' });
      // Failing pill: Highlight background (state not carried by colour alone: icon + text "Échec").
      await page.fill(width === 1440 ? '#baseHex' : '#base', width === 1440 ? '#E0A800' : '#e0a800');
      if (width === 1440) await page.keyboard.press('Enter');
      await settle(page);
      const fail = await page.$eval('.pill.fail', (e) => ({ bg: getComputedStyle(e).backgroundColor, icon: getComputedStyle(e.querySelector('.i-warn') as Element).display }));
      expect(parseCss(fail.bg)).toEqual(hl);
      expect(fail.icon).toBe('block');
      await page.click('.pill[data-pair=accent-fond]');
      await settle(page);
      if (shotsDir !== null) await page.screenshot({ path: `${shotsDir}/j6-forced-${width}.png` });
      await page.keyboard.press('Escape');
      await page.click('#exportBtn');
      if (shotsDir !== null) await page.screenshot({ path: `${shotsDir}/j6-forced-${width}-export.png` });
      expect(s.probe.errors).toEqual([]);
    });
  }
});

describe('dialogs never cover the contrast pills; dark "Fond" swatch keeps its edge', () => {
  const overlaps = (page: Page, dialog: string) =>
    page.evaluate((id) => {
      const d = (document.querySelector(id) as HTMLElement).getBoundingClientRect();
      const out: string[] = [];
      for (const p of document.querySelectorAll<HTMLElement>('#pills .pill, #pills')) {
        const r = p.getBoundingClientRect();
        if (r.width > 0 && d.left < r.right && d.right > r.left && d.top < r.bottom && d.bottom > r.top) out.push(p.getAttribute('data-pair') ?? 'groupe');
      }
      return out;
    }, dialog);

  for (const [width, height, touch] of [[1440, 900, false], [1280, 720, false], [1100, 800, false], [980, 800, false], [800, 900, false], [390, 844, true]] as const) {
    it(`${width} px: neither the export menu nor the contrast dialog (for each of the 6 pills) overlaps the pills`, async () => {
      const { page } = await open({ width, height, touch });
      await page.click('#exportBtn');
      await settle(page);
      expect(await overlaps(page, '#xmenu'), 'export').toEqual([]);
      await page.keyboard.press('Escape');
      for (const id of ['texte-fond', 'texte-surface', 'accent-fond', 'succes-surface', 'alerte-surface', 'accent2-fond']) {
        await page.locator(`.pill[data-pair=${id}]`).click();
        await settle(page);
        expect(await overlaps(page, '#cdlg'), id).toEqual([]);
        const r = await page.$eval('#cdlg', (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom, innerWidth, innerHeight]; });
        expect(r[0] as number).toBeGreaterThanOrEqual(0);
        expect(r[2] as number).toBeLessThanOrEqual(r[4] as number);
        expect(r[3] as number).toBeLessThanOrEqual(r[5] as number);
        await page.keyboard.press('Escape');
      }
    });
  }

  it('the menu follows the pills when the page scrolls and when the window is resized (1440 -> 1100)', async () => {
    const { page } = await open({ width: 1440, height: 700 });
    await page.click('#exportBtn');
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.waitForTimeout(200);
    expect(await overlaps(page, '#xmenu')).toEqual([]);
    expect(await page.$eval('#xmenu', (e) => e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(700);
  });

  for (const [width, touch] of [[1440, false], [390, true]] as const) {
    it(`dark theme, ${width} px: the Fond swatch keeps its 3:1 edge (inset line) against the dark tool`, async () => {
      const { page } = await open({ scheme: 'dark', width, height: width === 1440 ? 900 : 844, touch });
      const shadow = await page.$eval('.sw[data-role=fond]', (e) => getComputedStyle(e).boxShadow);
      expect(shadow).toContain('rgb(107, 107, 107)');
      expect(shadow).toContain('inset');
      const others = await page.$eval('.sw[data-role=surface]', (e) => getComputedStyle(e).boxShadow);
      expect(others).not.toContain('rgb(107, 107, 107)');
    });
  }
});
