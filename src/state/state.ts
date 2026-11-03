import type { Harmony } from '../core/harmony';
import { formatHex, parseHex } from '../core/hex';
import { next } from '../core/random';
import { generate } from '../palette/generate';
import { isLocked, LOCK_ALL, normalizeMask, ROLES, toggleLock as toggleMask, type LockMask, type Mode, type Role, type ThemeColors, type ThemeReport } from '../palette/roles';
import { reportMode } from '../palette/theme';
import { fixedRoles } from './fix';

export type OnAccent = Readonly<Record<Mode, '#000000' | '#FFFFFF'>>;

export type AppState = {
  readonly mode: Mode;
  readonly harmony: Harmony;
  /** uint32 */
  readonly seed: number;
  readonly locks: LockMask;
  /** Hex typed or picked by the user (light accent), cleared by Hasard. */
  readonly base?: string;
  readonly theme: ThemeColors;
  readonly report: ThemeReport;
  readonly onAccent: OnAccent;
  /** Incremented by Hasard only: the renderer staggers the swatches when it changes. */
  readonly shuffles: number;
};

export type Action = (state: AppState) => AppState;

/** Harmony of the first screen. The seed is not fixed: the caller draws one (`randomSeed`), a link restores a palette exactly. */
export const DEFAULT_HARMONY: Harmony = 'complementary';

type Core = Pick<AppState, 'harmony' | 'seed' | 'locks' | 'base'>;

function regenerate(prev: AppState | null, core: Core): AppState {
  const result = generate({
    harmony: core.harmony,
    seed: core.seed,
    locks: core.locks,
    ...(core.base === undefined ? {} : { base: core.base }),
    ...(prev === null ? {} : { previous: prev.theme }),
  });
  return {
    mode: prev?.mode ?? 'light',
    harmony: core.harmony,
    seed: core.seed,
    locks: core.locks,
    ...(core.base === undefined ? {} : { base: core.base }),
    theme: { light: result.light, dark: result.dark },
    report: result.report,
    onAccent: result.onAccent,
    shuffles: prev?.shuffles ?? 0,
  };
}

export function initialState(systemMode: Mode, seed: number, harmony: Harmony = DEFAULT_HARMONY): AppState {
  return { ...regenerate(null, { harmony, seed: seed >>> 0, locks: 0 }), mode: systemMode };
}

/**
 * Space bar: new seed, new palette, locked colours kept. A typed base is dropped (the accent is drawn again).
 * All 7 roles locked: nothing could change, so the state is returned as it is (same object, seed and counter untouched).
 */
export function hasard(): Action {
  return (s) => normalizeMask(s.locks) === LOCK_ALL ? s : ({ ...regenerate(s, { harmony: s.harmony, seed: next(s.seed), locks: s.locks }), mode: s.mode, shuffles: s.shuffles + 1 });
}

const ACCENT_BIT = 1 << ROLES.indexOf('accent');

/**
 * Invalid hex: the state is returned unchanged (same object).
 * Accent locked: the typed base replaces the accent and the accent stays locked at the new value (the other locked roles are untouched).
 */
export function setBase(hex: string): Action {
  return (s) => {
    const rgb = parseHex(hex);
    if (rgb === null) return s;
    const base = formatHex(rgb);
    if (base === s.base && base === s.theme.light.accent) return s;
    if (isLocked(s.locks, 'accent')) {
      if (base === s.theme.light.accent) return s;
      const free = regenerate(s, { harmony: s.harmony, seed: s.seed, locks: normalizeMask(s.locks) & ~ACCENT_BIT, base });
      const next: AppState = { ...free, locks: s.locks, mode: s.mode, shuffles: s.shuffles };
      return { ...next, report: { light: reportMode(next.theme.light, fixedRoles(next, 'light')), dark: reportMode(next.theme.dark, fixedRoles(next, 'dark')) } };
    }
    return { ...regenerate(s, { harmony: s.harmony, seed: s.seed, locks: s.locks, base }), mode: s.mode, shuffles: s.shuffles };
  };
}

export function setHarmony(harmony: Harmony): Action {
  return (s) => {
    if (harmony === s.harmony) return s;
    return { ...regenerate(s, { harmony, seed: s.seed, locks: s.locks, ...(s.base === undefined ? {} : { base: s.base }) }), mode: s.mode, shuffles: s.shuffles };
  };
}

/**
 * An image candidate (base colour + harmony + the seed derived from the base): the palette is built from scratch, locks cleared,
 * so the same candidate is the same palette whatever was on screen. The mode and the Hasard counter stay the current ones.
 */
export function useCandidate(c: { base: string; harmony: Harmony; seed: number }): Action {
  return (s) => ({ ...regenerate(s, { harmony: c.harmony, seed: c.seed, locks: 0, base: c.base }), mode: s.mode, shuffles: s.shuffles });
}

export function setMode(mode: Mode): Action {
  return (s) => (mode === s.mode ? s : { ...s, mode });
}

export function toggleLock(role: Role): Action {
  return (s) => ({ ...s, locks: toggleMask(s.locks, role) });
}
