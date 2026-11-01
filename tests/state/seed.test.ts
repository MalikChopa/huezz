import { describe, expect, it } from 'vitest';
import { ROLES } from '../../src/palette/roles';
import { randomSeed, type SeedSource } from '../../src/state/seed';
import { initialState } from '../../src/state/state';
import { encodeHash, decodeHash } from '../../src/state/url';
import { stateFromShared } from '../../src/state/share';
import { FIXED_HASH, FIXED_SEED, fixedState } from '../fixed-state';

const HEX = /^#[0-9A-F]{6}$/;

describe('randomSeed (J9: the first palette is random at every visit)', () => {
  it('draws from crypto.getRandomValues when it exists', () => {
    const calls: number[] = [];
    const source: SeedSource = {
      getRandomValues(a) {
        calls.push(a.length);
        a[0] = 0xdeadbeef;
        return a;
      },
    };
    expect(randomSeed(source, () => 1, () => 0.5)).toBe(0xdeadbeef);
    expect(calls).toEqual([1]);
  });
  it('always a uint32', () => {
    for (let i = 0; i < 1000; i++) {
      const s = randomSeed();
      expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
    }
  });
  it('without crypto: the clock mixed with Math.random, still a uint32 and different for different inputs', () => {
    const a = randomSeed(null, () => 1_700_000_000_000, () => 0.25);
    const b = randomSeed(null, () => 1_700_000_000_001, () => 0.25);
    const c = randomSeed(null, () => 1_700_000_000_000, () => 0.75);
    for (const s of [a, b, c]) expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(randomSeed(null, () => 5, () => 0.5)).toBe(randomSeed(null, () => 5, () => 0.5));
  });
  it('a crypto that throws or is not usable falls back to the clock instead of throwing', () => {
    const broken: SeedSource = {
      getRandomValues() {
        throw new Error('no entropy');
      },
    };
    expect(randomSeed(broken, () => 42, () => 0.5)).toBe(randomSeed(null, () => 42, () => 0.5));
    expect(randomSeed({} as SeedSource, () => 42, () => 0.5)).toBe(randomSeed(null, () => 42, () => 0.5));
  });
  it('200 fresh first screens: at least 150 distinct accents, 7 valid roles in both modes, the 5 control pairs pass AA, no exception', () => {
    const accents = new Set<string>();
    const failures: string[] = [];
    for (let i = 0; i < 200; i++) {
      const s = initialState('light', randomSeed());
      for (const mode of ['light', 'dark'] as const) {
        for (const role of ROLES) if (!HEX.test(s.theme[mode][role])) failures.push(`${s.seed} ${mode} ${role} ${s.theme[mode][role]}`);
        for (const pair of s.report[mode]) if (!pair.informational && !pair.ok) failures.push(`${s.seed} ${mode} ${pair.id} ${pair.ratio.toFixed(2)}`);
      }
      accents.add(s.theme.light.accent);
    }
    expect(failures).toEqual([]);
    expect(accents.size).toBeGreaterThanOrEqual(150);
  });
});

describe('the fixed starting link of the tests', () => {
  it('is what the generator gives for seed 0x01380f55, complementary, light, no lock (the old first screen)', () => {
    const s = fixedState('light');
    expect(s.seed).toBe(FIXED_SEED);
    expect(s.theme.light.accent).toBe('#137A6B');
    expect(encodeHash({ mode: s.mode, harmony: s.harmony, seed: s.seed, locks: s.locks, theme: s.theme })).toBe(FIXED_HASH);
  });
  it('restores the same 14 colours when loaded as a link', () => {
    const r = decodeHash(FIXED_HASH);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(stateFromShared(r.value).theme).toEqual(fixedState('light').theme);
  });
});
