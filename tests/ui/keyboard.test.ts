import { describe, expect, it } from 'vitest';
import { keyIntent, type KeyFacts } from '../../src/ui/keyboard';

const base: KeyFacts = { key: ' ', repeat: false, modifier: false, typing: false, native: false };
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
});
