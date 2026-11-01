import { describe, expect, it } from 'vitest';
import { fixContrast, contrastRatio } from '../../src/core/contrast';
import { formatHex } from '../../src/core/hex';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('fixContrast properties (10000 seeded pairs)', () => {
  const rand = mulberry32(20261101);
  const pick = () => formatHex({ r: Math.floor(rand() * 256), g: Math.floor(rand() * 256), b: Math.floor(rand() * 256) });
  const pairs = Array.from({ length: 10000 }, () => [pick(), pick()] as const);

  it('AA (4.5) is reached on every pair, measured on the returned hex', () => {
    let failures = 0;
    for (const [fg, bg] of pairs) {
      const r = fixContrast(fg, bg, 4.5);
      if (!r.ok || (contrastRatio(r.hex, bg) as number) < 4.5 || r.ratio !== contrastRatio(r.hex, bg)) failures++;
    }
    expect(failures).toBe(0);
  });

  it('target 7: ok:true meets 7, ok:false only when best (black/white) is below 7', () => {
    let wrong = 0;
    let okCount = 0;
    let koCount = 0;
    for (const [fg, bg] of pairs) {
      const r = fixContrast(fg, bg, 7);
      const reachable = Math.max(contrastRatio('#000000', bg) as number, contrastRatio('#FFFFFF', bg) as number);
      if (r.ok) {
        okCount++;
        if ((contrastRatio(r.hex, bg) as number) < 7 || reachable < 7) wrong++;
      } else {
        koCount++;
        if (reachable >= 7 || r.best === null || r.best.ratio >= 7) wrong++;
      }
    }
    expect(wrong).toBe(0);
    expect(okCount + koCount).toBe(10000);
  });

  it('worst background still reaches at least 4.5826 with black or white', () => {
    let min = Infinity;
    for (let v = 0; v < 256; v++) {
      const hex = formatHex({ r: v, g: v, b: v });
      min = Math.min(min, Math.max(contrastRatio('#000000', hex) as number, contrastRatio('#FFFFFF', hex) as number));
    }
    expect(min).toBeGreaterThanOrEqual(4.5826 - 1e-4);
  });

  it('a colour that already meets the target is returned unchanged', () => {
    const r = fixContrast('#000000', '#FFFFFF', 7);
    expect(r).toEqual({ ok: true, hex: '#000000', ratio: 21 });
  });
});
