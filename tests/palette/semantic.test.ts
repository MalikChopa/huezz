import { describe, expect, it } from 'vitest';
import { toOklch } from '../../src/core/color';
import { contrastRatio } from '../../src/core/contrast';
import { CVD_KINDS, cvdDeltaE } from '../../src/core/cvd';
import { maxChroma } from '../../src/core/gamut';
import { generate, plan, STATUS } from '../../src/palette/generate';
import { LOCK_ALL, ROLES, isLocked, type Mode, type Palette } from '../../src/palette/roles';
import { CVD_MIN, CVD_TARGET, cvdGap, cvdSeparate, DARK_STATUS, ensure, separate } from '../../src/palette/theme';
import { HARMONIES, samePalette, seedList } from './helpers';

const MODES: readonly Mode[] = ['light', 'dark'];
const lch = (hex: string) => toOklch(hex) as NonNullable<ReturnType<typeof toOklch>>;
const hueGap = (a: number, b: number): number => {
  const d = (((b - a) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};
/** Distance from h to the interval [lo, hi] (0 inside). */
const outside = (h: number, lo: number, hi: number): number => (h < lo ? lo - h : h > hi ? h - hi : 0);
const hueOutside = (h: number, lo: number, hi: number): number => Math.min(outside(h, lo, hi), outside(h + 360, lo, hi), outside(h - 360, lo, hi));

const SEEDS = seedList(1000, 20261101);
/** L read back from an 8-bit hex: the drawn shift reaches 0.78 / 0.72 exactly, rounding adds at most this (measured 0.0013). */
const HEX_L_TOL = 0.0015;

describe('J2c: semantic colours and colour-blind separation, 1000 seeds x 6 harmonies x 2 modes (no lock)', () => {
  it('sweep: simulated dE OK succes/alerte, status hues and L, earlier guarantees', () => {
    const fail: Record<string, number> = {};
    const bump = (k: string): void => {
      fail[k] = (fail[k] ?? 0) + 1;
    };
    const share05 = { light: { protan: 0, deutan: 0 }, dark: { protan: 0, deutan: 0 } };
    const minGap = { light: 9, dark: 9 };
    let n = 0;
    let anyOkFalse = 0;
    let rolesChanged = 0;
    let cvdMoved = 0;
    let darkSuccesLow = 0;
    let darkAlerteHigh = 0;
    let maxLightSuccesL = 0;
    let minOnAccent = 99;
    const generations = HARMONIES.length * SEEDS.length;
    for (const harmony of HARMONIES) {
      for (const seed of SEEDS) {
        const g = generate({ harmony, seed, locks: 0 });
        const again = generate({ harmony, seed, locks: 0 });
        if (!samePalette(g.light, again.light) || !samePalette(g.dark, again.dark)) bump('determinism');
        const pl = plan({ harmony, seed, locks: 0 });
        let changed = false;
        let moved = false;
        let bad = false;
        for (const mode of MODES) {
          n++;
          const p: Palette = g[mode];
          // (a)
          for (const kind of CVD_KINDS) {
            const d = cvdDeltaE(p.succes, p.alerte, kind) as number;
            if (d < CVD_MIN) bump(`a dE sim < 0.03 ${mode} ${kind}`);
            if (d >= 0.05) share05[mode][kind]++;
          }
          minGap[mode] = Math.min(minGap[mode], cvdGap(p));
          // (b)
          for (const [role, lo, hi] of [['succes', 142, 165], ['alerte', 22, 35]] as const) {
            const o = lch(p[role]);
            const tol = o.c >= 0.08 ? 1 : 3;
            if (hueOutside(o.h, lo, hi) > tol) bump(`b hue ${role} ${mode} (tol ${tol})`);
          }
          // (c)
          if (mode === 'dark') {
            if (lch(p.succes).l < 0.78 - HEX_L_TOL) darkSuccesLow++;
            if (lch(p.alerte).l > 0.72 + HEX_L_TOL) darkAlerteHigh++;
          } else maxLightSuccesL = Math.max(maxLightSuccesL, lch(p.succes).l);
          // (d)
          const rep = g.report[mode];
          if (rep.some((r) => !r.informational && !r.ok)) bad = true;
          if (rep.some((r) => r.informational && !r.ok)) bump(`d informational ok:false ${mode}`);
          const fixed = pl.fixed[mode];
          const e = ensure(pl[mode], fixed);
          if (ROLES.some((r) => e[r] !== pl[mode][r])) changed = true;
          const s = separate(e, fixed, mode, harmony === 'monochrome');
          if (s.unresolved.length > 0) bump(`d separate unresolved ${mode}`);
          if (!samePalette(cvdSeparate(s.palette, fixed, mode).palette, s.palette)) moved = true;
          if (new Set(ROLES.map((r) => p[r])).size !== ROLES.length) bump(`d duplicate ${mode}`);
          const ra = contrastRatio(g.onAccent[mode], p.accent) as number;
          minOnAccent = Math.min(minOnAccent, ra);
          if (ra < 4.5) bump(`d onAccent < 4.5 ${mode}`);
          if (g.onAccent[mode] !== '#000000' && g.onAccent[mode] !== '#FFFFFF') bump(`d onAccent not pure ${mode}`);
          if (mode === 'dark' && g.onAccent.dark !== '#000000') bump('d dark accent text not black');
        }
        if (bad) anyOkFalse++;
        if (changed) rolesChanged++;
        if (moved) cvdMoved++;
      }
    }
    const pct = (v: number, of: number): string => `${((100 * v) / of).toFixed(2)} %`;
    const half = n / 2;
    console.log(
      [
        `J2c sweep: ${generations} generations, ${n} palettes`,
        `dE OK sim succes/alerte >= 0.05: light protan ${pct(share05.light.protan, half)} deutan ${pct(share05.light.deutan, half)}; dark protan ${pct(share05.dark.protan, half)} deutan ${pct(share05.dark.deutan, half)}`,
        `min gap: light ${minGap.light.toFixed(4)} dark ${minGap.dark.toFixed(4)}`,
        `ok:false (any non informative pair): ${anyOkFalse}/${generations}; ensure changed a role: ${rolesChanged}/${generations}; cvdSeparate moved a role: ${cvdMoved}/${generations}`,
        `dark succes L < 0.78 (tol ${HEX_L_TOL}): ${darkSuccesLow}/${half}; dark alerte L > 0.72 (tol ${HEX_L_TOL}): ${darkAlerteHigh}/${half}; max light succes L ${maxLightSuccesL.toFixed(4)}; min onAccent ${minOnAccent.toFixed(4)}`,
        `failures: ${JSON.stringify(fail)}`,
      ].join('\n'),
    );
    expect(fail).toEqual({});
    expect(anyOkFalse).toBe(0);
    for (const mode of MODES) for (const kind of CVD_KINDS) expect(share05[mode][kind] / half).toBeGreaterThanOrEqual(0.99);
    expect(minGap.light).toBeGreaterThanOrEqual(CVD_MIN);
    expect(minGap.dark).toBeGreaterThanOrEqual(CVD_MIN);
    expect(darkSuccesLow).toBe(0);
    // beyond the tolerance, only separate() lifts a dark alerte (accent dE OK >= 0.08 impossible by going darker): reported, bounded
    expect(darkAlerteHigh / half).toBeLessThan(0.005);
    expect(maxLightSuccesL).toBeLessThanOrEqual(STATUS.succes.lMax + 0.0015);
  });

  it('plan: light status values of research 2 (L, chroma cap, hue pull and range) before ensure', () => {
    for (const harmony of HARMONIES) {
      for (const seed of SEEDS.slice(0, 300)) {
        const light = plan({ harmony, seed, locks: 0 }).light;
        const s = lch(light.succes);
        const a = lch(light.alerte);
        expect(s.l).toBeLessThanOrEqual(0.52 + 0.0015);
        expect(s.c).toBeLessThanOrEqual(0.9 * maxChroma(s.l, s.h) + 0.003);
        expect(hueOutside(s.h, 142, 165)).toBeLessThanOrEqual(1);
        expect(hueGap(s.h, 153)).toBeLessThanOrEqual(11);
        expect(hueOutside(a.h, 22, 35)).toBeLessThanOrEqual(1);
        expect(hueGap(a.h, 29)).toBeLessThanOrEqual(6);
        expect(Math.abs(a.l - 0.48)).toBeLessThan(0.02 + 0.0015);
      }
    }
  });

  it('constants: dark status values of research 2', () => {
    expect(DARK_STATUS.succes).toMatchObject({ l: 0.8, c: 0.13, lo: 150, hi: 155 });
    expect(DARK_STATUS.alerte).toMatchObject({ l: 0.7, c: 0.15, lo: 28, hi: 30 });
    expect(STATUS.succes).toMatchObject({ l: 0.52, lMax: 0.52, c: 0.13, lo: 142, hi: 165, pull: 10 });
    expect(STATUS.alerte).toMatchObject({ l: 0.48, c: 0.17, lo: 22, hi: 35, pull: 5 });
  });
});

describe('cvdSeparate (the colour-blind gap rule)', () => {
  const closeLight: Palette = {
    fond: '#F5F6F5',
    surface: '#FDFEFD',
    texte: '#2B2F2B',
    accent: '#1F5FA8',
    accent2: '#8A5A00',
    succes: '#307C2E',
    alerte: '#AE2A1D',
  };

  it('raises a failing pair above the target without touching other roles', () => {
    expect(cvdGap(closeLight)).toBeLessThan(CVD_MIN);
    const r = cvdSeparate(closeLight, new Set(), 'light');
    expect(r.unresolved).toBe(false);
    expect(cvdGap(r.palette)).toBeGreaterThanOrEqual(CVD_TARGET);
    expect(r.moved.length).toBe(1);
    for (const role of ROLES) if (!r.moved.includes(role)) expect(r.palette[role]).toBe(closeLight[role]);
    for (const role of r.moved) {
      expect(contrastRatio(r.palette[role], r.palette.surface) as number).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is a no-op when the gap already holds, and when both status roles are fixed', () => {
    const ok = cvdSeparate(closeLight, new Set(), 'light').palette;
    const again = cvdSeparate(ok, new Set(), 'light');
    expect(again.moved).toEqual([]);
    expect(again.palette).toEqual(ok);
    const frozen = cvdSeparate(closeLight, new Set(['succes', 'alerte']), 'light');
    expect(frozen.palette).toEqual(closeLight);
    expect(frozen.unresolved).toBe(true);
  });

  it('never moves a locked status role: the generator keeps both hex of a locked alerte', () => {
    const first = generate({ harmony: 'complementary', seed: 613350819, locks: 0 });
    const locks = 1 << ROLES.indexOf('alerte');
    expect(isLocked(locks, 'alerte')).toBe(true);
    for (const seed of seedList(60, 7)) {
      const g = generate({ harmony: 'complementary', seed, locks, previous: first });
      for (const mode of MODES) expect(g[mode].alerte).toBe(first[mode].alerte);
    }
    const all = generate({ harmony: 'triad', seed: 5, locks: LOCK_ALL, previous: first });
    expect(samePalette(all.light, first.light) && samePalette(all.dark, first.dark)).toBe(true);
  });
});
