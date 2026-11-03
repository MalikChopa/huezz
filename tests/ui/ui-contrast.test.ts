import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../src/core/contrast';
import { fromOklch } from '../../src/core/gamut';
import { generate } from '../../src/palette/generate';
import { fixedState } from '../fixed-state';
import { computeVars } from '../../src/ui/render';
import { TOOL, uiAccent, uiOnAccent, type SystemTheme } from '../../src/ui/tokens';

const THEMES: readonly SystemTheme[] = ['light', 'dark'];
const ratio = (fg: string, bg: string): number => {
  const r = contrastRatio(fg, bg);
  if (r === null) throw new Error(`hex invalide : ${fg} ${bg}`);
  return r;
};

describe('tokens.ts = tool.css (one source of truth checked)', () => {
  const css = readFileSync(new URL('../../src/styles/tool.css', import.meta.url), 'utf8');
  const darkAt = css.indexOf('@media (prefers-color-scheme:dark)');
  const parts = { light: css.slice(css.indexOf(':root{\n  color-scheme'), darkAt), dark: css.slice(darkAt, css.indexOf('@media (prefers-reduced-motion')) };
  const names = { bg: '--ui-bg', panel: '--ui-panel', ink: '--ui-ink', muted: '--ui-muted', line: '--ui-line', lineStrong: '--ui-line-strong', lineControl: '--ui-line-control' } as const;
  for (const theme of THEMES) {
    it(`${theme} values`, () => {
      for (const [key, name] of Object.entries(names)) {
        const m = new RegExp(`${name}:(#[0-9A-Fa-f]{6})[;}]`).exec(parts[theme]);
        expect(m?.[1]?.toUpperCase(), `${theme} ${name}`).toBe(TOOL[theme][key as keyof typeof names]);
      }
    });
  }
});

