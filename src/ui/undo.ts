import type { Action, AppState } from '../state/state';
import type { Store } from '../state/store';
import { NO_STEPS, record, redo, restore, samePalette, undo, type Timeline } from '../state/undo';

/** Base colour changes closer than this belong to one drag of a colour picker: one undo step. */
const DRAG_MS = 500;

export type Undoable = {
  store: Store;
  /** Returns the palette put back, or null when there was nothing to go back to. */
  undo(): AppState | null;
  redo(): AppState | null;
};

/** The store, with every palette change of the visit remembered. Undo and redo do not record themselves; a new change drops the redo list. */
export function withUndo(inner: Store): Undoable {
  let steps: Timeline = NO_STEPS;
  let lastDragAt = -Infinity;
  const dispatch = (action: Action): void => {
    const before = inner.getState();
    inner.dispatch(action);
    const after = inner.getState();
    if (after === before || samePalette(before, after)) return;
    const drag = after.seed === before.seed && after.harmony === before.harmony && after.locks === before.locks;
    const now = performance.now();
    steps = record(steps, before, drag && now - lastDragAt < DRAG_MS);
    lastDragAt = drag ? now : -Infinity;
  };
  const go = (step: typeof undo): AppState | null => {
    const r = step(steps, inner.getState());
    if (r === null) return null;
    steps = r.timeline;
    lastDragAt = -Infinity;
    inner.dispatch(restore(r.state));
    return inner.getState();
  };
  return { store: { ...inner, dispatch }, undo: () => go(undo), redo: () => go(redo) };
}
