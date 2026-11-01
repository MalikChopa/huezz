import { describe, expect, it } from 'vitest';
import { fixPair } from '../../src/state/fix';
import { hasard, setBase, setHarmony, setMode, toggleLock } from '../../src/state/state';
import { fixedState } from '../fixed-state';
import { announcement } from '../../src/ui/announce';

const start = fixedState('light');

describe('announcement (live region sentence)', () => {
  it('nothing for the first render', () => {
    expect(announcement(null, start)).toBeNull();
  });
  it('Hasard: new palette, accent of the current mode, AA count', () => {
    const next = hasard()(start);
    expect(announcement(start, next)).toBe(`Nouvelle palette : accent ${next.theme.light.accent}, 5 sur 5 contrastes AA`);
  });
  it('dark mode says the dark accent', () => {
    const next = setMode('dark')(start);
    expect(announcement(start, next)).toBe(`Palette sombre : accent ${next.theme.dark.accent}, 5 sur 5 contrastes AA`);
    expect(announcement(next, setMode('light')(next))).toMatch(/^Palette claire : accent #[0-9A-F]{6}, \d sur 5 contrastes AA$/);
  });
  it('harmony and base', () => {
    const triad = setHarmony('triad')(start);
    expect(announcement(start, triad)).toMatch(/^Harmonie triade : accent #[0-9A-F]{6}, \d sur 5 contrastes AA$/);
    const base = setBase('#E0A800')(start);
    expect(announcement(start, base)).toMatch(/^Couleur de base appliquée : accent #E0A800, 4 sur 5 contrastes AA$/);
  });
  it('J9: a lock change says one short sentence, with the gender of the role', () => {
    const locked = toggleLock('fond')(start);
    expect(announcement(start, locked)).toBe('Fond verrouillé');
    expect(announcement(locked, toggleLock('fond')(locked))).toBe('Fond déverrouillé');
    expect(announcement(start, toggleLock('surface')(start))).toBe('Surface verrouillée');
    expect(announcement(start, toggleLock('alerte')(start))).toBe('Alerte verrouillée');
    expect(announcement(toggleLock('alerte')(start), start)).toBe('Alerte déverrouillée');
    expect(announcement(start, toggleLock('accent2')(start))).toBe('Accent secondaire verrouillé');
    expect(announcement(start, toggleLock('succes')(start))).toBe('Succès verrouillé');
  });
  it('J9: Hasard that changes no colour is never announced as a new palette', () => {
    let all = start;
    for (const role of ['fond', 'surface', 'texte', 'accent', 'accent2', 'succes', 'alerte'] as const) all = toggleLock(role)(all);
    const pressed = hasard()(all);
    expect(announcement(all, pressed)).toBeNull();
    // even if a Hasard produced a new state object with the very same 14 colours
    const sameColours = { ...hasard()(start), theme: start.theme };
    expect(announcement(start, sameColours)).toBeNull();
  });
  it('fixes are not announced here (the toast speaks)', () => {
    const yellow = setBase('#E0A800')(start);
    const fixed = fixPair('accent-fond', 'fg')(yellow);
    expect(fixed).not.toBe(yellow);
    expect(announcement(yellow, fixed)).toBeNull();
  });
  it('the sentence stays short (one breath)', () => {
    expect(announcement(start, hasard()(start))?.length).toBeLessThan(70);
  });
});
