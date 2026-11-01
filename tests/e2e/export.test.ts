import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import axe from 'axe-core';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportText, pngLayout, type OutputId } from '../../src/export';
import type { ExportInput } from '../../src/export/keys';
import { next } from '../../src/core/random';
import { ROLES } from '../../src/palette/roles';
import { decodeHash } from '../../src/state/url';
import { fixedHashFor } from '../fixed-hash.mjs';

const distFile = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
const url = pathToFileURL(distFile).href;
const HTTPS = 'https://huezz.test/';

type Probe = { violations: string[]; errors: string[] };
type Session = { page: Page; probe: Probe; context: BrowserContext };

let browser: Browser;
const opened: BrowserContext[] = [];

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  for (const c of opened) await c.close();
  await browser?.close();
});

type Options = { scheme?: 'light' | 'dark'; width?: number; height?: number; hash?: string; https?: boolean; clipboard?: boolean; init?: () => void };

async function open(o: Options = {}): Promise<Session> {
  const context = await browser.newContext({ colorScheme: o.scheme ?? 'light', viewport: { width: o.width ?? 1440, height: o.height ?? 900 }, acceptDownloads: true });
  opened.push(context);
  if (o.https === true) {
    await context.route(`${HTTPS}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(distFile) }));
  }
  if (o.clipboard !== false) await context.grantPermissions(['clipboard-read', 'clipboard-write'], o.https === true ? { origin: 'https://huezz.test' } : undefined).catch(() => undefined);
  const page = await context.newPage();
  const probe: Probe = { violations: [], errors: [] };
  await page.exposeFunction('__huezzViolation', (directive: string, blocked: string) => probe.violations.push(`${directive} ${blocked}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __huezzViolation(d: string, b: string): void }).__huezzViolation(e.effectiveDirective, e.blockedURI);
    });
  });
  if (o.init) await page.addInitScript(o.init);
  page.on('console', (m) => m.type() === 'error' && probe.errors.push(m.text()));
  page.on('pageerror', (e) => probe.errors.push(String(e)));
  await page.goto(`${o.https === true ? HTTPS : url}${o.hash ?? fixedHashFor(o.scheme)}`);
  await page.waitForSelector('html.is-ready');
  return { page, probe, context };
}

const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
/** Palette fade (0.3 s) and the 300 ms address-bar throttle. */
const settle = async (page: Page) => {
  await frames(page);
  await page.waitForTimeout(450);
};
const dockHex = (page: Page): Promise<string[]> => page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
const toastText = (page: Page): Promise<string> => page.$eval('#toast span', (e) => e.textContent ?? '');

async function liveInput(page: Page): Promise<ExportInput> {
  await settle(page);
  const r = decodeHash(await page.evaluate(() => location.hash));
  if (r.kind !== 'ok') throw new Error('le hash vivant est illisible');
  return { harmony: r.value.harmony, mode: r.value.mode, theme: r.value.theme };
}

async function clean(s: Session): Promise<void> {
  expect(s.probe.errors).toEqual([]);
  expect(s.probe.violations).toEqual([]);
  expect(await s.page.$$eval('[style]', (els) => els.filter((e) => (e.getAttribute('style') ?? '').trim() !== '').length)).toBe(0);
}

const openMenu = async (page: Page): Promise<void> => {
  await page.click('#exportBtn');
  await page.waitForSelector('#xmenu:not([hidden])');
};

