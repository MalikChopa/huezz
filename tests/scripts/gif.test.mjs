import { readFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, downscale, encodeGif, lzwEncode, quantize } from '../../scripts/gif.mjs';
import { decodeGif, lzwDecode } from './gif-decoder.mjs';

/** Deterministic pseudo-random bytes (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A flat-colour test card: `w` x `h` RGBA, rectangles painted from a list. */
function card(w, h, bg, rects = []) {
  const data = new Uint8Array(w * h * 4);
  const paint = (x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  };
  paint(0, 0, w, h, bg);
  for (const [x0, y0, x1, y1, c] of rects) paint(x0, y0, x1, y1, c);
  return data;
}

describe('LZW', () => {
  it('round trip for every minimum code size, on random data', () => {
    const rand = rng(1);
    for (let min = 2; min <= 8; min++) {
      const n = 20000;
      const src = new Uint8Array(n);
      for (let i = 0; i < n; i++) src[i] = Math.floor(rand() * (1 << min));
      const back = lzwDecode(lzwEncode(src, min), min, n);
      expect(back.length, `min code ${min}`).toBe(n);
      expect(Buffer.from(back).equals(Buffer.from(src)), `min code ${min}`).toBe(true);
    }
  });
  it('round trip when the table fills up (clear code mid-stream) and on long runs', () => {
    const rand = rng(2);
    const noisy = new Uint8Array(200000).map(() => Math.floor(rand() * 256));
    const runs = new Uint8Array(300000);
    for (let i = 0; i < runs.length; i++) runs[i] = Math.floor(i / 5000) % 4;
    const flat = new Uint8Array(100000).fill(3);
    for (const [src, min] of [[noisy, 8], [runs, 2], [flat, 2], [Uint8Array.of(1), 2], [Uint8Array.of(0, 1, 0, 1, 0, 1, 0, 1, 0, 1), 2]]) {
      const back = lzwDecode(lzwEncode(src, min), min, src.length);
      expect(Buffer.from(back).equals(Buffer.from(src))).toBe(true);
    }
  });
  it('compresses a flat image far below its size', () => {
    const flat = new Uint8Array(100000);
    expect(lzwEncode(flat, 2).length).toBeLessThan(1000);
  });
});

describe('GIF structure', () => {
  const w = 40;
  const h = 30;
  const red = [200, 30, 30];
  const blue = [20, 40, 220];
  const frames = [
    { data: card(w, h, [255, 255, 255], [[2, 2, 10, 10, red]]), delay: 100 },
    { data: card(w, h, [255, 255, 255], [[2, 2, 10, 10, red], [20, 5, 30, 15, blue]]), delay: 100 },
    { data: card(w, h, [255, 255, 255], [[2, 2, 10, 10, red], [20, 5, 30, 15, blue]]), delay: 150 }, // identical to the previous one
    { data: card(w, h, [0, 0, 0], [[5, 5, 15, 25, blue]]), delay: 200 },
  ];
  for (const palette of ['local', 'global']) {
    it(`header, size, loop, trailer, frame count and delays (${palette} palette)`, () => {
      const gif = encodeGif({ width: w, height: h, frames, palette });
      expect(gif.toString('latin1', 0, 6)).toBe('GIF89a');
      expect(gif.readUInt16LE(6)).toBe(w);
      expect(gif.readUInt16LE(8)).toBe(h);
      expect(gif[gif.length - 1]).toBe(0x3b);
      const info = decodeGif(gif);
      expect(info.header).toBe('GIF89a');
      expect(info.trailer).toBe(true);
      expect(info.loops).toBe(0); // forever
      expect(info.frames.length).toBe(3); // the identical frame is merged into its predecessor
      expect(info.frames.map((f) => f.delay)).toEqual([100, 100 + 150, 200].map((ms) => ms / 10));
      expect(info.comments).toBe(0);
      expect(info.otherExtensions).toEqual([]);
    });
    it(`decodes back to the exact pixels when the image has at most 256 colours (${palette} palette)`, () => {
      const gif = encodeGif({ width: w, height: h, frames, palette });
      const info = decodeGif(gif);
      const expected = [frames[0], frames[1], frames[3]];
      info.frames.forEach((f, i) => expect(Buffer.from(f.rgba).equals(Buffer.from(expected[i].data)), `frame ${i}`).toBe(true));
    });
  }
  it('delta frames only carry the changed rectangle and use a transparent index', () => {
    const info = decodeGif(encodeGif({ width: w, height: h, frames, palette: 'local' }));
    expect(info.frames[0]).toMatchObject({ left: 0, top: 0, w, h });
    expect(info.frames[1]).toMatchObject({ left: 20, top: 5, w: 10, h: 10, transparent: false });
    expect(info.frames[1].disposal).toBe(1);
    expect(info.frames[2].transparent).toBe(false); // everything changed
    const noDelta = encodeGif({ width: w, height: h, frames, delta: false });
    expect(decodeGif(noDelta).frames.length).toBe(4);
  });
  it('transparency index is used when part of the frame is unchanged', () => {
    const a = card(w, h, [255, 255, 255], [[0, 0, 4, 4, red]]);
    const b = card(w, h, [255, 255, 255], [[0, 0, 4, 4, red], [30, 20, 34, 24, blue], [2, 25, 6, 29, [10, 10, 10]]]);
    const info = decodeGif(encodeGif({ width: w, height: h, frames: [{ data: a, delay: 100 }, { data: b, delay: 100 }] }));
    expect(info.frames[1].transparent).toBe(true);
    expect(Buffer.from(info.frames[1].rgba).equals(Buffer.from(b))).toBe(true);
  });
  it('refuses empty input and wrong frame sizes', () => {
    expect(() => encodeGif({ width: 2, height: 2, frames: [] })).toThrow();
    expect(() => encodeGif({ width: 2, height: 2, frames: [{ data: new Uint8Array(4), delay: 100 }] })).toThrow();
  });
});

