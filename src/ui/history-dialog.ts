import { paletteName } from '../palette/name';
import { ROLES, type Mode } from '../palette/roles';
import { isFavourite, type Entry, type History } from '../state/history';
import { loadShared } from '../state/share';
import type { AppState } from '../state/state';
import type { Store } from '../state/store';
import type { Ui } from './dom';
import { HARMONY_LABEL } from './labels';
import { belowPills, isNarrow, need } from './pills';
import { showToast } from './toast';

/** A palette is recorded once it has stayed this long: a colour drag leaves its end point, not each step. */
export const SETTLE_MS = 400;
const MARGIN = 10;
const MIN_ROOM = 280;

export type HistoryDialog = {
  /** Call on every render: schedules the recording of the displayed palette and keeps an open sheet in step. */
  track(state: AppState): void;
  close(returnFocus: boolean): boolean;
  isOpen(): boolean;
};

/** What had the focus, found again after the lists are rebuilt. */
type Spot = { cls: string; hash: string; kind: string; index: number };

export function initHistoryDialog(ui: Ui, history: History, store: Store, quiet: (text: string) => void): HistoryDialog {
  const dlg = need<HTMLElement>('#hmenu');
  const button = need<HTMLButtonElement>('#histBtn');
  const closeBtn = need<HTMLButtonElement>('#hClose');
  const warn = need<HTMLElement>('#hWarn');
  const note = need<HTMLElement>('#hNote');
  const lists = { fav: need<HTMLElement>('#hFav'), rec: need<HTMLElement>('#hRec') };
  const empties = { fav: need<HTMLElement>('#hFavEmpty'), rec: need<HTMLElement>('#hRecEmpty') };
  const clearBtn = need<HTMLButtonElement>('#hClear');
  const ask = need<HTMLElement>('#hAsk');
  const yes = need<HTMLButtonElement>('#hYes');
  const no = need<HTMLButtonElement>('#hNo');
  const template = need<HTMLTemplateElement>('#hRow');

  let isOpen = false;
  let mode: Mode = 'light';
  let latest: AppState | null = null;
  let timer: number | undefined;

  const nameOf = (e: Entry): string => paletteName(e.shared.theme[mode], mode);

  const build = (e: Entry, kind: 'fav' | 'rec', fav: boolean): HTMLElement => {
    const li = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
    const name = nameOf(e);
    const harmony = HARMONY_LABEL[e.shared.harmony];
    const row = need<HTMLButtonElement>('.hrow', li);
    const star = need<HTMLButtonElement>('.hstar', li);
    const colours = e.shared.theme[mode];
    li.querySelectorAll('rect').forEach((rect, i) => rect.setAttribute('fill', colours[ROLES[i] ?? 'fond']));
    need('b', li).textContent = name;
    need('small', li).textContent = harmony;
    row.setAttribute('aria-label', `${name} ${harmony}, restaurer`);
    star.setAttribute('aria-label', `Favori : ${name}`);
    star.setAttribute('aria-pressed', String(fav));
    for (const el of [row, star]) {
      el.dataset.h = e.hash;
      el.dataset.k = kind;
    }
    return li;
  };

  const spot = (): Spot | null => {
    const a = document.activeElement;
    if (!(a instanceof HTMLButtonElement) || !dlg.contains(a) || a.dataset.h === undefined) return null;
    const siblings = [...(a.closest('ul')?.querySelectorAll(`.${a.className}`) ?? [])];
    return { cls: a.className, hash: a.dataset.h, kind: a.dataset.k ?? '', index: siblings.indexOf(a) };
  };

  const refresh = (): void => {
    const was = spot();
    const data = history.data();
    for (const kind of ['fav', 'rec'] as const) {
      const entries = kind === 'fav' ? data.fav : data.recent;
      lists[kind].replaceChildren(...entries.map((e) => build(e, kind, isFavourite(data, e))));
      empties[kind].hidden = entries.length > 0;
    }
    const saved = history.persisted();
    warn.hidden = saved;
    note.hidden = !saved;
    if (was === null) return;
    const all = [...dlg.querySelectorAll<HTMLButtonElement>(`.${was.cls}`)];
    const same = all.find((b) => b.dataset.h === was.hash && b.dataset.k === was.kind);
    const inList = all.filter((b) => b.dataset.k === was.kind);
    (same ?? inList[Math.min(was.index, inList.length - 1)] ?? closeBtn).focus();
  };

  const flush = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (latest === null) return;
    const before = history.data();
    history.add(latest);
    if (isOpen && history.data() !== before) refresh();
  };

  // Position through a constructed style sheet (no style="" attribute), as the export sheet does.
  const sheet = new CSSStyleSheet();
  const rule = sheet.cssRules[sheet.insertRule('#hmenu{}')] as CSSStyleRule;
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const place = (): void => {
    if (!isOpen) return;
    if (isNarrow()) {
      rule.style.removeProperty('top');
      rule.style.removeProperty('max-height');
      return;
    }
    let top = Math.max(68, Math.round(belowPills()) + 8);
    if (window.innerHeight - top - MARGIN < MIN_ROOM) top = 68;
    rule.style.setProperty('top', `${top}px`);
    rule.style.setProperty('max-height', `${Math.max(120, window.innerHeight - top - MARGIN)}px`);
  };
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });

  const stopAsking = (): void => {
    ask.hidden = true;
    clearBtn.hidden = false;
  };
  const close = (returnFocus: boolean): boolean => {
    if (!isOpen) return false;
    isOpen = false;
    dlg.hidden = true;
    stopAsking();
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus();
    return true;
  };
  const open = (): void => {
    flush();
    isOpen = true;
    refresh();
    dlg.hidden = false;
    place();
    button.setAttribute('aria-expanded', 'true');
    closeBtn.focus();
  };
  button.addEventListener('click', () => (isOpen ? close(true) : open()));
  closeBtn.addEventListener('click', () => close(true));
  document.addEventListener('pointerdown', (e) => {
    if (!isOpen || !(e.target instanceof Node)) return;
    if (dlg.contains(e.target) || button.contains(e.target)) return;
    close(false);
  });
  addEventListener('pagehide', flush);

  dlg.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.hrow, .hstar') : null;
    const data = history.data();
    const entry = target === null ? undefined : [...data.fav, ...data.recent].find((x) => x.hash === target.dataset.h);
    if (target === null || entry === undefined) return;
    if (target.classList.contains('hstar')) {
      const result = history.toggle(entry.shared);
      if (result === 'full') showToast(ui, 'Favoris au complet (200) : retires-en un avant d\'en ajouter.', undefined, 4000);
      refresh();
      return;
    }
    const before = store.getState();
    store.dispatch(loadShared({ ...entry.shared, mode: before.mode }));
    const text = store.getState() === before ? `Déjà affichée : ${nameOf(entry)}` : `Restaurée : ${nameOf(entry)}`;
    if (store.getState() !== before) quiet(text);
    showToast(ui, text);
    close(true);
  });

  clearBtn.addEventListener('click', () => {
    clearBtn.hidden = true;
    ask.hidden = false;
    no.focus();
  });
  no.addEventListener('click', () => {
    stopAsking();
    clearBtn.focus();
  });
  yes.addEventListener('click', () => {
    history.clear();
    stopAsking();
    refresh();
    clearBtn.focus();
    showToast(ui, 'Historique effacé');
  });

  return {
    isOpen: () => isOpen,
    close,
    track(state) {
      latest = state;
      const modeChanged = state.mode !== mode;
      mode = state.mode;
      if (isOpen && modeChanged) refresh();
      clearTimeout(timer);
      timer = window.setTimeout(flush, SETTLE_MS);
    },
  };
}