describe('export menu: structure and keyboard', () => {
  it('lists the 6 formats, the Tailwind v4/v3 choice and the Figma 2025.10 option with its warning line', async () => {
    const s = await open();
    const { page } = s;
    expect(await page.getAttribute('#exportBtn', 'aria-expanded')).toBe('false');
    await openMenu(page);
    expect(await page.getAttribute('#xmenu', 'role')).toBe('dialog');
    expect(await page.getAttribute('#xmenu', 'aria-modal')).toBeNull();
    expect(await page.getAttribute('#exportBtn', 'aria-expanded')).toBe('true');
    expect(await page.$$eval('#xFormats [role=radio]', (els) => els.map((e) => e.textContent))).toEqual(['CSS', 'Tailwind', 'JSON', 'Swift', 'Figma', 'PNG']);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('CSS');
    expect(await page.isVisible('#xTw')).toBe(false);
    expect(await page.isVisible('#xFigma')).toBe(false);
    await page.click('#xFormats [data-f=tailwind]');
    expect(await page.$$eval('#xTw [role=radio]', (els) => els.map((e) => e.textContent))).toEqual(['Tailwind v4', 'Tailwind v3']);
    expect(await page.isVisible('#xTw')).toBe(true);
    await page.click('#xFormats [data-f=figma]');
    expect(await page.isVisible('#xFigma')).toBe(true);
    expect(await page.textContent('#xFigma label')).toBe('Format 2025.10');
    expect(await page.textContent('#xFigma .xhint')).toMatch(/2025\.10.*pas vérifié.*Figma.*Tokens Studio/);
    expect(await page.isVisible('#xTw')).toBe(false);
    await clean(s);
  });

  it('arrows move between the formats (selection follows the focus, wrapping), one tab stop, Esc closes and returns the focus', async () => {
    const s = await open();
    const { page } = s;
    await openMenu(page);
    const active = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.f ?? document.activeElement?.id);
    expect(await active()).toBe('css');
    await page.keyboard.press('ArrowRight');
    expect(await active()).toBe('tailwind');
    expect(await page.getAttribute('#xFormats [data-f=tailwind]', 'aria-checked')).toBe('true');
    expect(await page.getAttribute('#xFormats [data-f=css]', 'aria-checked')).toBe('false');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(await active()).toBe('png');
    await page.keyboard.press('ArrowRight');
    expect(await active()).toBe('css');
    expect(await page.$$eval('#xFormats [role=radio]', (els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length)).toBe(1);
    // Space on a radio keeps its native action: no Hasard.
    const before = await dockHex(page);
    await page.keyboard.press('Space');
    await settle(page);
    expect(await dockHex(page)).toEqual(before);
    // Tailwind version radios: arrows too.
    await page.click('#xFormats [data-f=tailwind]');
    await page.focus('#xTw [data-v=v4]');
    await page.keyboard.press('ArrowRight');
    expect(await page.getAttribute('#xTw [data-v=v3]', 'aria-checked')).toBe('true');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Tailwind v3');
    await page.keyboard.press('Escape');
    expect(await page.isVisible('#xmenu')).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('exportBtn');
    expect(await page.getAttribute('#exportBtn', 'aria-expanded')).toBe('false');
    // Esc also works from the code area.
    await openMenu(page);
    await page.focus('#xOut');
    await page.keyboard.press('Escape');
    expect(await page.isVisible('#xmenu')).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('exportBtn');
    await clean(s);
  });

  it('tab order of the bar: Hasard, mode, Partager, Exporter; a click outside closes without moving the focus', async () => {
    const s = await open();
    const { page } = s;
    await page.focus('#hasard');
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => document.activeElement?.id || (document.activeElement as HTMLElement).dataset.mode || ''));
    }
    expect(seen).toEqual(['light', 'share', 'exportBtn']);
    await openMenu(page);
    await page.mouse.click(300, 600);
    expect(await page.isVisible('#xmenu')).toBe(false);
    await clean(s);
  });

  it('opening the contrast dialog closes the export menu and the reverse', async () => {
    const s = await open();
    const { page } = s;
    await openMenu(page);
    await page.click('.pill[data-pair="texte-fond"]');
    expect(await page.isVisible('#xmenu')).toBe(false);
    expect(await page.isVisible('#cdlg')).toBe(true);
    await openMenu(page);
    expect(await page.isVisible('#cdlg')).toBe(false);
    await clean(s);
  });
});

const TEXT_OUTPUTS: Array<{ id: Exclude<OutputId, 'png'>; format: string; tw?: string; figma2025?: boolean; name: string }> = [
  { id: 'css', format: 'css', name: 'huezz.css' },
  { id: 'tailwind-v4', format: 'tailwind', tw: 'v4', name: 'huezz-theme.css' },
  { id: 'tailwind-v3', format: 'tailwind', tw: 'v3', name: 'tailwind.huezz.js' },
  { id: 'json', format: 'json', name: 'huezz.json' },
  { id: 'swift', format: 'swift', name: 'Huezz.swift' },
  { id: 'figma', format: 'figma', name: 'huezz.tokens.json' },
  { id: 'figma-2025.10', format: 'figma', figma2025: true, name: 'huezz.tokens.json' },
];

