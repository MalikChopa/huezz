import { describe, expect, it, vi } from 'vitest';
import { PAIRS } from '../../src/palette/roles';
import { setBase, setMode } from '../../src/state/state';
import { fixedState } from '../fixed-state';
import { exact4, fixToast, IMPOSSIBLE_MESSAGE, pairView, shown, STUCK_MESSAGE } from '../../src/ui/pairs';

describe('display helpers', () => {
  it('truncates, never rounds, with a decimal comma', () => {
    expect(shown(4.4781)).toBe('4,47');
    expect(shown(4.5)).toBe('4,50');
    expect(shown(15.8299)).toBe('15,82');
    expect(exact4(4.47819)).toBe('4,4781');
    expect(exact4(21)).toBe('21,0000');
  });
  it('toast texts (gender agrees, count announced)', () => {
    expect(fixToast('texte', '#AAAAAA', '#BBBBBB', 5, 5)).toBe('Texte corrigé : #AAAAAA → #BBBBBB (verrouillé). 5 sur 5 contrastes AA.');
    expect(fixToast('alerte', '#AAAAAA', '#BBBBBB', 4, 5)).toBe('Alerte corrigée : #AAAAAA → #BBBBBB (verrouillée). 4 sur 5 contrastes AA.');
  });
});

describe('pairView', () => {
  it('covers the 6 pairs of the state: 5 checked and 1 informative, with the four levels', () => {
    const s = fixedState('light');
    const views = PAIRS.map((p) => pairView(s, p.id));
    expect(views.filter((v) => v.informational)).toHaveLength(1);
    expect(views.filter((v) => !v.informational)).toHaveLength(5);
    for (const v of views) {
      expect(v.levels.map((l) => l.threshold)).toEqual([4.5, 7, 3, 4.5]);
      expect(v.ariaLabel.startsWith(v.sentence)).toBe(true);
      expect(v.ariaLabel).toContain(`${v.shown} sur 1`);
    }
    expect(views[0]?.sentence).toBe('Texte sur fond');
    expect(views[5]?.sentence).toBe('Accent secondaire sur fond');
    expect(views[5]?.ariaLabel).toMatch(/indicatif, seuil 3 sur 1, (atteint|non atteint)$/);
  });
  it('a passing pair offers no fix; a failing one offers the foreground fix and says "Échec"', () => {
    const ok = pairView(fixedState('light'), 'accent-fond');
    expect(ok.ok).toBe(true);
    expect(ok.fix).toEqual({ kind: 'none' });
    const bad = pairView(setBase('#E0A800')(fixedState('light')), 'accent-fond');
    expect(bad.ok).toBe(false);
    expect(bad.badge).toBe('Échec');
    expect(bad.levels.every((l) => !l.pass)).toBe(true);
    expect(bad.fix).toMatchObject({ kind: 'fg', offer: { role: 'accent', from: '#E0A800', to: '#8B6700' } });
    expect(bad.ariaLabel).toMatch(/niveau échec/);
  });
  it('dark mode is read from the dark palette', () => {
    const s = setMode('dark')(setBase('#E0A800')(fixedState('light')));
    expect(pairView(s, 'accent-fond').fgHex).toBe(s.theme.dark.accent);
    expect(pairView(s, 'accent-fond').ok).toBe(true);
  });
  it('impossible outcome with both hexes unusable: "stuck", and the documented sentences exist', () => {
    const s0 = setBase('#E0A800')(fixedState('light'));
    const crafted = { ...s0, theme: { ...s0.theme, light: { ...s0.theme.light, fond: 'x' } }, report: { ...s0.report } };
    expect(pairView(crafted, 'accent-fond').fix).toEqual({ kind: 'stuck' });
    expect(IMPOSSIBLE_MESSAGE).toBe('impossible avec ce fond, corriger le fond ?');
    expect(STUCK_MESSAGE).toMatch(/Impossible aussi en corrigeant le fond/);
  });
});

describe('pairView with the foreground fix forced impossible (mocked fixContrast)', () => {
  it('offers the background fix, "never silently": kind bg with its own proposal', async () => {
    vi.resetModules();
    vi.doMock('../../src/core/contrast', async (orig) => {
      const real = await orig<typeof import('../../src/core/contrast')>();
      return { ...real, fixContrast: (fg: string, bg: string, target: number) => (fg === '#E0A800' ? { ok: false as const, best: null } : real.fixContrast(fg, bg, target)) };
    });
    const { pairView: view } = await import('../../src/ui/pairs');
    const { setBase: base } = await import('../../src/state/state');
    const v = view(base('#E0A800')(fixedState('light')), 'accent-fond');
    expect(v.fix.kind).toBe('bg');
    if (v.fix.kind === 'bg') {
      expect(v.fix.offer.role).toBe('fond');
      expect(v.fix.offer.ratio).toBeGreaterThanOrEqual(4.5);
    }
    vi.doUnmock('../../src/core/contrast');
  });
});
