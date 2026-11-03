import { linearToOklab, normalizeHue, rgbToLinear } from '../core/color';
import { contrastRatio } from '../core/contrast';
import { fromOklch } from '../core/gamut';
import { HARMONIES, type Harmony } from '../core/harmony';
import { parseHex } from '../core/hex';
import { generate } from './generate';
import { ROLES, type ThemeColors } from './roles';

/** A base colour and a harmony: the generator builds the 7 roles from them. `seed` is derived from the base, so the same candidate is always the same palette. */
export type Candidate = { base: string; harmony: Harmony; seed: number; theme: ThemeColors };

type Lab = readonly [number, number, number];
type Cluster = { lab: Lab; share: number; score: number };

export const MIN_CANDIDATES = 3;
export const MAX_CANDIDATES = 5;
/** Boxes of the clustering. */
const K = 8;
/** Pixels under this alpha are ignored. */
const ALPHA_MIN = 128;
/** Samples read at most (64 x 64): a larger array is read with a stride. */
const MAX_SAMPLES = 4096;
/** A cluster under this share of the pixels is noise (anti-aliasing, a speck). */
const MIN_SHARE = 0.01;
/** Minimum ΔE OK between two candidate bases; relaxed when fewer than MIN_CANDIDATES colours are that far apart. */
export const MIN_DE = 0.1;
const MIN_DE_RELAXED = 0.06;
const L_MIN = 0.35;
/** The accent must hold 4.5:1 on the palest, darkest-looking fond the generator makes (L 0.945), with a little margin. */
const CONTRAST_TARGET = 4.6;
const FOND_REF = fromOklch({ l: 0.945, c: 0, h: 0 });

const dist2 = (a: Lab, b: Lab): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const dist = (a: Lab, b: Lab): number => Math.sqrt(dist2(a, b));

function mean(points: readonly Lab[]): Lab {
  let l = 0;
  let a = 0;
  let b = 0;
  for (const p of points) {
    l += p[0];
    a += p[1];
    b += p[2];
  }
  const n = Math.max(1, points.length);
  return [l / n, a / n, b / n];
}

const sse = (points: readonly Lab[]): number => {
  const m = mean(points);
  return points.reduce((sum, p) => sum + dist2(p, m), 0);
};

/** Splits a box at the mean of its widest axis (so two flat colours always part); null if all points are alike. */
function split(points: readonly Lab[]): [Lab[], Lab[]] | null {
  const m = mean(points);
  let axis = 0;
  let widest = 1e-9;
  for (let k = 0; k < 3; k++) {
    const v = points.reduce((sum, p) => sum + ((p[k] as number) - (m[k] as number)) ** 2, 0);
    if (v > widest) {
      widest = v;
      axis = k;
    }
  }
  if (widest === 1e-9) return null;
  const lo = points.filter((p) => (p[axis] as number) <= (m[axis] as number));
  const hi = points.filter((p) => (p[axis] as number) > (m[axis] as number));
  return lo.length > 0 && hi.length > 0 ? [lo, hi] : null;
}

/** Variance-driven box splitting (the box with the most squared error first), then 3 rounds of k-means from the box means. Fixed order, no randomness. */
function cluster(points: readonly Lab[]): { lab: Lab; n: number }[] {
  let boxes: Lab[][] = [[...points]];
  const done = new Set<Lab[]>();
  while (boxes.length < K) {
    let pick: Lab[] | null = null;
    let worst = 1e-9;
    for (const box of boxes) {
      const e = done.has(box) ? 0 : sse(box);
      if (e > worst) {
        worst = e;
        pick = box;
      }
    }
    if (pick === null) break;
    const parts = split(pick);
    if (parts === null) done.add(pick);
    else boxes = boxes.flatMap((b) => (b === pick ? parts : [b]));
  }
  let centres = boxes.map(mean);
  const counts = new Array<number>(centres.length).fill(0);
  for (let round = 0; round < 3; round++) {
    const groups: Lab[][] = centres.map(() => []);
    for (const p of points) {
      let best = 0;
      for (let i = 1; i < centres.length; i++) if (dist2(p, centres[i] as Lab) < dist2(p, centres[best] as Lab)) best = i;
      (groups[best] as Lab[]).push(p);
    }
    centres = groups.map((g, i) => (g.length > 0 ? mean(g) : (centres[i] as Lab)));
    groups.forEach((g, i) => (counts[i] = g.length));
  }
  return centres.map((lab, i) => ({ lab, n: counts[i] as number })).filter((c) => c.n > 0);
}

/** Step between two samples, in pixels, in both directions: 1 up to 64 x 64, larger beyond so that no more than about MAX_SAMPLES pixels are read. */
export const strideFor = (width: number, height: number): number => Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_SAMPLES)));

