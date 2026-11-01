import { describe, expect, it } from 'vitest';
import {
  hexToSeed,
  mulberry32,
  next,
  randomInt,
  randomRange,
  randomSigned,
  randomSign,
  seedToHex,
} from '../../src/core/random';

// Public mulberry32 (Tommy Ettinger), the well-known compact form, kept verbatim as an independent reference.
function reference(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const numerators = (seed: number, n: number): number[] => {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => Math.round(r() * 4294967296));
};

describe('random: mulberry32', () => {
  it('known first outputs (numerators over 2^32), computed with the reference', () => {
    expect(numerators(0, 5)).toEqual([1144304738, 1416247, 958946056, 627933444, 2007157716]);
    expect(numerators(1, 5)).toEqual([2693262067, 11749833, 2265367787, 4213581821, 4159151403]);
    expect(numerators(20261101, 5)).toEqual([2894595015, 3849201826, 3232460265, 1803126279, 2107286910]);
  });

  it('first value of seed 0 follows the public algorithm step by step', () => {
    // a = 0 + 0x6D2B79F5 = 1831565813
    let t = 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    expect((t ^ (t >>> 14)) >>> 0).toBe(1144304738);
    expect(mulberry32(0)()).toBe(1144304738 / 4294967296);
  });

  it('matches the reference on 10 seeds x 1000 outputs', () => {
    for (const seed of [0, 1, 2, 12345, 0x9a3c51e2, 0xffffffff, 20261101, 7, 99, 0x80000000]) {
      const a = mulberry32(seed);
      const b = reference(seed | 0);
      for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
    }
  });

  it('same seed, same sequence; outputs in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('a seed above 2^32 or negative is reduced to uint32', () => {
    expect(numerators(2 ** 32 + 5, 3)).toEqual(numerators(5, 3));
    expect(numerators(-1, 3)).toEqual(numerators(0xffffffff, 3));
  });
});

describe('random: next, hex, ranges', () => {
  it('next(seed) is the first output of mulberry32(seed) as uint32, deterministic, in uint32', () => {
    expect(next(0)).toBe(1144304738);
    expect(next(1)).toBe(2693262067);
    for (const s of [0, 5, 0xffffffff]) {
      expect(next(s)).toBe(next(s));
      expect(Number.isInteger(next(s))).toBe(true);
      expect(next(s)).toBeGreaterThanOrEqual(0);
      expect(next(s)).toBeLessThan(2 ** 32);
    }
  });

  it('seed <- next(seed) gives 1000 distinct seeds and streams that are not shifted copies', () => {
    const seen = new Set<number>();
    let s = 1;
    for (let i = 0; i < 1000; i++) {
      seen.add(s);
      s = next(s);
    }
    expect(seen.size).toBe(1000);
    const a = numerators(1, 6);
    const b = numerators(next(1), 6);
    expect(b.slice(0, 5)).not.toEqual(a.slice(1));
  });

  it('seedToHex: 8 lowercase hex digits; hexToSeed inverts it and rejects bad input', () => {
    expect(seedToHex(0)).toBe('00000000');
    expect(seedToHex(0x9a3c51e2)).toBe('9a3c51e2');
    expect(seedToHex(0xffffffff)).toBe('ffffffff');
    expect(hexToSeed('9a3c51e2')).toBe(0x9a3c51e2);
    expect(hexToSeed('9A3C51E2')).toBe(0x9a3c51e2);
    expect(hexToSeed('00000000')).toBe(0);
    for (const bad of ['', '9a3c51e', '9a3c51e22', 'zzzzzzzz', '0x9a3c51', ' 9a3c51e2', '9a3c51e2\n']) {
      expect(hexToSeed(bad)).toBeNull();
    }
    let s = 3;
    for (let i = 0; i < 200; i++) {
      expect(hexToSeed(seedToHex(s))).toBe(s);
      s = next(s);
    }
  });

  it('range helpers stay inside their bounds and are deterministic', () => {
    const r = mulberry32(9);
    for (let i = 0; i < 2000; i++) {
      const x = randomRange(r, 0.5, 0.58);
      expect(x).toBeGreaterThanOrEqual(0.5);
      expect(x).toBeLessThan(0.58);
      const y = randomSigned(r);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(y).toBeLessThan(1);
      const n = randomInt(r, 7);
      expect(Number.isInteger(n) && n >= 0 && n < 7).toBe(true);
      expect([-1, 1]).toContain(randomSign(r));
    }
    const a = mulberry32(9);
    const b = mulberry32(9);
    expect(randomRange(a, 1, 2)).toBe(randomRange(b, 1, 2));
  });
});
