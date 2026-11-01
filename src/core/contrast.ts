import { fromOklch } from './gamut';
import { rgbToLinear, rgbToOklch } from './color';
import { formatHex, parseHex, type Rgb } from './hex';

export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;
export const AAA_NORMAL = 7;
export const AAA_LARGE = 4.5;
export const LARGE_TEXT_PX = 24;
export const LARGE_TEXT_BOLD_PX = 18.66;
export const FIX_ROUNDS = 30;

export type Levels = { aa: boolean; aaLarge: boolean; aaa: boolean; aaaLarge: boolean };

export type Criterion = {
  id: string;
  measure(fg: string, bg: string): number | null;
  levels(ratio: number): Levels;
};

export function isLargeText(px: number, bold: boolean): boolean {
  return px >= LARGE_TEXT_PX || (bold && px >= LARGE_TEXT_BOLD_PX);
}

export function levels(ratio: number): Levels {
  return {
    aa: ratio >= AA_NORMAL,
    aaLarge: ratio >= AA_LARGE,
    aaa: ratio >= AAA_NORMAL,
    aaaLarge: ratio >= AAA_LARGE,
  };
}

export function luminanceRgb(rgb: Rgb): number {
  const { r, g, b } = rgbToLinear(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG relative luminance of a hex; null when invalid. */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  return rgb === null ? null : luminanceRgb(rgb);
}

/** WCAG contrast ratio on exact values (no rounding); null when a hex is invalid. */
export function contrastRatio(fg: string, bg: string): number | null {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export const wcag: Criterion = { id: 'wcag', measure: contrastRatio, levels };

/** Truncates (never rounds) to 2 decimals: 4.4781 -> "4.47". */
export function truncate2(ratio: number): string {
  return (Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2);
}

export type Fixed = { hex: string; ratio: number };
export type FixResult = { ok: true; hex: string; ratio: number } | { ok: false; best: Fixed | null };

/**
 * Keeps c and h, bisects L (30 rounds) toward black and toward white, keeps the smaller |dL|.
 * Ratios are measured on the rounded hex. best is null only when an input hex is invalid.
 */
export function fixContrast(fg: string, bg: string, target: number): FixResult {
  const rgb = parseHex(fg);
  if (rgb === null || parseHex(bg) === null) return { ok: false, best: null };
  const start = formatHex(rgb);
  const startRatio = contrastRatio(start, bg) as number;
  if (startRatio >= target) return { ok: true, hex: start, ratio: startRatio };

  const { l: l0, c, h } = rgbToOklch(rgb);
  const measure = (l: number): Fixed => {
    const hex = fromOklch({ l, c, h });
    return { hex, ratio: contrastRatio(hex, bg) as number };
  };

  let bestOk: { fixed: Fixed; dl: number } | null = null;
  let bestAny: Fixed = { hex: start, ratio: startRatio };
  for (const end of [0, 1]) {
    const atEnd = measure(end);
    if (atEnd.ratio > bestAny.ratio) bestAny = atEnd;
    if (atEnd.ratio < target) continue;
    let good = end;
    let goodFixed = atEnd;
    let bad = l0;
    for (let i = 0; i < FIX_ROUNDS; i++) {
      const mid = (good + bad) / 2;
      const m = measure(mid);
      if (m.ratio >= target) {
        good = mid;
        goodFixed = m;
      } else bad = mid;
    }
    const dl = Math.abs(good - l0);
    if (bestOk === null || dl < bestOk.dl) bestOk = { fixed: goodFixed, dl };
  }
  if (bestOk !== null) return { ok: true, hex: bestOk.fixed.hex, ratio: bestOk.fixed.ratio };
  return { ok: false, best: bestAny };
}
