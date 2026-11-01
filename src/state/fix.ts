import { fixContrast, type Fixed } from '../core/contrast';
import { isLocked, PAIRS, ROLES, toggleLock as toggleMask, type Mode, type PairId, type Role } from '../palette/roles';
import { reportMode } from '../palette/theme';
import type { Action, AppState } from './state';

/** Which member of the pair is corrected: the text-side (foreground) or the background. */
export type FixSide = 'fg' | 'bg';

export type FixPlan =
  | { ok: true; pairId: PairId; side: FixSide; role: Role; from: string; to: string; ratio: number; target: number }
  | { ok: false; reason: 'met' | 'impossible' | 'unknown'; pairId: PairId; side: FixSide; role: Role | null; target: number; best: Fixed | null };

/** One-click target: the AA threshold of the pair (4.5, or 3 for the informative pair), never the AAA rung of the ladder. */
export function fixTarget(pairId: PairId): number {
  return PAIRS.find((p) => p.id === pairId)?.informational === true ? 3 : 4.5;
}

/** Roles the generator must not move in a mode: locked ones, plus the typed base (light accent). */
export function fixedRoles(s: AppState, mode: Mode): Set<Role> {
  const fixed = new Set<Role>();
  for (const role of ROLES) if (isLocked(s.locks, role)) fixed.add(role);
  if (mode === 'light' && s.base !== undefined) fixed.add('accent');
  return fixed;
}

/** Pure: what `fixPair` would do on the displayed mode. */
export function planFix(s: AppState, pairId: PairId, side: FixSide = 'fg'): FixPlan {
  const spec = PAIRS.find((p) => p.id === pairId);
  const target = fixTarget(pairId);
  if (spec === undefined) return { ok: false, reason: 'unknown', pairId, side, role: null, target, best: null };
  const palette = s.theme[s.mode];
  const role = side === 'fg' ? spec.fg : spec.bg;
  const other = side === 'fg' ? spec.bg : spec.fg;
  const result = fixContrast(palette[role], palette[other], target);
  if (!result.ok) return { ok: false, reason: 'impossible', pairId, side, role, target, best: result.best };
  if (result.hex === palette[role]) return { ok: false, reason: 'met', pairId, side, role, target, best: { hex: result.hex, ratio: result.ratio } };
  return { ok: true, pairId, side, role, from: palette[role], to: result.hex, ratio: result.ratio, target };
}

/**
 * Corrects one pair in the DISPLAYED mode only and locks the changed role (a correction is a colour set by the user,
 * so Hasard keeps it). Impossible or already met: the state is returned unchanged (same object).
 * If the corrected role is the typed base (light accent), the base follows, so the base field shows the corrected hex.
 * Nothing else is regenerated.
 */
export function fixPair(pairId: PairId, side: FixSide = 'fg'): Action {
  return (s) => {
    const plan = planFix(s, pairId, side);
    if (!plan.ok) return s;
    const mode = s.mode;
    const locks = isLocked(s.locks, plan.role) ? s.locks : toggleMask(s.locks, plan.role);
    const theme = { ...s.theme, [mode]: { ...s.theme[mode], [plan.role]: plan.to } };
    const base = mode === 'light' && plan.role === 'accent' && s.base !== undefined ? { base: plan.to } : s.base === undefined ? {} : { base: s.base };
    const next = { ...s, ...base, locks, theme };
    const report = {
      light: reportMode(next.theme.light, fixedRoles(next, 'light')),
      dark: reportMode(next.theme.dark, fixedRoles(next, 'dark')),
    };
    return { ...next, report };
  };
}