describe('export menu: the text is the pure function output for the live palette', () => {
  it('7 text outputs on the start palette, then after Hasard, in the dark mode and after a base colour', async () => {
    const s = await open();
    const { page } = s;
    const steps: Array<() => Promise<void>> = [
      async () => undefined,
      async () => void (await page.click('#hasard')),
      async () => void (await page.click('[data-mode=dark]')),
      async () => {
        await page.fill('#baseHex', '#336699');
        await page.keyboard.press('Enter');
      },
    ];
    for (const [k, step] of steps.entries()) {
      await step();
      const input = await liveInput(page);
      // The hash is the live state: the dock agrees with it (displayed mode).
      expect(await dockHex(page), `étape ${k}`).toEqual(ROLES.map((r) => input.theme[input.mode][r]));
      await openMenu(page);
      for (const o of TEXT_OUTPUTS) {
        await page.click(`#xFormats [data-f=${o.format}]`);
        if (o.tw !== undefined) await page.click(`#xTw [data-v=${o.tw}]`);
        if (o.format === 'figma') await page.setChecked('#xFigma2025', o.figma2025 === true);
        expect(await page.inputValue('#xOut'), `étape ${k} ${o.id}`).toBe(exportText(o.id, input));
        expect(await page.textContent('#xName')).toBe(o.name);
        expect(await page.getAttribute('#xOut', 'readonly')).not.toBeNull();
      }
      await page.keyboard.press('Escape');
    }
    await clean(s);
  });

  it('the open menu follows the palette (a hash change while it is open)', async () => {
    const s = await open();
    const { page } = s;
    await openMenu(page);
    const first = await page.inputValue('#xOut');
    await page.evaluate(() => {
      location.hash = location.hash.replace(/&h=co&/, '&h=tr&');
    });
    await settle(page);
    const second = await page.inputValue('#xOut');
    expect(second).not.toBe(first);
    expect(second).toMatch(/harmonie triade/);
    await clean(s);
  });
});

describe('Copier (clipboard chain of J3a)', () => {
  it('clipboard API (file:// is a secure context here): the clipboard holds the code, the toast appears after success', async () => {
    const s = await open();
    const { page } = s;
    await openMenu(page);
    await page.click('#xFormats [data-f=json]');
    await page.click('#xCopy');
    await page.waitForFunction(() => document.querySelector('#toast')?.classList.contains('show'));
    expect(await toastText(page)).toBe('Copié dans le presse-papiers');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.inputValue('#xOut'));
    expect(await page.getAttribute('#toast', 'data-path')).toBe('clipboard');
    await clean(s);
  });

  it('execCommand fallback (isSecureContext forced to false): same text on the clipboard, toast shown', async () => {
    const s = await open({ init: () => Object.defineProperty(window, 'isSecureContext', { value: false }) });
    const { page } = s;
    await openMenu(page);
    await page.click('#xFormats [data-f=swift]');
    await page.click('#xCopy');
    await page.waitForFunction(() => document.querySelector('#toast')?.classList.contains('show'));
    expect(await page.getAttribute('#toast', 'data-path')).toBe('execCommand');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.inputValue('#xOut'));
    await clean(s);
  });

  it('manual last resort (no clipboard, execCommand refused): no toast, the code is selected, a line says so', async () => {
    const s = await open({
      init: () => {
        Object.defineProperty(window, 'isSecureContext', { value: false });
        document.execCommand = () => false;
      },
    });
    const { page } = s;
    await openMenu(page);
    await page.click('#xCopy');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.querySelector('#toast')?.classList.contains('show'))).toBe(false);
    expect(await toastText(page)).toBe('');
    expect(await page.textContent('#xStatus')).toMatch(/sélectionné.*Cmd\/Ctrl \+ C/);
    expect(await page.evaluate(() => { const t = document.querySelector<HTMLTextAreaElement>('#xOut')!; return [document.activeElement === t, t.selectionStart, t.selectionEnd === t.value.length]; })).toEqual([true, 0, true]);
    await clean(s);
  });
});

/** Decodes PNG bytes in a blank page with a canvas (no dependency) and reads pixels. */
async function decodePixels(bytes: Buffer, points: Array<[number, number]>): Promise<{ width: number; height: number; pixels: string[] }> {
  const context = await browser.newContext();
  opened.push(context);
  const page = await context.newPage();
  const out = await page.evaluate(
    async ({ b64, pts }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([arr], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const hex = (x: number, y: number) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return `#${[d[0]!, d[1]!, d[2]!].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}${d[3] === 255 ? '' : '!alpha'}`;
      };
      return { width: bmp.width, height: bmp.height, pixels: pts.map(([x, y]) => hex(x, y)) };
    },
    { b64: bytes.toString('base64'), pts: points },
  );
  return out;
}

