import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit, type Browser, type BrowserContext, type BrowserType, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXED_HASH } from '../fixed-hash.mjs';

// J11: the "Signature" motion (brief 24). Behaviour, not pixels: a view transition starts and ends, reduced motion starts none,
// a browser without the API still updates, rapid input never leaves the page stuck, focus and the live region are as before.
const url = pathToFileURL(fileURLToPath(new URL('../../dist/index.html', import.meta.url))).href;

type Options = { reducedMotion?: boolean; noViewTransitions?: boolean; width?: number; height?: number; touch?: boolean };
type Session = { page: Page; errors: string[] };
type VtLog = { started: number; finished: number; classes: string[] };

/** Records every call of document.startViewTransition (and when it finishes); optionally removes the API. Runs before the page's own scripts. */
const recorder = (remove: boolean): void => {
  const w = window as unknown as { __vt: VtLog };
  w.__vt = { started: 0, finished: 0, classes: [] };
  const original = Document.prototype.startViewTransition;
  if (remove || typeof original !== 'function') {
    delete (Document.prototype as { startViewTransition?: unknown }).startViewTransition;
    return;
  }
  Document.prototype.startViewTransition = function (this: Document, ...args: Parameters<Document['startViewTransition']>): ViewTransition {
    const vt = original.apply(this, args);
    w.__vt.started++;
    w.__vt.classes.push(document.documentElement.className);
    const end = (): void => void w.__vt.finished++;
    vt.finished.then(end, end);
    return vt;
  } as typeof original;
};

/** Same rule as webkit.test.ts: the Playwright WebKit build is absent on the CI runner by design, so its suite is skipped there (with a warning), never failed. */
const executableOf = (type: BrowserType): string => {
  try {
    return type.executablePath();
  } catch {
    return '';
  }
};
const webkitExecutable = executableOf(webkit);
const webkitAvailable = webkitExecutable !== '' && existsSync(webkitExecutable);
if (!webkitAvailable) console.warn(`motion.test.ts : suite WebKit SAUTÉE : exécutable absent (${webkitExecutable || 'chemin inconnu'})`);

