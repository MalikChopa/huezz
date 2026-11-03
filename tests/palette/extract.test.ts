import { describe, expect, it } from 'vitest';
import { toOklch } from '../../src/core/color';
import { contrastRatio } from '../../src/core/contrast';
import { deltaEOK } from '../../src/core/deltaE';
import { HARMONIES } from '../../src/core/harmony';
import { mulberry32 } from '../../src/core/random';
import { extractCandidates, MAX_CANDIDATES, MIN_CANDIDATES, MIN_DE, seedFor, strideFor, type Candidate } from '../../src/palette/extract';
import { generate } from '../../src/palette/generate';
import { ROLES } from '../../src/palette/roles';
import { HEX_RE } from './helpers';

type Px = [number, number, number, number];
/** A synthetic RGBA image from a function of the pixel position. Fake data only. */
function img(w: number, h: number, f: (x: number, y: number) => Px): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(f(x, y), (y * w + x) * 4);
  return a;
}
const flat = (w: number, h: number, c: [number, number, number]): Uint8ClampedArray => img(w, h, () => [...c, 255]);
const run = (p: Uint8ClampedArray, w = 64, h = 64): Candidate[] => extractCandidates(p, w, h);
const hueOf = (hex: string): number => (toOklch(hex) as { h: number }).h;
const hueGap = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
const hasHue = (cs: Candidate[], hue: number, tol = 20): boolean => cs.some((c) => (toOklch(c.base) as { c: number }).c > 0.05 && hueGap(hueOf(c.base), hue) <= tol);
const FOND_REF = '#F0F0F0';

function valid(cs: Candidate[]): void {
  for (const c of cs) {
    expect(c.base).toMatch(HEX_RE);
    expect(HARMONIES).toContain(c.harmony);
    expect(c.seed).toBe(seedFor(c.base));
    for (const mode of ['light', 'dark'] as const) for (const r of ROLES) expect(c.theme[mode][r]).toMatch(HEX_RE);
    expect(c.theme.light.accent).toBe(c.base);
  }
}

describe('shape of the result', () => {
  it('a solid colour: 3 candidates, the same colour under 3 different harmonies, 3 different palettes', () => {
    const cs = run(flat(64, 64, [200, 40, 40]));
    expect(cs).toHaveLength(MIN_CANDIDATES);
    expect(new Set(cs.map((c) => c.base)).size).toBe(1);
    expect(new Set(cs.map((c) => c.harmony)).size).toBe(3);
    expect(new Set(cs.map((c) => JSON.stringify(c.theme))).size).toBe(3);
    expect(hueGap(hueOf(cs[0]!.base), hueOf('#C82828'))).toBeLessThan(5);
    valid(cs);
  });

  it('1 x 1 image: 3 candidates from the one pixel', () => {
    const cs = run(flat(1, 1, [10, 200, 100]), 1, 1);
    expect(cs).toHaveLength(3);
    valid(cs);
  });

  it('everything transparent, or nothing at all: no candidate, no error', () => {
    expect(run(img(8, 8, () => [1, 2, 3, 0]), 8, 8)).toEqual([]);
    expect(run(img(8, 8, () => [255, 0, 0, 127]), 8, 8)).toEqual([]);
    expect(extractCandidates([], 0, 0)).toEqual([]);
    expect(extractCandidates(new Uint8ClampedArray(0), 5, 5)).toEqual([]);
    expect(extractCandidates([1, 2], 10, 10).length).toBeLessThanOrEqual(MAX_CANDIDATES);
  });

  it('transparent pixels are ignored, not read as black', () => {
    const cs = run(img(64, 64, (x) => (x < 32 ? [0, 0, 0, 0] : [30, 160, 60, 255])));
    expect(hasHue(cs, hueOf('#1EA03C'), 8)).toBe(true);
    expect(cs.every((c) => c.harmony !== undefined)).toBe(true);
    expect(new Set(cs.map((c) => c.base)).size).toBe(1);
  });

  it('two flat colours: both are candidates (and the third palette is a harmony variant)', () => {
    const cs = run(img(64, 64, (x) => (x < 32 ? [20, 90, 200, 255] : [250, 180, 20, 255])));
    expect(cs).toHaveLength(3);
    expect(hasHue(cs, hueOf('#145AC8'), 10)).toBe(true);
    expect(hasHue(cs, hueOf('#FAB414'), 10)).toBe(true);
    expect(new Set(cs.map((c) => c.base)).size).toBe(2);
    valid(cs);
  });

  it('a small vivid subject on a big grey background: the vivid colour is a candidate, and comes first', () => {
    const cs = run(img(64, 64, (x, y) => (x >= 28 && x < 35 && y >= 28 && y < 35 ? [230, 20, 40, 255] : [128, 128, 128, 255])));
    expect(hasHue(cs, hueOf('#E61428'), 8)).toBe(true);
    expect(toOklch(cs[0]!.base)!.c).toBeGreaterThan(0.1);
    valid(cs);
  });

  it('a gradient: 3 to 5 candidates, valid palettes', () => {
    const cs = run(img(64, 64, (x) => [x * 4, 100, 255 - x * 4, 255]));
    expect(cs.length).toBeGreaterThanOrEqual(MIN_CANDIDATES);
    expect(cs.length).toBeLessThanOrEqual(MAX_CANDIDATES);
    valid(cs);
  });

  it('a grey image, a white one and a black one still give usable candidates (low chroma allowed)', () => {
    for (const p of [img(64, 64, (x) => [x * 4, x * 4, x * 4, 255]), flat(64, 64, [255, 255, 255]), flat(64, 64, [0, 0, 0]), flat(64, 64, [128, 128, 128])]) {
      const cs = run(p);
      expect(cs.length).toBeGreaterThanOrEqual(MIN_CANDIDATES);
      valid(cs);
    }
  });

  it('a noisy image (seeded): up to 5 candidates, at least MIN_DE apart', () => {
    const r = mulberry32(7);
    const cs = run(img(64, 64, () => [r() * 255, r() * 255, r() * 255, 255]));
    expect(cs).toHaveLength(MAX_CANDIDATES);
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) expect(deltaEOK(cs[i]!.base, cs[j]!.base)!).toBeGreaterThanOrEqual(MIN_DE - 1e-9);
    }
    valid(cs);
  });

  it('a near-duplicate colour is not a second candidate: four bands, two of them almost the same blue', () => {
    const bands: [number, number, number][] = [[46, 98, 214], [52, 104, 220], [210, 40, 50], [235, 190, 40]];
    const cs = run(img(64, 64, (x) => [...(bands[Math.min(3, Math.floor(x / 16))] as [number, number, number]), 255]));
    expect(deltaEOK('#2E62D6', '#3468DC')!).toBeLessThan(0.03);
    expect(cs.length).toBeGreaterThanOrEqual(MIN_CANDIDATES);
    expect(new Set(cs.map((c) => c.base)).size).toBe(3);
    const bases = [...new Set(cs.map((c) => c.base))];
    for (let i = 0; i < bases.length; i++) for (let j = i + 1; j < bases.length; j++) expect(deltaEOK(bases[i]!, bases[j]!)!).toBeGreaterThanOrEqual(MIN_DE - 1e-9);
  });

  it('every base reads on a fond: at least 4.5:1 against a light grey, whatever the image', () => {
    const r = mulberry32(11);
    const images = [flat(64, 64, [255, 255, 255]), flat(64, 64, [250, 240, 120]), img(64, 64, () => [r() * 255, r() * 255, r() * 255, 255]), img(64, 64, (x) => [255, 255 - x * 4, 200, 255])];
    for (const p of images) for (const c of run(p)) expect(contrastRatio(c.base, FOND_REF)!).toBeGreaterThanOrEqual(4.5);
  });
});

