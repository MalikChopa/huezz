import { readFileSync } from 'node:fs';
import type { Page } from 'playwright-core';

export type Region = { x: number; y: number; w: number; h: number };
export type Comparison = {
  width: number;
  height: number;
  /** Pixels counted (a channel differs by more than `threshold`/255) over the whole image. */
  differing: number;
  percent: number;
  regionDiffering: number;
  regionPercent: number;
  /** PNG data URL: reference faded, differing pixels in red, region outlined in blue. */
  diffImage: string;
};

export const THRESHOLD = 16;

export const dataUrl = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`;
export const readPng = (path: string): Buffer => readFileSync(path);

/**
 * Compares two PNG images inside the browser, through canvas. The bytes are read by Node and passed as
 * data: URLs: an image loaded from file:// would taint the canvas and getImageData would throw.
 * `page` must be a blank page (about:blank): it is used only as a canvas host.
 */
export async function compareImages(page: Page, reference: Buffer, actual: Buffer, region: Region, threshold = THRESHOLD): Promise<Comparison> {
  return page.evaluate(
    async ({ a, b, region: r, threshold: t }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('image failed to load'));
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) throw new Error(`size mismatch ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}`);
      const { width, height } = ia;
      const read = (img: HTMLImageElement) => {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (ctx === null) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, width, height);
      };
      const da = read(ia);
      const db = read(ib);
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const octx = out.getContext('2d');
      if (octx === null) throw new Error('no 2d context');
      const diff = octx.createImageData(width, height);
      let differing = 0;
      let regionDiffering = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const bad =
            Math.abs((da.data[i] ?? 0) - (db.data[i] ?? 0)) > t ||
            Math.abs((da.data[i + 1] ?? 0) - (db.data[i + 1] ?? 0)) > t ||
            Math.abs((da.data[i + 2] ?? 0) - (db.data[i + 2] ?? 0)) > t;
          const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
          if (bad) {
            differing++;
            if (inside) regionDiffering++;
            diff.data[i] = 255;
            diff.data[i + 1] = 0;
            diff.data[i + 2] = 0;
          } else {
            diff.data[i] = 255 - Math.round((255 - (da.data[i] ?? 0)) * 0.25);
            diff.data[i + 1] = 255 - Math.round((255 - (da.data[i + 1] ?? 0)) * 0.25);
            diff.data[i + 2] = 255 - Math.round((255 - (da.data[i + 2] ?? 0)) * 0.25);
          }
          diff.data[i + 3] = 255;
        }
      }
      octx.putImageData(diff, 0, 0);
      octx.strokeStyle = '#0050ff';
      octx.lineWidth = 2;
      octx.strokeRect(r.x, r.y, r.w, r.h);
      const regionPixels = r.w * r.h;
      return {
        width,
        height,
        differing,
        percent: (differing / (width * height)) * 100,
        regionDiffering,
        regionPercent: (regionDiffering / regionPixels) * 100,
        diffImage: out.toDataURL('image/png'),
      };
    },
    { a: dataUrl(reference), b: dataUrl(actual), region, threshold },
  );
}
