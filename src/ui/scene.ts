import { HARMONY_LABEL } from './labels';
import { computeFit, type Fit } from './fit';
import type { AppState } from '../state/state';

function need<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (el === null) throw new Error(`Huezz: élément introuvable (${selector})`);
  return el;
}

/** The text node of an element (created once if missing), so later updates change `data` and add or remove no node. */
function textNodeOf(el: Element): Text {
  const first = el.firstChild;
  if (first instanceof Text) return first;
  const node = document.createTextNode('');
  el.replaceChildren(node);
  return node;
}

/** Counts the compliant pairs (AA) among the checked ones; the informative pair is left out. */
export function aaCount(state: AppState): { ok: number; total: number } {
  const pairs = state.report[state.mode].filter((p) => !p.informational);
  return { ok: pairs.filter((p) => p.ok).length, total: pairs.length };
}

export type SceneView = { update(next: AppState): void };

export function initScene(): SceneView {
  const harm = textNodeOf(need('#metaHarm'));
  const mode = textNodeOf(need('#metaMode'));
  const aa = textNodeOf(need('#metaAa'));
  const wrap = need<HTMLElement>('#stageWrap');
  const stage = need<HTMLElement>('#stage');

  // Scale and size live in a constructed style sheet: no style="" attribute.
  const sheet = new CSSStyleSheet();
  const ruleStyle = (selector: string): CSSStyleDeclaration => (sheet.cssRules[sheet.insertRule(`${selector}{}`, sheet.cssRules.length)] as CSSStyleRule).style;
  const stageRule = ruleStyle('#stage');
  const wrapRule = ruleStyle('#stageWrap');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  let last: Fit | null = null;

  const fit = (): void => {
    let f = computeFit(wrap.clientWidth, wrap.clientHeight);
    if (last?.tall === true && !f.tall) {
      // The wrapper still has its vertical-layout height: free it, then measure again.
      wrapRule.removeProperty('height');
      wrapRule.removeProperty('flex');
      f = computeFit(wrap.clientWidth, wrap.clientHeight);
    }
    if (last !== null && last.tall === f.tall && last.scale === f.scale && last.wrapHeight === f.wrapHeight) return;
    last = f;
    stage.classList.toggle('tall', f.tall);
    stageRule.setProperty('transform', `translate(-50%,-50%) scale(${f.scale})`);
    if (f.wrapHeight === null) {
      wrapRule.removeProperty('height');
      wrapRule.removeProperty('flex');
    } else {
      wrapRule.setProperty('flex', 'none');
      wrapRule.setProperty('height', `${f.wrapHeight}px`);
    }
  };
  fit();
  new ResizeObserver(fit).observe(wrap);

  return {
    update(next) {
      const harmony = HARMONY_LABEL[next.harmony];
      if (harm.data !== harmony) harm.data = harmony;
      const modeText = next.mode === 'light' ? 'clair' : 'sombre';
      if (mode.data !== modeText) mode.data = modeText;
      const { ok, total } = aaCount(next);
      const count = `${ok}/${total}`;
      if (aa.data !== count) aa.data = count;
    },
  };
}
