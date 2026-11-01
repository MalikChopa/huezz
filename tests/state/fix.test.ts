import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../src/core/contrast';
import { isLocked, PAIRS, ROLES, type PairId } from '../../src/palette/roles';
import { fixPair, fixTarget, planFix } from '../../src/state/fix';
import { hasard, setBase, setHarmony, setMode, toggleLock, type AppState } from '../../src/state/state';
import { fixedState } from '../fixed-state';

const yellow = (mode: 'light' | 'dark' = 'light'): AppState => setMode(mode)(setBase('#E0A800')(fixedState('light')));
const ratioOf = (s: AppState, id: PairId): number => s.report[s.mode].find((p) => p.id === id)?.ratio ?? NaN;
const pairRatio = (s: AppState, id: PairId): number => {
  const spec = PAIRS.find((p) => p.id === id);
  if (spec === undefined) throw new Error(id);
  return contrastRatio(s.theme[s.mode][spec.fg], s.theme[s.mode][spec.bg]) as number;
};

describe('fixTarget', () => {
  it('4.5 for the five checked pairs (never the AAA rung), 3 for the informative one', () => {
    for (const p of PAIRS) expect(fixTarget(p.id)).toBe(p.informational ? 3 : 4.5);
  });
});

describe('fixPair (light mode, yellow base: accent/fond fails)', () => {
  const s0 = yellow();
  it('the setup really fails and the plan says what will change', () => {
    expect(ratioOf(s0, 'accent-fond')).toBeLessThan(2);
    const plan = planFix(s0, 'accent-fond');
    expect(plan).toMatchObject({ ok: true, role: 'accent', from: '#E0A800', to: '#8B6700', side: 'fg' });
  });

  it('is pure: input untouched, same result twice (determinism)', () => {
    const frozen = JSON.stringify(s0);
    const a = fixPair('accent-fond')(s0);
    const b = fixPair('accent-fond')(s0);
    expect(JSON.stringify(s0)).toBe(frozen);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).not.toBe(s0);
  });

  it('brings the pair to >= 4.5 on the exact colours and the report agrees', () => {
    const s1 = fixPair('accent-fond')(s0);
    expect(pairRatio(s1, 'accent-fond')).toBeGreaterThanOrEqual(4.5);
    expect(ratioOf(s1, 'accent-fond')).toBeGreaterThanOrEqual(4.5);
    expect(s1.report.light.find((p) => p.id === 'accent-fond')?.ok).toBe(true);
  });

  it('changes only the foreground role, in the displayed mode: the other mode and all other roles are identical', () => {
    const s1 = fixPair('accent-fond')(s0);
    expect(s1.theme.dark).toEqual(s0.theme.dark);
    for (const role of ROLES) if (role !== 'accent') expect(s1.theme.light[role]).toBe(s0.theme.light[role]);
    expect(s1.theme.light.accent).not.toBe(s0.theme.light.accent);
    expect(s1.report.dark.map((p) => [p.id, p.ratio, p.ok])).toEqual(s0.report.dark.map((p) => [p.id, p.ratio, p.ok]));
    for (const id of ['texte-fond', 'succes-surface', 'alerte-surface'] as const) expect(ratioOf(s1, id)).toBe(ratioOf(s0, id));
  });

  it('locks the changed role (and only it), keeps mode, harmony, seed', () => {
    const s1 = fixPair('accent-fond')(s0);
    expect(isLocked(s1.locks, 'accent')).toBe(true);
    for (const role of ROLES) if (role !== 'accent') expect(isLocked(s1.locks, role)).toBe(isLocked(s0.locks, role));
    expect([s1.mode, s1.harmony, s1.seed]).toEqual([s0.mode, s0.harmony, s0.seed]);
  });

  it('the typed base follows the corrected hex (the base field shows it)', () => {
    const s1 = fixPair('accent-fond')(s0);
    expect(s0.base).toBe('#E0A800');
    expect(s1.base).toBe(s1.theme.light.accent);
    expect(s1.base).toBe('#8B6700');
  });

  it('a second press changes nothing (pair already met): same object', () => {
    const s1 = fixPair('accent-fond')(s0);
    expect(fixPair('accent-fond')(s1)).toBe(s1);
    expect(planFix(s1, 'accent-fond')).toMatchObject({ ok: false, reason: 'met' });
  });

  it('survives 20 Hasard: the corrected accent stays in both modes; the report matches the exact ratio (the pair itself may drop: a locked colour is never moved, section 4)', () => {
    let s = fixPair('accent-fond')(s0);
    const fixed = s.theme.light.accent;
    const darkAccent = s.theme.dark.accent;
    for (let i = 0; i < 20; i++) {
      s = hasard()(s);
      expect(s.theme.light.accent).toBe(fixed);
      expect(s.theme.dark.accent).toBe(darkAccent);
      const report = s.report.light.find((p) => p.id === 'accent-fond');
      expect(report?.ratio).toBeCloseTo(pairRatio(s, 'accent-fond'), 10);
      expect(report?.touchesFixed).toBe(true);
    }
  });

  it('a locked foreground can still be fixed by the explicit action (lock kept)', () => {
    const locked = toggleLock('accent')(s0);
    const s1 = fixPair('accent-fond')(locked);
    expect(pairRatio(s1, 'accent-fond')).toBeGreaterThanOrEqual(4.5);
    expect(isLocked(s1.locks, 'accent')).toBe(true);
  });

  it('background side: fixes the Fond against the accent, locks Fond only, other mode untouched', () => {
    const s1 = fixPair('accent-fond', 'bg')(s0);
    expect(s1.theme.light.accent).toBe(s0.theme.light.accent);
    expect(s1.theme.light.fond).not.toBe(s0.theme.light.fond);
    expect(pairRatio(s1, 'accent-fond')).toBeGreaterThanOrEqual(4.5);
    expect(isLocked(s1.locks, 'fond')).toBe(true);
    expect(isLocked(s1.locks, 'accent')).toBe(false);
    expect(s1.theme.dark).toEqual(s0.theme.dark);
    expect(s1.base).toBe('#E0A800');
  });
});

