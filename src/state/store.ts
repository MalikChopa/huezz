import type { Action, AppState } from './state';

export type Renderer = (prev: AppState | null, next: AppState) => void;
export type Schedule = (callback: () => void) => void;

export type Store = {
  getState(): AppState;
  /** Applies the action now; the render happens at most once per frame. */
  dispatch(action: Action): void;
  /** Full re-render at the next frame (for example the system theme changed). */
  invalidate(): void;
};

export function createStore(initial: AppState, render: Renderer, schedule: Schedule = (cb) => requestAnimationFrame(cb)): Store {
  let state = initial;
  let rendered: AppState | null = null;
  let pending = false;
  let full = true;

  const flush = () => {
    pending = false;
    const prev = full ? null : rendered;
    full = false;
    rendered = state;
    render(prev, state);
  };
  const request = () => {
    if (pending) return;
    pending = true;
    schedule(flush);
  };

  request();
  return {
    getState: () => state,
    dispatch(action) {
      const nextState = action(state);
      if (nextState === state) return;
      state = nextState;
      request();
    },
    invalidate() {
      full = true;
      request();
    },
  };
}
