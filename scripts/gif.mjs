// Dependency-free GIF89a encoder (LZW, median-cut palette, optional dithering, frame deltas)
// and a capture command that records the built page in Chrome (playwright-core, channel "chrome").
//
//   node scripts/gif.mjs capture [--out assets/demo.gif] [--frames-dir <dir>]
//   node scripts/gif.mjs shots   [--out-dir assets]
//
// Library use: import { encodeGif, lzwEncode, quantize, decodePng } from './gif.mjs'.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FIXED_HASH } from '../tests/fixed-hash.mjs';

// ---------------------------------------------------------------- PNG reader

/** Decode an 8-bit, non-interlaced PNG (grey, grey+alpha, RGB, RGBA, palette) into RGBA bytes. */
export function decodePng(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 8 || sig.some((b, i) => buf[i] !== b)) throw new Error('decodePng: not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let plte = null;
  let trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const name = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (name === 'PLTE') plte = body;
    else if (name === 'tRNS') trns = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error('decodePng: only 8-bit non-interlaced PNG is supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`decodePng: colour type ${type} unsupported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? rows[dst + x - channels] : 0;
      const b = y > 0 ? rows[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? rows[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`decodePng: bad filter ${filter}`);
      rows[dst + x] = v & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let r;
    let g;
    let b;
    let a = 255;
    if (type === 6) [r, g, b, a] = [rows[s], rows[s + 1], rows[s + 2], rows[s + 3]];
    else if (type === 2) [r, g, b] = [rows[s], rows[s + 1], rows[s + 2]];
    else if (type === 0) r = g = b = rows[s];
    else if (type === 4) {
      r = g = b = rows[s];
      a = rows[s + 1];
    } else {
      const k = rows[s];
      r = plte[k * 3];
      g = plte[k * 3 + 1];
      b = plte[k * 3 + 2];
      if (trns && k < trns.length) a = trns[k];
    }
    data.set([r, g, b, a], i * 4);
  }
  return { width, height, data };
}

// ---------------------------------------------------------------- LZW

/**
 * GIF variant of LZW. Returns the raw code stream (not cut into sub-blocks).
 * `indices`: Uint8Array of palette indices; `minCodeSize`: 2 to 8.
 */
export function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out = [];
  let acc = 0;
  let nbits = 0;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const table = new Int16Array(4096 * 256).fill(-1);
  const emit = (code) => {
    acc |= code << nbits;
    nbits += codeSize;
    while (nbits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      nbits -= 8;
    }
  };
  emit(clear);
  if (indices.length > 0) {
    let cur = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (cur << 8) | k;
      const hit = table[key];
      if (hit >= 0) {
        cur = hit;
        continue;
      }
      emit(cur);
      if (next === 4096) {
        emit(clear);
        table.fill(-1);
        next = eoi + 1;
        codeSize = minCodeSize + 1;
      } else {
        if (next >= 1 << codeSize) codeSize++;
        table[key] = next++;
      }
      cur = k;
    }
    emit(cur);
  }
  emit(eoi);
  if (nbits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------- palette

const packRgb = (r, g, b) => (r << 16) | (g << 8) | b;

/**
 * Median cut. `histogram`: Map<packed 0xRRGGBB, count>. Returns an array of [r, g, b], at most `maxColors`
 * entries; when the image has no more distinct colours than that, the palette is exact.
 */
export function quantize(histogram, maxColors) {
  const entries = [...histogram].map(([rgb, count]) => ({ r: rgb >> 16, g: (rgb >> 8) & 255, b: rgb & 255, count }));
  if (entries.length <= maxColors) return entries.map((e) => [e.r, e.g, e.b]);
  const makeBox = (items) => {
    let lo = [255, 255, 255];
    let hi = [0, 0, 0];
    let total = 0;
    for (const e of items) {
      const c = [e.r, e.g, e.b];
      for (let k = 0; k < 3; k++) {
        if (c[k] < lo[k]) lo[k] = c[k];
        if (c[k] > hi[k]) hi[k] = c[k];
      }
      total += e.count;
    }
    const range = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    // Channels are weighted like the eye (green first) so the split favours visible differences.
    const weighted = [range[0] * 0.8, range[1] * 1.0, range[2] * 0.6];
    const axis = weighted.indexOf(Math.max(...weighted));
    return { items, total, axis, score: weighted[axis] * Math.sqrt(total) };
  };
  const boxes = [makeBox(entries)];
  while (boxes.length < maxColors) {
    let best = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].items.length > 1 && (best < 0 || boxes[i].score > boxes[best].score)) best = i;
    }
    if (best < 0) break;
    const box = boxes[best];
    const key = ['r', 'g', 'b'][box.axis];
    const sorted = box.items.slice().sort((p, q) => p[key] - q[key]);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i].count;
      cut = i + 1;
      if (acc >= box.total / 2) break;
    }
    boxes.splice(best, 1, makeBox(sorted.slice(0, cut)), makeBox(sorted.slice(cut)));
  }
  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const e of box.items) {
      r += e.r * e.count;
      g += e.g * e.count;
      b += e.b * e.count;
    }
    return [Math.round(r / box.total), Math.round(g / box.total), Math.round(b / box.total)];
  });
}

