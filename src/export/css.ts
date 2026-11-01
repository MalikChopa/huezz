import { rolesToLines, titleLine, type ExportInput } from './keys';

export function cssVariables(input: ExportInput): string {
  const line = (key: string, hex: string) => `${key}: ${hex};`;
  return `/* ${titleLine(input)} */
:root {
${rolesToLines(input.theme.light, 'css', '  ', line)}
}

@media (prefers-color-scheme: dark) {
  :root {
${rolesToLines(input.theme.dark, 'css', '    ', line)}
  }
}
`;
}