describe('palette', () => {
  const w = 128;
  const h = 64;
  /** A smooth gradient with far more than 256 distinct colours. */
  const gradient = () => {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) data.set([x * 2, y * 4, 255 - x * 2 + (y & 3), 255], (y * w + x) * 4);
    }
    return data;
  };
  const meanError = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return s / (a.length / 4) / 3;
  };
  it('median cut keeps at most the requested number of colours and is exact below that', () => {
    const hist = new Map();
    for (let i = 0; i < 1000; i++) hist.set(i * 997, 1 + (i % 7));
    expect(quantize(hist, 256).length).toBe(256);
    expect(quantize(hist, 17).length).toBe(17);
    const few = new Map([[0xff0000, 5], [0x00ff00, 5], [0x0000ff, 1]]);
    expect(quantize(few, 256)).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
  });
  it('a gradient of more than 256 colours is encoded with at most 256 entries per table and a small error', () => {
    const data = gradient();
    const distinct = new Set(new Uint32Array(data.buffer)).size;
    expect(distinct).toBeGreaterThan(256);
    const frame = { data, delay: 100 };
    const local = decodeGif(encodeGif({ width: w, height: h, frames: [frame], palette: 'local' }));
    expect(meanError(local.frames[0].rgba, data)).toBeLessThan(6);
    const global = decodeGif(encodeGif({ width: w, height: h, frames: [frame], palette: 'global', maxColors: 64 }));
    expect(new Set(new Uint32Array(global.frames[0].rgba.buffer)).size).toBeLessThanOrEqual(64);
    expect(meanError(global.frames[0].rgba, data)).toBeLessThan(25);
  });
  it('dithering changes the output but keeps the average colour close', () => {
    const data = gradient();
    const plain = decodeGif(encodeGif({ width: w, height: h, frames: [{ data, delay: 100 }], maxColors: 8 })).frames[0].rgba;
    const dithered = decodeGif(encodeGif({ width: w, height: h, frames: [{ data, delay: 100 }], maxColors: 8, dither: true })).frames[0].rgba;
    expect(Buffer.from(dithered).equals(Buffer.from(plain))).toBe(false);
    const mean = (a) => [0, 1, 2].map((c) => a.reduce((s, v, i) => (i % 4 === c ? s + v : s), 0) / (a.length / 4));
    const m0 = mean(data);
    const md = mean(dithered);
    for (let c = 0; c < 3; c++) expect(Math.abs(md[c] - m0[c])).toBeLessThan(6);
  });
});

