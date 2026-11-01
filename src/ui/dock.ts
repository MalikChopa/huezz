import type { Role } from '../palette/roles';
import type { Store } from '../state/store';
import { toggleLock } from '../state/state';
import type { Ui } from './dom';

export type Dock = { targetRole(): Role | null };

/** Dock: one tab stop for the colours and one for the locks (roving tabindex), arrows move, click copies. */
export function initDock(ui: Ui, store: Store, copy: (hex: string) => void): Dock {
  const { swatches } = ui;
  let hovered: Role | null = null;
  let focused: Role | null = null;

  const setCurrent = (index: number) => {
    for (const [i, sw] of swatches.entries()) {
      const tab = i === index ? 0 : -1;
      sw.copy.tabIndex = tab;
      sw.lock.tabIndex = tab;
    }
  };
  setCurrent(0);

  for (const [i, sw] of swatches.entries()) {
    sw.copy.addEventListener('click', () => {
      const { theme, mode } = store.getState();
      copy(theme[mode][sw.role]);
    });
    sw.lock.addEventListener('click', () => store.dispatch(toggleLock(sw.role)));
    sw.el.addEventListener('focusin', () => {
      focused = sw.role;
      setCurrent(i);
    });
    sw.el.addEventListener('focusout', () => {
      focused = null;
    });
    sw.el.addEventListener('pointerenter', () => {
      hovered = sw.role;
    });
    sw.el.addEventListener('pointerleave', () => {
      hovered = null;
    });
  }

  ui.dock.addEventListener('keydown', (e) => {
    const from = swatches.findIndex((sw) => sw.el.contains(e.target as Node));
    if (from < 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    let to = from;
    if (e.key === 'ArrowRight') to = Math.min(swatches.length - 1, from + 1);
    else if (e.key === 'ArrowLeft') to = Math.max(0, from - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = swatches.length - 1;
    else return;
    e.preventDefault();
    const onLock = swatches[from]?.lock.contains(e.target as Node) ?? false;
    const dest = swatches[to];
    if (dest) (onLock ? dest.lock : dest.copy).focus();
  });

  return { targetRole: () => focused ?? hovered };
}
