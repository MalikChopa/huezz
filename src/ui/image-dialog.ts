import { extractCandidates, type Candidate } from '../palette/extract';
import { paletteName } from '../palette/name';
import { ROLES, type Mode } from '../palette/roles';
import { useCandidate, type AppState } from '../state/state';
import type { Store } from '../state/store';
import { say } from './announce';
import type { Ui } from './dom';
import { MESSAGES, pickFile, readImage } from './image-read';
import { HARMONY_LABEL } from './labels';
import { TYPING } from './keyboard';
import { belowPills, capPhoneSheet, isNarrow, need } from './pills';
import { showToast } from './toast';

const MARGIN = 10;
const MIN_ROOM = 280;

export type ImageDialog = {
  isOpen(): boolean;
  close(returnFocus: boolean): boolean;
  /** Call on every render: an open sheet shows its candidates in the current mode. */
  track(state: AppState): void;
};

const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;

/**
 * The image sheet (F1): the picture is read in this page only (decoded, shrunk to 64 px, clustered by hand) and kept only while the sheet is open.
 * Entry: the file button, a drop anywhere on the page, a paste of an image. Candidates are real buttons; one click applies it as an ordinary palette change.
 */
export function initImageDialog(ui: Ui, store: Store, quiet: () => void, closeOthers: () => void): ImageDialog {
  const dlg = need<HTMLElement>('#imenu');
  const button = need<HTMLButtonElement>('#imgBtn');
  const closeBtn = need<HTMLButtonElement>('#iClose');
  const zone = need<HTMLButtonElement>('#iDrop');
  const input = need<HTMLInputElement>('#iFile');
  const message = need<HTMLElement>('#iMsg');
  const preview = need<HTMLElement>('#iPrev');
  const thumb = need<HTMLElement>('#iThumb');
  const count = need<HTMLElement>('#iCount');
  const list = need<HTMLElement>('#iList');
  const template = need<HTMLTemplateElement>('#iRow');

  let isOpen = false;
  let byDrag = false;
  let depth = 0;
  let mode: Mode = store.getState().mode;
  let found: Candidate[] = [];
  // Each read has a number: an older one that finishes late is dropped.
  let run = 0;

  const paint = (): void => {
    list.querySelectorAll<HTMLElement>('.icard').forEach((card, i) => {
      const c = found[i];
      if (c === undefined) return;
      const colours = c.theme[mode];
      card.querySelectorAll('rect').forEach((rect, k) => rect.setAttribute('fill', colours[ROLES[k] ?? 'fond']));
      need('b', card).textContent = paletteName(colours, mode);
      need('small', card).textContent = HARMONY_LABEL[c.harmony];
    });
  };

  const clear = (): void => {
    found = [];
    list.replaceChildren();
    thumb.querySelectorAll('canvas').forEach((c) => (c.width = 0));
    thumb.replaceChildren();
    preview.hidden = true;
    message.hidden = true;
  };

  const fail = (text: string): void => {
    clear();
    message.textContent = text;
    message.hidden = false;
    say(ui.live, text);
  };

  const load = async (file: File | null): Promise<void> => {
    const mine = ++run;
    clear();
    if (file === null) return fail(MESSAGES.noFile);
    message.textContent = 'Lecture de l\'image…';
    message.hidden = false;
    const result = await readImage(file);
    if (mine !== run || !isOpen) return;
    if (!result.ok) return fail(result.message);
    const candidates = extractCandidates(result.sample.data, result.sample.width, result.sample.height);
    if (candidates.length === 0) return fail(MESSAGES.empty);
    clear();
    found = candidates;
    result.preview.setAttribute('aria-hidden', 'true');
    thumb.append(result.preview);
    const text = `${found.length} palettes tirées de ton image : choisis-en une.`;
    count.textContent = text;
    preview.hidden = false;
    list.replaceChildren(...found.map(() => template.content.firstElementChild?.cloneNode(true) as HTMLElement));
    paint();
    say(ui.live, text);
  };

  // Position through a constructed style sheet (no style="" attribute), as the history sheet does.
  const sheet = new CSSStyleSheet();
  const rule = sheet.cssRules[sheet.insertRule('#imenu{}')] as CSSStyleRule;
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const place = (): void => {
    if (!isOpen) return;
    if (isNarrow()) {
      rule.style.removeProperty('top');
      capPhoneSheet(rule.style);
      return;
    }
    let top = Math.max(68, Math.round(belowPills()) + 8);
    if (window.innerHeight - top - MARGIN < MIN_ROOM) top = 68;
    rule.style.setProperty('top', `${top}px`);
    rule.style.setProperty('max-height', `${Math.max(120, window.innerHeight - top - MARGIN)}px`);
  };
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });

  const close = (returnFocus: boolean): boolean => {
    if (!isOpen) return false;
    isOpen = false;
    byDrag = false;
    run++;
    clear();
    input.value = '';
    dlg.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus();
    return true;
  };
  const open = (focus: boolean): void => {
    if (!isOpen) {
      closeOthers();
      isOpen = true;
      dlg.hidden = false;
      place();
      button.setAttribute('aria-expanded', 'true');
    }
    if (focus) zone.focus();
  };

  button.addEventListener('click', () => (isOpen ? close(true) : open(true)));
  closeBtn.addEventListener('click', () => close(true));
  document.addEventListener('pointerdown', (e) => {
    if (!isOpen || !(e.target instanceof Node)) return;
    if (dlg.contains(e.target) || button.contains(e.target)) return;
    close(false);
  });

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = pickFile(input.files);
    input.value = '';
    if (file !== null) void load(file);
  });

  // A file dragged over the page opens the sheet (so the drop zone shows); leaving the window with nothing read closes it again.
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    if (!isOpen) {
      open(false);
      byDrag = true;
    }
    zone.classList.add('is-over');
  });
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth > 0) return;
    zone.classList.remove('is-over');
    if (byDrag) close(false);
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    byDrag = false;
    zone.classList.remove('is-over');
    open(true);
    void load(pickFile(e.dataTransfer?.files));
  });

  // Cmd/Ctrl+V with an image on the clipboard, outside a text field: the sheet opens on that image. Anything else is left to the browser.
  document.addEventListener('paste', (e) => {
    const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (file === undefined || (e.target instanceof Element && e.target.closest(TYPING) !== null)) return;
    e.preventDefault();
    open(true);
    void load(file);
  });

  list.addEventListener('click', (e) => {
    const card = e.target instanceof Element ? e.target.closest('.icard') : null;
    const chosen = card === null ? undefined : found[[...list.querySelectorAll('.icard')].indexOf(card)];
    if (chosen === undefined) return;
    store.dispatch(useCandidate(chosen));
    const now = store.getState();
    const text = `Palette tirée de ton image : ${paletteName(now.theme[now.mode], now.mode)}`;
    quiet();
    showToast(ui, text);
    close(true);
  });

  return {
    isOpen: () => isOpen,
    close,
    track(state) {
      const changed = state.mode !== mode;
      mode = state.mode;
      if (isOpen && changed) paint();
    },
  };
}
