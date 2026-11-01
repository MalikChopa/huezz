import { describe, expect, it } from 'vitest';
import { createStore } from '../../src/state/store';
import { hasard, setMode, toggleLock, type AppState } from '../../src/state/state';
import { fixedState } from '../fixed-state';

function harness() {
  const frames: (() => void)[] = [];
  const calls: { prev: AppState | null; next: AppState }[] = [];
  const store = createStore(fixedState('light'), (prev, next) => calls.push({ prev, next }), (cb) => frames.push(cb));
  const frame = () => frames.splice(0).forEach((cb) => cb());
  return { store, frames, calls, frame };
}

describe('store', () => {
  it('renders once at start, prev = null, then at most once per frame whatever the number of dispatches', () => {
    const { store, frames, calls, frame } = harness();
    expect(frames.length).toBe(1);
    frame();
    expect(calls.length).toBe(1);
    expect(calls[0]?.prev).toBeNull();
    const rendered = store.getState();
    for (let i = 0; i < 10; i++) store.dispatch(hasard());
    store.dispatch(toggleLock('accent'));
    expect(frames.length).toBe(1);
    frame();
    expect(calls.length).toBe(2);
    expect(calls[1]?.prev).toBe(rendered);
    expect(calls[1]?.next).toBe(store.getState());
    expect(store.getState().shuffles).toBe(10);
  });
  it('state is up to date immediately; an action that changes nothing schedules nothing', () => {
    const { store, frames, frame } = harness();
    frame();
    store.dispatch(setMode('light'));
    expect(frames.length).toBe(0);
    store.dispatch(setMode('dark'));
    expect(store.getState().mode).toBe('dark');
    expect(frames.length).toBe(1);
  });
  it('invalidate asks for a full render (prev = null)', () => {
    const { store, calls, frame } = harness();
    frame();
    store.invalidate();
    store.invalidate();
    frame();
    expect(calls.length).toBe(2);
    expect(calls[1]?.prev).toBeNull();
  });
});
