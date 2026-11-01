import { linearToOklab, rgbToLinear } from './color';
import { parseHex } from './hex';

/** Delta E OK: Euclidean distance in OKLab between two hex colours, no weighting. null if a hex is invalid. */
export function deltaEOK(a: string, b: string): number | null {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (ra === null || rb === null) return null;
  const la = linearToOklab(rgbToLinear(ra));
  const lb = linearToOklab(rgbToLinear(rb));
  return Math.hypot(la.l - lb.l, la.a - lb.a, la.b - lb.b);
}
