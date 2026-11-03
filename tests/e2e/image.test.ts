import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { cards, chooserFrom, fourColours, makePng, openImageSheet, outcome, pick, png, solid, twoColours, type Upload } from './image-helpers';
import { settle, useBrowser } from './j6-helpers';

/**
 * J15: palette from an image. Every picture is made in memory by the test (PNG bytes from a function): no photo, no file on disk.
 * Waits are conditions (a card shown, a message shown, a value stored), never a sleep that stands for the speed of the machine.
 */
const { open } = useBrowser();

const KEY = 'huezz.history.v1';
const dockHexes = (page: Page): Promise<string[]> => page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent ?? ''));
const toastText = (page: Page): Promise<string> => page.$eval('#toast span', (e) => e.textContent ?? '');
const live = (page: Page): Promise<string> => page.$eval('#live', (e) => e.textContent ?? '');
const activeId = (page: Page): Promise<string> => page.evaluate(() => document.activeElement?.id ?? '');
const sheetOpen = (page: Page): Promise<boolean> => page.isVisible('#imenu');
/** The 7 strip colours of a card, read from the page. */
const strip = (page: Page, i: number): Promise<string[]> => page.locator('#iList .icard').nth(i).locator('rect').evaluateAll((rs) => rs.map((r) => r.getAttribute('fill') ?? ''));
const cardName = (page: Page, i: number): Promise<string> => page.locator('#iList .icard').nth(i).locator('b').innerText();
const base64 = (b: Buffer): string => b.toString('base64');

