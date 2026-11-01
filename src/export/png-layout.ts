import { onAccent } from '../palette/theme';
import { ROLES } from '../palette/roles';
import { ROLE_LABEL } from '../ui/labels';
import type { ExportInput } from './keys';

export const PNG_WIDTH = 1400;
export const PNG_HEIGHT = 400;
export const BAND_WIDTH = PNG_WIDTH / ROLES.length;

export type PngRect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly fill: string };
export type PngText = { readonly x: number; readonly y: number; readonly text: string; readonly fill: string; readonly font: string };
export type PngLayout = { readonly width: number; readonly height: number; readonly rects: readonly PngRect[]; readonly texts: readonly PngText[] };

const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Pure: 7 bands of 200 x 400 px (the displayed mode), role name and hex at the bottom left in black or white. */
export function pngLayout(input: ExportInput): PngLayout {
  const palette = input.theme[input.mode];
  const rects: PngRect[] = [];
  const texts: PngText[] = [];
  for (const [i, role] of ROLES.entries()) {
    const x = i * BAND_WIDTH;
    const hex = palette[role];
    const ink = onAccent(hex);
    rects.push({ x, y: 0, w: BAND_WIDTH, h: PNG_HEIGHT, fill: hex });
    texts.push({ x: x + 16, y: 356, text: ROLE_LABEL[role], fill: ink, font: `600 15px ${SANS}` });
    texts.push({ x: x + 16, y: 380, text: hex, fill: ink, font: `500 15px ${MONO}` });
  }
  return { width: PNG_WIDTH, height: PNG_HEIGHT, rects, texts };
}
