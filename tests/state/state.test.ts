import { describe, expect, it } from 'vitest';
import { HARMONIES } from '../../src/core/harmony';
import { formatHex, parseHex } from '../../src/core/hex';
import { next } from '../../src/core/random';
import { isLocked, LOCK_NONE, ROLES } from '../../src/palette/roles';
import { DEFAULT_HARMONY, hasard, initialState, setBase, setHarmony, setMode, toggleLock, type AppState } from '../../src/state/state';
import { fixedState, FIXED_SEED } from '../fixed-state';

const HEX = /^#[0-9A-F]{6}$/;

function assertValid(s: AppState): void {
  for (const mode of ['light', 'dark'] as const) for (const role of ROLES) expect(s.theme[mode][role]).toMatch(HEX);
}

describe('initialState', () => {
  it('follows the system mode passed in and is valid', () => {
    expect(fixedState('light').mode).toBe('light');
    expect(fixedState('dark').mode).toBe('dark');
    assertValid(fixedState('dark'));
  });
  it('uses the seed it is given, the default harmony, no lock, no base', () => {
    const s = fixedState('light');
    expect(s.seed).toBe(FIXED_SEED);
    expect(s.harmony).toBe(DEFAULT_HARMONY);
    expect(s.locks).toBe(LOCK_NONE);
    expect(s.base).toBeUndefined();
  });
  it('same seed = same state, different seed = different palette', () => {
    expect(JSON.stringify(initialState('light', 7))).toBe(JSON.stringify(initialState('light', 7)));
    expect(initialState('light', 7).theme).not.toEqual(initialState('light', 8).theme);
  });
  it('the system mode changes the mode only, not the colours', () => {
    expect(fixedState('dark').theme).toEqual(fixedState('light').theme);
  });
});

describe('hasard', () => {
  it('seed <- next(seed), pure and deterministic, input untouched', () => {
    const s0 = fixedState('light');
    const frozen = JSON.stringify(s0);
    const a = hasard()(s0);
    const b = hasard()(s0);
    expect(a.seed).toBe(next(s0.seed));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(s0)).toBe(frozen);
    expect(a.theme).not.toEqual(s0.theme);
    expect(a.shuffles).toBe(s0.shuffles + 1);
    assertValid(a);
  });
  it('keeps mode and harmony, drops a typed base', () => {
    let s = setHarmony('triad')(setMode('dark')(fixedState('light')));
    s = setBase('#336699')(s);
    const h = hasard()(s);
    expect(h.mode).toBe('dark');
    expect(h.harmony).toBe('triad');
    expect(h.base).toBeUndefined();
    expect(h.theme.light.accent).not.toBe('#336699');
  });
  it('locked colours (light and dark hex) survive 50 presses', () => {
    let s = fixedState('light');
    for (const role of ['accent', 'texte', 'fond'] as const) s = toggleLock(role)(s);
    const kept = s.theme;
    for (let i = 0; i < 50; i++) s = hasard()(s);
    for (const role of ['accent', 'texte', 'fond'] as const) {
      expect(isLocked(s.locks, role)).toBe(true);
      expect(s.theme.light[role]).toBe(kept.light[role]);
      expect(s.theme.dark[role]).toBe(kept.dark[role]);
    }
    expect(s.theme.light.surface).toMatch(HEX);
  });
  it('free colours do change', () => {
    const s0 = toggleLock('accent')(fixedState('light'));
    const s1 = hasard()(s0);
    expect(s1.theme.light.alerte !== s0.theme.light.alerte || s1.theme.light.succes !== s0.theme.light.succes || s1.theme.light.fond !== s0.theme.light.fond).toBe(true);
  });
});