/** Nearest palette entry (redmean weighting), memoised per packed colour. */
function makeMapper(palette) {
  const cache = new Map();
  return (r, g, b) => {
    const key = packRgb(r, g, b);
    let hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const mr = (r + p[0]) / 2;
      const dr = r - p[0];
      const dg = g - p[1];
      const db = b - p[2];
      const d = (2 + mr / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mr) / 256) * db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
        if (d === 0) break;
      }
    }
    cache.set(key, best);
    return best;
  };
}

// ---------------------------------------------------------------- encoder

const u16 = (n) => [n & 255, (n >> 8) & 255];

function subBlocks(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.subarray(i, Math.min(i + 255, bytes.length));
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

function tableBits(count) {
  let bits = 1;
  while (1 << bits < count) bits++;
  return bits;
}

/**
 * Encode frames as an animated GIF89a.
 * @param {object} o
 * @param {number} o.width
 * @param {number} o.height
 * @param {{data: Uint8Array|Uint8ClampedArray, delay: number}[]} o.frames RGBA pixels (width*height*4), delay in milliseconds
 * @param {number} [o.loop=0] 0 = loop forever
 * @param {'global'|'local'} [o.palette='global'] one table for the whole file (median cut over every changed pixel), or one per frame
 * @param {boolean} [o.dither=false] Floyd-Steinberg error diffusion on the changed pixels
 * @param {number} [o.maxColors=256]
 * @param {boolean} [o.delta=true] unchanged pixels become transparent over the previous frame (identical frames are merged)
 * @returns {Buffer}
 */
export function encodeGif({ width, height, frames, loop = 0, palette = 'global', dither = false, maxColors = 256, delta = true }) {
  if (!frames.length) throw new Error('encodeGif: no frame');
  const px = (f) => new Uint32Array(f.data.buffer, f.data.byteOffset, width * height);
  for (const f of frames) if (f.data.length !== width * height * 4) throw new Error('encodeGif: wrong frame size');
  // 1. Which pixels change in each frame (the first frame: all of them).
  const steps = [];
  let prev = null;
  for (const f of frames) {
    const cur = px(f);
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    if (!prev || !delta) {
      x0 = 0;
      y0 = 0;
      x1 = width - 1;
      y1 = height - 1;
    } else {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (cur[y * width + x] !== prev[y * width + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
    }
    if (x1 < 0) {
      steps[steps.length - 1].delay += f.delay; // identical frame: only wait longer
    } else steps.push({ cur, prev: delta ? prev : null, box: { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, delay: f.delay });
    prev = cur;
  }
  // 2. Histograms of the changed pixels.
  const rgbOf = (v) => ((v & 255) << 16) | (v & 0xff00) | ((v >> 16) & 255); // Uint32 little-endian ABGR -> 0xRRGGBB
  const histOf = (step, into) => {
    const { cur, prev: p, box } = step;
    for (let y = box.y0; y < box.y0 + box.h; y++) {
      for (let x = box.x0; x < box.x0 + box.w; x++) {
        const i = y * width + x;
        if (p && cur[i] === p[i]) continue;
        const k = rgbOf(cur[i]);
        into.set(k, (into.get(k) ?? 0) + 1);
      }
    }
    return into;
  };
  const usesTransparency = (step) => {
    if (!step.prev) return false;
    const { cur, prev: p, box } = step;
    for (let y = box.y0; y < box.y0 + box.h; y++) {
      for (let x = box.x0; x < box.x0 + box.w; x++) if (cur[y * width + x] === p[y * width + x]) return true;
    }
    return false;
  };
  const anyTransparency = steps.some(usesTransparency);
  const budget = (transparent) => maxColors - (transparent ? 1 : 0);
  let globalPalette = null;
  if (palette === 'global') {
    const all = new Map();
    for (const s of steps) histOf(s, all);
    globalPalette = quantize(all, budget(anyTransparency));
  }
  // 3. Bytes.
  const out = [];
  const push = (...b) => {
    for (const x of b) out.push(x);
  };
  push(...Buffer.from('GIF89a', 'latin1'), ...u16(width), ...u16(height));
  let gBits = 0;
  if (globalPalette) {
    gBits = tableBits(globalPalette.length + (anyTransparency ? 1 : 0));
    push(0x80 | (7 << 4) | (gBits - 1), 0, 0);
    for (let i = 0; i < 1 << gBits; i++) push(...(globalPalette[i] ?? [0, 0, 0]));
  } else push(7 << 4, 0, 0);
  push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0', 'latin1'), 3, 1, ...u16(loop), 0);
  for (const step of steps) {
    const { cur, prev: p, box } = step;
    const transparent = usesTransparency(step);
    const pal = globalPalette ?? quantize(histOf(step, new Map()), budget(transparent));
    const transIdx = transparent ? pal.length : -1;
    const bits = globalPalette ? gBits : tableBits(pal.length + (transparent ? 1 : 0));
    const map = makeMapper(pal);
    const idx = new Uint8Array(box.w * box.h);
    const errR = dither ? new Float32Array((box.w + 2) * 2) : null;
    const errG = dither ? new Float32Array((box.w + 2) * 2) : null;
    const errB = dither ? new Float32Array((box.w + 2) * 2) : null;
    for (let y = 0; y < box.h; y++) {
      const row = y & 1;
      const other = row ^ 1;
      if (dither) {
        errR.fill(0, other * (box.w + 2), (other + 1) * (box.w + 2));
        errG.fill(0, other * (box.w + 2), (other + 1) * (box.w + 2));
        errB.fill(0, other * (box.w + 2), (other + 1) * (box.w + 2));
      }
      for (let x = 0; x < box.w; x++) {
        const i = (box.y0 + y) * width + box.x0 + x;
        if (p && cur[i] === p[i]) {
          idx[y * box.w + x] = transIdx;
          continue;
        }
        const v = cur[i];
        let r = v & 255;
        let g = (v >> 8) & 255;
        let b = (v >> 16) & 255;
        if (dither) {
          const e = row * (box.w + 2) + x + 1;
          r = Math.max(0, Math.min(255, r + errR[e]));
          g = Math.max(0, Math.min(255, g + errG[e]));
          b = Math.max(0, Math.min(255, b + errB[e]));
        }
        const k = map(Math.round(r), Math.round(g), Math.round(b));
        idx[y * box.w + x] = k;
        if (dither) {
          const q = pal[k];
          const dr = r - q[0];
          const dg = g - q[1];
          const db = b - q[2];
          const e = row * (box.w + 2) + x + 1;
          const n = other * (box.w + 2) + x + 1;
          errR[e + 1] += (dr * 7) / 16;
          errG[e + 1] += (dg * 7) / 16;
          errB[e + 1] += (db * 7) / 16;
          errR[n - 1] += (dr * 3) / 16;
          errG[n - 1] += (dg * 3) / 16;
          errB[n - 1] += (db * 3) / 16;
          errR[n] += (dr * 5) / 16;
          errG[n] += (dg * 5) / 16;
          errB[n] += (db * 5) / 16;
          errR[n + 1] += dr / 16;
          errG[n + 1] += dg / 16;
          errB[n + 1] += db / 16;
        }
      }
    }
    const delay = Math.max(2, Math.round(step.delay / 10)); // centiseconds; browsers treat < 2 as 10
    push(0x21, 0xf9, 4, (1 << 2) | (transparent ? 1 : 0), ...u16(delay), transparent ? transIdx : 0, 0);
    push(0x2c, ...u16(box.x0), ...u16(box.y0), ...u16(box.w), ...u16(box.h), globalPalette ? 0 : 0x80 | (bits - 1));
    if (!globalPalette) for (let i = 0; i < 1 << bits; i++) push(...(pal[i] ?? [0, 0, 0]));
    const minCode = Math.max(2, bits);
    push(minCode);
    push(...subBlocks(lzwEncode(idx, minCode)));
  }
  push(0x3b);
  return Buffer.from(out);
}

// ---------------------------------------------------------------- resize

/** Area-average downscale of RGBA pixels (each destination pixel is the exact coverage-weighted mean of the source). */
export function downscale(data, width, height, newWidth, newHeight) {
  if (newWidth === width && newHeight === height) return data;
  const out = new Uint8Array(newWidth * newHeight * 4);
  const fx = width / newWidth;
  const fy = height / newHeight;
  for (let y = 0; y < newHeight; y++) {
    const y0 = y * fy;
    const y1 = y0 + fy;
    for (let x = 0; x < newWidth; x++) {
      const x0 = x * fx;
      const x1 = x0 + fx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.min(height, Math.ceil(y1)); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.min(width, Math.ceil(x1)); sx++) {
          const w = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0));
          const i = (sy * width + sx) * 4;
          r += data[i] * w;
          g += data[i + 1] * w;
          b += data[i + 2] * w;
          a += data[i + 3] * w;
          wsum += w;
        }
      }
      const o = (y * newWidth + x) * 4;
      out[o] = Math.round(r / wsum);
      out[o + 1] = Math.round(g / wsum);
      out[o + 2] = Math.round(b / wsum);
      out[o + 3] = Math.round(a / wsum);
    }
  }
  return out;
}

