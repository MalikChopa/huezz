/** Seeded PRNG (mulberry32, public domain algorithm by Tommy Ettinger), rewritten. Pure: no Math.random, no clock. */

export type Rng = () => number;

const STEP = 0x6d2b79f5;
const TWO_32 = 4294967296;

function mix(state: number): number {
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Same seed, same sequence of floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + STEP) >>> 0;
    return mix(a) / TWO_32;
  };
}

/**
 * Next seed (space bar: seed <- next(seed)). It is the first output of mulberry32(seed) as a uint32,
 * so the new stream is not a shifted copy of the old one.
 */
export function next(seed: number): number {
  return mix(((seed >>> 0) + STEP) >>> 0);
}

/** 8 lowercase hex digits (URL format). */
export function seedToHex(seed: number): string {
  return (seed >>> 0).toString(16).padStart(8, '0');
}

/** Exactly 8 hex digits (any case) or null. */
export function hexToSeed(hex: string): number | null {
  return /^[0-9a-fA-F]{8}$/.test(hex) ? parseInt(hex, 16) : null;
}

/** Float in [lo, hi). */
export function randomRange(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** Float in [-1, 1). */
export function randomSigned(rng: Rng): number {
  return rng() * 2 - 1;
}

/** Integer in [0, n). */
export function randomInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** -1 or +1. */
export function randomSign(rng: Rng): 1 | -1 {
  return rng() < 0.5 ? -1 : 1;
}
