import { exportText, FILE_NAME, FORMATS, outputOf, pngLayout, type ExportChoice } from '../export';
import type { AppState } from '../state/state';
import { copyText, type CopyEnv } from './clipboard';
import type { Ui } from './dom';
import { belowPills, isNarrow, need } from './pills';
import { canvasToBlob, downloadBlob, drawLayout } from './png';
import { showToast } from './toast';

export type ExportDialog = {
  update(state: AppState): void;
  open(): void;
  /** Closes the dialog; returns whether it was open. */
  close(returnFocus: boolean): boolean;
  isOpen(): boolean;
};

const COPIED = 'Copié dans le presse-papiers';
const MARGIN = 10;
const MIN_ROOM = 280;

export function initExportDialog(ui: Ui, getState: () => AppState, env: CopyEnv): ExportDialog {
  const dlg = need<HTMLElement>('#xmenu');
  const button = need<HTMLButtonElement>('#exportBtn');
  const closeBtn = need<HTMLButtonElement>('#xClose');
  const formats = [...dlg.querySelectorAll<HTMLButtonElement>('#xFormats [role=radio]')];
  const versions = [...dlg.querySelectorAll<HTMLButtonElement>('#xTw [role=radio]')];
  const twBox = need<HTMLElement>('#xTw');
  const figmaBox = need<HTMLElement>('#xFigma');
  const figma2025 = need<HTMLInputElement>('#xFigma2025');
  const out = need<HTMLTextAreaElement>('#xOut');
  const name = need<HTMLElement>('#xName');
  const copyBtn = need<HTMLButtonElement>('#xCopy');
  const downloadBtn = need<HTMLButtonElement>('#xDownload');
  const pngBox = need<HTMLElement>('#xPng');
  const canvas = need<HTMLCanvasElement>('#xCanvas');
  const status = need<HTMLElement>('#xStatus');

  let choice: ExportChoice = { format: 'css', tailwind: 'v4', figma: 'hex' };
  let isOpen = false;

  const input = () => {
    const s = getState();
    return { harmony: s.harmony, mode: s.mode, theme: s.theme };
  };

  const paint = (buttons: HTMLButtonElement[], key: 'f' | 'v', current: string): void => {
    for (const b of buttons) {
      const on = b.dataset[key] === current;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  const refresh = (): void => {
    const output = outputOf(choice);
    const png = choice.format === 'png';
    paint(formats, 'f', choice.format);
    paint(versions, 'v', choice.tailwind);
    twBox.hidden = choice.format !== 'tailwind';
    figmaBox.hidden = choice.format !== 'figma';
    figma2025.checked = choice.figma === '2025.10';
    name.textContent = FILE_NAME[output];
    out.hidden = png;
    pngBox.hidden = !png;
    copyBtn.hidden = png;
    downloadBtn.hidden = !png;
    status.textContent = '';
    if (output === 'png') drawLayout(pngLayout(input()), canvas);
    else out.value = exportText(output, input());
  };

  /** Radio buttons: click or arrows select (and move the focus to) a value. */
  const wire = <T extends string>(buttons: HTMLButtonElement[], key: 'f' | 'v', values: readonly T[], get: () => T, set: (v: T) => void): void => {
    const select = (v: T): void => {
      set(v);
      refresh();
      buttons.find((b) => b.dataset[key] === v)?.focus();
    };
    for (const b of buttons) {
      b.addEventListener('click', () => select(values.find((v) => v === b.dataset[key]) ?? values[0] ?? get()));
      b.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (step === 0 || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        select(values[(values.indexOf(get()) + step + values.length) % values.length] ?? get());
      });
    }
  };
  wire(formats, 'f', FORMATS, () => choice.format, (format) => (choice = { ...choice, format }));
  wire(versions, 'v', ['v4', 'v3'] as const, () => choice.tailwind, (tailwind) => (choice = { ...choice, tailwind }));
  figma2025.addEventListener('change', () => {
    choice = { ...choice, figma: figma2025.checked ? '2025.10' : 'hex' };
    refresh();
  });

  copyBtn.addEventListener('click', () => {
    void copyText(out.value, env).then((path) => {
      if (path === 'manual') {
        out.focus();
        out.select();
        status.textContent = 'Copie automatique impossible : le texte est sélectionné, Cmd/Ctrl + C pour copier.';
      } else {
        status.textContent = '';
        showToast(ui, COPIED, path);
      }
    });
  });
  downloadBtn.addEventListener('click', () => {
    drawLayout(pngLayout(input()), canvas);
    void canvasToBlob(canvas).then((blob) => downloadBlob(blob, FILE_NAME.png));
  });

  // Position through a constructed style sheet (no style="" attribute): under the contrast pills, never over them.
  const sheet = new CSSStyleSheet();
  const rule = sheet.cssRules[sheet.insertRule('#xmenu{}')] as CSSStyleRule;
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const place = (): void => {
    if (!isOpen) return;
    if (isNarrow()) {
      rule.style.removeProperty('top');
      rule.style.removeProperty('max-height');
      return;
    }
    let top = Math.max(68, Math.round(belowPills()) + 8);
    // Short window (a phone on its side): under the pills there is no room left, so the sheet goes up under the bar instead of leaving the screen.
    if (window.innerHeight - top - MARGIN < MIN_ROOM) top = 68;
    rule.style.setProperty('top', `${top}px`);
    rule.style.setProperty('max-height', `${Math.max(120, window.innerHeight - top - MARGIN)}px`);
  };
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });

  const close = (returnFocus: boolean): boolean => {
    if (!isOpen) return false;
    isOpen = false;
    dlg.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus();
    return true;
  };
  const open = (): void => {
    isOpen = true;
    refresh();
    dlg.hidden = false;
    place();
    button.setAttribute('aria-expanded', 'true');
    formats.find((b) => b.dataset.f === choice.format)?.focus();
  };
  closeBtn.addEventListener('click', () => close(true));
  button.addEventListener('click', () => (isOpen ? close(true) : open()));
  document.addEventListener('pointerdown', (e) => {
    if (!isOpen || !(e.target instanceof Node)) return;
    if (dlg.contains(e.target) || button.contains(e.target)) return;
    close(false);
  });

  return {
    isOpen: () => isOpen,
    open,
    close,
    update() {
      if (isOpen) {
        refresh();
        place();
      }
    },
  };
}
