import { ROLES } from '../palette/roles';
import type { AppState } from '../state/state';
import type { Ui } from './dom';

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.3,.7,.2,1)';
const WAVE_SPAN_MS = 150;
const WAVE_FADE_MS = 200;
const CIRCLE_MS = 550;

/** Perceptual colour change (OKLCH) needs color-mix() in oklch and registered custom properties. */
export const canMorph = (): boolean => CSS.supports('color', 'color-mix(in oklch, red, blue)') && typeof CSS.registerProperty === 'function';

/** True while the DOM update runs inside a view transition: the colours then change at once, the snapshots do the fade. */
let instant = false;
export const isInstant = (): boolean => instant;

// Elements that get their own snapshot during the wave: the 7 dock swatches and the 3 mock-ups.
const WAVE_NAMES: readonly (readonly [string, string])[] = [
  ...ROLES.map((r) => [`.sw[data-role=${r}]`, `s-${r}`] as const),
  ...(['web', 'dash', 'phone'] as const).map((p) => [`.p-${p}`, `p-${p}`] as const),
];
let namesReady = false;
function nameWaveElements(): void {
  if (namesReady) return;
  namesReady = true;
  const sheet = new CSSStyleSheet();
  for (const [selector, name] of WAVE_NAMES) sheet.insertRule(`.vt-wave ${selector}{view-transition-name:${name}}`, sheet.cssRules.length);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

type Point = { x: number; y: number };
const center = (el: Element): Point => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** Each named element fades in after a delay proportional to its distance from Hasard: the mock-ups first, then the swatches from the middle out. */
function wave(root: HTMLElement, from: Point): void {
  const items = WAVE_NAMES.map(([selector, name]) => {
    const el = document.querySelector(selector);
    const c = el ? center(el) : from;
    return { name, d: Math.hypot(c.x - from.x, c.y - from.y) };
  });
  const dMin = Math.min(...items.map((i) => i.d));
  const dMax = Math.max(...items.map((i) => i.d));
  for (const { name, d } of items) {
    const delay = dMax > dMin ? (WAVE_SPAN_MS * (d - dMin)) / (dMax - dMin) : 0;
    root.animate({ opacity: [0, 1] }, { duration: WAVE_FADE_MS, delay, easing: EASE, fill: 'backwards', pseudoElement: `::view-transition-new(${name})` });
  }
}

/** The new mode grows as a circle from the button that was pressed, up to the farthest corner. */
function circle(root: HTMLElement, from: Point): void {
  const r = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
  root.animate(
    { clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${r}px at ${from.x}px ${from.y}px)`] },
    { duration: CIRCLE_MS, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' },
  );
}

export type Kind = 'wave' | 'circle';

/** Which effect a change deserves, or null for the plain update (first render, reduced motion, no View Transitions API, hidden page). */
export function kindOf(prev: AppState | null, next: AppState): Kind | null {
  if (prev === null || reduced() || typeof document.startViewTransition !== 'function' || document.hidden) return null;
  if (prev.mode !== next.mode) return 'circle';
  return prev.shuffles !== next.shuffles ? 'wave' : null;
}

let active: ViewTransition | null = null;

/** Runs `body` (the whole DOM update) inside a view transition, animated from the control that triggered it. */
export function transition(ui: Ui, kind: Kind, next: AppState, body: () => void): void {
  const root = ui.root;
  const from = center(kind === 'wave' ? ui.hasard : (ui.modeButtons.find((b) => b.dataset.mode === next.mode) ?? ui.hasard));
  if (kind === 'wave') nameWaveElements();
  root.classList.remove('vt-wave', 'vt-circle');
  root.classList.add('vt', kind === 'wave' ? 'vt-wave' : 'vt-circle');
  const vt = document.startViewTransition(() => {
    instant = true;
    try {
      body();
    } finally {
      instant = false;
    }
  });
  active = vt;
  const done = (): void => {
    if (active !== vt) return;
    active = null;
    root.classList.remove('vt', 'vt-wave', 'vt-circle');
  };
  vt.ready.then(() => (kind === 'wave' ? wave(root, from) : circle(root, from))).catch(() => undefined);
  void vt.finished.then(done, done);
}

/**
 * Pointer input never reaches the page while a view transition runs (the page is replaced by its snapshots, so the target is the root element).
 * A press during a transition ends it at once; the click that follows is aimed at the root, so it is handed to the control under the finger.
 */
export function initMotion(root: HTMLElement): void {
  let lost: Point | null = null;
  const handOver = (at: Point, retry: boolean): void => {
    const el = document.elementFromPoint(at.x, at.y);
    if (el === root && retry) requestAnimationFrame(() => handOver(at, false)); // the snapshots are not gone yet
    else if (el instanceof HTMLElement && el !== root && el !== document.body) {
      el.focus({ preventScroll: true });
      el.click();
    }
  };
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (active === null) return;
      lost = e.target === root ? { x: e.clientX, y: e.clientY } : null;
      active.skipTransition();
    },
    true,
  );
  document.addEventListener(
    'click',
    (e) => {
      const at = lost;
      lost = null;
      if (at !== null && e.target === root) handOver(at, true);
    },
    true,
  );
}
