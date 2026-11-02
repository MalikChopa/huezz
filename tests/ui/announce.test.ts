import { describe, expect, it } from 'vitest';
import { fixPair } from '../../src/state/fix';
import { hasard, setBase, setHarmony, setMode, toggleLock } from '../../src/state/state';
import { fixedState } from '../fixed-state';
import { paletteName } from '../../src/palette/name';
import { announcement } from '../../src/ui/announce';

const nameOf = (s: ReturnType<typeof fixedState>) => paletteName(s.theme[s.mode], s.mode);

const start = fixedState('light');

describe('announcement (live region sentence)', () => {
  it('nothing for the first render', () => {
    expect(announcement(null, start)).toBeNull();
  });
  it('Hasard: new palette, accent of the current mode, AA count', () => {
    const next = hasard()(start);
    expect(announcement(start, next)).toBe(`Nouvelle palette : ${nameOf(next)}, accent ${next.theme.light.accent}, 5 sur 5 contrastes AA`);
  });
  it('dark mode says the dark accent', () => {
    const next = setMode('dark')(start);
    expect(announcement(start, next)).toBe(`Palette sombre : ${nameOf(next)}, accent ${next.theme.dark.accent}, 5 sur 5 contrastes AA`);
    expect(announcement(next, setMode('light')(next))).toMatch(/^Palette claire : \p{Lu}\p{Ll}+ \p{Ll}+, accent #[0-9A-F]{6}, \d sur 5 contrastes AA$/u);
  });
  it('harmony and base', () => {
    const triad = setHarmony('triad')(start);
    expect(announcement(start, triad)).toMatch(/^Harmonie triade : \p{Lu}\p{Ll}+ \p{Ll}+, accent #[0-9A-F]{6}, \d sur 5 contrastes AA$/u);
    const base = setBase('#E0A800')(start);
    expect(announcement(start, base)).toMatch(/^Couleur de base appliquée : \p{Lu}\p{Ll}+ \p{Ll}+, accent #E0A800, 4 sur 5 contrastes AA$/u);
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
  it('brief 25: the sentence says the palette name; it stays short (one breath): under 70 characters without the name, under 80 with it', () => {
    const next = hasard()(start);
    const text = announcement(start, next) as string;
    expect(text).toContain(`: ${nameOf(next)}, accent `);
    expect(text.length - nameOf(next).length).toBeLessThan(70);
    expect(text.length).toBeLessThan(80);
  });
});
