import { describe, expect, it } from 'vitest';
import { toOklch } from '../../src/core/color';
import { contrastRatio, fixContrast, relativeLuminance } from '../../src/core/contrast';
import { fromOklch } from '../../src/core/gamut';

const T = 1e-4;
const oklch = (hex: string) => {
  const o = toOklch(hex);
  if (o === null) throw new Error('invalid hex in test');
  return o;
};
const near = (actual: number | null, expected: number, tol = T) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(tol);
};
const expectOklch = (hex: string, l: number, c: number, h: number) => {
  const o = oklch(hex);
  near(o.l, l);
  near(o.c, c);
  near(o.h, h, 0.01);
};

describe('ARCHITECTURE section 3 vectors', () => {
  it('vector 1: ratio #FFFFFF/#000000 = 21', () => near(contrastRatio('#FFFFFF', '#000000'), 21.0));
  it('vector 2: ratio #767676/#FFFFFF = 4.5422', () => near(contrastRatio('#767676', '#FFFFFF'), 4.5422));
  it('vector 3: ratio #777777/#FFFFFF = 4.4781 (AA fails)', () => {
    near(contrastRatio('#777777', '#FFFFFF'), 4.4781);
    expect(contrastRatio('#777777', '#FFFFFF') as number).toBeLessThan(4.5);
  });
  it('vector 4: ratio #595959/#FFFFFF = 7.0047', () => near(contrastRatio('#595959', '#FFFFFF'), 7.0047));
  it('vector 5: ratio #949494/#FFFFFF = 3.0335', () => near(contrastRatio('#949494', '#FFFFFF'), 3.0335));
  it('vector 6: ratio #0F7C74/#F5F8F7 = 4.7292', () => near(contrastRatio('#0F7C74', '#F5F8F7'), 4.7292));
  it('vector 7: luminance #808080 = 0.21586, #FF0000 = 0.21260', () => {
    near(relativeLuminance('#808080'), 0.21586);
    near(relativeLuminance('#FF0000'), 0.2126);
  });
  it('vector 8: #FF0000 -> OKLCH 0.6280 0.2577 29.2339', () => expectOklch('#FF0000', 0.628, 0.2577, 29.2339));
  it('vector 9: #00FF00 -> OKLCH 0.8664 0.2948 142.4953', () => expectOklch('#00FF00', 0.8664, 0.2948, 142.4953));
  it('vector 10: #0000FF -> OKLCH 0.4520 0.3132 264.0520', () => expectOklch('#0000FF', 0.452, 0.3132, 264.052));
  it('vector 11: #0F7C74 -> OKLCH 0.5294 0.0894 186.7697', () => expectOklch('#0F7C74', 0.5294, 0.0894, 186.7697));
  it('vector 12: #FFFFFF L 1 c 0; #808080 L 0.5999 c 0', () => {
    const w = oklch('#FFFFFF');
    near(w.l, 1);
    expect(w.c).toBe(0);
    const g = oklch('#808080');
    near(g.l, 0.5999);
    expect(g.c).toBe(0);
  });
  it('vector 13: oklch(0.7 0.4 145) -> #00BF34 ; oklch(0.9 0.3 30) -> #FFD2CA', () => {
    expect(fromOklch({ l: 0.7, c: 0.4, h: 145 })).toBe('#00BF34');
    expect(fromOklch({ l: 0.9, c: 0.3, h: 30 })).toBe('#FFD2CA');
  });
  it('vector 14: 17^3 grid round trip, 0 differences', () => {
    const vals = Array.from({ length: 17 }, (_, i) => Math.min(255, i * 16));
    expect(vals[16]).toBe(255);
    let n = 0;
    let diffs = 0;
    const hx = (v: number) => v.toString(16).padStart(2, '0');
    for (const r of vals)
      for (const g of vals)
        for (const b of vals) {
          const hex = `#${hx(r)}${hx(g)}${hx(b)}`.toUpperCase();
          n++;
          if (fromOklch(oklch(hex)) !== hex) diffs++;
        }
    expect(n).toBe(4913);
    expect(diffs).toBe(0);
  });
  it('vector 15: fix #E0A800/#FFFFFF -> 4.5 = #977000 (4.532)', () => {
    const r = fixContrast('#E0A800', '#FFFFFF', 4.5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hex).toBe('#977000');
      near(r.ratio, 4.532, 5e-4);
    }
  });
  it('vector 16: fix #0F7C74/#F5F8F7 -> 7 = #005F59 (7.066)', () => {
    const r = fixContrast('#0F7C74', '#F5F8F7', 7);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hex).toBe('#005F59');
      near(r.ratio, 7.066, 5e-4);
    }
  });
  it('vector 17: fix #D95A4E/#FFFFFF -> 4.5 = #CA4D42 (4.515)', () => {
    const r = fixContrast('#D95A4E', '#FFFFFF', 4.5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hex).toBe('#CA4D42');
      near(r.ratio, 4.515, 5e-4);
    }
  });
  it('vector 18: fix #777777/#FFFFFF -> 4.5 = #767676 (4.5422)', () => {
    const r = fixContrast('#777777', '#FFFFFF', 4.5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hex).toBe('#767676');
      near(r.ratio, 4.5422);
    }
  });
  it('vector 19: fix #808080/#777777 -> 7 is impossible', () => {
    const r = fixContrast('#808080', '#777777', 7);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.best).not.toBeNull();
      expect(r.best?.ratio as number).toBeLessThan(7);
    }
  });
  it('vector 20: the 256 greys stay grey (c = 0, h = 0, exact round trip)', () => {
    let bad = 0;
    for (let v = 0; v < 256; v++) {
      const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`.toUpperCase();
      const o = oklch(hex);
      if (o.c !== 0 || o.h !== 0 || fromOklch(o) !== hex) bad++;
    }
    expect(bad).toBe(0);
  });
});
