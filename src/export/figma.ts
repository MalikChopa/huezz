import { ROLES, type Palette } from '../palette/roles';
import { keyOf, rgbOf, titleLine, type ExportInput } from './keys';

export type FigmaFormat = 'hex' | '2025.10';

const unit = (v: number): number => Number((v / 255).toFixed(4));

function value(hex: string, format: FigmaFormat): string | { colorSpace: 'srgb'; components: number[]; hex: string } {
  if (format === 'hex') return hex;
  const rgb = rgbOf(hex);
  return { colorSpace: 'srgb', components: [unit(rgb.r), unit(rgb.g), unit(rgb.b)], hex: hex.toLowerCase() };
}

function group(palette: Palette, format: FigmaFormat): Record<string, unknown> {
  return { $type: 'color', ...Object.fromEntries(ROLES.map((role) => [keyOf('figma', role), { $value: value(palette[role], format) }])) };
}

/** DTCG tokens. Default: `"$value": "#RRGGBB"`. Option '2025.10': colour object (not checked against Figma or Tokens Studio). */
export function figmaTokens(input: ExportInput, format: FigmaFormat = 'hex'): string {
  return `${JSON.stringify({ $description: titleLine(input), clair: group(input.theme.light, format), sombre: group(input.theme.dark, format) }, null, 2)}\n`;
}
