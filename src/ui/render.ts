import { HARMONIES } from '../core/harmony';
import { isLocked, ROLES } from '../palette/roles';
import type { AppState } from '../state/state';
import type { Renderer } from '../state/store';
import { toOklch } from '../core/color';
import { onAccent } from '../palette/theme';
import type { Ui } from './dom';
import { HARMONY_LABEL, ROLE_LABEL } from './labels';
import { canMorph, isInstant } from './motion';
import { uiAccent, uiOnAccent, type SystemTheme } from './tokens';

/** CSS variables of the palette and of the tool accent, for the current mode and system theme. Pure. */
export function computeVars(state: AppState, system: SystemTheme): Map<string, string> {
  const palette = state.theme[state.mode];
  const vars = new Map<string, string>();
  for (const role of ROLES) {
    vars.set(`--${role}`, palette[role]);
    const ink = onAccent(palette[role]);
    vars.set(`--ink-${role}`, ink);
    vars.set(`--paper-${role}`, ink === '#FFFFFF' ? '#111111' : '#FFFFFF');
  }
  vars.set('--sur-accent', state.onAccent[state.mode]);
  vars.set('--sur-accent2', onAccent(palette.accent2));
  const accent = uiAccent(palette.accent, system);
  vars.set('--ui-accent', accent);
  vars.set('--ui-on-accent', uiOnAccent(accent));
  return vars;
}

const STAGGER_MS = 55;
const MORPH_MS = 300;
const MORPH_EASE = 'cubic-bezier(.3,.7,.2,1)';
/** The 11 registered colour variables (see tool.css): the only ones that are animated. */
const COLOR_VARS = new Set([...ROLES.map((r) => `--${r}`), '--sur-accent', '--sur-accent2', '--ui-accent', '--ui-on-accent']);
/** A hex as an explicit oklch() value: Chrome gives hex colours of low chroma a missing hue (rendered pink) inside color-mix(); achromatic ones keep it missing on purpose, so they take the other colour's hue. */
const cssOklch = (hex: string): string => {
  const c = toOklch(hex);
  return c ? `oklch(${c.l.toFixed(4)} ${c.c.toFixed(4)} ${c.c < 0.004 ? 'none' : c.h.toFixed(2)})` : hex;
};

export function fillHarmonies(select: HTMLSelectElement): void {
  for (const h of HARMONIES) {
    const option = document.createElement('option');
    option.value = h;
    option.textContent = HARMONY_LABEL[h];
    select.append(option);
  }
}

export function createRenderer(ui: Ui, systemTheme: () => SystemTheme): Renderer {
  // The role variables live in a constructed style sheet (CSSOM): no style="" attribute is ever written.
  const sheet = new CSSStyleSheet();
  sheet.insertRule(':root{}');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const rule = sheet.cssRules[0] as CSSStyleRule;
  const applied = new Map<string, string>();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let first = true;

  // Colour changes that are not a view transition go through OKLCH (not through sRGB): while `morph` runs, the class `morph` makes each
  // variable color-mix(in oklch, --X-to --p, --X-from) with --p animated 0% -> 100%; at rest the variables are the plain hex.
  const perceptual = canMorph();
  ui.root.classList.toggle('oklch', perceptual);
  let morph: Animation | null = null;
  const target = new Map<string, string>();

  return (prev, next) => {
    // What is on screen now, read before any variable changes: the live mix if a morph runs, else the last target.
    const live = morph?.playState === 'running' ? getComputedStyle(ui.root) : null;
    const shown = (name: string): string => (live ? live.getPropertyValue(name) : (target.get(name) ?? ''));
    const before = perceptual ? new Map([...COLOR_VARS].map((name) => [name, shown(name)] as const)) : null;
    let recoloured = false;
    for (const [name, value] of computeVars(next, systemTheme())) {
      if (applied.get(name) === value) continue;
      applied.set(name, value);
      rule.style.setProperty(name, value);
      if (perceptual && COLOR_VARS.has(name)) {
        target.set(name, cssOklch(value));
        recoloured = true;
      }
    }
    if (before && recoloured) {
      morph?.cancel();
      morph = null;
      ui.root.classList.remove('morph');
      const calm = first || isInstant() || reduceMotion.matches || !ui.root.classList.contains('is-ready') || ui.root.classList.contains('is-dragging');
      if (!calm) {
        for (const [name, from] of before) {
          rule.style.setProperty(`${name}-from`, from || (target.get(name) ?? ''));
          rule.style.setProperty(`${name}-to`, target.get(name) ?? '');
        }
        const run = ui.root.animate({ '--p': ['0%', '100%'] }, { duration: MORPH_MS, easing: MORPH_EASE });
        morph = run;
        ui.root.classList.add('morph');
        const end = (): void => {
          if (morph !== run) return;
          morph = null;
          ui.root.classList.remove('morph');
        };
        run.finished.then(end, end);
      }
    }

    const palette = next.theme[next.mode];
    const stagger = prev !== null && prev.shuffles !== next.shuffles && !reduceMotion.matches && !isInstant();
    for (const [k, sw] of ui.swatches.entries()) {
      const hex = palette[sw.role];
      const locked = isLocked(next.locks, sw.role);
      if (prev === null || prev.theme[prev.mode][sw.role] !== hex) {
        sw.hex.textContent = hex;
        sw.copy.setAttribute('aria-label', `${ROLE_LABEL[sw.role]} ${hex}, copier le code`);
      }
      if (prev === null || isLocked(prev.locks, sw.role) !== locked) {
        sw.lock.setAttribute('aria-pressed', String(locked));
        sw.lock.dataset.tip = locked ? 'Déverrouiller' : 'Verrouiller';
        sw.el.classList.toggle('locked', locked);
      }
      if (stagger && !locked) {
        sw.el.animate(
          [
            { transform: 'translateY(14px) scale(.95)', opacity: 0.3 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 550, delay: k * STAGGER_MS, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' },
        );
      }
    }

    if (prev === null || prev.harmony !== next.harmony) ui.harmony.value = next.harmony;
    if (prev === null || prev.mode !== next.mode) {
      for (const button of ui.modeButtons) {
        const on = button.dataset.mode === next.mode;
        button.setAttribute('aria-pressed', String(on));
        button.tabIndex = on ? 0 : -1;
      }
    }
    const base = next.theme.light.accent;
    if (prev === null || prev.theme.light.accent !== base) {
      ui.baseColor.value = base.toLowerCase();
      if (document.activeElement !== ui.baseHex) {
        ui.baseHex.value = base;
        ui.baseHex.removeAttribute('aria-invalid');
        ui.baseError.textContent = '';
      }
    }

    if (first) {
      first = false;
      requestAnimationFrame(() => requestAnimationFrame(() => ui.root.classList.add('is-ready')));
    }
  };
}
