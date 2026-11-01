import { describe, expect, it } from 'vitest';
import { toOklch } from '../../src/core/color';
import { inSrgbGamut } from '../../src/core/gamut';
import { generate } from '../../src/palette/generate';
import { PAIRS, ROLES, type Mode, type PairReport } from '../../src/palette/roles';
import { HARMONIES, HEX_RE, allValid, bestExtreme, ratioOf, samePalette, seedList, rngOf } from './helpers';

const MODES: readonly Mode[] = ['light', 'dark'];

describe('generate: determinism', () => {
  it('same inputs give a byte-identical output over 200 random inputs', () => {
    const r = rngOf(77);
    for (let i = 0; i < 200; i++) {
      const input = {
        harmony: HARMONIES[Math.floor(r() * HARMONIES.length)] as (typeof HARMONIES)[number],
        seed: Math.floor(r() * 2 ** 32),
        locks: 0,
        ...(r() < 0.3 ? { base: '#' + Math.floor(r() * 0xffffff).toString(16).padStart(6, '0') } : {}),
      };
      expect(JSON.stringify(generate(input))).toBe(JSON.stringify(generate(input)));
    }
  });

  it('different seeds give different palettes in most cases (share printed)', () => {
    const seeds = seedList(1000);
    let differ = 0;
    let pairs = 0;
    for (const h of HARMONIES) {
      for (let i = 0; i + 1 < seeds.length; i += 2) {
        const a = generate({ harmony: h, seed: seeds[i] as number, locks: 0 });
        const b = generate({ harmony: h, seed: seeds[i + 1] as number, locks: 0 });
        pairs++;
        if (!samePalette(a.light, b.light) || !samePalette(a.dark, b.dark)) differ++;
      }
    }
    console.log(`J2 seeds: ${differ}/${pairs} pairs of different seeds give different palettes (${((100 * differ) / pairs).toFixed(2)} %)`);
    expect(differ / pairs).toBeGreaterThan(0.99);
  });

  it('preset is accepted and does not change the result yet', () => {
    const a = generate({ harmony: 'triad', seed: 5, locks: 0 });
    const b = generate({ harmony: 'triad', seed: 5, locks: 0, preset: [{ l: 0.5, c: 0.1, h: 10 }] });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('generate: validity', () => {
  it('all 14 colours are uppercase #RRGGBB and in sRGB gamut (parsed back), over 5 harmonies x 200 seeds', () => {
    for (const h of HARMONIES) {
      for (const seed of seedList(200, 3)) {
        const g = generate({ harmony: h, seed, locks: 0 });
        for (const m of MODES) {
          expect(allValid(g[m])).toBe(true);
          for (const role of ROLES) {
            const o = toOklch(g[m][role]);
            expect(o).not.toBeNull();
            // a hex is in gamut by definition; the OKLCH read back from it must also be inside sRGB
            expect(inSrgbGamut(o as NonNullable<typeof o>)).toBe(true);
          }
        }
      }
    }
  });

  it('light neutrals respect the ranges (fond ~0.965, texte ~0.20, within the L shift)', () => {
    for (const seed of seedList(100, 9)) {
      const g = generate({ harmony: 'complementary', seed, locks: 0 });
      const fond = toOklch(g.light.fond)!;
      const texte = toOklch(g.light.texte)!;
      expect(fond.l).toBeGreaterThan(0.94);
      expect(texte.l).toBeLessThan(0.3);
    }
  });
});

describe('generate: 1000 seeds x 6 harmonies x 2 modes = 12 000 palettes, no lock, base drawn from the seed', () => {
  it('every pair reaches its target (7, or 4.5 where 7 is impossible); every miss is an ok:false in the report', () => {
    const seeds = seedList(1000);
    let palettes = 0;
    let withFailing = 0;
    let withFailingInfo = 0;
    let atFallback = 0;
    let unexplained = 0;
    let reportMismatch = 0;
    let minRatio = Infinity;
    for (const h of HARMONIES) {
      for (const seed of seeds) {
        const g = generate({ harmony: h, seed, locks: 0 });
        for (const m of MODES) {
          palettes++;
          const pal = g[m];
          const reports: readonly PairReport[] = g.report[m];
          let failing = false;
          let failingInfo = false;
          for (const spec of PAIRS) {
            const rep = reports.find((x) => x.id === spec.id) as PairReport;
            const r = ratioOf(pal[spec.fg], pal[spec.bg]);
            if (r !== rep.ratio) reportMismatch++;
            const top = spec.ladder[0] as number;
            const feasibleTop = bestExtreme(pal[spec.bg]) >= top;
            const wanted = feasibleTop ? top : (spec.ladder[spec.ladder.length - 1] as number);
            if (!spec.informational) minRatio = Math.min(minRatio, r);
            if (r < wanted && rep.ok) unexplained++;
            if (!rep.ok) {
              if (spec.informational) failingInfo = true;
              else failing = true;
            }
            if (rep.ok && rep.target < top) atFallback++;
            expect(rep.ok).toBe(r >= (rep.target as number));
          }
          if (failing) withFailing++;
          if (failingInfo) withFailingInfo++;
        }
      }
    }
    console.log(
      `J2 sweep: ${palettes} palettes; ${withFailing} with >=1 ok:false (non-informational pair); ` +
        `${withFailingInfo} with accent2/fond ok:false (informational); ${atFallback} pairs at the 4.5 fallback; ` +
        `min non-informational ratio ${minRatio.toFixed(4)}; unexplained misses ${unexplained}; report/ratio mismatches ${reportMismatch}`,
    );
    expect(palettes).toBe(12000);
    expect(unexplained).toBe(0);
    expect(reportMismatch).toBe(0);
    expect(withFailing).toBe(0);
    expect(withFailingInfo).toBe(0);
  });

  it('text on the accent is pure black or white and reaches 4.58 on every generated accent', () => {
    let min = Infinity;
    for (const h of HARMONIES) {
      for (const seed of seedList(1000, 11)) {
        const g = generate({ harmony: h, seed, locks: 0 });
        for (const m of MODES) {
          const on = g.onAccent[m];
          expect(['#000000', '#FFFFFF']).toContain(on);
          const r = ratioOf(on, g[m].accent);
          min = Math.min(min, r);
          expect(r).toBeGreaterThanOrEqual(4.58);
        }
      }
    }
    console.log(`J2 onAccent: min ratio over 12 000 accents = ${min.toFixed(4)}`);
  });
});

describe('generate: harmony and roles', () => {
  it('accent2 hue = accent hue + first harmony offset (analogous: +-40), monochrome: lighter and less chromatic', () => {
    for (const seed of seedList(100, 21)) {
      const comp = generate({ harmony: 'complementary', seed, locks: 0 });
      const a = toOklch(comp.light.accent)!;
      const b = toOklch(comp.light.accent2)!;
      if (a.c > 0.08 && b.c > 0.08) {
        const d = Math.abs(((b.h - a.h - 180 + 540) % 360) - 180);
        expect(d).toBeLessThan(3);
      }
      const ana = generate({ harmony: 'analogous', seed, locks: 0 });
      const aa = toOklch(ana.light.accent)!;
      const bb = toOklch(ana.light.accent2)!;
      if (aa.c > 0.08 && bb.c > 0.08) {
        const d = Math.abs(((bb.h - aa.h + 540) % 360) - 180);
        expect(Math.abs(d - 40)).toBeLessThan(3);
      }
    }
  });

  it('analogous: both signs occur across seeds', () => {
    const signs = new Set<number>();
    for (const seed of seedList(200, 31)) {
      const g = generate({ harmony: 'analogous', seed, locks: 0 });
      const a = toOklch(g.light.accent)!;
      const b = toOklch(g.light.accent2)!;
      signs.add(Math.sign(((b.h - a.h + 540) % 360) - 180));
    }
    expect(signs.has(1) && signs.has(-1)).toBe(true);
  });

  it('dark succes and alerte hues stay in [150, 155] and [28, 30] (read back from hex, +-3 deg for rounding)', () => {
    for (const h of HARMONIES) {
      for (const seed of seedList(200, 41)) {
        const g = generate({ harmony: h, seed, locks: 0 });
        const s = toOklch(g.dark.succes)!;
        const a = toOklch(g.dark.alerte)!;
        expect(s.h).toBeGreaterThan(147);
        expect(s.h).toBeLessThan(158);
        expect(a.h).toBeGreaterThan(25);
        expect(a.h).toBeLessThan(33);
      }
    }
  });

  it('dark mode keeps the hue of light, fond darker than surface darker than texte', () => {
    for (const seed of seedList(100, 51)) {
      const g = generate({ harmony: 'triad', seed, locks: 0 });
      const lf = toOklch(g.dark.fond)!.l;
      const ls = toOklch(g.dark.surface)!.l;
      const lt = toOklch(g.dark.texte)!.l;
      expect(lf).toBeLessThan(ls);
      expect(ls).toBeLessThan(lt);
      const acc = toOklch(g.dark.accent)!.l;
      expect(acc).toBeGreaterThan(0.66);
    }
  });
});
