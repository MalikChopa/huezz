import { cssVariables } from './css';
import { figmaTokens } from './figma';
import { jsonExport } from './json';
import type { ExportInput } from './keys';
import { pngLayout } from './png-layout';
import { swiftExport } from './swift';
import { tailwindV3, tailwindV4 } from './tailwind';

export type FormatId = 'css' | 'tailwind' | 'json' | 'swift' | 'figma' | 'png';
export const FORMATS: readonly FormatId[] = ['css', 'tailwind', 'json', 'swift', 'figma', 'png'];
export type ExportChoice = { readonly format: FormatId; readonly tailwind: 'v4' | 'v3'; readonly figma: 'hex' | '2025.10' };
/** The 8 things the menu can show (7 text or layout outputs + the PNG itself). */
export type OutputId = 'css' | 'tailwind-v4' | 'tailwind-v3' | 'json' | 'swift' | 'figma' | 'figma-2025.10' | 'png';

export function outputOf(c: ExportChoice): OutputId {
  if (c.format === 'tailwind') return c.tailwind === 'v4' ? 'tailwind-v4' : 'tailwind-v3';
  if (c.format === 'figma') return c.figma === 'hex' ? 'figma' : 'figma-2025.10';
  return c.format;
}

export const FILE_NAME: Readonly<Record<OutputId, string>> = {
  css: 'huezz.css',
  'tailwind-v4': 'huezz-theme.css',
  'tailwind-v3': 'tailwind.huezz.js',
  json: 'huezz.json',
  swift: 'Huezz.swift',
  figma: 'huezz.tokens.json',
  'figma-2025.10': 'huezz.tokens.json',
  png: 'huezz.png',
};

/** Text of one output (the PNG has none: see `pngLayout`). */
export function exportText(output: Exclude<OutputId, 'png'>, input: ExportInput): string {
  switch (output) {
    case 'css':
      return cssVariables(input);
    case 'tailwind-v4':
      return tailwindV4(input);
    case 'tailwind-v3':
      return tailwindV3(input);
    case 'json':
      return jsonExport(input);
    case 'swift':
      return swiftExport(input);
    case 'figma':
      return figmaTokens(input, 'hex');
    case 'figma-2025.10':
      return figmaTokens(input, '2025.10');
  }
}

export { pngLayout };
