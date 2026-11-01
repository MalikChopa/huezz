import type { ExportInput } from '../../src/export/keys';

// Three fictitious palettes, written by hand (not produced by the generator): the golden files must not move when the generator changes.
export const FIXTURES: Readonly<Record<string, ExportInput>> = {
  lagune: {
    harmony: 'complementary',
    mode: 'light',
    theme: {
      light: { fond: '#E7F2EF', surface: '#F7FBFA', texte: '#071916', accent: '#137A6B', accent2: '#845060', succes: '#206720', alerte: '#B01F29' },
      dark: { fond: '#060E0D', surface: '#0F1917', texte: '#E1E9E7', accent: '#6EBCAD', accent2: '#C792A1', succes: '#79CF8D', alerte: '#EE7063' },
    },
  },
  brique: {
    harmony: 'split-complementary',
    mode: 'dark',
    theme: {
      light: { fond: '#F6EFEA', surface: '#FFFAF6', texte: '#1F100B', accent: '#9A3A1E', accent2: '#2F6F7A', succes: '#2D6A2F', alerte: '#B3261E' },
      dark: { fond: '#150C09', surface: '#1F1410', texte: '#F3E8E3', accent: '#F0956F', accent2: '#7CC4CF', succes: '#7FD18A', alerte: '#F2837A' },
    },
  },
  ardoise: {
    harmony: 'monochrome',
    mode: 'light',
    theme: {
      light: { fond: '#EEF1F6', surface: '#F9FAFD', texte: '#0F1420', accent: '#34509A', accent2: '#5C7BC4', succes: '#256B3A', alerte: '#B4232F' },
      dark: { fond: '#0B0E15', surface: '#131824', texte: '#E6EAF3', accent: '#8FA8E8', accent2: '#B7C6F2', succes: '#74CC8C', alerte: '#F07C7C' },
    },
  },
};

export const OUTPUTS = [
  { id: 'css', file: 'css' },
  { id: 'tailwind-v4', file: 'tailwind-v4.css' },
  { id: 'tailwind-v3', file: 'tailwind-v3.js' },
  { id: 'json', file: 'json' },
  { id: 'swift', file: 'swift' },
  { id: 'figma', file: 'figma.json' },
] as const;
