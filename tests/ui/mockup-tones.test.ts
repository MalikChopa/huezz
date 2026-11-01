import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HARMONIES } from '../../src/core/harmony';
import { next } from '../../src/core/random';
import { generate } from '../../src/palette/generate';
import { onAccent } from '../../src/palette/theme';
import { palDeclarations, TONES, toneRatio } from './tones-helper';

const css = readFileSync(new URL('../../src/styles/mockups.css', import.meta.url), 'utf8');

type Stat = { min: number; fail: number; n: number };

/** 1,000 seeds x 6 harmonies x 2 modes, no lock; every small-text tone against its real background. */
function sweep(decl: Map<string, string>): Map<string, Stat> {
  const stats = new Map<string, Stat>();
  let seed = 20261101;
  for (let i = 0; i < 1000; i++) {
    seed = next(seed);
    for (const harmony of HARMONIES) {
      const g = generate({ harmony, seed, locks: 0 });
      for (const mode of ['light', 'dark'] as const) {
        const palette = g[mode];
        const vars = new Map<string, string>(decl);
        for (const [role, hex] of Object.entries(palette)) vars.set(`--${role}`, hex);
        vars.set('--sur-accent', g.onAccent[mode]);
        vars.set('--sur-accent2', onAccent(palette.accent2));
        for (const tone of TONES) {
          const r = toneRatio(tone, vars);
          const s = stats.get(tone.id) ?? { min: Infinity, fail: 0, n: 0 };
          s.min = Math.min(s.min, r);
          s.n++;
          if (r < 4.5) s.fail++;
          stats.set(tone.id, s);
        }
      }
    }
  }
  return stats;
}

describe('mock-up small text >= 4.5:1 on its real background', () => {
  it('the declared tones are the ones used by the rules (guard: the sweep measures what the page shows)', () => {
    const used: Array<[RegExp, string]> = [
      [/\.m-hero \.m-ok\{[^}]*color:var\(--ok-ink\)/, '.m-ok'],
      [/\.st-ok\{[^}]*color:var\(--ok-ink\)/, '.st-ok'],
      [/\.m-late\{[^}]*color:var\(--al-ink\)/, '.m-late'],
      [/\.st-bad\{[^}]*color:var\(--al-ink\)/, '.st-bad'],
      [/\.m-card small\{[^}]*color:var\(--sur-accent-soft\)/, '.m-card small'],
      [/\.m-card-foot\{[^}]*color:var\(--sur-accent-soft\)/, '.m-card-foot'],
      [/\.m-kpi \.up\{[^}]*color:var\(--succes\)/, '.m-kpi .up'],
      [/\.m-kpi \.bad\{[^}]*color:var\(--alerte\)/, '.m-kpi .bad'],
      [/\.m-tabbar \.on\{[^}]*color:var\(--texte\)/, '.m-tabbar .on'],
    ];
    for (const [re, name] of used) expect(re.test(css), name).toBe(true);
    // No opacity on text: it would blend the tone with the background without the sweep seeing it.
    expect(/opacity:/.test(css)).toBe(false);
  });

  it('every tone >= 4.5 over 12,000 palettes', () => {
    const stats = sweep(palDeclarations(css));
    const report = [...stats].map(([id, s]) => `${id}: min ${s.min.toFixed(3)}, ${s.fail}/${s.n} below 4.5`);
    const failing = [...stats].filter(([, s]) => s.fail > 0).map(([id]) => id);
    expect(failing, report.join('\n')).toEqual([]);
    expect(stats.size).toBe(TONES.length);
    for (const s of stats.values()) expect(s.n).toBe(12000);
    if (process.env.HUEZZ_TONES_REPORT) console.log(report.join('\n'));
  });

  it('negative control: with the original tones (raw colours, opacity .85) the same sweep fails', () => {
    const decl = palDeclarations(css);
    decl.set('--ok-ink', 'var(--succes)');
    decl.set('--al-ink', 'var(--alerte)');
    decl.set('--sur-accent-soft', 'color-mix(in srgb,var(--sur-accent) 85%,var(--accent))');
    const stats = sweep(decl);
    expect(stats.get('al-ink-tint-al')?.fail).toBeGreaterThan(0);
    expect(stats.get('soft-accent')?.fail).toBeGreaterThan(0);
    expect(stats.get('ok-ink-fond')?.fail).toBeGreaterThan(0);
  });

  it('reproduces color-mix(in oklab) on a known pair (endpoints and midpoint lightness)', async () => {
    const { mixOklab } = await import('./tones-helper');
    expect(mixOklab('#FF0000', 100, '#0000FF')).toBe('#FF0000');
    expect(mixOklab('#FF0000', 0, '#0000FF')).toBe('#0000FF');
    expect(mixOklab('#FFFFFF', 50, '#000000')).toBe('#636363');
  });
});
