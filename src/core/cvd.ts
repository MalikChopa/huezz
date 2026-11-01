import { linearToRgb, rgbToLinear, type Linear } from './color';
import { deltaEOK } from './deltaE';
import { formatHex, parseHex } from './hex';

/** Dichromacies simulated at full severity (tritanopia is post-MVP: Vienot 1999 is invalid for it). */
export type Cvd = 'protan' | 'deutan';
export const CVD_KINDS: readonly Cvd[] = ['protan', 'deutan'];

type Matrix = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

/** Vienot, Brettel and Mollon 1999, adapted to sRGB, applied on LINEAR sRGB (rows sum to 1: greys stay grey). */
export const CVD_MATRICES: Readonly<Record<Cvd, Matrix>> = {
  protan: [
    [0.11238, 0.88762, 0],
    [0.11238, 0.88762, 0],
    [0.00401, -0.00401, 1],
  ],
  deutan: [
    [0.29275, 0.70725, 0],
    [0.29275, 0.70725, 0],
    [-0.02234, 0.02234, 1],
  ],
};

/** The matrix on a linear colour. No clamping here: channels can leave [0, 1] (clamped when encoded). */
export function simulateCvdLinear({ r, g, b }: Linear, kind: Cvd): Linear {
  const m = CVD_MATRICES[kind];
  return {
    r: m[0][0] * r + m[0][1] * g + m[0][2] * b,
    g: m[1][0] * r + m[1][1] * g + m[1][2] * b,
    b: m[2][0] * r + m[2][1] * g + m[2][2] * b,
  };
}

/** Hex as seen by a dichromat (uppercase #RRGGBB), clamped to [0, 1] after the matrix; null if the hex is invalid. */
export function simulateCvd(hex: string, kind: Cvd): string | null {
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  return formatHex(linearToRgb(simulateCvdLinear(rgbToLinear(rgb), kind)));
}

/** Delta E OK between the two colours as seen by a dichromat; null if a hex is invalid. */
export function cvdDeltaE(a: string, b: string, kind: Cvd): number | null {
  const sa = simulateCvd(a, kind);
  const sb = simulateCvd(b, kind);
  return sa === null || sb === null ? null : deltaEOK(sa, sb);
}