describe('setBase', () => {
  it('keeps the typed base exactly as the light accent (normalised to uppercase #RRGGBB)', () => {
    for (const input of ['#336699', '336699', '#369', 'aBcDeF']) {
      const rgb = parseHex(input);
      if (rgb === null) throw new Error('bad test input');
      const s = setBase(input)(fixedState('light'));
      expect(s.theme.light.accent).toBe(formatHex(rgb));
      expect(s.base).toBe(formatHex(rgb));
    }
  });
  it('is deterministic and pure', () => {
    const s0 = fixedState('light');
    const a = setBase('#C0FFEE')(s0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(setBase('#C0FFEE')(s0)));
    expect(s0.base).toBeUndefined();
    expect(a.seed).toBe(s0.seed);
    assertValid(a);
  });
  it('returns the same object for an invalid hex (nothing applied)', () => {
    const s0 = fixedState('light');
    for (const bad of ['', '#12', 'zzzzzz', '#12345', '#1234567', 'javascript:1']) expect(setBase(bad)(s0)).toBe(s0);
  });
  it('J9: a typed base replaces a locked accent and the accent stays locked at the new value', () => {
    const s0 = toggleLock('accent')(fixedState('light'));
    const s1 = setBase('#336699')(s0);
    expect(s1.theme.light.accent).toBe('#336699');
    expect(s1.base).toBe('#336699');
    expect(isLocked(s1.locks, 'accent')).toBe(true);
    expect(s1.locks).toBe(s0.locks);
    expect(s1.seed).toBe(s0.seed);
    assertValid(s1);
    // the dark accent follows the new base (it is no longer the old locked one)
    expect(s1.theme.dark.accent).not.toBe(s0.theme.dark.accent);
    // and it stays through Hasard, in both modes
    const h = hasard()(s1);
    expect(h.theme.light.accent).toBe('#336699');
    expect(h.theme.dark.accent).toBe(s1.theme.dark.accent);
    expect(isLocked(h.locks, 'accent')).toBe(true);
  });
  it('J9: the same base as the locked accent changes nothing (same object); an unlocked accent keeps the old behaviour', () => {
    const s0 = toggleLock('accent')(fixedState('light'));
    expect(setBase(s0.theme.light.accent)(s0)).toBe(s0);
    const free = fixedState('light');
    expect(isLocked(setBase('#336699')(free).locks, 'accent')).toBe(false);
  });
  it('J9: a locked accent replaced by a base leaves every other locked role as it was', () => {
    let s = fixedState('light');
    for (const role of ['accent', 'fond', 'succes', 'alerte'] as const) s = toggleLock(role)(s);
    const s1 = setBase('#2E86AB')(s);
    for (const role of ['fond', 'succes', 'alerte'] as const) {
      expect(s1.theme.light[role]).toBe(s.theme.light[role]);
      expect(s1.theme.dark[role]).toBe(s.theme.dark[role]);
    }
    expect(s1.theme.light.accent).toBe('#2E86AB');
    expect(s1.locks).toBe(s.locks);
  });
  it('keeps the other locks', () => {
    const s0 = toggleLock('succes')(fixedState('light'));
    const s1 = setBase('#336699')(s0);
    expect(s1.theme.light.succes).toBe(s0.theme.light.succes);
    expect(s1.theme.dark.succes).toBe(s0.theme.dark.succes);
  });
});

describe('hasard with every role locked (J9)', () => {
  it('returns the same object: nothing changes, not even the seed or the counter', () => {
    let s = fixedState('light');
    for (const role of ROLES) s = toggleLock(role)(s);
    expect(hasard()(s)).toBe(s);
    const open = toggleLock('fond')(s);
    expect(hasard()(open)).not.toBe(open);
    expect(hasard()(open).shuffles).toBe(open.shuffles + 1);
  });
});

describe('setHarmony / setMode / toggleLock', () => {
  it('setHarmony regenerates with the same seed and keeps the typed base', () => {
    const s0 = setBase('#336699')(fixedState('light'));
    for (const h of HARMONIES) {
      const s = setHarmony(h)(s0);
      expect(s.harmony).toBe(h);
      expect(s.seed).toBe(s0.seed);
      expect(s.theme.light.accent).toBe('#336699');
      assertValid(s);
    }
    expect(setHarmony(s0.harmony)(s0)).toBe(s0);
  });
  it('setMode changes the mode only', () => {
    const s0 = fixedState('light');
    const s1 = setMode('dark')(s0);
    expect(s1.mode).toBe('dark');
    expect(s1.theme).toBe(s0.theme);
    expect(setMode('light')(s0)).toBe(s0);
  });
  it('toggleLock flips one bit and flipping twice restores', () => {
    const s0 = fixedState('light');
    for (const [i, role] of ROLES.entries()) {
      const on = toggleLock(role)(s0);
      expect(on.locks).toBe(1 << i);
      expect(on.theme).toBe(s0.theme);
      expect(toggleLock(role)(on).locks).toBe(0);
    }
  });
});
