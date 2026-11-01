import { formatHex } from './hex';
import { linearToRgb, normalizeHue, oklchToLinear, type Oklch } from './color';

export const GAMUT_ROUNDS = 24;
const GAMUT_TOLERANCE = 1e-6;

export function inSrgbGamut(color: Oklch): boolean {
  const { r, g, b } = oklchToLinear(color);
  const lo = -GAMUT_TOLERANCE;
  const hi = 1 + GAMUT_TOLERANCE;
  return r >= lo && r <= hi && g >= lo && g <= hi && b >= lo && b <= hi;
}

/** Keeps L and h, bisects chroma (24 rounds) for the largest chroma inside sRGB. Never clamps. */
export function reduceChroma(color: Oklch): Oklch {
  const l = Math.min(1, Math.max(0, Number.isFinite(color.l) ? color.l : 0));
  const h = normalizeHue(Number.isFinite(color.h) ? color.h : 0);
  const c = Number.isFinite(color.c) ? Math.max(0, color.c) : 0;
  const full = { l, c, h };
  if (inSrgbGamut(full)) return full;
  let lo = 0;
  let hi = c;
  for (let i = 0; i < GAMUT_ROUNDS; i++) {
    const mid = (lo + hi) / 2;
    if (inSrgbGamut({ l, c: mid, h })) lo = mid;
    else hi = mid;
  }
  return { l, c: lo, h };
}

/** OKLCH to uppercase #RRGGBB; out-of-gamut input is chroma-reduced, so the result is always valid. */
export function fromOklch(color: Oklch): string {
  return formatHex(linearToRgb(oklchToLinear(reduceChroma(color))));
}

/** Largest chroma that stays inside sRGB at this L and h (bisection, same tolerance as reduceChroma). */
export function maxChroma(l: number, h: number): number {
  return reduceChroma({ l, c: 0.5, h }).c;
}
