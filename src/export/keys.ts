import type { Harmony } from '../core/harmony';
import { parseHex, type Rgb } from '../core/hex';
import { paletteName } from '../palette/name';
import { ROLES, type Mode, type Palette, type Role, type ThemeColors } from '../palette/roles';
import { HARMONY_LABEL } from '../ui/labels';

export type KeyFormat = 'css' | 'tw4' | 'tw3' | 'json' | 'swift' | 'figma';

const names = (id: string, dashed: string = id): Readonly<Record<KeyFormat, string>> => ({
  css: `--huezz-${dashed}`,
  tw4: `--color-${dashed}`,
  tw3: dashed,
  json: id,
  swift: id,
  figma: id,
});

/** The one table of key names (ARCHITECTURE section 7): the internal role is `accent2`, a `-` is not valid in Swift. */
export const KEY_NAMES: Readonly<Record<Role, Readonly<Record<KeyFormat, string>>>> = {
  fond: names('fond'),
  surface: names('surface'),
  texte: names('texte'),
  accent: names('accent'),
  accent2: names('accent2', 'accent-2'),
  succes: names('succes'),
  alerte: names('alerte'),
};

export const keyOf = (format: KeyFormat, role: Role): string => KEY_NAMES[role][format];

/** What every export reads: the 14 colours, the harmony (header) and the displayed mode (PNG only). */
export type ExportInput = { readonly harmony: Harmony; readonly mode: Mode; readonly theme: ThemeColors };

/** The palette name of the displayed mode (the one shown above the preview). */
export const nameOf = (input: ExportInput): string => paletteName(input.theme[input.mode], input.mode);

/** One line naming Huezz, the palette and its harmony: no URL, no date, no personal data. */
export const titleLine = (input: ExportInput): string => `Huezz : palette ${nameOf(input)}, harmonie ${HARMONY_LABEL[input.harmony].toLowerCase()}`;

/** `indent + key: value;` lines in role order. */
export function rolesToLines(palette: Palette, format: KeyFormat, indent: string, line: (key: string, hex: string) => string): string {
  return ROLES.map((role) => `${indent}${line(keyOf(format, role), palette[role])}`).join('\n');
}

export function rgbOf(hex: string): Rgb {
  const rgb = parseHex(hex);
  if (rgb === null) throw new Error(`Huezz: hex invalide (${hex})`);
  return rgb;
}