describe('PNG', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`preview, download "huezz.png": signature, 1400 x 400, the 7 band colours (centre and corner pixels), ${mode} mode`, async () => {
      const s = await open();
      const { page } = s;
      if (mode === 'dark') await page.click('[data-mode=dark]');
      await page.click('#hasard');
      const input = await liveInput(page);
      await openMenu(page);
      await page.click('#xFormats [data-f=png]');
      expect(await page.isVisible('#xCanvas')).toBe(true);
      expect(await page.isVisible('#xOut')).toBe(false);
      expect(await page.isVisible('#xCopy')).toBe(false);
      expect(await page.textContent('#xName')).toBe('huezz.png');
      expect(await page.$eval('#xCanvas', (c) => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height])).toEqual([1400, 400]);
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#xDownload')]);
      expect(download.suggestedFilename()).toBe('huezz.png');
      const path = await download.path();
      const bytes = readFileSync(path);
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(bytes.toString('latin1', 12, 16)).toBe('IHDR');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1400, 400]);
      const palette = ROLES.map((r) => input.theme[input.mode][r]);
      const layout = pngLayout(input);
      expect(layout.rects.map((r) => r.fill)).toEqual(palette);
      const centre: Array<[number, number]> = palette.map((_, i) => [i * 200 + 100, 200]);
      const corner: Array<[number, number]> = palette.map((_, i) => [i * 200 + 4, 4]);
      const decoded = await decodePixels(bytes, [...centre, ...corner]);
      expect([decoded.width, decoded.height]).toEqual([1400, 400]);
      console.log(`PNG ${mode}: ${bytes.length} octets ; centres ${decoded.pixels.slice(0, 7).join(' ')} ; attendu ${palette.join(' ')}`);
      expect(decoded.pixels.slice(0, 7)).toEqual(palette);
      expect(decoded.pixels.slice(7)).toEqual(palette);
      await clean(s);
    });
  }
});