// ---------------------------------------------------------------- capture (Chrome)

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** The page always opens on the fixed starting link (the product itself opens on a random palette). */
async function openPage(chromium, { width, height, scheme = 'light', touch = false, hash = FIXED_HASH }) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: scheme,
    reducedMotion: 'no-preference',
    isMobile: touch,
    hasTouch: touch,
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(resolve(root, 'dist/index.html')).href + hash);
  await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'));
  await sleep(600);
  return { browser, page };
}

/** The 10 s storyboard; returns { width, height, frames } with RGBA frames and their real delays. */
export async function captureStoryboard({ width = 1440, height = 900, outWidth = 960, fps = 10, seconds = 10, frameSink } = {}) {
  const { chromium } = await import('playwright-core');
  const { browser, page } = await openPage(chromium, { width, height });
  const cdp = await page.context().newCDPSession(page);
  const grab = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })).data, 'base64');
  const click = (selector) => page.evaluate((s) => document.querySelector(s).click(), selector);
  // Times in ms from the start of the recording.
  const script = [
    ...[1000, 1900, 2800, 3700, 4600].map((t, i) => ({ t, run: () => (i === 2 ? page.selectOption('#harm', 'triad') : click('#hasard')) })),
    { t: 5000, run: () => click('[data-mode="dark"]') },
    { t: 6600, run: () => click('.pill[data-pair="accent-fond"]') },
    { t: 7900, run: () => click('#cdClose') },
    { t: 8100, run: () => click('#exportBtn') },
    { t: 8300, run: () => click('[data-f="css"]') },
    { t: 9100, run: () => click('[data-f="swift"]') },
  ];
  const frames = [];
  const stamps = [];
  const t0 = performance.now();
  let k = 0;
  const actions = [];
  while (true) {
    const now = performance.now() - t0;
    if (now > seconds * 1000) break;
    while (k < script.length && script[k].t <= now) actions.push(script[k++].run());
    const started = performance.now() - t0;
    const shot = await grab();
    stamps.push(started);
    frames.push(shot);
    frameSink?.(frames.length - 1, shot);
    const wait = 1000 / fps - (performance.now() - t0 - started);
    if (wait > 0) await sleep(wait);
  }
  await Promise.all(actions);
  await browser.close();
  const decoded = frames.map((png) => decodePng(png));
  const outHeight = Math.round((decoded[0].height * outWidth) / decoded[0].width);
  for (const d of decoded) {
    d.data = downscale(d.data, d.width, d.height, outWidth, outHeight);
    d.width = outWidth;
    d.height = outHeight;
  }
  const delays = stamps.map((s, i) => (i + 1 < stamps.length ? stamps[i + 1] - s : 1000 / fps));
  return {
    width: decoded[0].width,
    height: decoded[0].height,
    frames: decoded.map((d, i) => ({ data: d.data, delay: delays[i] })),
    stamps,
  };
}

