import { describe, expect, it } from 'vitest';
import { hasard, setBase, setHarmony, setMode, toggleLock, type AppState } from '../../src/state/state';
import { MAX_STEPS, NO_STEPS, record, redo, restore, samePalette, undo } from '../../src/state/undo';
import { fixedState } from '../fixed-state';

const s0 = fixedState('light');
const s1 = hasard()(s0);
const s2 = hasard()(s1);

describe('samePalette', () => {
  it('ignores the mode, sees the seed, harmony, locks, base and colours', () => {
    expect(samePalette(s0, setMode('dark')(s0))).toBe(true);
    expect(samePalette(s0, s1)).toBe(false);
    expect(samePalette(s0, setHarmony('triad')(s0))).toBe(false);
    expect(samePalette(s0, toggleLock('fond')(s0))).toBe(false);
    expect(samePalette(s0, setBase('#336699')(s0))).toBe(false);
  });
});

describe('timeline', () => {
  it('a change records the state before it and drops the redo list', () => {
    let t = record(NO_STEPS, s0, false);
    expect(t.past).toEqual([s0]);
    const u = undo(t, s1);
    expect(u?.state).toBe(s0);
    t = u!.timeline;
    expect(t.future).toEqual([s1]);
    t = record(t, s0, false);
    expect(t.future).toEqual([]);
  });
  it('undo does not push on the past, redo does not drop the future, both round-trip', () => {
    let t = record(record(NO_STEPS, s0, false), s1, false);
    const a = undo(t, s2)!;
    expect(a.state).toBe(s1);
    expect(a.timeline.past).toEqual([s0]);
    const b = undo(a.timeline, s1)!;
    expect(b.state).toBe(s0);
    expect(b.timeline.future).toEqual([s2, s1]);
    const c = redo(b.timeline, s0)!;
    expect(c.state).toBe(s1);
    expect(c.timeline.future).toEqual([s2]);
    const d = redo(c.timeline, s1)!;
    expect(d.state).toBe(s2);
    expect(redo(d.timeline, s2)).toBeNull();
    t = d.timeline;
    expect(t.past).toEqual([s0, s1]);
  });
  it('nothing to undo or redo gives null', () => {
    expect(undo(NO_STEPS, s0)).toBeNull();
    expect(redo(NO_STEPS, s0)).toBeNull();
  });
  it('a drag continues the previous step: no new line, redo list still dropped', () => {
    const t = record(record(NO_STEPS, s0, false), s1, true);
    expect(t.past).toEqual([s0]);
    const redoable = { ...t, future: [s2] };
    expect(record(redoable, s1, true).future).toEqual([]);
  });
  it('is bounded', () => {
    let t = NO_STEPS;
    for (let i = 0; i < MAX_STEPS + 50; i++) t = record(t, i % 2 ? s0 : s1, false);
    expect(t.past).toHaveLength(MAX_STEPS);
    let f = { past: [] as readonly AppState[], future: [] as readonly AppState[] };
    for (let i = 0; i < MAX_STEPS + 50; i++) f = undo({ past: [s0], future: f.future }, s1)!.timeline;
    expect(f.future).toHaveLength(MAX_STEPS);
  });
});

describe('restore', () => {
  it('puts the saved palette back and keeps the mode and the Hasard counter of now', () => {
    const dark = setMode('dark')(s2);
    const r = restore(s0)(dark);
    expect(r.theme).toBe(s0.theme);
    expect(r.seed).toBe(s0.seed);
    expect(r.mode).toBe('dark');
    expect(r.shuffles).toBe(dark.shuffles);
  });
  it('restores the typed base of the saved state', () => {
    const typed = setBase('#336699')(s0);
    expect(restore(typed)(s1).base).toBe('#336699');
  });
  it('the same palette gives the same object (no render)', () => {
    expect(restore(s1)(s1)).toBe(s1);
    const dark = setMode('dark')(s1);
    expect(restore(s1)(dark)).toBe(dark);
  });
});
