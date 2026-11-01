import { parseHex, type Rgb } from './hex';

export type Oklch = { l: number; c: number; h: number };
export type Linear = { r: number; g: number; b: number };

export const CHROMA_EPSILON = 1e-4;

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function normalizeHue(h: number): number {
  const m = ((h % 360) + 360) % 360;
  return m >= 360 ? 0 : m;
}

export function rgbToLinear({ r, g, b }: Rgb): Linear {
  return { r: srgbToLinear(r / 255), g: srgbToLinear(g / 255), b: srgbToLinear(b / 255) };
}

export function linearToRgb({ r, g, b }: Linear): Rgb {
  const enc = (v: number) => linearToSrgb(Math.min(1, Math.max(0, v))) * 255;
  return { r: enc(r), g: enc(g), b: enc(b) };
}

export function linearToOklab({ r, g, b }: Linear): { l: number; a: number; b: number } {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToLinear(lab: { l: number; a: number; b: number }): Linear {
  const l = Math.pow(lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b, 3);
  const m = Math.pow(lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b, 3);
  const s = Math.pow(lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b, 3);
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/** Raw OKLCH to linear sRGB: no clamping, channels may leave [0, 1]. */
export function oklchToLinear({ l, c, h }: Oklch): Linear {
  const rad = (h * Math.PI) / 180;
  return oklabToLinear({ l, a: c * Math.cos(rad), b: c * Math.sin(rad) });
}

/** sRGB (0-255 channels) to OKLCH, with the cleanup c < 1e-4 -> c = 0, h = 0. */
export function rgbToOklch(rgb: Rgb): Oklch {
  const lab = linearToOklab(rgbToLinear(rgb));
  const c = Math.hypot(lab.a, lab.b);
  if (c < CHROMA_EPSILON) return { l: lab.l, c: 0, h: 0 };
  return { l: lab.l, c, h: normalizeHue(Math.atan2(lab.b, lab.a) * (180 / Math.PI)) };
}

/** Hex to OKLCH; null when the hex is invalid (never throws). */
export function toOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex);
  return rgb === null ? null : rgbToOklch(rgb);
}
