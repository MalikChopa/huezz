import { HARMONIES, type Harmony } from '../core/harmony';
import { isLocked, type Mode } from '../palette/roles';
import { hasard, setBase, setHarmony, setMode } from '../state/state';
import type { Store } from '../state/store';
import { checkHex } from './base-field';
import type { Ui } from './dom';
import { showToast } from './toast';

const MODES: readonly Mode[] = ['light', 'dark'];

export const ALL_LOCKED_MESSAGE = 'Les 7 couleurs sont verrouillées : déverrouille-en une pour générer une nouvelle palette.';
export const accentUpdated = (hex: string): string => `Accent mis à jour : ${hex} (verrouillé)`;

/** Hasard (button or Space bar). When it changes nothing (all 7 roles locked) a toast says why instead of staying silent. */
export function runHasard(ui: Ui, store: Store): void {
  const before = store.getState();
  store.dispatch(hasard());
  if (store.getState() === before) showToast(ui, ALL_LOCKED_MESSAGE, undefined, 4000);
}

export function initControls(ui: Ui, store: Store): void {
  ui.hasard.addEventListener('click', () => runHasard(ui, store));

  ui.harmony.addEventListener('change', () => {
    const value = HARMONIES.find((h): h is Harmony => h === ui.harmony.value);
    if (value) store.dispatch(setHarmony(value));
  });

  for (const button of ui.modeButtons) {
    button.addEventListener('click', () => {
      const mode = MODES.find((m) => m === button.dataset.mode);
      if (mode) store.dispatch(setMode(mode));
    });
    button.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const mode = e.key === 'ArrowLeft' ? 'light' : 'dark';
      store.dispatch(setMode(mode));
      ui.modeButtons.find((b) => b.dataset.mode === mode)?.focus();
    });
  }

  /** Applies a typed or picked base; true if the state changed while the accent was locked (the toast then says so). */
  const applyBase = (hex: string): boolean => {
    const before = store.getState();
    store.dispatch(setBase(hex));
    return isLocked(before.locks, 'accent') && store.getState() !== before;
  };
  const toastLockedAccent = (): void => showToast(ui, accentUpdated(store.getState().theme.light.accent), undefined, 2800);

  // Colour input: live while dragging (no fade), committed when the picker closes (one toast then, not one per move).
  let lockedDrag = false;
  ui.baseColor.addEventListener('input', () => {
    ui.root.classList.add('is-dragging');
    if (applyBase(ui.baseColor.value)) lockedDrag = true;
  });
  ui.baseColor.addEventListener('change', () => {
    ui.root.classList.remove('is-dragging');
    if (applyBase(ui.baseColor.value)) lockedDrag = true;
    if (lockedDrag) toastLockedAccent();
    lockedDrag = false;
  });
  ui.baseColor.addEventListener('blur', () => ui.root.classList.remove('is-dragging'));

  const clearError = (): void => {
    ui.baseHex.removeAttribute('aria-invalid');
    ui.baseError.textContent = '';
  };
  const commitHex = (): void => {
    const check = checkHex(ui.baseHex.value);
    if (!check.ok) {
      ui.baseHex.setAttribute('aria-invalid', 'true');
      ui.baseError.textContent = check.message;
      return;
    }
    clearError();
    if (applyBase(check.hex)) toastLockedAccent();
    ui.baseHex.value = store.getState().theme.light.accent;
  };
  ui.baseHex.addEventListener('change', commitHex);
  ui.baseHex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitHex();
    else if (e.key === 'Escape' && (ui.baseHex.hasAttribute('aria-invalid') || ui.baseHex.value !== store.getState().theme.light.accent)) {
      // Escape gives the applied value back (and keeps the page-wide Escape for dialogs).
      e.stopPropagation();
      clearError();
      ui.baseHex.value = store.getState().theme.light.accent;
    }
  });
  // An error goes away as soon as the text is a good code again.
  ui.baseHex.addEventListener('input', () => {
    if (ui.baseHex.hasAttribute('aria-invalid') && checkHex(ui.baseHex.value).ok) clearError();
  });
}
