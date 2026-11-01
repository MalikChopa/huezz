import { normalizeHue } from './color';

export type Harmony = 'complementary' | 'analogous' | 'triad' | 'tetrad' | 'monochrome' | 'split-complementary';

/** Hue offsets in degrees, relative to the base hue. Monochrome keeps the base hue (offset 0). */
export const HARMONY_OFFSETS: Readonly<Record<Harmony, readonly number[]>> = {
  complementary: [180],
  analogous: [-40, 40],
  triad: [120, 240],
  tetrad: [90, 180, 270],
  monochrome: [0],
  'split-complementary': [150, 210],
};

export const HARMONIES: readonly Harmony[] = ['complementary', 'analogous', 'triad', 'tetrad', 'monochrome', 'split-complementary'];

/** Hues (in [0, 360)) of the harmony's offsets applied to baseHue, in offset order. */
export function harmonyHues(baseHue: number, harmony: Harmony): number[] {
  return HARMONY_OFFSETS[harmony].map((o) => normalizeHue(baseHue + o));
}