function suite(name: string, type: BrowserType, launchOptions: Record<string, unknown>, chrome: boolean, available = true): void {
  // The animation details of the pseudo-elements are checked in Chrome only: the WebKit build did not show the wave in captures (docs/proto-anim/README.md), so nothing is claimed about it there.
  const detail = chrome;
  const strictErrors = chrome;
  describe.skipIf(!available)(name, () => {
    let browser: Browser;
    const contexts: BrowserContext[] = [];
    beforeAll(async () => {
      browser = await type.launch(launchOptions);
    });
    afterAll(async () => {
      for (const c of contexts) await c.close();
      await browser?.close();
    });

    async function open(o: Options = {}): Promise<Session> {
      const context = await browser.newContext({
        viewport: { width: o.width ?? 1440, height: o.height ?? 900 },
        colorScheme: 'light',
        reducedMotion: o.reducedMotion === true ? 'reduce' : 'no-preference',
        isMobile: o.touch === true,
        hasTouch: o.touch === true,
      });
      contexts.push(context);
      await context.addInitScript(recorder, o.noViewTransitions === true);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(url + FIXED_HASH);
      await page.waitForSelector('html.is-ready');
      return { page, errors };
    }

    const expectClean = (s: Session): void => {
      // The Playwright WebKit build prints a known CSP console message for the <select> (see webkit.test.ts); only exceptions count there.
      expect(strictErrors ? s.errors : s.errors.filter((e) => !/Content Security Policy/.test(e))).toEqual([]);
    };
    const hexes = (page: Page): Promise<string[]> => page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
    const vtLog = (page: Page): Promise<VtLog> => page.evaluate(() => (window as unknown as { __vt: VtLog }).__vt);
    /** Every transition that started has finished and the root carries none of the transition classes. */
    const idle = async (page: Page): Promise<void> => {
      // The store renders on the next frame (that is where the transition starts): look after two frames.
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      await page.waitForFunction(() => {
        const w = window as unknown as { __vt: VtLog };
        return w.__vt.started === w.__vt.finished && !document.documentElement.className.split(' ').some((c) => c === 'vt' || c === 'vt-wave' || c === 'vt-circle' || c === 'morph');
      });
    };
    /** The address bar follows the state at most every 300 ms: read it after that. */
    const finalHash = async (page: Page): Promise<string> => {
      await page.waitForTimeout(700);
      return page.evaluate(() => location.hash);
    };
    const live = async (page: Page): Promise<string> => {
      await page.waitForTimeout(900);
      return page.$eval('#live', (e) => (e.textContent ?? '').trim());
    };
    const space = async (page: Page, times: number): Promise<void> => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (let i = 0; i < times; i++) await page.keyboard.press('Space');
    };
    /** What the same presses give without any transition (reduced motion): the oracle for the final state. */
    const oracleHash = async (presses: number, after?: (page: Page) => Promise<void>): Promise<string> => {
      const s = await open({ reducedMotion: true });
      await space(s.page, presses);
      if (after) await after(s.page);
      return finalHash(s.page);
    };

    it('wave: Hasard starts one view transition that finishes; the 10 named elements fade in with delays from 0 to 150 ms over 200 ms', async () => {
      const s = await open();
      const before = await hexes(s.page);
      await s.page.click('#hasard');
      if (detail) {
        await s.page.waitForFunction(() => document.getAnimations().some((a) => (a.effect as KeyframeEffect).pseudoElement?.startsWith('::view-transition-new(s-')));
        const timings = await s.page.evaluate(() =>
          document
            .getAnimations()
            .filter((a) => /^::view-transition-new\((s|p)-/.test((a.effect as KeyframeEffect).pseudoElement ?? ''))
            .map((a) => ({ delay: Number(a.effect?.getTiming().delay), duration: Number(a.effect?.getTiming().duration) })),
        );
        expect(timings).toHaveLength(10);
        expect(new Set(timings.map((t) => t.duration))).toEqual(new Set([200]));
        expect(Math.min(...timings.map((t) => t.delay))).toBe(0);
        expect(Math.max(...timings.map((t) => t.delay))).toBeCloseTo(150, 5);
      }
      await idle(s.page);
      const log = await vtLog(s.page);
      expect(log.started).toBe(1);
      expect(log.finished).toBe(1);
      expect(log.classes[0]).toContain('vt-wave');
      expect(await hexes(s.page)).not.toEqual(before);
      expectClean(s);
    });

    it('circle: the mode button starts one view transition with a growing clip-path circle, then the dark palette is on screen', async () => {
      const s = await open();
      await s.page.click('.seg button[data-mode=dark]');
      if (detail) {
        await s.page.waitForFunction(() => document.getAnimations().some((a) => (a.effect as KeyframeEffect).pseudoElement === '::view-transition-new(root)'));
        const circle = await s.page.evaluate(() => {
          const a = document.getAnimations().find((x) => (x.effect as KeyframeEffect).pseudoElement === '::view-transition-new(root)');
          const effect = a?.effect as KeyframeEffect;
          return { duration: Number(effect.getTiming().duration), clip: effect.getKeyframes().map((k) => String(k['clipPath'])) };
        });
        expect(circle.duration).toBe(550);
        expect(circle.clip).toHaveLength(2);
        expect(circle.clip[0]).toMatch(/^circle\(0px at /);
        expect(circle.clip[1]).toMatch(/^circle\([1-9]\d*(\.\d+)?px at /);
      }
      await idle(s.page);
      const log = await vtLog(s.page);
      expect(log.started).toBe(1);
      expect(log.finished).toBe(1);
      expect(log.classes[0]).toContain('vt-circle');
      expect(await s.page.getAttribute('.seg button[data-mode=dark]', 'aria-pressed')).toBe('true');
      expect(await s.page.textContent('#metaMode')).toBe('sombre');
      expect(await live(s.page)).toMatch(/^Palette sombre : \p{Lu}\p{Ll}+ \p{Ll}+, accent #[0-9A-F]{6}, \d+ sur \d+ contrastes AA$/u);
      expectClean(s);
    });

    it('prefers-reduced-motion: no view transition and no animation at all, and the new palette is there at once', async () => {
      const s = await open({ reducedMotion: true });
      const before = await hexes(s.page);
      await s.page.click('#hasard');
      await s.page.waitForFunction((b) => document.querySelector('.sw-hex')?.textContent !== b, before[0]);
      expect(await s.page.evaluate(() => document.getAnimations().length)).toBe(0);
      await s.page.click('.seg button[data-mode=dark]');
      await s.page.waitForFunction(() => document.querySelector('#metaMode')?.textContent === 'sombre');
      expect(await s.page.evaluate(() => document.getAnimations().length)).toBe(0);
      expect((await vtLog(s.page)).started).toBe(0);
      expect(await s.page.evaluate(() => document.documentElement.className)).toBe('oklch is-ready');
      expectClean(s);
    });

    it('without the View Transitions API: Hasard, the mode and a new base colour still update the page; the base colour still fades through OKLCH', async () => {
      const s = await open({ noViewTransitions: true });
      expect(await s.page.evaluate(() => typeof document.startViewTransition)).toBe('undefined');
      const before = await hexes(s.page);
      await s.page.click('#hasard');
      await s.page.waitForFunction((b) => document.querySelector('.sw-hex')?.textContent !== b, before[0]);
      expect(await hexes(s.page)).not.toEqual(before);
      await s.page.click('.seg button[data-mode=dark]');
      await s.page.waitForFunction(() => document.querySelector('#metaMode')?.textContent === 'sombre');
      expect(await s.page.getAttribute('.seg button[data-mode=dark]', 'aria-pressed')).toBe('true');
      await s.page.fill('#baseHex', '#B02060');
      await s.page.press('#baseHex', 'Enter');
      await s.page.waitForFunction(() => document.documentElement.classList.contains('morph'));
      await idle(s.page);
      expect(await s.page.inputValue('#baseHex')).toBe('#B02060');
      expect((await vtLog(s.page)).started).toBe(0);
      expectClean(s);
    });

    it('20 rapid Space presses never leave the page stuck: every transition ends, the final palette is the one without transitions, and the live region says the last one', async () => {
      const s = await open();
      await space(s.page, 20);
      await idle(s.page);
      const log = await vtLog(s.page);
      expect(log.started).toBeGreaterThan(0);
      expect(log.finished).toBe(log.started);
      const hash = await finalHash(s.page);
      expect(hash).toBe(await oracleHash(20));
      const swatches = await hexes(s.page);
      expect(swatches.map((h) => h.slice(1))).toEqual(hash.match(/&l=([0-9A-F]+)/)![1]!.match(/.{6}/g));
      const said = await live(s.page);
      expect(said).toMatch(new RegExp(`^Nouvelle palette : \\p{Lu}\\p{Ll}+ \\p{Ll}+, accent ${swatches[3]}, \\d+ sur \\d+ contrastes AA$`, 'u'));
      expectClean(s);
    });

    it('10 Hasard presses then the dark mode, all in a burst: the final state is dark with the palette the same actions give without transitions', async () => {
      const s = await open();
      await space(s.page, 10);
      await s.page.click('.seg button[data-mode=dark]');
      await idle(s.page);
      const hash = await finalHash(s.page);
      expect(hash).toBe(await oracleHash(10, (p) => p.click('.seg button[data-mode=dark]')));
      expect(hash).toContain('m=d');
      expect(await s.page.textContent('#metaMode')).toBe('sombre');
      expect((await hexes(s.page)).map((h) => h.slice(1))).toEqual(hash.match(/&d=([0-9A-F]+)/)![1]!.match(/.{6}/g));
      expectClean(s);
    });

    it('20 rapid mouse clicks on Hasard: every click reaches the button (also the ones pressed during a transition), nothing stays stuck, the final palette is the expected one', async () => {
      const s = await open();
      await s.page.evaluate(() => {
        const w = window as unknown as { __clicks: number };
        w.__clicks = 0;
        document.querySelector('#hasard')?.addEventListener('click', () => w.__clicks++);
      });
      const box = (await s.page.locator('#hasard').boundingBox())!;
      for (let i = 0; i < 20; i++) {
        await s.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await s.page.waitForTimeout(40);
      }
      await idle(s.page);
      expect(await s.page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(20);
      expect(await finalHash(s.page)).toBe(await oracleHash(20));
      // WebKit on the Mac does not focus a button on a mouse click: the focus is only checked where the engine gives it.
      if (chrome) expect(await s.page.evaluate(() => document.activeElement?.id)).toBe('hasard');
      expectClean(s);
    });

    it('a press during the wave ends it and goes through: two clicks 100 ms apart give two new palettes', async () => {
      const s = await open();
      const box = (await s.page.locator('#hasard').boundingBox())!;
      await s.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await s.page.waitForFunction(() => document.documentElement.classList.contains('vt-wave'));
      await s.page.waitForTimeout(100);
      await s.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await idle(s.page);
      expect(await finalHash(s.page)).toBe(await oracleHash(2));
      expectClean(s);
    });

    it('focus and live region: Hasard keeps the focus on its button and the live region says what it says without transitions', async () => {
      const s = await open();
      await s.page.focus('#hasard');
      await s.page.keyboard.press('Space');
      await idle(s.page);
      expect(await s.page.evaluate(() => document.activeElement?.id)).toBe('hasard');
      const said = await live(s.page);
      const calm = await open({ reducedMotion: true });
      await calm.page.focus('#hasard');
      await calm.page.keyboard.press('Space');
      expect(said).toMatch(/^Nouvelle palette : \p{Lu}\p{Ll}+ \p{Ll}+, accent #[0-9A-F]{6}, \d+ sur \d+ contrastes AA$/u);
      expect(said).toBe(await live(calm.page));
      expectClean(s);
    });

    it('a contrast dialog open during a Hasard and a mode change keeps its focus and shows the new values', async () => {
      const run = async (o: Options): Promise<{ s: Session; focus: string; open: boolean; ratio: string; title: string; same: boolean }> => {
        const s = await open(o);
        await s.page.click('.pill[data-pair=accent-fond]');
        await s.page.waitForSelector('#cdlg:not([hidden])');
        await s.page.evaluate(() => ((document.querySelector('#cdClose') as HTMLElement).focus(), undefined));
        const keyed = await s.page.evaluate(() => (document.activeElement as HTMLElement).id);
        await s.page.evaluate(() => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        });
        await s.page.waitForTimeout(500);
        await s.page.evaluate(() => (document.querySelector('.seg button[data-mode=dark]') as HTMLElement).click());
        await s.page.waitForTimeout(900);
        if (o.reducedMotion !== true) await idle(s.page);
        return {
          s,
          focus: await s.page.evaluate(() => (document.activeElement as HTMLElement).id),
          open: await s.page.evaluate(() => !(document.querySelector('#cdlg') as HTMLElement).hidden),
          ratio: await s.page.$eval('#cdRatio', (e) => e.textContent ?? ''),
          title: await s.page.$eval('#cdTitle', (e) => e.textContent ?? ''),
          same: keyed === (await s.page.evaluate(() => (document.activeElement as HTMLElement).id)),
        };
      };
      const lively = await run({});
      const calm = await run({ reducedMotion: true });
      expect(lively.open).toBe(true);
      expect(lively.focus).toBe('cdClose');
      expect(lively.same).toBe(true);
      expect({ ratio: lively.ratio, title: lively.title }).toEqual({ ratio: calm.ratio, title: calm.title });
      expect(calm.open).toBe(true);
      expect((await vtLog(lively.s.page)).started).toBe(2);
      expectClean(lively.s);
    });

    it('a bottom sheet (export, 390 px) open during a Hasard keeps its focus; the page and the pills do not scroll by themselves', async () => {
      const s = await open({ width: 390, height: 844, touch: true });
      await s.page.evaluate(() => {
        const pills = document.querySelector('#pills') as HTMLElement;
        const third = pills.children[3] as HTMLElement;
        pills.scrollLeft = third.offsetLeft - 16; // a snap point: the scroll-snap would pull any other value back
        window.scrollTo(0, 40);
      });
      await s.page.waitForTimeout(300);
      const scrolled = await s.page.evaluate(() => ({ x: (document.querySelector('#pills') as HTMLElement).scrollLeft, y: window.scrollY }));
      expect(scrolled.x).toBeGreaterThan(0);
      expect(scrolled.y).toBeGreaterThan(0);
      await s.page.evaluate(() => (document.querySelector('#exportBtn') as HTMLElement).click());
      await s.page.waitForSelector('#xmenu:not([hidden])');
      const focusBefore = await s.page.evaluate(() => document.activeElement?.id ?? document.activeElement?.className);
      await s.page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
      await s.page.waitForTimeout(100);
      await idle(s.page);
      await s.page.waitForTimeout(400);
      expect(await s.page.evaluate(() => !(document.querySelector('#xmenu') as HTMLElement).hidden)).toBe(true);
      expect(await s.page.evaluate(() => document.activeElement?.id ?? document.activeElement?.className)).toBe(focusBefore);
      expect(await s.page.evaluate(() => ({ x: (document.querySelector('#pills') as HTMLElement).scrollLeft, y: window.scrollY }))).toEqual(scrolled);
      expect((await vtLog(s.page)).started).toBe(1);
      expectClean(s);
    });
  });
}

suite('motion: Chrome', chromium, { channel: 'chrome', headless: true }, true);
suite('motion: WebKit engine (Playwright build; not Safari itself)', webkit, {}, false, webkitAvailable);
