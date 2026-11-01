import type { PairId } from '../palette/roles';
import { fixPair, planFix, type FixSide } from '../state/fix';
import type { AppState } from '../state/state';
import type { Store } from '../state/store';
import type { Ui } from './dom';
import { ROLE_LABEL } from './labels';
import { IMPOSSIBLE_MESSAGE, STUCK_MESSAGE, fixToast, fr, pairView, shown, type PairView } from './pairs';
import { aaCount } from './scene';
import { belowPills, isNarrow, need, textSlot, type PillsView } from './pills';
import { showToast } from './toast';

const TOAST_MS = 4000;
const MARGIN = 10;
const WIDTH = 320;

export type ContrastDialog = {
  update(state: AppState): void;
  /** Closes the dialog; returns whether it was open. */
  close(returnFocus: boolean): boolean;
  isOpen(): boolean;
};

export function initContrastDialog(ui: Ui, store: Store, pills: PillsView): ContrastDialog {
  const dlg = need<HTMLElement>('#cdlg');
  const closeBtn = need<HTMLButtonElement>('#cdClose');
  const fixBtn = need<HTMLButtonElement>('#cdFix');
  const fixBgBtn = need<HTMLButtonElement>('#cdFixBg');
  const warn = need<HTMLElement>('#cdWarn');
  const fixBox = need<HTMLElement>('#cdFixBox');
  const fixBgBox = need<HTMLElement>('#cdFixBgBox');
  const text = {
    title: textSlot(need('#cdTitle')),
    fg: textSlot(need('#cdFg')),
    bg: textSlot(need('#cdBg')),
    ratio: textSlot(need('#cdRatio')),
    shown: textSlot(need('#cdShown')),
    msg: textSlot(need('#cdMsg')),
    prop: textSlot(need('#cdProp')),
    propBg: textSlot(need('#cdPropBg')),
    fixBg: textSlot(fixBgBtn),
  };
  const levelRows = [...dlg.querySelectorAll<HTMLElement>('.cdlg-levels li')].map((li) => ({
    li,
    name: textSlot(need('.lv-name', li)),
    res: textSlot(need('.lv-text', li)),
  }));

  // Position and colours go through a constructed style sheet: no style="" attribute.
  const sheet = new CSSStyleSheet();
  const rule = sheet.cssRules[sheet.insertRule('#cdlg{}')] as CSSStyleRule;
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const setVar = (name: string, value: string): void => {
    if (rule.style.getPropertyValue(name) !== value) rule.style.setProperty(name, value);
  };

  let openId: PairId | null = null;
  const set = (slot: Text, value: string): void => {
    if (slot.data !== value) slot.data = value;
  };

  const place = (): void => {
    if (openId === null) return;
    if (isNarrow()) {
      // Bottom sheet: the style sheet of the page places it.
      for (const name of ['width', 'left', 'top']) rule.style.removeProperty(name);
      return;
    }
    const r = pills.button(openId).getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(r.right - width, window.innerWidth - width - MARGIN));
    const height = dlg.offsetHeight;
    let top = belowPills() + 8;
    if (top + height > window.innerHeight - MARGIN) top = Math.max(MARGIN, window.innerHeight - height - MARGIN);
    rule.style.setProperty('width', `${width}px`);
    rule.style.setProperty('left', `${left}px`);
    rule.style.setProperty('top', `${top}px`);
  };

  const fill = (view: PairView): void => {
    set(text.title, view.informational ? `${view.sentence} (indicatif)` : view.sentence);
    set(text.fg, view.fgHex);
    set(text.bg, view.bgHex);
    set(text.ratio, view.exact);
    set(text.shown, view.shown);
    setVar('--cd-fg', view.fgHex);
    setVar('--cd-bg', view.bgHex);
    for (const [i, row] of levelRows.entries()) {
      const level = view.levels[i];
      if (level === undefined) continue;
      set(row.name, `${level.name} (${fr(String(level.threshold))}:1)`);
      set(row.res, level.pass ? 'Réussi' : 'Échec');
      row.li.classList.toggle('fail', !level.pass);
    }
    const f = view.fix;
    warn.hidden = view.ok;
    fixBox.hidden = f.kind !== 'fg';
    fixBgBox.hidden = f.kind !== 'bg';
    const head = view.informational ? 'Sous le seuil indicatif de 3:1.' : 'Sous AA (4,5:1).';
    if (f.kind === 'fg') {
      set(text.msg, `${head} Corriger propose une teinte proche, puis la verrouille : Hasard la garde.`);
      set(text.prop, `${f.offer.to} · ${shown(f.offer.ratio)}:1`);
      setVar('--cd-prop', f.offer.to);
      fixBtn.setAttribute('aria-label', `Corriger : ${ROLE_LABEL[f.offer.role]}, ${f.offer.from} vers ${f.offer.to}`);
    } else if (f.kind === 'bg') {
      set(text.msg, `${head} ${IMPOSSIBLE_MESSAGE} La modifier change aussi les autres paires qui l'utilisent, et la verrouille.`);
      set(text.propBg, `${f.offer.to} · ${shown(f.offer.ratio)}:1`);
      set(text.fixBg, f.offer.role === 'surface' ? 'Corriger la surface' : 'Corriger le fond');
      setVar('--cd-prop', f.offer.to);
    } else if (f.kind === 'stuck') {
      set(text.msg, `${head} ${STUCK_MESSAGE}`);
    }
  };

  const open = (id: PairId, moveFocus: boolean): void => {
    openId = id;
    const state = store.getState();
    const view = pairView(state, id);
    fill(view);
    dlg.hidden = false;
    place();
    for (const spec of ['texte-fond', 'texte-surface', 'accent-fond', 'succes-surface', 'alerte-surface', 'accent2-fond'] as const) {
      pills.button(spec).setAttribute('aria-expanded', String(spec === id));
    }
    if (!moveFocus) return;
    if (view.fix.kind === 'fg') fixBtn.focus();
    else if (view.fix.kind === 'bg') fixBgBtn.focus();
    else closeBtn.focus();
  };

  const close = (returnFocus: boolean): boolean => {
    if (openId === null) return false;
    const pill = pills.button(openId);
    openId = null;
    dlg.hidden = true;
    pill.setAttribute('aria-expanded', 'false');
    if (returnFocus) pill.focus();
    return true;
  };

  const apply = (side: FixSide): void => {
    if (openId === null) return;
    const id = openId;
    const before = store.getState();
    const plan = planFix(before, id, side);
    store.dispatch(fixPair(id, side));
    const after = store.getState();
    if (plan.ok && after !== before) {
      const { ok, total } = aaCount(after);
      showToast(ui, fixToast(plan.role, plan.from, plan.to, ok, total), undefined, TOAST_MS);
    }
    close(true);
  };
  fixBtn.addEventListener('click', () => apply('fg'));
  fixBgBtn.addEventListener('click', () => apply('bg'));
  closeBtn.addEventListener('click', () => close(true));

  for (const spec of ['texte-fond', 'texte-surface', 'accent-fond', 'succes-surface', 'alerte-surface', 'accent2-fond'] as const) {
    pills.button(spec).addEventListener('click', () => {
      if (openId === spec) close(true);
      else open(spec, true);
    });
  }
  document.addEventListener('pointerdown', (e) => {
    if (openId === null || !(e.target instanceof Node)) return;
    if (dlg.contains(e.target) || pills.button(openId).parentElement?.contains(e.target)) return;
    close(false);
  });
  const reposition = (): void => place();
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, { passive: true });

  return {
    isOpen: () => openId !== null,
    close,
    update(state) {
      if (openId === null) return;
      const hadFocus = dlg.contains(document.activeElement);
      fill(pairView(state, openId));
      place();
      if (hadFocus && document.activeElement instanceof HTMLElement && document.activeElement.offsetParent === null) closeBtn.focus();
    },
  };
}
