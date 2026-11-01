import { ROLES, type Role } from '../palette/roles';

export type SwatchRefs = { role: Role; el: HTMLElement; copy: HTMLButtonElement; lock: HTMLButtonElement; hex: HTMLElement };

export type Ui = {
  root: HTMLElement;
  baseColor: HTMLInputElement;
  baseHex: HTMLInputElement;
  baseError: HTMLElement;
  harmony: HTMLSelectElement;
  hasard: HTMLButtonElement;
  modeButtons: HTMLButtonElement[];
  dock: HTMLElement;
  swatches: SwatchRefs[];
  live: HTMLElement;
  toast: HTMLElement;
  toastText: HTMLElement;
  manual: HTMLElement;
  manualField: HTMLInputElement;
};

function need<T extends Element>(selector: string, parent: ParentNode = document): T {
  const el = parent.querySelector<T>(selector);
  if (el === null) throw new Error(`Huezz: élément introuvable (${selector})`);
  return el;
}

export function getUi(): Ui {
  return {
    root: document.documentElement,
    baseColor: need<HTMLInputElement>('#base'),
    baseHex: need<HTMLInputElement>('#baseHex'),
    baseError: need('#baseErr'),
    harmony: need<HTMLSelectElement>('#harm'),
    hasard: need<HTMLButtonElement>('#hasard'),
    modeButtons: [...document.querySelectorAll<HTMLButtonElement>('.seg button')],
    dock: need('#dock'),
    swatches: ROLES.map((role) => {
      const el = need<HTMLElement>(`.sw[data-role="${role}"]`);
      return { role, el, copy: need<HTMLButtonElement>('.sw-copy', el), lock: need<HTMLButtonElement>('.sw-lock', el), hex: need('.sw-hex', el) };
    }),
    live: need('#live'),
    toast: need('#toast'),
    toastText: need('#toast span'),
    manual: need('#manual'),
    manualField: need<HTMLInputElement>('#manualField'),
  };
}
