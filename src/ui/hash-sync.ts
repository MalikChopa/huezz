import { loadShared } from '../state/share';
import type { AppState } from '../state/state';
import type { Store } from '../state/store';
import { decodeHash, encodeHash } from '../state/url';
import type { Ui } from './dom';
import { showToast } from './toast';

export const WRITE_EVERY_MS = 300;

export type HashSync = { write(state: AppState): void };

/** Keeps the address bar in step with the state (replaceState at most once per 300 ms) and reads it back on `hashchange`. */
export function initHashSync(ui: Ui, store: Store): HashSync {
  let last = -Infinity;
  let timer: number | undefined;
  let pending: AppState | null = null;

  const flush = (): void => {
    timer = undefined;
    if (pending === null) return;
    const hash = encodeHash(pending);
    pending = null;
    if (location.hash === hash) return;
    history.replaceState(null, '', hash);
    last = performance.now();
  };
  const write = (state: AppState): void => {
    pending = state;
    if (timer !== undefined) return;
    const wait = last + WRITE_EVERY_MS - performance.now();
    if (wait <= 0) flush();
    else timer = window.setTimeout(flush, wait);
  };

  window.addEventListener('hashchange', () => {
    const result = decodeHash(location.hash);
    if (result.kind === 'ok') store.dispatch(loadShared(result.value));
    else if (result.kind === 'error') showToast(ui, result.message, undefined, 4000);
    write(store.getState());
  });
  return { write };
}
