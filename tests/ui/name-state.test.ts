import { describe, expect, it } from 'vitest';
import { paletteName } from '../../src/palette/name';
import { hasard, setMode } from '../../src/state/state';
import { nameOfState } from '../../src/ui/scene';
import { fixedState } from '../fixed-state';

describe('nameOfState (the title and the live region read the same name)', () => {
  const start = fixedState('light');
  it('is the name of the displayed mode palette, and follows the mode and a new palette', () => {
    expect(nameOfState(start)).toBe(paletteName(start.theme.light, 'light'));
    expect(nameOfState(start)).toBe('Argile turquoise');
    const dark = setMode('dark')(start);
    expect(nameOfState(dark)).toBe(paletteName(dark.theme.dark, 'dark'));
    expect(nameOfState(dark)).not.toBe(nameOfState(start));
    const next = hasard()(start);
    expect(nameOfState(next)).toBe(paletteName(next.theme[next.mode], next.mode));
  });
  it('asked twice for the same state gives the same string (memoised on the theme object and the mode)', () => {
    expect(nameOfState(start)).toBe(nameOfState(start));
    expect(nameOfState(setMode('light')(start))).toBe(nameOfState(start));
  });
});
