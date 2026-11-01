import { describe, expect, it } from 'vitest';
import { LOCK_ALL, PAIRS, ROLES, isLocked, normalizeMask, toggleLock } from '../../src/palette/roles';

describe('roles', () => {
  it('7 roles in the fixed order', () => {
    expect([...ROLES]).toEqual(['fond', 'surface', 'texte', 'accent', 'accent2', 'succes', 'alerte']);
  });

  it('lock mask: 7 bits, bit i = role i, out-of-range bits dropped', () => {
    expect(LOCK_ALL).toBe(127);
    expect(normalizeMask(0xffff)).toBe(127);
    expect(normalizeMask(NaN)).toBe(0);
    expect(isLocked(0b0001000, 'accent')).toBe(true);
    expect(isLocked(0b0001000, 'texte')).toBe(false);
    expect(toggleLock(0, 'alerte')).toBe(64);
    expect(toggleLock(toggleLock(5, 'surface'), 'surface')).toBe(5);
  });

  it('the 6 pairs and their targets', () => {
    const table = PAIRS.map((p) => `${p.fg}/${p.bg}:${p.ladder.join('>')}${p.informational ? ' info' : ''}`);
    expect(table).toEqual([
      'texte/fond:7>4.5',
      'texte/surface:7>4.5',
      'accent/fond:4.5',
      'succes/surface:4.5',
      'alerte/surface:4.5',
      'accent2/fond:3 info',
    ]);
  });
});