describe('Partager', () => {
  it('under file:// shows the toast and copies nothing', async () => {
    const s = await open();
    const { page } = s;
    await page.evaluate(() => navigator.clipboard.writeText('SENTINELLE'));
    await page.click('#share');
    await page.waitForFunction(() => document.querySelector('#toast')?.classList.contains('show'));
    expect(await toastText(page)).toBe('Lien indisponible hors http(s) : ouvre la page depuis un site pour partager');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('SENTINELLE');
    expect(await page.evaluate(() => document.querySelector('#manual')?.hasAttribute('hidden'))).toBe(true);
    await clean(s);
  });

  it('under https (fictitious origin by interception) copies the full address with the live hash', async () => {
    const s = await open({ https: true });
    const { page } = s;
    await page.evaluate(() => navigator.clipboard.writeText('SENTINELLE'));
    await page.click('#hasard');
    await settle(page);
    await page.click('#share');
    await page.waitForFunction(() => document.querySelector('#toast')?.classList.contains('show'));
    expect(await toastText(page)).toMatch(/^Lien copié/);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const live = await page.evaluate(() => location.href);
    expect(copied).toBe(live);
    expect(copied).toMatch(/^https:\/\/huezz\.test\/#v=1&m=l&h=co&s=[0-9a-f]{8}&k=00&l=[0-9A-F]{42}&d=[0-9A-F]{42}$/);
    await clean(s);
  });
});

const L = 'FFF4E8' + 'FFFFFF' + '1A0F00' + 'B4531A' + '1A6B7A' + '2E7D32' + 'C62828';
const D = '1A1008' + '261A10' + 'F5EBDD' + 'F2A065' + '6CC4D4' + '81C784' + 'EF9A9A';
const HAND = `#v=1&m=d&h=tr&s=00c0ffee&k=41&l=${L}&d=${D}`;
const hexList = (digits: string): string[] => ROLES.map((_, i) => `#${digits.slice(i * 6, i * 6 + 6)}`);

describe('URL: load, live hash, hashchange, reload', () => {
  it('a hand-built hash restores the 14 colours, mode, harmony and locks, and wins over the system theme and the default seed', async () => {
    const s = await open({ hash: HAND, scheme: 'light' });
    const { page } = s;
    await settle(page);
    expect(await dockHex(page)).toEqual(hexList(D));
    expect(await page.getAttribute('[data-mode=dark]', 'aria-pressed')).toBe('true');
    expect(await page.inputValue('#harm')).toBe('triad');
    expect(await page.$$eval('.sw-lock', (els) => els.map((e) => e.getAttribute('aria-pressed')))).toEqual(['true', 'false', 'false', 'false', 'false', 'false', 'true']);
    await page.click('[data-mode=light]');
    await settle(page);
    expect(await dockHex(page)).toEqual(hexList(L));
    expect(await page.inputValue('#baseHex')).toBe(`#${L.slice(18, 24)}`);
    expect(await page.evaluate(() => location.hash)).toBe(HAND.replace('m=d', 'm=l'));
    expect(await toastText(page)).toBe('');
    await clean(s);
  });

  it('after a link, Hasard draws from the link seed (next of it) and keeps the locked colours of both modes', async () => {
    const s = await open({ hash: HAND });
    const { page } = s;
    await settle(page);
    await page.click('#hasard');
    const input = await liveInput(page);
    const r = decodeHash(await page.evaluate(() => location.hash));
    expect(r.kind === 'ok' && r.value.seed).toBe(next(0x00c0ffee));
    expect(input.theme.dark.fond).toBe(`#${D.slice(0, 6)}`);
    expect(input.theme.dark.alerte).toBe(`#${D.slice(36, 42)}`);
    expect(input.theme.light.fond).toBe(`#${L.slice(0, 6)}`);
    expect(input.theme.light.alerte).toBe(`#${L.slice(36, 42)}`);
    expect(input.theme.dark.accent).not.toBe(`#${D.slice(18, 24)}`);
    await clean(s);
  });

  it('a link with a dark system theme and m=l stays light (the hash wins both ways)', async () => {
    const s = await open({ hash: HAND.replace('m=d', 'm=l'), scheme: 'dark' });
    await settle(s.page);
    expect(await dockHex(s.page)).toEqual(hexList(L));
    await clean(s);
  });

  it('no hash: system theme and a random palette (J9), and the address bar gets the live hash', async () => {
    const dark = await open({ scheme: 'dark', hash: '' });
    await settle(dark.page);
    expect(await dark.page.getAttribute('[data-mode=dark]', 'aria-pressed')).toBe('true');
    expect(await dark.page.evaluate(() => location.hash)).toMatch(/^#v=1&m=d&h=co&s=[0-9a-f]{8}&k=00&l=/);
    await clean(dark);
  });

  it('hashchange loads the new palette; a hostile hash keeps the palette, shows a message and the address bar is repaired', async () => {
    const s = await open({ hash: HAND });
    const { page } = s;
    await settle(page);
    const next = HAND.replace('m=d', 'm=l').replace('h=tr', 'h=an').replace('k=41', 'k=00');
    await page.evaluate((h) => void (location.hash = h), next);
    await settle(page);
    expect(await dockHex(page)).toEqual(hexList(L));
    expect(await page.inputValue('#harm')).toBe('analogous');
    expect(await page.$$eval('.sw-lock', (els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true').length)).toBe(0);
    await page.evaluate(() => void (location.hash = '#v=1&m=l&h=co&k=ff'));
    await page.waitForTimeout(100);
    expect(await toastText(page)).toBe('Lien invalide : une palette neuve est affichée.');
    await settle(page);
    expect(await dockHex(page)).toEqual(hexList(L));
    expect(await page.evaluate(() => location.hash)).toBe(next.replace('k=00', 'k=00'));
    await page.evaluate(() => void (location.hash = '#v=9&x=1'));
    await page.waitForTimeout(100);
    expect(await toastText(page)).toMatch(/version plus récente/);
    await clean(s);
  });

  it('reloading the page from the live hash gives the same 14 colours (both modes), the same harmony and locks', async () => {
    const s = await open();
    const { page } = s;
    await page.click('#harm');
    await page.selectOption('#harm', 'split-complementary');
    for (let i = 0; i < 4; i++) await page.click('#hasard');
    await page.click('.sw[data-role=texte] .sw-lock');
    await page.click('[data-mode=dark]');
    await settle(page);
    const before = await page.evaluate(() => location.hash);
    const darkBefore = await dockHex(page);
    await page.click('[data-mode=light]');
    await settle(page);
    const lightBefore = await dockHex(page);
    const live = await page.evaluate(() => location.hash);
    await page.reload();
    await page.waitForSelector('html.is-ready');
    await settle(page);
    expect(await page.evaluate(() => location.hash)).toBe(live);
    expect(live.replace('m=l', 'm=d')).toBe(before);
    expect(await dockHex(page)).toEqual(lightBefore);
    await page.click('[data-mode=dark]');
    await settle(page);
    expect(await dockHex(page)).toEqual(darkBefore);
    expect(await page.inputValue('#harm')).toBe('split-complementary');
    expect(await page.getAttribute('.sw[data-role=texte] .sw-lock', 'aria-pressed')).toBe('true');
    const r = decodeHash(live);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect([...hexList(''.padEnd(42, '0'))].length).toBe(7);
    await clean(s);
  });

  it('replaceState is throttled: 50 Hasard presses (one per frame) make far fewer than 20 calls, and the last state is written', async () => {
    const s = await open({
      init: () => {
        const w = window as unknown as { __replaceCalls: number };
        w.__replaceCalls = 0;
        const original = history.replaceState.bind(history);
        history.replaceState = (...args: Parameters<History['replaceState']>) => {
          w.__replaceCalls++;
          original(...args);
        };
      },
    });
    const { page } = s;
    await settle(page);
    const before = await page.evaluate(() => (window as unknown as { __replaceCalls: number }).__replaceCalls);
    await page.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        document.querySelector<HTMLButtonElement>('#hasard')!.click();
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
    });
    const duringMs = await page.evaluate(() => performance.now());
    await settle(page);
    const calls = (await page.evaluate(() => (window as unknown as { __replaceCalls: number }).__replaceCalls)) - before;
    console.log(`replaceState : ${calls} appels pour 50 Hasard (page ouverte depuis ${Math.round(duringMs)} ms)`);
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThan(20);
    const input = await liveInput(page);
    expect(await dockHex(page)).toEqual(ROLES.map((r) => input.theme[input.mode][r]));
    await clean(s);
  });
});

const GOOD_L = L;
const GOOD_D = D;
const goodWith = (over: Record<string, string>): string => {
  const f: Record<string, string> = { v: '1', m: 'l', h: 'co', s: '9a3c51e2', k: '0c', l: GOOD_L, d: GOOD_D, ...over };
  return `#${Object.entries(f).map(([k, v]) => `${k}=${v}`).join('&')}`;
};
const HOSTILE_PAGES: string[] = [
  '#<script>alert(1)</script>',
  goodWith({ l: '<script>alert(1)</script>0000000000000000' }),
  goodWith({ l: `%00${GOOD_L.slice(3)}` }),
  '#%00',
  `${goodWith({})}&x=${'a'.repeat(200)}`,
  `#${'&'.repeat(10_000)}`,
  `${goodWith({})}&m=d`,
  `${goodWith({})}&z=1&z=2`,
  `${goodWith({})}&__proto__=1&__proto__=2`,
  '#__proto__=1',
  '#__proto__[polluted]=1',
  '#constructor[prototype][x]=1&v=1',
  goodWith({ k: '80' }),
  goodWith({ k: 'ff' }),
  goodWith({ k: '0g' }),
  goodWith({ k: 'c' }),
  goodWith({ v: '9' }),
  goodWith({ v: '0' }),
  goodWith({ v: '' }),
  goodWith({ v: '01' }),
  goodWith({ l: GOOD_L.slice(1) }),
  goodWith({ l: `${GOOD_L}0` }),
  goodWith({}).replace(/&d=.*$/, ''),
  goodWith({ l: GOOD_L.toLowerCase() }),
  goodWith({ d: `GZ${GOOD_D.slice(2)}` }),
  goodWith({ s: '9A3C51E2' }),
  goodWith({ s: '9a3c51e' }),
  '#v=1&m=&h=&s=&k=&l=&d=',
  goodWith({ h: 'xx' }),
  goodWith({ m: 'x' }),
  `${goodWith({})}&`,
  '#v=1&=x',
  '#{"__proto__":{"x":1}}',
  '#javascript:alert(1)',
];

describe('hostile addresses loaded as page URLs', () => {
  it(`${HOSTILE_PAGES.length} hostile hashes: a fresh random palette (never the hostile link's colours), a message, 0 console error, 0 CSP violation, nothing polluted`, async () => {
    let withMessage = 0;
    for (const [i, hash] of HOSTILE_PAGES.entries()) {
      const s = await open({ hash });
      await settle(s.page);
      const dock = await dockHex(s.page);
      expect(dock, `#${i} ${hash.slice(0, 60)}`).toHaveLength(7);
      for (const hex of dock) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(dock, `#${i} not the colours of the hostile link`).not.toEqual(hexList(L));
      const msg = await toastText(s.page);
      expect(msg, `#${i}`).toMatch(/^(Lien invalide|Lien trop long|Ce lien vient d'une version plus récente)/);
      if (msg !== '') withMessage++;
      expect(await s.page.evaluate(() => ({} as Record<string, unknown>).polluted ?? ({} as Record<string, unknown>).x ?? null)).toBeNull();
      // The address bar is repaired with the hash of the fresh palette on screen.
      const repaired = await s.page.evaluate(() => location.hash);
      expect(repaired).toMatch(/^#v=1&m=l&h=co&s=[0-9a-f]{8}&k=00&l=[0-9A-F]{42}&d=[0-9A-F]{42}$/);
      const decoded = decodeHash(repaired);
      expect(decoded.kind === 'ok' && ROLES.map((r) => decoded.value.theme.light[r])).toEqual(dock);
      expect(s.probe.errors, `#${i}`).toEqual([]);
      expect(s.probe.violations, `#${i}`).toEqual([]);
      await s.context.close();
    }
    console.log(`hash hostiles chargés : ${HOSTILE_PAGES.length}, messages : ${withMessage}`);
    expect(withMessage).toBe(HOSTILE_PAGES.length);
    expect(HOSTILE_PAGES.length).toBeGreaterThanOrEqual(30);
  });

  it('v=9 shows the "version plus récente" message', async () => {
    const s = await open({ hash: goodWith({ v: '9' }) });
    expect(await toastText(s.page)).toBe("Ce lien vient d'une version plus récente de Huezz : une palette neuve est affichée.");
    await clean(s);
  });
});

type AxeResult = { violations: { id: string; impact: string | null; nodes: { target: unknown }[] }[] };
async function axeSerious(page: Page): Promise<string[]> {
  await page.evaluate(axe.source);
  const r = await page.evaluate(() => (window as unknown as { axe: { run(): Promise<AxeResult> } }).axe.run());
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${JSON.stringify(v.nodes.map((n) => n.target))}`);
  if (bad.length > 0) console.log('axe', JSON.stringify(r.violations.map((v) => [v.id, v.impact])));
  return bad;
}

describe('export menu open: axe, layout, CSP, style attributes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [1440, 390]) {
      it(`axe 0 serious/critical on every format, inside the viewport, no horizontal scroll; ${scheme} theme, ${width} px`, async () => {
        const s = await open({ scheme, width, height: width === 390 ? 844 : 900 });
        const { page } = s;
        await openMenu(page);
        const formats: Array<[string, string?]> = [['css'], ['tailwind', 'v3'], ['json'], ['swift'], ['figma'], ['png']];
        for (const [f, v] of formats) {
          await page.click(`#xFormats [data-f=${f}]`);
          if (v !== undefined) await page.click(`#xTw [data-v=${v}]`);
          if (f === 'figma') await page.check('#xFigma2025');
          expect(await axeSerious(page), `${f}`).toEqual([]);
          const box = await page.$eval('#xmenu', (e) => {
            const r = e.getBoundingClientRect();
            return [r.left, r.top, r.right, r.bottom, innerWidth, innerHeight];
          });
          expect(box[0]!).toBeGreaterThanOrEqual(0);
          expect(box[1]!).toBeGreaterThanOrEqual(0);
          expect(box[2]!).toBeLessThanOrEqual(box[4]!);
          expect(box[3]!).toBeLessThanOrEqual(box[5]!);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        }
        await clean(s);
      });
    }
  }

  it('the bar fits at 1440 and 390 without horizontal scroll (menu closed), and the buttons are 36 px high at 1440, 44 px (touch targets, J6) at 390', async () => {
    for (const width of [1440, 390]) {
      const s = await open({ width, height: width === 390 ? 844 : 900 });
      expect(await s.page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect(await s.page.$$eval('#share, #exportBtn', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))).toEqual(width === 390 ? [44, 44] : [36, 36]);
      expect(await s.page.$$eval('#share, #exportBtn', (els) => els.every((e) => e.getBoundingClientRect().right <= innerWidth))).toBe(true);
      await clean(s);
    }
  });
});