/** JPEG screenshots of the built page; quality is lowered until the file is within `maxBytes`. */
export async function captureShots(outDir, { maxBytes = 200 * 1024 } = {}) {
  const { chromium } = await import('playwright-core');
  const jobs = [
    { name: 'screenshot-light.jpg', width: 1440, height: 900, scheme: 'light', dark: false },
    { name: 'screenshot-dark.jpg', width: 1440, height: 900, scheme: 'dark', dark: true },
    { name: 'screenshot-mobile.jpg', width: 390, height: 844, scheme: 'light', touch: true, dark: false },
  ];
  mkdirSync(outDir, { recursive: true });
  const report = [];
  for (const job of jobs) {
    const { browser, page } = await openPage(chromium, job);
    if (job.dark) {
      await page.evaluate(() => document.querySelector('[data-mode="dark"]').click());
      await sleep(700);
    }
    let q = 90;
    let jpg = await page.screenshot({ type: 'jpeg', quality: q });
    while (jpg.length > maxBytes && q > 30) {
      q -= 5;
      jpg = await page.screenshot({ type: 'jpeg', quality: q });
    }
    writeFileSync(resolve(outDir, job.name), jpg);
    report.push({ name: job.name, bytes: jpg.length, quality: q });
    await browser.close();
  }
  return report;
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'capture') {
    const out = resolve(arg('out', resolve(root, 'assets/demo.gif')));
    const framesDir = arg('frames-dir', null);
    if (framesDir) mkdirSync(framesDir, { recursive: true });
    const cap = await captureStoryboard({
      width: Number(arg('width', 1440)),
      height: Number(arg('height', 900)),
      outWidth: Number(arg('out-width', 960)),
      fps: Number(arg('fps', 10)),
      frameSink: framesDir ? (i, png) => writeFileSync(resolve(framesDir, `f${String(i).padStart(3, '0')}.png`), png) : undefined,
    });
    const gif = encodeGif({ ...cap, palette: arg('palette', 'global'), dither: process.argv.includes('--dither') });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, gif);
    console.log(`${out}: ${gif.length} bytes, ${cap.frames.length} captured frames, ${cap.width}x${cap.height}`);
  } else if (cmd === 'shots') {
    const res = await captureShots(resolve(arg('out-dir', resolve(root, 'assets'))));
    for (const r of res) console.log(`${r.name}: ${r.bytes} bytes (quality ${r.quality})`);
  } else {
    console.error('usage: node scripts/gif.mjs capture [--out file] [--frames-dir dir] [--width 1440] [--height 900] [--out-width 960] [--fps 10] [--palette global|local] [--dither]\n       node scripts/gif.mjs shots [--out-dir dir]');
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
