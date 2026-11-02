import type { Cvd } from '../core/cvd';
import { say } from './announce';

export type Vision = 'normal' | Cvd;

const KIND: Readonly<Record<Cvd, string>> = { protan: 'protanopie', deutan: 'deutéranopie', tritan: 'tritanopie' };
const isKind = (value: string): value is Cvd => value in KIND;

/** The sentence of the live region when the choice changes. Pure. */
export function visionSentence(vision: Vision): string {
  return vision === 'normal' ? 'Vision normale : aperçu en couleurs réelles' : `Aperçu simulé, ${KIND[vision]}, simulation approchée : les contrastes et les exports restent ceux de la vraie palette`;
}

/**
 * Vision preview. The choice lives in memory only (no share link, no storage, back to Normale on every load) and does not go through the store or the render
 * pipeline: it is one attribute on <html>, and the CSS puts the SVG filter of index.html on the 3 mock-ups and the 7 dock swatches. A palette change under a
 * simulation therefore just changes the colour variables, and the filter shows them through the same matrix; the tool's own bar, dialogs and contrast pills are never filtered.
 */
export function initVision(root: HTMLElement, live: HTMLElement): void {
  const select = document.querySelector<HTMLSelectElement>('#vision');
  const note = document.querySelector<HTMLElement>('#visionNote');
  if (select === null || note === null) throw new Error('Huezz: élément introuvable (#vision)');
  const apply = (announce: boolean): void => {
    const value = select.value;
    const vision: Vision = isKind(value) ? value : 'normal';
    if (vision === 'normal') {
      root.removeAttribute('data-vision');
      note.hidden = true;
    } else {
      root.setAttribute('data-vision', vision);
      note.hidden = false;
    }
    if (announce) say(live, visionSentence(vision));
  };
  // A reload would let the browser put the old choice back in the control: start from Normale every time.
  select.value = 'normal';
  apply(false);
  select.addEventListener('change', () => apply(true));
}