describe('fixPair (dark mode)', () => {
  it('fixes the dark palette only; the light one is untouched; lock keeps both hexes', () => {
    // A locked light-yellow accent shown in dark mode with a bad dark accent: build it by locking, then fixing the dark fg against a dark fond forced by the bg fix.
    const s0 = setMode('dark')(fixedState('light'));
    const pair: PairId = 'texte-fond';
    const bad = { ...s0, theme: { ...s0.theme, dark: { ...s0.theme.dark, texte: '#2A2A2A' } } };
    expect(pairRatio(bad, pair)).toBeLessThan(4.5);
    const s1 = fixPair(pair)(bad);
    expect(pairRatio(s1, pair)).toBeGreaterThanOrEqual(4.5);
    expect(s1.theme.light).toEqual(bad.theme.light);
    expect(s1.mode).toBe('dark');
    expect(isLocked(s1.locks, 'texte')).toBe(true);
    expect(s1.base).toBeUndefined();
  });

  it('informative pair accent2/fond uses the target 3, not 4.5', () => {
    const s0 = fixedState('light');
    const bad = { ...s0, theme: { ...s0.theme, light: { ...s0.theme.light, accent2: '#E8E3D0' } } };
    expect(pairRatio(bad, 'accent2-fond')).toBeLessThan(3);
    const s1 = fixPair('accent2-fond')(bad);
    const r = pairRatio(s1, 'accent2-fond');
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeLessThan(3.2);
  });
});

describe('fixPair: impossible and no-op cases (documented outcome: state unchanged, same object)', () => {
  it('already compliant pair: unchanged', () => {
    const s = fixedState('light');
    for (const p of PAIRS) expect(fixPair(p.id)(s)).toBe(s);
  });
  it('impossible fix (crafted state with an invalid background): ok:false, nothing changes', () => {
    const s0 = fixedState('light');
    const crafted = { ...s0, theme: { ...s0.theme, light: { ...s0.theme.light, fond: 'pas-un-hex' } } };
    expect(planFix(crafted, 'accent-fond')).toMatchObject({ ok: false, reason: 'impossible', role: 'accent', best: null });
    expect(fixPair('accent-fond')(crafted)).toBe(crafted);
  });
  it('unknown pair id: unchanged', () => {
    const s = fixedState('light');
    expect(fixPair('nope' as PairId)(s)).toBe(s);
  });
  it('AA is always reachable against a valid solid background (>= 4.58), so the real app never hits "impossible" for AA', () => {
    for (const bg of ['#808080', '#777777', '#7B7B7B', '#767676']) {
      const s0 = fixedState('light');
      const crafted = { ...s0, theme: { ...s0.theme, light: { ...s0.theme.light, fond: bg, accent: bg } } };
      expect(planFix(crafted, 'accent-fond').ok).toBe(true);
    }
  });
});

describe('fixPair keeps working after other actions', () => {
  it('setHarmony keeps the corrected accent (locked)', () => {
    const s1 = fixPair('accent-fond')(yellow());
    const s2 = setHarmony('triad')(s1);
    expect(s2.theme.light.accent).toBe(s1.theme.light.accent);
  });
});

describe('J9 (audit I1, tester G1): a base typed after Corriger', () => {
  it('yellow #E0A800, Corriger, then #2E86AB: the accent is #2E86AB and locked, the other locked roles are untouched', () => {
    let s = toggleLock('succes')(yellow());
    const succes = s.theme.light.succes;
    s = fixPair('accent-fond')(s);
    expect(isLocked(s.locks, 'accent')).toBe(true);
    expect(s.theme.light.accent).toBe('#8B6700');
    const typed = setBase('#2E86AB')(s);
    expect(typed).not.toBe(s);
    expect(typed.theme.light.accent).toBe('#2E86AB');
    expect(typed.base).toBe('#2E86AB');
    expect(isLocked(typed.locks, 'accent')).toBe(true);
    expect(isLocked(typed.locks, 'succes')).toBe(true);
    expect(typed.theme.light.succes).toBe(succes);
    expect(typed.theme.dark.succes).toBe(s.theme.dark.succes);
    expect(typed.locks).toBe(s.locks);
    // the report is the one of the new colours (fixed roles: locked ones and the base)
    const accentPair = typed.report.light.find((p) => p.id === 'accent-fond');
    expect(accentPair?.touchesFixed).toBe(true);
    expect(accentPair?.ratio).toBeCloseTo(contrastRatio('#2E86AB', typed.theme.light.fond) ?? NaN, 9);
    // and it stays through Hasard
    expect(hasard()(typed).theme.light.accent).toBe('#2E86AB');
  });
});
