import { describe, expect, it } from 'vitest';
import { deriveDark, ensure, neutralChroma, onAccent, reportMode } from '../../src/palette/theme';
import type { Palette, Role } from '../../src/palette/roles';
import { ratioOf } from './helpers';

const BASE: Palette = {
  fond: '#F5F8F7',
  surface: '#FFFFFF',
  texte: '#333333',
  accent: '#0F7C74',
  accent2: '#B05A9C',
  succes: '#2E7D32',
  alerte: '#C0392B',
};
const none = new Set<Role>();

describe('ensure', () => {
  it('moves the free foreground to the target (vector 15: #E0A800 on white -> 4.5)', () => {
    const out = ensure({ ...BASE, fond: '#FFFFFF', accent: '#E0A800' }, none);
    // J2b: the accent is also capped at 0.95 x the gamut chroma, so the J1 value #977000 became #957113
    expect(out.accent).toBe('#957113');
    expect(ratioOf(out.accent, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('texte aims at 7 on fond and surface', () => {
    const out = ensure({ ...BASE, texte: '#767676' }, none);
    expect(ratioOf(out.texte, BASE.fond)).toBeGreaterThanOrEqual(7);
    expect(ratioOf(out.texte, BASE.surface)).toBeGreaterThanOrEqual(7);
  });

  it('a fixed role is never changed, even when it fails (the report says so)', () => {
    const p = { ...BASE, fond: '#FFFFFF', accent: '#E0A800' };
    const out = ensure(p, new Set<Role>(['accent']));
    expect(out.accent).toBe('#E0A800');
    const rep = reportMode(out, new Set<Role>(['accent'])).find((x) => x.id === 'accent-fond')!;
    expect(rep.ok).toBe(false);
    expect(rep.touchesFixed).toBe(true);
  });

  it('a free background moves only for a fixed texte, never for a fixed accent', () => {
    const accentFixed = ensure({ ...BASE, fond: '#FFFFFF', accent: '#E0A800' }, new Set<Role>(['accent']));
    expect(accentFixed.fond).toBe('#FFFFFF');
    const texteFixed = ensure({ ...BASE, texte: '#777777' }, new Set<Role>(['texte']));
    expect(texteFixed.texte).toBe('#777777');
    expect(texteFixed.fond).not.toBe(BASE.fond);
    expect(ratioOf('#777777', texteFixed.fond)).toBeGreaterThanOrEqual(4.5);
  });

  it('impossible 7 falls back to 4.5 (4.5 itself is always reachable against one background: >= 4.5826)', () => {
    const f = new Set<Role>(['fond', 'surface']);
    for (const grey of ['#808080', '#777777', '#8A8A8A']) {
      const out = ensure({ ...BASE, fond: grey, surface: grey, texte: grey }, f);
      const rep = reportMode(out, f).find((x) => x.id === 'texte-fond')!;
      expect(rep.ok).toBe(true);
      expect(rep.target).toBe(4.5);
      expect(out.fond).toBe(grey);
    }
    const reachable = ensure({ ...BASE, fond: '#8A8A8A', surface: '#FFFFFF', texte: '#8A8A8A' }, new Set<Role>(['fond']));
    const rep = reportMode(reachable, new Set<Role>(['fond'])).find((x) => x.id === 'texte-fond')!;
    expect(rep.target).toBe(rep.ratio >= 7 ? 7 : 4.5);
  });

  it('texte vs two backgrounds with no common solution: kept as the best compromise, reported failing', () => {
    const f = new Set<Role>(['fond', 'surface']);
    const out = ensure({ ...BASE, fond: '#202020', surface: '#F0F0F0', texte: '#808080' }, f);
    const reports = reportMode(out, f).filter((x) => x.fg === 'texte');
    expect(reports.some((x) => !x.ok)).toBe(true);
    expect(out.fond).toBe('#202020');
    expect(out.surface).toBe('#F0F0F0');
  });

  it('is idempotent', () => {
    const once = ensure({ ...BASE, accent: '#E0A800', texte: '#999999', alerte: '#FF8888' }, none);
    expect(ensure(once, none)).toEqual(once);
  });
});

describe('onAccent and deriveDark', () => {
  it('onAccent is #000000 or #FFFFFF and >= 4.58 on 256 greys and 6 saturated colours', () => {
    const list = Array.from({ length: 256 }, (_, i) => '#' + i.toString(16).padStart(2, '0').toUpperCase().repeat(3));
    list.push('#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF');
    for (const c of list) {
      const on = onAccent(c);
      expect(['#000000', '#FFFFFF']).toContain(on);
      expect(ratioOf(on, c)).toBeGreaterThanOrEqual(4.58);
    }
  });

  it('neutral chroma ceilings of the document', () => {
    expect(neutralChroma('fond', 0.4)).toBe(0.012);
    expect(neutralChroma('fond', 0.04)).toBeCloseTo(0.006, 12);
    expect(neutralChroma('surface', 0.4)).toBe(0.005);
    expect(neutralChroma('texte', 0.4)).toBe(0.03);
    expect(neutralChroma('texte', 0.05)).toBeCloseTo(0.015, 12);
  });

  it('dark neutral ceilings (J2b): fond min(0.02, 0.15c), surface min(0.025, 0.18c), texte min(0.012, 0.1c)', () => {
    expect(neutralChroma('fond', 0.4, 'dark')).toBe(0.02);
    expect(neutralChroma('fond', 0.1, 'dark')).toBeCloseTo(0.015, 12);
    expect(neutralChroma('surface', 0.4, 'dark')).toBe(0.025);
    expect(neutralChroma('surface', 0.1, 'dark')).toBeCloseTo(0.018, 12);
    expect(neutralChroma('texte', 0.4, 'dark')).toBe(0.012);
    expect(neutralChroma('texte', 0.05, 'dark')).toBeCloseTo(0.005, 12);
  });

  it('dark values of the table: 0.17 / 0.22 / 0.93, accents L+0.22 bounded [0.68, 0.80] and c x 0.9, status 0.80 / 0.70 (research 2)', () => {
    const zero: Record<Role, number> = { fond: 0, surface: 0, texte: 0, accent: 0, accent2: 0, succes: 0, alerte: 0 };
    const mk = (l: number) => ({ l, c: 0.1, h: 100 });
    const light = { fond: mk(0.975), surface: mk(0.995), texte: mk(0.2), accent: mk(0.5), accent2: mk(0.7), succes: mk(0.52), alerte: mk(0.55) };
    const d = deriveDark(light, 0.1, zero);
    expect(d.fond.l).toBe(0.17);
    expect(d.surface.l).toBe(0.22);
    expect(d.texte.l).toBe(0.93);
    expect(d.accent.l).toBeCloseTo(0.72, 12);
    expect(d.accent2.l).toBe(0.8);
    expect(d.accent.c).toBeCloseTo(0.09, 12);
    expect(d.succes.l).toBe(0.8);
    expect(d.alerte.l).toBe(0.7);
    expect(d.succes.c).toBeCloseTo(0.13, 12);
    expect(d.alerte.c).toBeCloseTo(0.15, 12);
    expect(d.succes.h).toBe(150);
    expect(d.alerte.h).toBe(30);
    expect(deriveDark({ ...light, accent: mk(0.3) }, 0.1, zero).accent.l).toBe(0.68);
  });
});
