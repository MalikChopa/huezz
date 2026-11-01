import type { Ui } from './dom';
import type { CopyPath } from './clipboard';

const SHOW_MS = 1800;
let timer: number | undefined;

export function showToast(ui: Ui, text: string, path?: CopyPath, ms: number = SHOW_MS): void {
  ui.toastText.textContent = text;
  if (path) ui.toast.dataset.path = path;
  ui.toast.classList.add('show');
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    ui.toast.classList.remove('show');
  }, ms);
}

let before: Element | null = null;

/** Last resort when no copy method worked: a selected field and the shortcut. */
export function showManualCopy(ui: Ui, text: string): void {
  before = document.activeElement;
  ui.manualField.value = text;
  ui.manual.hidden = false;
  ui.manualField.focus();
  ui.manualField.select();
}

export function closeManualCopy(ui: Ui): boolean {
  if (ui.manual.hidden) return false;
  ui.manual.hidden = true;
  if (before instanceof HTMLElement) before.focus();
  before = null;
  return true;
}
