import { HARMONIES } from '../core/harmony';
import { isLocked, ROLES } from '../palette/roles';
import type { AppState } from '../state/state';
import type { Renderer } from '../state/store';
import { onAccent } from '../palette/theme';
import type { Ui } from './dom';
import { HARMONY_LABEL, ROLE_LABEL } from './labels';
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

  return (prev, next) => {
    for (const [name, value] of computeVars(next, systemTheme())) {
      if (applied.get(name) === value) continue;
      applied.set(name, value);
      rule.style.setProperty(name, value);
    }

    const palette = next.theme[next.mode];
    const stagger = prev !== null && prev.shuffles !== next.shuffles && !reduceMotion.matches;
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
