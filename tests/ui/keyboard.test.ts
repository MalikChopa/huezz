import { describe, expect, it } from 'vitest';
import { keyIntent, type KeyFacts } from '../../src/ui/keyboard';

const base: KeyFacts = { key: ' ', repeat: false, modifier: false, command: false, shift: false, ctrl: false, typing: false, native: false };
const k = (o: Partial<KeyFacts>): KeyFacts => ({ ...base, ...o });

describe('keyIntent (section 6 table)', () => {
  it('Space = Hasard on the page, not on a control that keeps its native action', () => {
    expect(keyIntent(k({}))).toBe('hasard');
    expect(keyIntent(k({ native: true }))).toBeNull();
    expect(keyIntent(k({ native: true, typing: true }))).toBeNull();
  });
  it('no Hasard on key repeat or with a modifier', () => {
    expect(keyIntent(k({ repeat: true }))).toBeNull();
    expect(keyIntent(k({ modifier: true }))).toBeNull();
  });
  it('L locks except when typing in a field', () => {
    expect(keyIntent(k({ key: 'l' }))).toBe('lock');
    expect(keyIntent(k({ key: 'L' }))).toBe('lock');
    expect(keyIntent(k({ key: 'l', typing: true }))).toBeNull();
    expect(keyIntent(k({ key: 'l', native: true }))).toBe('lock');
    expect(keyIntent(k({ key: 'l', modifier: true }))).toBeNull();
  });
  it('Escape is always an intent; Enter and other keys are left to the controls', () => {
    expect(keyIntent(k({ key: 'Escape', typing: true }))).toBe('escape');
    expect(keyIntent(k({ key: 'Enter' }))).toBeNull();
    expect(keyIntent(k({ key: 'ArrowLeft' }))).toBeNull();
    expect(keyIntent(k({ key: 'a' }))).toBeNull();
  });
  it('J13: Ctrl/Cmd+Z undoes, Shift+Z redoes, Ctrl+Y redoes; a text field or select keeps its own undo', () => {
    const cmd = { modifier: true, command: true };
    expect(keyIntent(k({ ...cmd, key: 'z' }))).toBe('undo');
    expect(keyIntent(k({ ...cmd, key: 'Z', shift: true }))).toBe('redo');
    expect(keyIntent(k({ ...cmd, key: 'z', shift: true }))).toBe('redo');
    expect(keyIntent(k({ ...cmd, key: 'y', ctrl: true }))).toBe('redo');
    expect(keyIntent(k({ ...cmd, key: 'y' }))).toBeNull(); // Cmd+Y is the browser history on a Mac
    expect(keyIntent(k({ ...cmd, key: 'y', ctrl: true, shift: true }))).toBeNull();
    expect(keyIntent(k({ ...cmd, key: 'z', typing: true }))).toBeNull();
    expect(keyIntent(k({ ...cmd, key: 'y', ctrl: true, typing: true }))).toBeNull();
    expect(keyIntent(k({ ...cmd, key: 'z', native: true }))).toBe('undo');
    expect(keyIntent(k({ ...cmd, key: 'z', repeat: true }))).toBe('undo');
    expect(keyIntent(k({ modifier: true, command: false, key: 'z' }))).toBeNull(); // Alt+Z alone
    expect(keyIntent(k({ key: 'z' }))).toBeNull();
    expect(keyIntent(k({ ...cmd, key: 'a' }))).toBeNull();
  });
});
