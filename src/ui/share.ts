import type { AppState } from '../state/state';
import { encodeHash } from '../state/url';
import { copyText, type CopyEnv } from './clipboard';
import type { Ui } from './dom';
import { showManualCopy, showToast } from './toast';

export const UNAVAILABLE = 'Lien indisponible hors http(s) : ouvre la page depuis un site pour partager';

/** The page address with the hash of the current state (not the throttled address bar). */
export function shareUrl(state: AppState): string {
  return location.href.split('#')[0] + encodeHash(state);
}

export function initShare(ui: Ui, getState: () => AppState, env: CopyEnv): void {
  const button = document.getElementById('share');
  button?.addEventListener('click', () => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      showToast(ui, UNAVAILABLE, undefined, 4000);
      return;
    }
    const url = shareUrl(getState());
    void copyText(url, env).then((path) => {
      if (path === 'manual') showManualCopy(ui, url);
      else showToast(ui, 'Lien copié : la palette est dans l\'adresse', path);
    });
  });
}