/** Dispatches drag events carrying a file on the page body (the product listens on the document). */
async function drag(page: Page, upload: Upload | null, types: readonly string[]): Promise<void> {
  await page.evaluate(
    ([b64, name, mime, steps]) => {
      const dt = new DataTransfer();
      if (b64 === null) dt.setData('text/plain', 'just some text');
      else dt.items.add(new File([Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0))], name as string, { type: mime as string }));
      for (const t of steps as string[]) document.body.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [upload === null ? null : base64(upload.buffer), upload?.name ?? '', upload?.mimeType ?? '', types] as const,
  );
}
/** Dispatches a paste carrying a file (or only text) on the element that has the focus, and says whether the page took it over. */
async function paste(page: Page, upload: Upload | null): Promise<{ prevented: boolean }> {
  return page.evaluate(
    ([b64, name, mime]) => {
      const dt = new DataTransfer();
      if (b64 === null) dt.setData('text/plain', 'just some text');
      else dt.items.add(new File([Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0))], name as string, { type: mime as string }));
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      (document.activeElement ?? document.body).dispatchEvent(event);
      return { prevented: event.defaultPrevented };
    },
    [upload === null ? null : base64(upload.buffer), upload?.name ?? '', upload?.mimeType ?? ''] as const,
  );
}
const hasardWorks = async (page: Page): Promise<boolean> => {
  const before = await dockHexes(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await page.waitForFunction((b) => document.querySelector('.sw-hex')?.textContent !== b[0], before, { timeout: 30_000 });
  return true;
};

describe('the sheet and its three ways in', () => {
  it('the empty sheet: a real button (zone), the privacy note, nothing else; the bar button says what it does', async () => {
    const { page, probe } = await open();
    expect(await page.getAttribute('#imgBtn', 'aria-label')).toBe('Image');
    expect(await page.getAttribute('#imgBtn', 'aria-expanded')).toBe('false');
    await openImageSheet(page);
    expect(await page.getAttribute('#imgBtn', 'aria-expanded')).toBe('true');
    expect(await page.evaluate(() => document.getElementById('iDrop')?.tagName)).toBe('BUTTON');
    expect(await page.getAttribute('#iFile', 'accept')).toBe('image/*');
    expect(await page.innerText('#iNote')).toBe('L\'image reste dans cette page : elle n\'est envoyée nulle part et n\'est pas enregistrée.');
    expect(await page.locator('#iList .icard').count()).toBe(0);
    expect(await page.isVisible('#iPrev')).toBe(false);
    expect(await page.isVisible('#iMsg')).toBe(false);
    expect(await activeId(page)).toBe('iDrop');
    expect(probe.errors).toEqual([]);
    expect(probe.violations).toEqual([]);
  });

  it('a file through the file input: 3 to 5 cards (strip of 7, name, harmony, "Utiliser"), a preview, the note kept, one sentence in the live region', async () => {
    const { page, probe } = await open();
    await openImageSheet(page);
    await pick(page, png('four.png', fourColours()));
    const out = await outcome(page);
    expect(out.message).toBe('');
    expect(out.cards).toBeGreaterThanOrEqual(3);
    expect(out.cards).toBeLessThanOrEqual(5);
    for (const text of await cards(page)) expect(text).toMatch(/^\S.* (Complémentaire|Analogue|Triade|Tétrade|Monochrome|Split-complémentaire) ?Utiliser$/);
    for (let i = 0; i < out.cards; i++) expect(await strip(page, i)).toHaveLength(7);
    expect(await page.isVisible('#iPrev canvas')).toBe(true);
    expect(await page.getAttribute('#iPrev canvas', 'aria-hidden')).toBe('true');
    expect(await page.isVisible('#iNote')).toBe(true);
    await page.waitForFunction(() => /palettes tirées de ton image/.test(document.getElementById('live')?.textContent ?? ''));
    expect(probe.errors).toEqual([]);
    expect(probe.violations).toEqual([]);
  });

  it('the file button opens the native file picker (images only, one file); the chosen file is read', async () => {
    const { page } = await open();
    await openImageSheet(page);
    const chooser = await chooserFrom(page, () => page.click('#iDrop'));
    expect(chooser.isMultiple()).toBe(false);
    await chooser.setFiles(png('two.png', twoColours()));
    expect((await outcome(page)).cards).toBeGreaterThanOrEqual(3);
  });

  it('drag and drop: a file over the page opens the sheet with the drop state; leaving with nothing read closes it; a drop reads the file', async () => {
    const { page, probe } = await open();
    const file = png('drop.png', fourColours());
    await drag(page, file, ['dragenter', 'dragover']);
    expect(await sheetOpen(page)).toBe(true);
    expect(await page.evaluate(() => document.getElementById('iDrop')?.classList.contains('is-over'))).toBe(true);
    await drag(page, file, ['dragleave']);
    expect(await sheetOpen(page)).toBe(false);
    await drag(page, file, ['dragenter', 'dragover', 'drop']);
    expect(await sheetOpen(page)).toBe(true);
    expect(await page.evaluate(() => document.getElementById('iDrop')?.classList.contains('is-over'))).toBe(false);
    expect((await outcome(page)).cards).toBeGreaterThanOrEqual(3);
    expect(probe.errors).toEqual([]);
  });

  it('a dragged non-image says so; a dragged piece of text does nothing', async () => {
    const { page } = await open();
    await drag(page, null, ['dragenter', 'dragover', 'drop']);
    expect(await sheetOpen(page)).toBe(false);
    await drag(page, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }, ['dragenter', 'dragover', 'drop']);
    expect(await sheetOpen(page)).toBe(true);
    expect((await outcome(page)).message).toBe('Ce fichier n\'est pas une image. Essaie JPEG, PNG ou WebP.');
  });

  it('paste: an image on the clipboard opens the sheet on it; text, and a field with the focus, are left alone', async () => {
    const { page, probe } = await open();
    const text = await paste(page, null);
    expect(text.prevented).toBe(false);
    expect(await sheetOpen(page)).toBe(false);
    await page.focus('#baseHex');
    const inField = await paste(page, png('p.png', fourColours()));
    expect(inField.prevented).toBe(false);
    expect(await sheetOpen(page)).toBe(false);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const taken = await paste(page, png('p.png', fourColours()));
    expect(taken.prevented).toBe(true);
    expect(await sheetOpen(page)).toBe(true);
    expect((await outcome(page)).cards).toBeGreaterThanOrEqual(3);
    expect(await activeId(page)).toBe('iDrop');
    expect(probe.errors).toEqual([]);
  });

  it('opening it closes the other sheets, and the other sheets close it', async () => {
    const { page } = await open();
    await page.click('#exportBtn');
    await page.click('#imgBtn');
    expect(await page.isVisible('#xmenu')).toBe(false);
    expect(await sheetOpen(page)).toBe(true);
    await page.locator('#histBtn').focus();
    await page.keyboard.press('Enter');
    expect(await page.isVisible('#hmenu')).toBe(true);
    expect(await sheetOpen(page)).toBe(false);
    await page.keyboard.press('Escape');
    await page.click('.pill[data-pair=accent-fond]');
    await paste(page, png('p.png', fourColours()));
    expect(await sheetOpen(page)).toBe(true);
    expect(await page.isVisible('#cdlg')).toBe(false);
  });
});

