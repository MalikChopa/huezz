import type { Action, AppState } from './state';

/** Undo steps kept for the visit (not persisted). */
export const MAX_STEPS = 100;

export type Timeline = { readonly past: readonly AppState[]; readonly future: readonly AppState[] };
export const NO_STEPS: Timeline = { past: [], future: [] };

/** The palette part of the state (seed, harmony, locks, base, generated colours): the mode and Vision are not in it. */
export const samePalette = (a: AppState, b: AppState): boolean =>
  a.theme === b.theme && a.harmony === b.harmony && a.locks === b.locks && a.seed === b.seed && a.base === b.base;

/** A new change: `before` becomes an undo step (unless it continues a drag that already has its step) and the redo list is dropped. */
export function record(t: Timeline, before: AppState, joinsPrevious: boolean): Timeline {
  return { past: joinsPrevious ? t.past : [...t.past, before].slice(-MAX_STEPS), future: [] };
}

export function undo(t: Timeline, present: AppState): { timeline: Timeline; state: AppState } | null {
  const state = t.past[t.past.length - 1];
  return state === undefined ? null : { timeline: { past: t.past.slice(0, -1), future: [...t.future, present].slice(-MAX_STEPS) }, state };
}

export function redo(t: Timeline, present: AppState): { timeline: Timeline; state: AppState } | null {
  const state = t.future[t.future.length - 1];
  return state === undefined ? null : { timeline: { past: [...t.past, present].slice(-MAX_STEPS), future: t.future.slice(0, -1) }, state };
}

/** Puts a saved palette back; the mode and the Hasard counter stay the current ones (no mode flip, no wave). */
export const restore = (saved: AppState): Action => (s) => (samePalette(s, saved) ? s : { ...saved, mode: s.mode, shuffles: s.shuffles });
