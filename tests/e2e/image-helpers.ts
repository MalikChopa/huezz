import { crc32, deflateSync } from 'node:zlib';
import type { FileChooser, Page } from 'playwright-core';

export type Px = [number, number, number, number];

/** A PNG made in memory from a function of the pixel position (RGBA 8 bits). Fake data only, no file on disk. */
export function makePng(width: number, height: number, f: (x: number, y: number) => Px): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) Buffer.from(f(x, y)).copy(raw, row + 1 + x * 4);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const solid = (w: number, h: number, c: [number, number, number]): Buffer => makePng(w, h, () => [...c, 255]);
/** Blue left, orange right: two flat colours. */
export const twoColours = (): Buffer => makePng(96, 64, (x) => (x < 48 ? [20, 90, 200, 255] : [240, 120, 20, 255]));
/** Teal, red and yellow bands plus grey: 4 clearly different colours. */
export const fourColours = (): Buffer =>
  makePng(120, 80, (x, y) => (y < 40 ? (x < 60 ? [20, 140, 130, 255] : [210, 40, 50, 255]) : x < 60 ? [235, 190, 40, 255] : [120, 120, 120, 255]));

export type Upload = { name: string; mimeType: string; buffer: Buffer };
export const png = (name: string, buffer: Buffer): Upload => ({ name, mimeType: 'image/png', buffer });

/** Opens the image sheet from the bar button. */
export async function openImageSheet(page: Page): Promise<void> {
  if (!(await page.isVisible('#imenu'))) await page.click('#imgBtn');
  await page.waitForSelector('#imenu', { state: 'visible' });
}
/** Picks a file through the real file input (the drop zone button opens it). */
export async function pick(page: Page, upload: Upload): Promise<void> {
  await page.setInputFiles('#iFile', upload);
}
export const cards = (page: Page): Promise<string[]> => page.$$eval('#iList .icard', (els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
/** Waits until the cards or an error message are shown, then returns which. */
export async function outcome(page: Page): Promise<{ cards: number; message: string }> {
  await page.waitForFunction(() => document.querySelectorAll('#iList .icard').length > 0 || (!document.getElementById('iMsg')!.hidden && document.getElementById('iMsg')!.textContent !== 'Lecture de l\'image…'), undefined, { timeout: 30_000 });
  return page.evaluate(() => ({
    cards: document.querySelectorAll('#iList .icard').length,
    message: document.getElementById('iMsg')!.hidden ? '' : (document.getElementById('iMsg')!.textContent ?? ''),
  }));
}

/**
 * The native file picker opened by `trigger` (a click or a key): the listener is registered and a round trip to the page has finished BEFORE the trigger runs,
 * so the browser protocol has the interception on (one run of the full suite, under load, saw the picker open before it was ready: "filechooser" never came).
 */
export async function chooserFrom(page: Page, trigger: () => Promise<unknown>): Promise<FileChooser> {
  const wait = page.waitForEvent('filechooser', { timeout: 30_000 });
  await page.evaluate(() => undefined);
  await trigger();
  return wait;
}
