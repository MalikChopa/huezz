import { onAccent, reportMode } from '../palette/theme';
import { fixedRoles } from './fix';
import type { Action, AppState } from './state';
import type { Shared } from './url';

/** State rebuilt from a decoded link: the 14 colours are kept as they are, nothing is regenerated. */
export function stateFromShared(shared: Shared, shuffles = 0): AppState {
  const draft: AppState = {
    mode: shared.mode,
    harmony: shared.harmony,
    seed: shared.seed,
    locks: shared.locks,
    theme: shared.theme,
    report: { light: [], dark: [] },
    onAccent: { light: onAccent(shared.theme.light.accent), dark: onAccent(shared.theme.dark.accent) },
    shuffles,
  };
  return { ...draft, report: { light: reportMode(draft.theme.light, fixedRoles(draft, 'light')), dark: reportMode(draft.theme.dark, fixedRoles(draft, 'dark')) } };
}

const same = (a: AppState, b: Shared): boolean =>
  a.mode === b.mode && a.harmony === b.harmony && a.seed === b.seed && a.locks === b.locks && JSON.stringify(a.theme) === JSON.stringify(b.theme);

/** Loads a decoded link; the same link gives the same object back (no render). */
export function loadShared(shared: Shared): Action {
  return (s) => (same(s, shared) ? s : stateFromShared(shared, s.shuffles));
}