function readLabs(px: ArrayLike<number>, width: number, height: number): Lab[] {
  const stride = strideFor(width, height);
  const out: Lab[] = [];
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      if ((px[i + 3] ?? 0) < ALPHA_MIN) continue;
      const lab = linearToOklab(rgbToLinear({ r: px[i] ?? 0, g: px[i + 1] ?? 0, b: px[i + 2] ?? 0 }));
      out.push([lab.l, lab.a, lab.b]);
    }
  }
  return out;
}

const labOf = (hex: string): Lab => {
  const rgb = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  const lab = linearToOklab(rgbToLinear(rgb));
  return [lab.l, lab.a, lab.b];
};

/** The cluster colour as an accent: same hue and chroma, lightness brought into the range where the accent reads on the fond (gamut handled by `fromOklch`). */
function accentOf(lab: Lab): string {
  const c = Math.hypot(lab[1], lab[2]);
  const h = c < 1e-4 ? 0 : normalizeHue((Math.atan2(lab[2], lab[1]) * 180) / Math.PI);
  let l = Math.max(L_MIN, lab[0]);
  let hex = fromOklch({ l, c, h });
  while (l > L_MIN && (contrastRatio(hex, FOND_REF) ?? 21) < CONTRAST_TARGET) {
    l = Math.max(L_MIN, l - 0.01);
    hex = fromOklch({ l, c, h });
  }
  return hex;
}

/** FNV-1a of the hex text: a fixed uint32 seed for a base colour. */
export function seedFor(base: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) h = Math.imul(h ^ base.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

type Ranked = { harmony: Harmony; theme: ThemeColors; gap: number };

/** The 6 harmonies, best first: for each, the palette is built and every other dominant colour is matched to its nearest role (light mode); the gap is the mean ΔE OK, weighted by cluster score. */
function rankHarmonies(base: string, others: readonly Cluster[]): Ranked[] {
  const seed = seedFor(base);
  const total = others.reduce((sum, o) => sum + o.score, 0);
  return HARMONIES.map((harmony) => {
    const made = generate({ harmony, seed, locks: 0, base });
    const theme = { light: made.light, dark: made.dark };
    const roles = ROLES.map((r) => labOf(theme.light[r]));
    const gap = total === 0 ? 0 : others.reduce((sum, o) => sum + o.score * Math.min(...roles.map((p) => dist(o.lab, p))), 0) / total;
    return { harmony, theme, gap };
  }).sort((a, b) => a.gap - b.gap);
}

/**
 * Pure and deterministic. `pixels`: RGBA, row by row, about 64 x 64 (a larger array is read with a stride).
 * Returns 0 candidates only when no pixel is opaque enough; otherwise 3 to 5 (fewer than 3 distinct colours: the same colours under their next best harmonies).
 */
export function extractCandidates(pixels: ArrayLike<number>, width: number, height: number): Candidate[] {
  const points = readLabs(pixels, Math.max(0, Math.floor(width)), Math.max(0, Math.floor(height)));
  if (points.length === 0) return [];
  const all: Cluster[] = cluster(points).map((c) => {
    const share = c.n / points.length;
    return { lab: c.lab, share, score: Math.sqrt(share) * (Math.hypot(c.lab[1], c.lab[2]) + 0.015) };
  });
  const clusters = all.filter((c) => c.share >= MIN_SHARE);
  const pool = (clusters.length > 0 ? clusters : all).sort((a, b) => b.score - a.score);
  const picks = (gap: number): { cluster: Cluster; base: string }[] => {
    const chosen: { cluster: Cluster; base: string }[] = [];
    for (const c of pool) {
      const base = accentOf(c.lab);
      if (chosen.length < MAX_CANDIDATES && chosen.every((p) => dist(labOf(p.base), labOf(base)) >= gap)) chosen.push({ cluster: c, base });
    }
    return chosen;
  };
  let chosen = picks(MIN_DE);
  if (chosen.length < MIN_CANDIDATES) chosen = picks(MIN_DE_RELAXED);
  const ranks = chosen.map((p) => rankHarmonies(p.base, pool.filter((o) => dist(o.lab, p.cluster.lab) >= MIN_DE)));
  const make = (i: number, r: number): Candidate => {
    const pick = (ranks[i] as Ranked[])[r] as Ranked;
    const base = (chosen[i] as { base: string }).base;
    return { base, harmony: pick.harmony, seed: seedFor(base), theme: pick.theme };
  };
  const out = chosen.map((_, i) => make(i, 0));
  for (let r = 1; out.length < MIN_CANDIDATES && r < HARMONIES.length; r++) {
    for (let i = 0; i < chosen.length && out.length < MIN_CANDIDATES; i++) out.push(make(i, r));
  }
  return out;
}
