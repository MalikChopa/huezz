import { contrastRatio } from '../../src/core/contrast';
import { HARMONIES } from '../../src/core/harmony';
import { mulberry32, next } from '../../src/core/random';
import { ROLES, type Palette, type Role } from '../../src/palette/roles';

export { HARMONIES };

export const HEX_RE = /^#[0-9A-F]{6}$/;

/** Deterministic list of n distinct-ish seeds (fake data only). */
export function seedList(n: number, start = 20261101): number[] {
  const out: number[] = [];
  let s = start;
  for (let i = 0; i < n; i++) {
    s = next(s);
    out.push(s);
  }
  return out;
}

export function rngOf(seed: number): () => number {
  return mulberry32(seed);
}

export const ratioOf = (fg: string, bg: string): number => contrastRatio(fg, bg) as number;

/** Best ratio reachable against a background by a colour of any lightness: black or white. */
export const bestExtreme = (bg: string): number => Math.max(ratioOf('#000000', bg), ratioOf('#FFFFFF', bg));

export function allValid(p: Palette): boolean {
  return ROLES.every((r: Role) => HEX_RE.test(p[r]));
}

export function samePalette(a: Palette, b: Palette): boolean {
  return ROLES.every((r) => a[r] === b[r]);
}
