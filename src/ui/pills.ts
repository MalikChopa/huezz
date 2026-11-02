import { PAIRS, type PairId } from '../palette/roles';
import type { AppState } from '../state/state';
import { pairView } from './pairs';

/** A text node created once, so updates change `data` and add or remove no node. */
export function textSlot(el: Element): Text {
  const first = el.firstChild;
  if (first instanceof Text) return first;
  const node = document.createTextNode('');
  el.append(node);
  return node;
}

export function need<T extends Element>(selector: string, parent: ParentNode = document): T {
  const el = parent.querySelector<T>(selector);
  if (el === null) throw new Error(`Huezz: élément introuvable (${selector})`);
  return el;
}

/** Under 760 px the menus are bottom sheets, placed by the style sheet. */
export const isNarrow = (): boolean => window.matchMedia('(max-width:760px)').matches;

/** Viewport y of the bottom edge of the pills group: menus open below it, never over it. */
export const belowPills = (): number => need<HTMLElement>('#pills').getBoundingClientRect().bottom;

/**
 * Phone bottom sheets (export, history): cap the height so the sheet stays under the pills, 8 px below them, and scrolls inside itself beyond that.
 * The page style sheet sets a bottom anchor and a window-high cap only; where the pills sit depends on the font (a wider font wraps the title and moves them down), so it is measured, not assumed.
 * On a short screen (under 280 px left) the cap is dropped: the sheet then wins over the pills rather than becoming unusable.
 */
export function capPhoneSheet(style: CSSStyleDeclaration): void {
  const used = Math.round(belowPills()) + 16;
  if (window.innerHeight - used < 280) style.removeProperty('max-height');
  else style.setProperty('max-height', `min(calc(100vh - 24px), calc(100dvh - 24px - env(safe-area-inset-bottom)), calc(100dvh - ${used}px - env(safe-area-inset-bottom)))`);
}

type PillRefs = { id: PairId; el: HTMLButtonElement; ratio: HTMLElement; level: HTMLElement; last: string };

export type PillsView = {
  button(id: PairId): HTMLButtonElement;
  /** Updates the six pills in place (text data, class, aria-label); nothing is created. */
  update(state: AppState): void;
};

export function initPills(): PillsView {
  const refs: PillRefs[] = PAIRS.map((spec) => {
    const el = need<HTMLButtonElement>(`.pill[data-pair="${spec.id}"]`);
    return { id: spec.id, el, ratio: need<HTMLElement>('.pill-ratio', el), level: need<HTMLElement>('.pill-lv', el), last: '' };
  });
  return {
    button: (id) => (refs.find((r) => r.id === id) as PillRefs).el,
    update(state) {
      for (const ref of refs) {
        const view = pairView(state, ref.id);
        const key = `${view.shown}|${view.badge}|${view.ok}|${view.ariaLabel}`;
        if (key === ref.last) continue;
        ref.last = key;
        ref.ratio.dataset.v = view.shown;
        ref.level.dataset.v = view.badge;
        ref.el.classList.toggle('fail', !view.ok);
        ref.el.setAttribute('aria-label', view.ariaLabel);
      }
    },
  };
}