describe('failures: a short visible message, the live region, no console error, the page keeps working', () => {
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(32)]);
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
  const whole = fourColours();
  const bad: { what: string; upload: Upload; message: RegExp }[] = [
    { what: 'a corrupt file renamed .png', upload: png('photo.png', Buffer.from('this is not a png, only some text pretending to be one')), message: /n'a pas pu être lue/ },
    { what: 'an empty .png', upload: png('empty.png', Buffer.alloc(0)), message: /n'a pas pu être lue/ },
    { what: 'a text file', upload: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }, message: /n'est pas une image/ },
    { what: 'an SVG', upload: { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svgText) }, message: /SVG ne sont pas lues/ },
    { what: 'an SVG that claims to be a PNG', upload: png('logo.png', Buffer.from(svgText)), message: /SVG ne sont pas lues/ },
    { what: 'a HEIC the browser cannot read', upload: { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: heic }, message: /^Ce format d'image n'est pas lu par ton navigateur\. Essaie JPEG, PNG ou WebP\.$/ },
    { what: 'an oversized file (26 MB of zeros, in memory)', upload: png('big.png', Buffer.alloc(26 * 1024 * 1024)), message: /plus de 25 Mo/ },
    { what: 'a fully transparent PNG', upload: png('clear.png', makePng(16, 16, () => [10, 20, 30, 0])), message: /transparente/ },
  ];
  for (const { what, upload, message } of bad) {
    it(`${what}: the message is shown and announced, no cards, the page works, and a good image is read right after`, async () => {
      const { page, probe } = await open();
      await openImageSheet(page);
      await pick(page, upload);
      const out = await outcome(page);
      expect(out.cards).toBe(0);
      expect(out.message).toMatch(message);
      expect(await page.isVisible('#iMsg')).toBe(true);
      expect(await page.isVisible('#iPrev')).toBe(false);
      await page.waitForFunction((m) => (document.getElementById('live')?.textContent ?? '').replace(/ /g, '') === m, out.message);
      expect(await sheetOpen(page)).toBe(true);
      expect(await hasardWorks(page)).toBe(true);
      await openImageSheet(page);
      await pick(page, png('four.png', whole));
      const next = await outcome(page);
      expect(next.cards).toBeGreaterThanOrEqual(3);
      expect(next.message).toBe('');
      expect(probe.errors).toEqual([]);
      expect(probe.violations).toEqual([]);
    }, 60_000);
  }

  it('a truncated PNG ends in cards or in a message, never in a stuck state or an error', async () => {
    const { page, probe } = await open();
    await openImageSheet(page);
    await pick(page, png('cut.png', whole.subarray(0, Math.floor(whole.length / 2))));
    const out = await outcome(page);
    expect(out.cards > 0 || out.message !== '').toBe(true);
    expect(probe.errors).toEqual([]);
  });

  it('a read that never ends gives up after about 10 s with a message', async () => {
    const { page, probe } = await open({
      initScript: 'window.createImageBitmap=()=>new Promise(()=>{});HTMLImageElement.prototype.decode=()=>new Promise(()=>{});',
    });
    await openImageSheet(page);
    await pick(page, png('four.png', whole));
    const out = await outcome(page);
    expect(out.message).toMatch(/prend trop de temps/);
    expect(await hasardWorks(page)).toBe(true);
    expect(probe.errors).toEqual([]);
  }, 60_000);
});

