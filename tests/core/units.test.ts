import { describe, expect, it } from 'vitest';
import { normalizeHue, toOklch, srgbToLinear, linearToSrgb } from '../../src/core/color';
import {
  AAA_LARGE, AAA_NORMAL, AA_LARGE, AA_NORMAL, contrastRatio, fixContrast, isLargeText, levels,
  relativeLuminance, truncate2, wcag,
} from '../../src/core/contrast';
import { fromOklch, inSrgbGamut, reduceChroma } from '../../src/core/gamut';
import { maxChroma } from '../../src/core/gamut';
import { HARMONIES, HARMONY_OFFSETS, harmonyHues } from '../../src/core/harmony';
import { parseHex } from '../../src/core/hex';

describe('truncate2', () => {
  it('truncates, never rounds', () => {
    expect(truncate2(4.4781)).toBe('4.47');
    expect(truncate2(4.4999)).toBe('4.49');
    expect(truncate2(21)).toBe('21.00');
    expect(truncate2(4.5)).toBe('4.50');
    expect(truncate2(4.35)).toBe('4.35');
    expect(truncate2(7.0047)).toBe('7.00');
  });
});

describe('levels and thresholds', () => {
  it('constants', () => {
    expect([AA_NORMAL, AA_LARGE, AAA_NORMAL, AAA_LARGE]).toEqual([4.5, 3, 7, 4.5]);
  });
  it('AA normal boundary', () => {
    expect(levels(4.5).aa).toBe(true);
    expect(levels(4.4999).aa).toBe(false);
  });
  it('AA large boundary (3)', () => {
    expect(levels(3).aaLarge).toBe(true);
    expect(levels(2.9999).aaLarge).toBe(false);
  });
  it('AAA normal boundary (7)', () => {
    expect(levels(7).aaa).toBe(true);
    expect(levels(6.9999).aaa).toBe(false);
  });
  it('AAA large boundary (4.5)', () => {
    expect(levels(4.5).aaaLarge).toBe(true);
    expect(levels(4.4999).aaaLarge).toBe(false);
  });
  it('large text: >= 24 px, or >= 18.66 px bold', () => {
    expect(isLargeText(24, false)).toBe(true);
    expect(isLargeText(23.99, false)).toBe(false);
    expect(isLargeText(18.66, true)).toBe(true);
    expect(isLargeText(18.65, true)).toBe(false);
    expect(isLargeText(18.66, false)).toBe(false);
  });
  it('WCAG criterion exposes id, measure and levels', () => {
    expect(wcag.id).toBe('wcag');
    expect(wcag.measure('#000000', '#FFFFFF')).toBeCloseTo(21, 10);
    expect(wcag.levels(4.5)).toEqual(levels(4.5));
  });
});

describe('invalid input does not throw', () => {
  it('returns null / ok:false', () => {
    expect(parseHex('nope')).toBeNull();
    expect(toOklch('nope')).toBeNull();
    expect(relativeLuminance('#12')).toBeNull();
    expect(contrastRatio('#FFFFFF', 'zzz')).toBeNull();
    expect(wcag.measure('', '#000000')).toBeNull();
    expect(fixContrast('nope', '#FFFFFF', 4.5)).toEqual({ ok: false, best: null });
    expect(fixContrast('#FFFFFF', 'xyz!', 4.5)).toEqual({ ok: false, best: null });
  });
  it('accepts short and prefix-less hex', () => {
    expect(contrastRatio('fff', '#000')).toBeCloseTo(21, 10);
    expect(toOklch('f00')).toEqual(toOklch('#FF0000'));
  });
});

describe('conversions and gamut', () => {
  it('sRGB transfer function round trips across the thresholds', () => {
    for (const v of [0, 0.003, 0.0031308, 0.04, 0.05, 0.5, 1]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 12);
    }
  });
  it('normalizeHue stays in [0, 360)', () => {
    expect(normalizeHue(-30)).toBe(330);
    expect(normalizeHue(360)).toBe(0);
    expect(normalizeHue(725)).toBe(5);
    expect(normalizeHue(-1e-20)).toBe(0);
  });
  it('toOklch hue is in [0, 360)', () => {
    for (const hex of ['#FF0000', '#00FF00', '#0000FF', '#FF00FF', '#FF0001', '#0F7C74']) {
      const o = toOklch(hex);
      expect(o).not.toBeNull();
      expect(o!.h).toBeGreaterThanOrEqual(0);
      expect(o!.h).toBeLessThan(360);
    }
  });
  it('white has no stray hue (cleanup inside toOklch)', () => {
    expect(toOklch('#FFFFFF')).toMatchObject({ c: 0, h: 0 });
    expect(toOklch('#777777')).toMatchObject({ c: 0, h: 0 });
  });
  it('out-of-gamut input yields a valid uppercase hex; L is kept, not clamped', () => {
    for (const c of [{ l: 0.7, c: 0.4, h: 145 }, { l: 0.5, c: 1, h: 300 }, { l: 2, c: 0.2, h: 10 }, { l: -1, c: 0.2, h: 10 }, { l: 0.5, c: 0.1, h: -90 }]) {
      expect(fromOklch(c)).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(fromOklch({ l: 2, c: 0.2, h: 10 })).toBe('#FFFFFF');
    expect(fromOklch({ l: -1, c: 0.2, h: 10 })).toBe('#000000');
    const reduced = reduceChroma({ l: 0.7, c: 0.4, h: 145 });
    expect(reduced.l).toBe(0.7);
    expect(reduced.c).toBeLessThan(0.4);
    expect(inSrgbGamut(reduced)).toBe(true);
    const back = toOklch(fromOklch({ l: 0.7, c: 0.4, h: 145 }))!;
    expect(Math.abs(back.l - 0.7)).toBeLessThan(5e-3);
  });
  it('NaN input does not throw', () => {
    expect(fromOklch({ l: NaN, c: NaN, h: NaN })).toBe('#000000');
  });
});

describe('harmony', () => {
  it('offsets match the architecture', () => {
    expect(HARMONY_OFFSETS.complementary).toEqual([180]);
    expect(HARMONY_OFFSETS.analogous).toEqual([-40, 40]);
    expect(HARMONY_OFFSETS.triad).toEqual([120, 240]);
    expect(HARMONY_OFFSETS.tetrad).toEqual([90, 180, 270]);
    expect(HARMONY_OFFSETS.monochrome).toEqual([0]);
    expect(HARMONY_OFFSETS['split-complementary']).toEqual([150, 210]);
    expect(HARMONIES).toHaveLength(6);
    expect(HARMONIES).toContain('split-complementary');
  });
  it('harmonyHues normalises into [0, 360)', () => {
    expect(harmonyHues(350, 'complementary')).toEqual([170]);
    expect(harmonyHues(10, 'analogous')).toEqual([330, 50]);
    expect(harmonyHues(300, 'split-complementary')).toEqual([90, 150]);
    expect(harmonyHues(300, 'triad')).toEqual([60, 180]);
    expect(harmonyHues(200, 'tetrad')).toEqual([290, 20, 110]);
    expect(harmonyHues(123.5, 'monochrome')).toEqual([123.5]);
  });
});

describe('maxChroma', () => {
  it('matches known gamut limits (sRGB red 0.2577 at L 0.628 h 29.2; research minimum 0.085 at L 0.5 h 200)', () => {
    expect(maxChroma(0.628, 29.2)).toBeCloseTo(0.2576, 3);
    expect(maxChroma(0.5, 200)).toBeCloseTo(0.085, 3);
    expect(maxChroma(1, 10)).toBeLessThan(1e-4);
  });
});