describe('harmony choice', () => {
  it('picks the harmony whose palette contains the image\'s other colour (hand-made: B is the accent2 of harmony H built from A)', () => {
    const A = '#2E62D6';
    let checked = 0;
    for (const harmony of HARMONIES) {
      const B = generate({ harmony, seed: seedFor(A), base: A, locks: 0 }).light.accent2;
      if ((deltaEOK(A, B) ?? 0) < MIN_DE) continue; // too close to A to count as another colour
      const cs = run(img(64, 64, (x) => (x < 32 ? [0x2e, 0x62, 0xd6, 255] : [parseInt(B.slice(1, 3), 16), parseInt(B.slice(3, 5), 16), parseInt(B.slice(5, 7), 16), 255])));
      const mine = cs.find((c) => c.base === A);
      expect(mine?.harmony, harmony).toBe(harmony);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it('a candidate is exactly the palette the generator makes from its base, harmony and seed', () => {
    const cs = run(img(64, 64, (x) => [x * 4, 100, 255 - x * 4, 255]));
    for (const c of cs) {
      const g = generate({ harmony: c.harmony, seed: c.seed, base: c.base, locks: 0 });
      expect(c.theme).toEqual({ light: g.light, dark: g.dark });
    }
  });
});

describe('determinism and cost', () => {
  it('the same pixels give the same candidates, 50 runs', () => {
    const r = mulberry32(3);
    const p = img(64, 64, () => [r() * 255, r() * 255, r() * 255, 255]);
    const first = JSON.stringify(run(p));
    for (let i = 0; i < 50; i++) expect(JSON.stringify(run(p))).toBe(first);
  });

  it('the work is bounded: a large image is read with a stride, never more than about 4096 samples', () => {
    expect(strideFor(64, 64)).toBe(1);
    expect(strideFor(10, 10)).toBe(1);
    for (const [w, h] of [[65, 64], [128, 128], [1000, 1000], [4000, 3000], [20000, 20]] as const) {
      const s = strideFor(w, h);
      expect(Math.ceil(w / s) * Math.ceil(h / s)).toBeLessThanOrEqual(4096 * 1.6);
    }
    const r = mulberry32(9);
    const big = img(700, 700, () => [r() * 255, r() * 255, r() * 255, 255]);
    expect(run(big, 700, 700).length).toBeGreaterThanOrEqual(MIN_CANDIDATES);
  });

  it('64 x 64 takes a small fraction of a generous limit (the measured cost is a few ms; the limit is 100 times that)', () => {
    const r = mulberry32(13);
    const p = img(64, 64, () => [r() * 255, r() * 255, r() * 255, 255]);
    const t = performance.now();
    for (let i = 0; i < 5; i++) run(p);
    expect(performance.now() - t).toBeLessThan(2000);
  });
});