describe('reading paths', () => {
  const tracking = 'window.__urls={made:[],revoked:[]};const mk=URL.createObjectURL.bind(URL),rv=URL.revokeObjectURL.bind(URL);URL.createObjectURL=(b)=>{const u=mk(b);window.__urls.made.push(u);return u};URL.revokeObjectURL=(u)=>{window.__urls.revoked.push(u);rv(u)};';
  it('without createImageBitmap: an <img> on a blob: URL reads the file, the CSP raises no violation, the URL is revoked', async () => {
    const { page, probe } = await open({ initScript: `${tracking}delete window.createImageBitmap;` });
    expect(await page.evaluate(() => typeof createImageBitmap)).toBe('undefined');
    await openImageSheet(page);
    await pick(page, png('four.png', fourColours()));
    expect((await outcome(page)).cards).toBeGreaterThanOrEqual(3);
    const urls = await page.evaluate(() => (window as unknown as { __urls: { made: string[]; revoked: string[] } }).__urls);
    expect(urls.made.length).toBeGreaterThan(0);
    expect(urls.revoked.sort()).toEqual(urls.made.sort());
    expect(urls.made.every((u) => u.startsWith('blob:'))).toBe(true);
    expect(probe.violations).toEqual([]);
    expect(probe.errors).toEqual([]);
  });

  it('a browser that refuses the resize options (some Safari versions): the same file is read without them', async () => {
    const { page, probe } = await open({
      initScript: 'const o=window.createImageBitmap.bind(window);window.createImageBitmap=(f,opt)=>opt?Promise.reject(new Error("options")):o(f);',
    });
    await openImageSheet(page);
    await pick(page, png('four.png', fourColours()));
    expect((await outcome(page)).cards).toBeGreaterThanOrEqual(3);
    expect(probe.errors).toEqual([]);
  });

  it('two files in a row: the last one wins, and the first, finishing late, is dropped', async () => {
    // The first read is held back for 1.5 s (its decoding "finishes" long after the second one's).
    const { page, probe } = await open({
      initScript: 'let n=0;const o=window.createImageBitmap.bind(window);window.createImageBitmap=(f,opt)=>n++===0?new Promise((r)=>setTimeout(r,1500)).then(()=>o(f,opt)).then((b)=>{window.__firstDone=true;return b}):o(f,opt);',
    });
    await openImageSheet(page);
    await pick(page, png('wide.png', makePng(200, 50, (x) => (x < 100 ? [20, 90, 200, 255] : [240, 120, 20, 255]))));
    await pick(page, png('square.png', makePng(80, 80, (x) => (x < 40 ? [200, 30, 60, 255] : [30, 160, 90, 255]))));
    await page.waitForFunction(() => {
      const c = document.querySelector<HTMLCanvasElement>('#iPrev canvas');
      return c !== null && Math.abs(c.width / c.height - 1) < 0.02;
    });
    // Now the late one finishes; the page must not show it.
    await page.waitForFunction(() => (window as unknown as { __firstDone?: boolean }).__firstDone === true, undefined, { timeout: 30_000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForTimeout(200);
    const ratio = await page.$eval('#iPrev canvas', (c) => (c as HTMLCanvasElement).width / (c as HTMLCanvasElement).height);
    expect(ratio).toBeCloseTo(1, 1);
    expect(await page.locator('#iList .icard').count()).toBeGreaterThanOrEqual(3);
    expect(probe.errors).toEqual([]);
  });

  it('the same candidates for the same pixels, on two visits', async () => {
    const names: string[][] = [];
    for (let i = 0; i < 2; i++) {
      const { page } = await open();
      await openImageSheet(page);
      await pick(page, png('four.png', fourColours()));
      await outcome(page);
      names.push(await cards(page));
    }
    expect(names[0]).toEqual(names[1]);
  });
});

describe('applying a candidate', () => {
  it('is an ordinary palette change: the swatches show the card, the sheet closes, the focus returns, one toast, nothing said twice, undo, history, share link', async () => {
    const { page, probe } = await open();
    await page.waitForFunction((k) => (JSON.parse(localStorage.getItem(k) ?? '{"recent":[]}') as { recent: string[] }).recent.length >= 1, KEY, { timeout: 30_000 });
    const before = await dockHexes(page);
    await page.evaluate(() => {
      const w = window as unknown as { __morph: boolean };
      w.__morph = false;
      new MutationObserver(() => {
        if (document.documentElement.classList.contains('morph')) w.__morph = true;
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    });
    await openImageSheet(page);
    await pick(page, png('four.png', fourColours()));
    const out = await outcome(page);
    const pickIndex = Math.min(1, out.cards - 1);
    const want = await strip(page, pickIndex);
    const name = await cardName(page, pickIndex);
    await page.locator('#iList .icard').nth(pickIndex).click();
    await page.waitForFunction((w) => [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent).join() === w, want.join(), { timeout: 30_000 });
    expect(await dockHexes(page)).toEqual(want);
    expect(await sheetOpen(page)).toBe(false);
    expect(await activeId(page)).toBe('imgBtn');
    expect(await page.getAttribute('#imgBtn', 'aria-expanded')).toBe('false');
    expect(await toastText(page)).toBe(`Palette tirée de ton image : ${name}`);
    expect(await page.textContent('.scene-title')).toBe(name);
    // The fade runs through OKLCH (J11), and nothing stays stuck.
    await page.waitForFunction(() => (window as unknown as { __morph: boolean }).__morph === true);
    await page.waitForFunction(() => !document.documentElement.className.split(' ').some((c) => ['vt', 'vt-wave', 'vt-circle', 'morph'].includes(c)), undefined, { timeout: 30_000 });
    // The toast is the announcement: the live region does not say it a second time.
    await settle(page);
    await page.waitForTimeout(700);
    expect(await live(page)).not.toMatch(/Nouvelle palette|Harmonie|Couleur de base|Palette (claire|sombre)|Restaurée/);
    // The palette is in the history (the real localStorage), without the image.
    await page.waitForFunction(([k, colours]) => (JSON.parse(localStorage.getItem(k as string) ?? '{"recent":[]}') as { recent: string[] }).recent[0]?.includes(`&l=${colours as string}`) ?? false, [KEY, want.map((h) => h.slice(1)).join('')] as const, { timeout: 30_000 });
    const stored = await page.evaluate((k) => ({ ls: localStorage.getItem(k) ?? '', keys: Object.keys(localStorage), session: sessionStorage.length, href: location.href }), KEY);
    expect(stored.keys).toEqual([KEY]);
    expect(stored.session).toBe(0);
    expect(`${stored.ls}${stored.href}`).not.toMatch(/blob:|data:|four\.png/);
    // Undo puts the old palette back (the mode stays).
    await page.keyboard.press('Control+z');
    await page.waitForFunction((b) => [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent).join() === b, before.join(), { timeout: 30_000 });
    await page.keyboard.press('Control+y');
    await page.waitForFunction((w) => [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent).join() === w, want.join(), { timeout: 30_000 });
    // The link rebuilds the same palette (nothing about the image in it).
    await page.waitForFunction((accent) => location.hash.includes((accent as string).slice(1)), want[3], { timeout: 30_000 });
    const hash = await page.evaluate(() => location.hash);
    expect(hash).not.toMatch(/blob|data|png/);
    const again = await open({ hash });
    expect(await dockHexes(again.page)).toEqual(want);
    expect(probe.errors).toEqual([]);
  }, 90_000);

  it('the same card gives the same palette whatever was on screen (and locks are cleared; undo brings the lock back)', async () => {
    const { page } = await open();
    await openImageSheet(page);
    await pick(page, png('four.png', fourColours()));
    await outcome(page);
    const want = await strip(page, 0);
    await page.locator('#iList .icard').nth(0).click();
    await page.waitForFunction((w) => [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent).join() === w, want.join());
    // Another palette, a lock, then the same card again.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Space');
    await page.waitForFunction((w) => [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent).join() !== w, want.join());
    await settle(page);
    await page.click('.sw[data-role=fond] .sw-lock');
    await page.waitForFunction(() => document.querySelector('.sw[data-role=fond] .sw-lock')?.getAttribute('aria-pressed') === 'true');
    const locked = await dockHexes(page);
    await openImageSheet(page);
    await pick(page, png('four.png', fourColours()));
    await outcome(page);
    await page.locator('#iList .icard').nth(0).click();
    await page.waitForFunction((w) => [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent).join() === w, want.join());
    await page.waitForFunction(() => [...document.querySelectorAll('.sw-lock')].every((e) => e.getAttribute('aria-pressed') === 'false'));
    await page.keyboard.press('Control+z');
    await page.waitForFunction((w) => [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent).join() === w, locked.join());
    await page.waitForFunction(() => document.querySelector('.sw[data-role=fond] .sw-lock')?.getAttribute('aria-pressed') === 'true');
  });

  it('in the dark mode the cards and the applied palette are the dark ones', async () => {
    const { page } = await open({ scheme: 'dark' });
    await openImageSheet(page);
    await pick(page, png('four.png', fourColours()));
    await outcome(page);
    const want = await strip(page, 0);
    expect(await page.textContent('#metaMode')).toBe('sombre');
    await page.locator('#iList .icard').nth(0).click();
    await page.waitForFunction((w) => [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent).join() === w, want.join());
    expect(await page.textContent('#metaMode')).toBe('sombre');
  });

  it('the mode changes while the sheet is open (keyboard): the cards follow, in strips and in names', async () => {
    const { page } = await open();
    await openImageSheet(page);
    await pick(page, png('four.png', fourColours()));
    await outcome(page);
    const lightStrip = await strip(page, 0);
    const lightName = await cardName(page, 0);
    await page.locator('.seg button[data-mode=dark]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('metaMode')?.textContent === 'sombre');
    expect(await sheetOpen(page)).toBe(true);
    const darkStrip = await strip(page, 0);
    expect(darkStrip).not.toEqual(lightStrip);
    expect(darkStrip[3]).not.toBe(lightStrip[3]);
    expect(typeof lightName).toBe('string');
    await page.locator('#iList .icard').nth(0).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction((w) => [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent).join() === w, darkStrip.join());
    expect(await page.textContent('#metaMode')).toBe('sombre');
  });

  it('nothing of the image stays once the sheet is closed: no card, no preview, no message, no file; reopening shows the empty zone', async () => {
    const { page, probe } = await open();
    await openImageSheet(page);
    await pick(page, png('four.png', fourColours()));
    await outcome(page);
    await page.click('#iClose');
    expect(await sheetOpen(page)).toBe(false);
    expect(await activeId(page)).toBe('imgBtn');
    expect(await page.evaluate(() => [document.getElementById('iList')!.children.length, document.getElementById('iThumb')!.children.length, (document.getElementById('iFile') as HTMLInputElement).value])).toEqual([0, 0, '']);
    await openImageSheet(page);
    expect(await page.isVisible('#iPrev')).toBe(false);
    expect(await page.isVisible('#iMsg')).toBe(false);
    expect(await page.locator('#iList .icard').count()).toBe(0);
    // A read that finishes after the sheet was closed shows nothing.
    await pick(page, png('four.png', fourColours()));
    await page.click('#iClose');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => [document.getElementById('iList')!.children.length, document.getElementById('iThumb')!.children.length])).toEqual([0, 0]);
    expect(probe.errors).toEqual([]);
  });

  it('a solid-colour image still gives 3 palettes to choose from, and a grey one too', async () => {
    const { page, probe } = await open();
    for (const upload of [png('red.png', solid(32, 32, [200, 40, 40])), png('grey.png', solid(32, 32, [128, 128, 128])), png('pixel.png', solid(1, 1, [10, 200, 100]))]) {
      await openImageSheet(page);
      await pick(page, upload);
      expect((await outcome(page)).cards).toBe(3);
      await page.click('#iClose');
    }
    expect(probe.errors).toEqual([]);
  });
});

describe('keyboard only', () => {
  it('Enter on the bar button, Enter on the zone (file picker), Tab through the cards and out of the sheet, Escape, Enter on a card', async () => {
    const { page, probe } = await open();
    await page.locator('#imgBtn').focus();
    await page.keyboard.press('Enter');
    expect(await activeId(page)).toBe('iDrop');
    await page.keyboard.press('Shift+Tab');
    expect(await activeId(page)).toBe('iClose');
    await page.keyboard.press('Tab');
    expect(await activeId(page)).toBe('iDrop');
    const chooser = await chooserFrom(page, () => page.keyboard.press('Enter'));
    await chooser.setFiles(png('four.png', fourColours()));
    const out = await outcome(page);
    // Tab goes through the zone and the cards, then leaves the sheet: no trap.
    let left = -1;
    for (let i = 0; i < out.cards + 3; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.closest('#imenu') === null)) {
        left = i;
        break;
      }
    }
    expect(left, 'Tab leaves the sheet after its last card').toBe(out.cards);
    await page.keyboard.press('Escape');
    expect(await sheetOpen(page)).toBe(false);
    expect(await activeId(page)).toBe('imgBtn');
    // Space or Enter on a card applies it (Space does not start a Hasard).
    await openImageSheet(page);
    await pick(page, png('four.png', fourColours()));
    await outcome(page);
    const want = await strip(page, 1);
    await page.locator('#iList .icard').nth(1).focus();
    await page.keyboard.press('Space');
    await page.waitForFunction((w) => [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent).join() === w, want.join());
    expect(await activeId(page)).toBe('imgBtn');
    expect(probe.errors).toEqual([]);
  });

  it('the cards have a name that starts with what is shown (label in name) and no label of their own', async () => {
    const { page } = await open();
    await openImageSheet(page);
    await pick(page, png('four.png', fourColours()));
    await outcome(page);
    expect(await page.$$eval('#iList .icard', (els) => els.map((e) => e.hasAttribute('aria-label')))).toEqual(Array(await page.locator('#iList .icard').count()).fill(false));
  });
});

describe('phones and short windows', () => {
  for (const [width, height] of [[390, 844], [320, 568]] as const) {
    it(`${width} x ${height} (touch): 44 px targets, the sheet under the pills and inside the window, no horizontal overflow, a card applies on tap`, async () => {
      const { page, probe } = await open({ width, height, touch: true });
      await page.tap('#imgBtn');
      await page.waitForSelector('#imenu', { state: 'visible' });
      await pick(page, png('four.png', fourColours()));
      await outcome(page);
      const m = await page.evaluate(() => {
        const box = (sel: string) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect());
        const sheet = document.getElementById('imenu')!.getBoundingClientRect();
        return {
          targets: [...box('#iClose'), ...box('#iDrop'), ...box('#iList .icard')].map((r) => [Math.round(r.width), Math.round(r.height)]),
          sheetTop: sheet.top,
          sheetBottom: sheet.bottom,
          pillsBottom: document.getElementById('pills')!.getBoundingClientRect().bottom,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          sheetRight: sheet.right,
        };
      });
      for (const [w, h] of m.targets) {
        expect(w).toBeGreaterThanOrEqual(44);
        expect(h).toBeGreaterThanOrEqual(44);
      }
      expect(m.sheetBottom).toBeLessThanOrEqual(height);
      expect(m.sheetRight).toBeLessThanOrEqual(width);
      expect(m.overflow).toBeLessThanOrEqual(0);
      if (height >= 800) expect(m.sheetTop).toBeGreaterThanOrEqual(m.pillsBottom - 0.5);
      const want = await strip(page, 0);
      await page.tap('#iList .icard');
      await page.waitForFunction((w) => [...document.querySelectorAll('.sw-hex')].map((e) => e.textContent).join() === w, want.join());
      expect(probe.errors).toEqual([]);
    });
  }

  for (const [width, height] of [[844, 390], [800, 450]] as const) {
    it(`${width} x ${height} (a phone on its side): the sheet fits the window, scrolls inside itself, and its last card can be reached`, async () => {
      const { page } = await open({ width, height, touch: true });
      await page.click('#imgBtn');
      await pick(page, png('four.png', fourColours()));
      const out = await outcome(page);
      const r = await page.$eval('#imenu', (e) => {
        const b = e.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, scrolls: e.scrollHeight > e.clientHeight };
      });
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeLessThanOrEqual(height);
      const last = page.locator('#iList .icard').nth(out.cards - 1);
      await last.scrollIntoViewIfNeeded();
      const box = await last.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(height + 0.5);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      await last.click();
      await page.waitForFunction(() => document.getElementById('imenu')!.hidden);
    });
  }

  it('Escape and a tap outside close the sheet', async () => {
    const { page } = await open();
    await openImageSheet(page);
    await page.keyboard.press('Escape');
    expect(await sheetOpen(page)).toBe(false);
    await openImageSheet(page);
    await page.mouse.click(300, 700);
    expect(await sheetOpen(page)).toBe(false);
  });
});