describe('PNG reader', () => {
  /** Filter one row with PNG filter `type`. */
  function filterRow(type, row, prior, bpp) {
    const out = Buffer.alloc(row.length);
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prior ? prior[i] : 0;
      const c = i >= bpp && prior ? prior[i - bpp] : 0;
      let p = 0;
      if (type === 1) p = a;
      else if (type === 2) p = b;
      else if (type === 3) p = (a + b) >> 1;
      else if (type === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = (row[i] - p) & 255;
    }
    return out;
  }
  function crc32(buf) {
    let c = -1;
    for (const x of buf) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ -1) >>> 0;
  }
  const chunk = (name, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(name), body])));
    return Buffer.concat([len, Buffer.from(name), body, crc]);
  };
  it('decodes the five filter types (RGBA and RGB)', () => {
    for (const [colourType, channels] of [[6, 4], [2, 3]]) {
      const w = 9;
      const h = 10;
      const rand = rng(7);
      const pixels = Buffer.alloc(w * h * channels).map(() => Math.floor(rand() * 256));
      const rows = [];
      for (let y = 0; y < h; y++) {
        const row = pixels.subarray(y * w * channels, (y + 1) * w * channels);
        const prior = y > 0 ? pixels.subarray((y - 1) * w * channels, y * w * channels) : null;
        rows.push(Buffer.from([y % 5]), filterRow(y % 5, row, prior, channels));
      }
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(w, 0);
      ihdr.writeUInt32BE(h, 4);
      ihdr[8] = 8;
      ihdr[9] = colourType;
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
      const img = decodePng(png);
      expect([img.width, img.height]).toEqual([w, h]);
      for (let i = 0; i < w * h; i++) {
        expect([...img.data.subarray(i * 4, i * 4 + 4)]).toEqual([pixels[i * channels], pixels[i * channels + 1], pixels[i * channels + 2], channels === 4 ? pixels[i * channels + 3] : 255]);
      }
    }
  });
  it('rejects anything that is not a PNG', () => {
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow();
  });
  it('reads a PNG written by Chrome (frozen visual reference, 390 x 844)', () => {
    const file = new URL('../visual/ref/frozen-390-light.png', import.meta.url);
    if (!existsSync(file)) return; // reference images are not part of every checkout
    const img = decodePng(readFileSync(file));
    expect([img.width, img.height]).toEqual([390, 844]);
    expect(new Set(new Uint32Array(img.data.buffer)).size).toBeGreaterThan(50); // not blank
  });
});

describe('downscale', () => {
  it('keeps a flat colour, averages blocks exactly and handles fractional factors', () => {
    const flat = card(6, 4, [10, 200, 90]);
    expect([...downscale(flat, 6, 4, 4, 2).slice(0, 4)]).toEqual([10, 200, 90, 255]);
    // 4 x 2 -> 2 x 1: each output pixel is the mean of a 2 x 2 block
    const px = new Uint8Array(4 * 2 * 4);
    const put = (x, y, v) => px.set([v, v, v, 255], (y * 4 + x) * 4);
    put(0, 0, 0); put(1, 0, 100); put(0, 1, 200); put(1, 1, 100); // mean 100
    put(2, 0, 40); put(3, 0, 40); put(2, 1, 80); put(3, 1, 80); // mean 60
    const out = downscale(px, 4, 2, 2, 1);
    expect([out[0], out[4]]).toEqual([100, 60]);
    // 3 -> 2 (factor 1.5): the middle source pixel is shared half and half
    const row = new Uint8Array([0, 0, 0, 255, 90, 90, 90, 255, 180, 180, 180, 255]);
    const two = downscale(row, 3, 1, 2, 1);
    expect([two[0], two[4]]).toEqual([30, 150]); // (0*1 + 90*0.5)/1.5, (90*0.5 + 180*1)/1.5
    expect(downscale(row, 3, 1, 3, 1)).toBe(row);
  });
});
