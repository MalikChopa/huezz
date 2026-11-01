import { ROLES } from '../palette/roles';
import { keyOf, rolesToLines, titleLine, type ExportInput } from './keys';

/** Tailwind v4: `@theme` for the light colours, dark by overriding the same variables under the media query. */
export function tailwindV4(input: ExportInput): string {
  const line = (key: string, hex: string) => `${key}: ${hex};`;
  return `/* ${titleLine(input)} */
@theme {
${rolesToLines(input.theme.light, 'tw4', '  ', line)}
}

@media (prefers-color-scheme: dark) {
  :root {
${rolesToLines(input.theme.dark, 'tw4', '    ', line)}
  }
}
`;
}

const jsKey = (key: string): string => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`);

/** Tailwind v3: stand-alone config, hex values, `darkMode: 'media'`, usage `bg-fond dark:bg-fond-sombre`. */
export function tailwindV3(input: ExportInput): string {
  const colors = ROLES.map((role) => `        ${jsKey(keyOf('tw3', role))}: { DEFAULT: '${input.theme.light[role]}', sombre: '${input.theme.dark[role]}' },`).join('\n');
  return `// ${titleLine(input)}
module.exports = {
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
${colors}
      },
    },
  },
};
`;
}
