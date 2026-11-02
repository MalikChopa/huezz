import { ROLES, type Palette } from '../palette/roles';
import { keyOf, nameOf, type ExportInput } from './keys';

const block = (palette: Palette): Record<string, string> => Object.fromEntries(ROLES.map((role) => [keyOf('json', role), palette[role]]));

export function jsonExport(input: ExportInput): string {
  return `${JSON.stringify({ generateur: 'Huezz', version: 1, harmonie: input.harmony, nom: nameOf(input), clair: block(input.theme.light), sombre: block(input.theme.dark) }, null, 2)}\n`;
}
