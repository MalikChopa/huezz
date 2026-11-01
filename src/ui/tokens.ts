import { contrastRatio, fixContrast } from '../core/contrast';
import { onAccent } from '../palette/theme';

export type SystemTheme = 'light' | 'dark';

/** The tool's own colours (black and white). Same values as src/styles/tool.css (a test compares them). */
export const TOOL = {
  light: { bg: '#FFFFFF', panel: '#F6F6F5', ink: '#111111', muted: '#5C5C5C', line: '#E4E4E2', lineStrong: '#C8C8C5', lineControl: '#8A8A8A' },
  dark: { bg: '#0C0C0C', panel: '#151515', ink: '#F1F1EF', muted: '#A6A6A3', line: '#262626', lineStrong: '#3D3D3D', lineControl: '#6B6B6B' },
} as const;

export const UI_ACCENT_MIN = 3;

/**
 * The palette accent made readable as a graphic on the tool background (>= 3:1 on --ui-bg and --ui-panel).
 * Colours that already pass are returned unchanged.
 */
export function uiAccent(accent: string, theme: SystemTheme): string {
  const { bg, panel } = TOOL[theme];
  const against = (hex: string, back: string): string => {
    const r = fixContrast(hex, back, UI_ACCENT_MIN);
    return r.ok ? r.hex : (r.best?.hex ?? hex);
  };
  const first = against(accent, bg);
  if ((contrastRatio(first, panel) ?? 0) >= UI_ACCENT_MIN) return first;
  return against(first, panel);
}

export function uiOnAccent(accent: string): '#000000' | '#FFFFFF' {
  return onAccent(accent);
}
