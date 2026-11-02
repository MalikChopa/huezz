import { isLocked, ROLES } from '../palette/roles';
import type { AppState } from '../state/state';
import { HARMONY_LABEL, lockSentence } from './labels';
import { aaCount, nameOfState } from './scene';

const DELAY_MS = 600;

const sameColours = (a: AppState, b: AppState): boolean => ROLES.every((r) => a.theme.light[r] === b.theme.light[r] && a.theme.dark[r] === b.theme.dark[r]);

/**
 * The sentence for a palette change; null when the change is not one the live region announces. Pure.
 * A Hasard that changed no colour is never «Nouvelle palette» (the toast says why when everything is locked).
 * One lock changed alone: «Fond verrouillé» / «Fond déverrouillé».
 */
export function announcement(prev: AppState | null, next: AppState): string | null {
  if (prev === null) return null;
  if (prev.shuffles !== next.shuffles && sameColours(prev, next)) return null;
  if (prev.shuffles === next.shuffles && prev.theme === next.theme && prev.harmony === next.harmony && prev.mode === next.mode && prev.locks !== next.locks) {
    const changed = ROLES.filter((r) => isLocked(prev.locks, r) !== isLocked(next.locks, r));
    const role = changed[0];
    return changed.length === 1 && role !== undefined ? lockSentence(role, isLocked(next.locks, role)) : null;
  }
  let lead: string;
  if (prev.shuffles !== next.shuffles) lead = 'Nouvelle palette';
  else if (prev.harmony !== next.harmony) lead = `Harmonie ${HARMONY_LABEL[next.harmony].toLowerCase()}`;
  else if (prev.mode !== next.mode) lead = next.mode === 'dark' ? 'Palette sombre' : 'Palette claire';
  else if (prev.theme.light.accent !== next.theme.light.accent && prev.theme !== next.theme && prev.locks === next.locks) lead = 'Couleur de base appliquée';
  else return null;
  const { ok, total } = aaCount(next);
  return `${lead} : ${nameOfState(next)}, accent ${next.theme[next.mode].accent}, ${ok} sur ${total} contrastes AA`;
}

let swap = false;
/** Writes a sentence in the polite live region; a trailing no-break space on every other call makes the same sentence read again. */
export function say(region: HTMLElement, text: string): void {
  swap = !swap;
  region.textContent = swap ? text : `${text}\u00a0`;
}

/** Polite live region: one short sentence, after a quiet period, so a burst of changes says only the last. */
export function initAnnouncer(region: HTMLElement): (prev: AppState | null, next: AppState) => void {
  let timer: number | undefined;
  return (prev, next) => {
    const text = announcement(prev, next);
    if (text === null) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => say(region, text), DELAY_MS);
  };
}
