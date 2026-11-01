import { describe, expect, it } from 'vitest';
import { toOklch } from '../../src/core/color';
import { deltaEOK } from '../../src/core/deltaE';
import { maxChroma } from '../../src/core/gamut';
import { HARMONY_OFFSETS } from '../../src/core/harmony';
import { generate } from '../../src/palette/generate';
import { ROLES, type Mode, type Role } from '../../src/palette/roles';
import { ensure, neutralChroma, separate } from '../../src/palette/theme';
import { plan } from '../../src/palette/generate';
import { HARMONIES, seedList } from './helpers';

const MODES: readonly Mode[] = ['light', 'dark'];
const dE = (a: string, b: string): number => deltaEOK(a, b) as number;
const lch = (hex: string) => toOklch(hex) as NonNullable<ReturnType<typeof toOklch>>;
const hueGap = (a: number, b: number): number => {
  const d = (((b - a) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};

/** Accent cap: tolerance on chroma read back from 8-bit hex (brief: 1e-3; measured max excess 9.4e-4). */
const TOL_C = 1e-3;
/**
 * Neutral caps: the chroma read back from an 8-bit hex differs from the requested one. Measured max excess
 * 1.9e-3 (light) and 4.3e-3 (dark, where one hex step is a larger share of the tiny chroma); tolerances 2.5e-3 / 5e-3.
 */
const TOL_NEUTRAL = { light: 2.5e-3, dark: 5e-3 } as const;
/** Hue gap: 1 degree holds when both chromas are >= 0.10; below that quantisation to hex reaches 2.6 degrees. */
const HUE_STRICT_MIN_C = 0.1;
const HUE_ABS_MAX = 3;

type Counts = Record<string, number>;
const counts: Counts = {};
const worst: Record<string, number> = {};
const bump = (k: string): void => {
  counts[k] = (counts[k] ?? 0) + 1;
};
const track = (k: string, v: number): void => {
  worst[k] = Math.max(worst[k] ?? -Infinity, v);
};

describe('J2b automated checks: 1000 seeds x 6 harmonies x 2 modes = 12 000 palettes, no lock', () => {
  it('sweep', () => {
    let palettes = 0;
    for (const h of HARMONIES) {
      for (const seed of seedList(1000, 20261101)) {
        const g = generate({ harmony: h, seed, locks: 0 });
        for (const m of MODES) {
          palettes++;
          const p = g[m];
          // 1
          if (dE(p.fond, p.surface) < (m === 'light' ? 0.03 : 0.04)) bump(`1 fond/surface ${m}`);
          // 2
          if (h !== 'monochrome' && dE(p.accent, p.accent2) < 0.08) bump(`2 accent/accent2 ${m}`);
          if (dE(p.accent, p.succes) < 0.08) bump(`2 accent/succes ${m}`);
          if (dE(p.accent, p.alerte) < 0.08) bump(`2 accent/alerte ${m}`);
          // 3
          if (new Set(ROLES.map((r) => p[r])).size !== ROLES.length) bump(`3 duplicate ${m}`);
          // 4
          const a = lch(p.accent);
          const cap = 0.95 * maxChroma(a.l, a.h);
          track(`4 excess c over cap ${m}`, a.c - cap);
          if (a.c > cap + TOL_C) bump(`4 accent over cap ${m}`);
          if (a.c < 0.04) bump(`4 accent grey ${m}`);
          // 5
          const f = lch(p.fond);
          const [lo, hi] = m === 'light' ? [0.94, 0.985] : [0.12, 0.22];
          if (f.l < lo || f.l > hi) bump(`5 fond L ${m}`);
          if (p.fond === '#FFFFFF' || p.fond === '#000000') bump(`5 fond pure ${m}`);
          // 6
          for (const role of ['fond', 'surface', 'texte'] as const) {
            const c = lch(p[role]).c;
            const capN = neutralChroma(role, a.c, m);
            track(`6 excess c ${role} ${m}`, c - capN);
            if (c > capN + TOL_NEUTRAL[m]) bump(`6 ${role} chroma ${m}`);
          }
          if (lch(p.texte).c > 0.04) bump(`6 texte c>0.04 ${m}`);
          // 7
          if (m === 'light') {
            if (Math.abs(lch(p.texte).l - f.l) < 0.6) bump('7 texte/fond dL');
            if (Math.abs(a.l - f.l) < 0.35) bump('7 accent/fond dL');
          }
          // 8
          if (h !== 'monochrome') {
            const first = HARMONY_OFFSETS[h][0] as number;
            const gap = hueGap(a.h, lch(p.accent2).h);
            const err = Math.abs(Math.abs(gap) - Math.abs(first > 180 ? first - 360 : first));
            track(`8 hue err ${m}`, err);
            const minC = Math.min(a.c, lch(p.accent2).c);
            for (const t of [0.06, 0.08, 0.1, 0.12]) if (minC >= t) track(`8 hue err minC>=${t}`, err);
            if (err > 1) bump(`8 hue gap >1deg ${m}`);
            if (err > 1) {
              if (minC >= HUE_STRICT_MIN_C) bump(`8 hue gap >1deg with chroma>=0.10 ${m}`);
            }
            if (err > HUE_ABS_MAX) bump(`8 hue gap >3deg ${m}`);
          }
          // 9
          if (m === 'dark' && a.l < 0.6) bump('9 dark accent L');
        }
      }
    }
    console.log(`J2b checks: ${palettes} palettes; violations ${JSON.stringify(counts)}; worst ${JSON.stringify(worst)}`);
    expect(palettes).toBe(12000);
    const hard = Object.keys(counts).filter((k) => !k.startsWith('8 hue gap >1deg ') || k.includes('chroma>=0.10'));
    expect(hard.map((k) => `${k}: ${counts[k]}`)).toEqual([]);
  });

  it('separate(): how many palettes needed a dE shift, per role; none stays unresolved', () => {
    const shifted: Record<string, number> = {};
    let palettes = 0;
    let anyShift = 0;
    let unresolved = 0;
    for (const h of HARMONIES) {
      for (const seed of seedList(1000, 20261101)) {
        const raw = plan({ harmony: h, seed, locks: 0 });
        for (const m of MODES) {
          palettes++;
          const none = new Set<Role>();
          const r = separate(ensure(raw[m], none), none, m, h === 'monochrome');
          if (r.moved.length > 0) anyShift++;
          for (const role of r.moved) shifted[`${role} ${m}`] = (shifted[`${role} ${m}`] ?? 0) + 1;
          unresolved += r.unresolved.length;
        }
      }
    }
    console.log(`J2b separate: ${anyShift}/${palettes} palettes shifted; per role ${JSON.stringify(shifted)}; unresolved ${unresolved}`);
    expect(unresolved).toBe(0);
  });
});

describe('split-complementary and accent draw', () => {
  it('accent2 hue = accent + 150 (within 1 degree when both chromas are >= 0.10)', () => {
    let checked = 0;
    for (const seed of seedList(300, 77)) {
      const g = generate({ harmony: 'split-complementary', seed, locks: 0 });
      const a = lch(g.light.accent);
      const b = lch(g.light.accent2);
      if (Math.min(a.c, b.c) < HUE_STRICT_MIN_C) continue;
      checked++;
      expect(Math.abs(hueGap(a.h, b.h) - 150)).toBeLessThan(1);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('plan: drawn light accent L in [0.48, 0.54] (hex rounding 0.003) and chroma <= 0.16', () => {
    for (const seed of seedList(500, 3)) {
      const a = lch(plan({ harmony: 'triad', seed, locks: 0 }).light.accent);
      expect(a.l).toBeGreaterThan(0.477);
      expect(a.l).toBeLessThan(0.543);
      expect(a.c).toBeLessThan(0.16 + TOL_C);
    }
  });
});