describe('J9: the new surfaces use the pair the table checks (ink background, bg text)', () => {
  const css = readFileSync(new URL('../../src/styles/tool.css', import.meta.url), 'utf8');
  const rule = (selector: string): string => css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
  for (const selector of ['.base-err{', '.sw-lock::after{']) {
    it(`${selector} is --ui-bg text on a --ui-ink background`, () => {
      const body = rule(selector);
      expect(body, selector).toMatch(/background:var\(--ui-ink\)/);
      expect(body, selector).toMatch(/[;{]color:var\(--ui-bg\)/);
    });
  }
});

type Row = { fg: string; bg: string; min: number; what: string };
function table(theme: SystemTheme): Row[] {
  const t = TOOL[theme];
  const state = fixedState(theme);
  const rows: Row[] = [
    { what: 'ink on bg (text)', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'ink on panel (text)', fg: t.ink, bg: t.panel, min: 4.5 },
    { what: 'muted on bg (text: captions, Esc hint)', fg: t.muted, bg: t.bg, min: 4.5 },
    { what: 'muted on panel (text)', fg: t.muted, bg: t.panel, min: 4.5 },
    { what: 'line-control on bg (hex field, select, seg border)', fg: t.lineControl, bg: t.bg, min: 3 },
    { what: 'line-control on panel', fg: t.lineControl, bg: t.panel, min: 3 },
    { what: 'line-control on the field background (= bg)', fg: t.lineControl, bg: t.bg, min: 3 },
    { what: 'focus ring (ink) on bg', fg: t.ink, bg: t.bg, min: 3 },
    { what: 'focus ring (ink) on panel', fg: t.ink, bg: t.panel, min: 3 },
    { what: 'seg button icon (muted) on bg', fg: t.muted, bg: t.bg, min: 3 },
    { what: 'seg button icon (muted) on panel', fg: t.muted, bg: t.panel, min: 3 },
    { what: 'bg on ink (pressed seg button, toast, skip link)', fg: t.bg, bg: t.ink, min: 4.5 },
    // J9: visible hex error under the base field (bg text and icon on an ink bubble), lock tooltip (same pair)
    { what: 'hex error text and icon (bg) on the ink bubble', fg: t.bg, bg: t.ink, min: 4.5 },
    { what: 'lock tooltip text (bg) on its ink background', fg: t.bg, bg: t.ink, min: 4.5 },
    { what: 'hex error bubble (ink) on the page background (the bubble edge is read against the page)', fg: t.ink, bg: t.bg, min: 3 },
    // J4: contrast pills and detail dialog
    { what: 'pill name / ratio (ink) on the pill background (bg)', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'pill level badge (ink) on its background (panel)', fg: t.ink, bg: t.panel, min: 4.5 },
    { what: 'pill "indicatif 3:1" tag (muted) on the pill background (bg)', fg: t.muted, bg: t.bg, min: 4.5 },
    { what: 'failing pill text (bg) on its ink background', fg: t.bg, bg: t.ink, min: 4.5 },
    { what: 'failing pill badge (ink) on its bg-coloured background', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'pill border (line-control) on the page background', fg: t.lineControl, bg: t.bg, min: 3 },
    { what: 'dialog text, title, hex, ratio (ink) on the dialog background (bg)', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'dialog secondary text (muted: "sur", "affiché", failed level names, proposed colour) on bg', fg: t.muted, bg: t.bg, min: 4.5 },
    { what: 'dialog border and close button border (line-control) on bg', fg: t.lineControl, bg: t.bg, min: 3 },
    { what: 'dialog warning frame and icon (ink) on bg', fg: t.ink, bg: t.bg, min: 3 },
    { what: 'dialog "Corriger" button label (bg) on its ink background', fg: t.bg, bg: t.ink, min: 4.5 },
    { what: 'dialog focus ring (ink) on bg', fg: t.ink, bg: t.bg, min: 3 },
    // J5: share button, export menu
    { what: 'share button border and export format buttons border (line-control) on bg', fg: t.lineControl, bg: t.bg, min: 3 },
    { what: 'export format button text (ink) on bg', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'export format button text (ink) on its hover background (panel)', fg: t.ink, bg: t.panel, min: 4.5 },
    { what: 'selected format / version button (bg) on ink', fg: t.bg, bg: t.ink, min: 4.5 },
    { what: 'export code area text (ink) on its panel background', fg: t.ink, bg: t.panel, min: 4.5 },
    { what: 'export file name (muted) on the code header (panel)', fg: t.muted, bg: t.panel, min: 4.5 },
    { what: 'export hint (2025.10 not verified) and footer (muted) on bg', fg: t.muted, bg: t.bg, min: 4.5 },
    { what: 'export status line (ink) on bg', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'export "Copier" / "Télécharger" label (bg) on its ink background', fg: t.bg, bg: t.ink, min: 4.5 },
    { what: 'checkbox "Format 2025.10" mark and frame (ink) on bg', fg: t.ink, bg: t.bg, min: 3 },
    // J13: history sheet (same dialog background as the export menu)
    { what: 'history row name (ink) on the dialog background (bg)', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'history row name (ink) on its hover background (panel)', fg: t.ink, bg: t.panel, min: 4.5 },
    { what: 'history row harmony (muted) on bg', fg: t.muted, bg: t.bg, min: 4.5 },
    { what: 'history row harmony (muted) on its hover background (panel)', fg: t.muted, bg: t.panel, min: 4.5 },
    { what: 'history section titles, empty states and note (muted) on bg', fg: t.muted, bg: t.bg, min: 4.5 },
    { what: 'history star outline (muted) on bg', fg: t.muted, bg: t.bg, min: 3 },
    { what: 'history star outline (muted) on its hover background (panel)', fg: t.muted, bg: t.panel, min: 3 },
    { what: 'history star pressed, filled (ink) on bg', fg: t.ink, bg: t.bg, min: 3 },
    { what: 'history star pressed, filled (ink) on its hover background (panel)', fg: t.ink, bg: t.panel, min: 3 },
    { what: 'history colour strip edge (line-control) on bg', fg: t.lineControl, bg: t.bg, min: 3 },
    { what: 'history "not saved" hint (ink) and its frame on bg', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'history "Effacer" label (bg) on its ink background', fg: t.bg, bg: t.ink, min: 4.5 },
    { what: 'history button border (line-control) on the bar background (bg)', fg: t.lineControl, bg: t.bg, min: 3 },
    // J15: image sheet
    { what: 'image button border (line-control) on the bar background (bg)', fg: t.lineControl, bg: t.bg, min: 3 },
    { what: 'image drop zone label (ink) on its panel background', fg: t.ink, bg: t.panel, min: 4.5 },
    { what: 'image drop zone hint (muted) on its panel background', fg: t.muted, bg: t.panel, min: 4.5 },
    { what: 'image drop zone dashed outline (line-control) on the dialog background (bg)', fg: t.lineControl, bg: t.bg, min: 3 },
    { what: 'image drop zone dashed outline (line-control) on its own panel background', fg: t.lineControl, bg: t.panel, min: 3 },
    { what: 'image drop zone while a file is dragged or hovered: label (ink) on bg', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'image drop zone while a file is dragged or hovered: hint (muted) on bg', fg: t.muted, bg: t.bg, min: 4.5 },
    { what: 'image drop zone while a file is dragged or hovered: outline (ink) on bg', fg: t.ink, bg: t.bg, min: 3 },
    { what: 'image note (muted) on bg', fg: t.muted, bg: t.bg, min: 4.5 },
    { what: 'image message (ink) and its frame on bg', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'image preview frame (line-control) on bg', fg: t.lineControl, bg: t.bg, min: 3 },
    { what: 'image card name (ink) on bg', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'image card name (ink) on its hover background (panel)', fg: t.ink, bg: t.panel, min: 4.5 },
    { what: 'image card harmony (muted) on bg', fg: t.muted, bg: t.bg, min: 4.5 },
    { what: 'image card harmony (muted) on its hover background (panel)', fg: t.muted, bg: t.panel, min: 4.5 },
    { what: 'image card "Utiliser" label (ink) on bg', fg: t.ink, bg: t.bg, min: 4.5 },
    { what: 'image card "Utiliser" label (ink) on its hover background (panel)', fg: t.ink, bg: t.panel, min: 4.5 },
    { what: 'image card "Utiliser" outline (line-control) on bg', fg: t.lineControl, bg: t.bg, min: 3 },
    { what: 'image card "Utiliser" outline (line-control) on its hover background (panel)', fg: t.lineControl, bg: t.panel, min: 3 },
    { what: 'image card hovered "Utiliser" label (bg) on its ink background', fg: t.bg, bg: t.ink, min: 4.5 },
  ];
  for (const mode of THEMES) {
    const accent = state.theme[mode].accent;
    const ua = uiAccent(accent, theme);
    rows.push(
      { what: `--ui-accent (default palette, ${mode}) on bg`, fg: ua, bg: t.bg, min: 3 },
      { what: `--ui-accent (default palette, ${mode}) on panel`, fg: ua, bg: t.panel, min: 3 },
      { what: `--ui-on-accent on --ui-accent (default palette, ${mode}, Hasard button)`, fg: uiOnAccent(ua), bg: ua, min: 4.5 },
    );
  }
  return rows;
}

describe('table of the tool pairs (token, background, threshold)', () => {
  for (const theme of THEMES) {
    for (const row of table(theme)) {
      it(`${theme}: ${row.what} >= ${row.min}`, () => {
        expect(ratio(row.fg, row.bg)).toBeGreaterThanOrEqual(row.min);
      });
    }
  }
  it('frozen ratios of the architecture (guard rail), light / dark', () => {
    const f = (theme: SystemTheme, fg: keyof (typeof TOOL)['light'], bg: keyof (typeof TOOL)['light']) => ratio(TOOL[theme][fg], TOOL[theme][bg]);
    expect([f('light', 'ink', 'bg'), f('dark', 'ink', 'bg')].map((v) => v.toFixed(2))).toEqual(['18.88', '17.30']);
    expect([f('light', 'muted', 'bg'), f('dark', 'muted', 'bg')].map((v) => v.toFixed(2))).toEqual(['6.69', '8.02']);
    expect([f('light', 'muted', 'panel'), f('dark', 'muted', 'panel')].map((v) => v.toFixed(2))).toEqual(['6.18', '7.48']);
    expect([f('light', 'lineStrong', 'bg'), f('dark', 'lineStrong', 'bg')].map((v) => v.toFixed(2))).toEqual(['1.68', '1.80']);
    expect([f('light', 'lineControl', 'bg'), f('light', 'lineControl', 'panel')].map((v) => v.toFixed(2))).toEqual(['3.45', '3.19']);
    expect([f('dark', 'lineControl', 'bg'), f('dark', 'lineControl', 'panel')].map((v) => v.toFixed(2))).toEqual(['3.67', '3.43']);
  });
  it('computeVars gives the 7 roles, the swatch inks and the tool accent', () => {
    const vars = computeVars(fixedState('light'), 'light');
    for (const name of ['--fond', '--surface', '--texte', '--accent', '--accent2', '--succes', '--alerte', '--sur-accent', '--sur-accent2', '--ui-accent', '--ui-on-accent']) {
      expect(vars.get(name), name).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(['#000000', '#FFFFFF']).toContain(vars.get('--sur-accent'));
  });
});

describe('sweep: 360 hues x 4 (L, c) x 2 palette modes x 2 system themes', () => {
  const LC = [
    [0.5, 0.1],
    [0.5, 0.18],
    [0.58, 0.1],
    [0.58, 0.18],
  ] as const;
  const stats = { cases: 0, corrected: 0, minUiAccentBg: Infinity, minUiAccentPanel: Infinity, minOnAccent: Infinity, minSurAccent: Infinity, failures: [] as string[] };

  it('--ui-accent >= 3:1 on bg and panel, --ui-on-accent >= 4.5:1 on --ui-accent, --sur-accent >= 4.5:1 on the accent', () => {
    for (let h = 0; h < 360; h++) {
      for (const [l, c] of LC) {
        const base = fromOklch({ l, c, h });
        const g = generate({ base, harmony: 'complementary', seed: 1, locks: 0 });
        expect(g.light.accent).toBe(base);
        for (const mode of THEMES) {
          const accent = g[mode].accent;
          for (const theme of THEMES) {
            const t = TOOL[theme];
            const ua = uiAccent(accent, theme);
            const onUa = uiOnAccent(ua);
            const rb = ratio(ua, t.bg);
            const rp = ratio(ua, t.panel);
            const ro = ratio(onUa, ua);
            const rs = ratio(g.onAccent[mode], accent);
            stats.cases++;
            if (ua !== accent) stats.corrected++;
            stats.minUiAccentBg = Math.min(stats.minUiAccentBg, rb);
            stats.minUiAccentPanel = Math.min(stats.minUiAccentPanel, rp);
            stats.minOnAccent = Math.min(stats.minOnAccent, ro);
            stats.minSurAccent = Math.min(stats.minSurAccent, rs);
            if (rb < 3 || rp < 3 || ro < 4.5 || rs < 4.5) stats.failures.push(`h=${h} L=${l} c=${c} ${mode}/${theme} accent=${accent} ui=${ua} bg=${rb.toFixed(3)} panel=${rp.toFixed(3)} on=${ro.toFixed(3)} sur=${rs.toFixed(3)}`);
          }
        }
      }
    }
    console.log('ui-contrast sweep:', JSON.stringify({ ...stats, failures: stats.failures.length }));
    expect(stats.cases).toBe(360 * 4 * 2 * 2);
    expect(stats.failures.slice(0, 10)).toEqual([]);
  });
});

describe('J4: the pills and the dialog really use the tokens of the table above (tool.css)', () => {
  const css = readFileSync(new URL('../../src/styles/tool.css', import.meta.url), 'utf8');
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector}{`);
    if (start < 0) throw new Error(`règle absente : ${selector}`);
    return css.slice(start, css.indexOf('}', start));
  };
  const cases: Array<[string, RegExp[]]> = [
    ['.pill', [/border:1px solid var\(--ui-line-control\)/, /background:var\(--ui-bg\)/, /color:var\(--ui-ink\)/]],
    ['.pill-tag', [/color:var\(--ui-muted\)/]],
    ['.pill-lv', [/background:var\(--ui-panel\)/, /color:var\(--ui-ink\)/]],
    ['.pill.fail', [/background:var\(--ui-ink\)/, /color:var\(--ui-bg\)/]],
    ['.pill.fail .pill-lv', [/background:var\(--ui-bg\)/, /color:var\(--ui-ink\)/]],
    ['.cdlg', [/background:var\(--ui-bg\)/, /color:var\(--ui-ink\)/, /border:1px solid var\(--ui-line-control\)/]],
    ['.cdlg-x', [/border:1px solid var\(--ui-line-control\)/, /color:var\(--ui-ink\)/]],
    ['.cdlg-ratio small', [/color:var\(--ui-muted\)/]],
    ['.cdlg-levels li.fail .lv-name', [/color:var\(--ui-muted\)/]],
    ['.cdlg-warn', [/border:1.5px solid var\(--ui-ink\)/]],
    ['.prop', [/color:var\(--ui-muted\)/]],
    ['.btn-ink', [/background:var\(--ui-ink\)/, /color:var\(--ui-bg\)/]],
  ];
  for (const [selector, patterns] of cases) {
    it(`${selector} uses the audited tokens`, () => {
      const body = rule(selector);
      for (const re of patterns) expect(body, selector).toMatch(re);
    });
  }
});

describe('J5: the export menu and the share button use the audited tokens (tool.css)', () => {
  const css = readFileSync(new URL('../../src/styles/tool.css', import.meta.url), 'utf8');
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector}{`);
    if (start < 0) throw new Error(`règle absente : ${selector}`);
    return css.slice(start, css.indexOf('}', start));
  };
  const cases: Array<[string, RegExp[]]> = [
    ['#share', [/border-color:var\(--ui-line-control\)/]],
    ['.xfmt button,.xopt button', [/border:1px solid var\(--ui-line-control\)/, /background:var\(--ui-bg\)/, /color:var\(--ui-ink\)/]],
    ['.xfmt button:hover,.xopt button:hover', [/background:var\(--ui-panel\)/]],
    ['.xfmt button[aria-checked=true],.xopt button[aria-checked=true]', [/background:var\(--ui-ink\)/, /color:var\(--ui-bg\)/]],
    ['.xcode', [/background:var\(--ui-panel\)/]],
    ['.xcode-head', [/color:var\(--ui-muted\)/]],
    ['#xOut', [/color:var\(--ui-ink\)/, /background:none/]],
    ['.xhint', [/color:var\(--ui-muted\)/]],
    ['.xfoot', [/color:var\(--ui-muted\)/]],
    ['.xstatus', [/color:var\(--ui-ink\)/]],
    ['.cdlg', [/border:1px solid var\(--ui-line-control\)/, /background:var\(--ui-bg\)/, /color:var\(--ui-ink\)/]],
    // J13: history sheet
    ['#histBtn', [/border-color:var\(--ui-line-control\)/]],
    ['.hmenu h3', [/color:var\(--ui-muted\)/]],
    ['.hrow', [/color:var\(--ui-ink\)/, /background:none/]],
    ['.hrow:hover', [/background:var\(--ui-panel\)/]],
    ['.hstrip', [/border:1px solid var\(--ui-line-control\)/]],
    ['.hname small', [/color:var\(--ui-muted\)/]],
    ['.hstar', [/color:var\(--ui-muted\)/, /background:none/]],
    ['.hstar:hover', [/background:var\(--ui-panel\)/, /color:var\(--ui-ink\)/]],
    ['.hstar[aria-pressed=true]', [/color:var\(--ui-ink\)/]],
    ['.hempty', [/color:var\(--ui-muted\)/]],
    ['.hwarn', [/border:1.5px solid var\(--ui-ink\)/]],
    // J15: image sheet
    ['#imgBtn', [/border-color:var\(--ui-line-control\)/]],
    ['.idrop', [/border:1.5px dashed var\(--ui-line-control\)/, /background:var\(--ui-panel\)/, /color:var\(--ui-ink\)/]],
    ['.idrop span', [/color:var\(--ui-muted\)/]],
    ['.idrop:hover,.idrop.is-over', [/border-color:var\(--ui-ink\)/, /background:var\(--ui-bg\)/]],
    ['.imsg', [/border:1.5px solid var\(--ui-ink\)/]],
    ['.iprev canvas', [/border:1px solid var\(--ui-line-control\)/]],
    ['.iuse', [/border:1px solid var\(--ui-line-control\)/]],
    ['.icard:hover .iuse', [/background:var\(--ui-ink\)/, /color:var\(--ui-bg\)/]],
  ];
  for (const [selector, patterns] of cases) {
    it(`${selector} uses the audited tokens`, () => {
      const body = rule(selector);
      for (const re of patterns) expect(body, selector).toMatch(re);
    });
  }
  it('J15: the drop zone turns to a solid ink outline while a file is dragged over it', () => {
    expect(css).toMatch(/\.idrop\.is-over\{border-style:solid;box-shadow:inset 0 0 0 1px var\(--ui-ink\)\}/);
  });
  it('the selected button rule comes after the hover rule with the same specificity (a hovered selected button keeps ink on bg)', () => {
    expect(css.indexOf('.xfmt button[aria-checked=true]')).toBeGreaterThan(css.indexOf('.xfmt button:hover'));
  });
  it('no colour literal in the J5 rules (only tokens)', () => {
    const start = css.indexOf('/* Bar actions and export menu');
    const block = css.slice(start, css.indexOf('/* Scene area', start));
    expect(block.match(/#[0-9A-Fa-f]{3,6}\b/g)).toBeNull();
  });
});
