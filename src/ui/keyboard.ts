export type KeyFacts = {
  key: string;
  repeat: boolean;
  modifier: boolean;
  /** Ctrl or Cmd, without Alt (the undo shortcuts). */
  command: boolean;
  shift: boolean;
  /** Ctrl itself (Ctrl+Y redoes on Windows; Cmd+Y is the browser history on a Mac). */
  ctrl: boolean;
  /** The target is a text field, select, textarea or editable area. */
  typing: boolean;
  /** The target is a control that keeps its own action for Space (button, link, field, select...). */
  native: boolean;
};

export type Intent = 'hasard' | 'lock' | 'escape' | 'undo' | 'redo';

/** Pure decision table of section 6. Enter and the arrows are handled by the controls themselves (native action / roving focus). */
export function keyIntent(k: KeyFacts): Intent | null {
  const letter = k.key.toLowerCase();
  // A text field, the harmony menu: they keep their own undo.
  if (k.command && !k.typing) {
    if (letter === 'z') return k.shift ? 'redo' : 'undo';
    if (letter === 'y' && k.ctrl && !k.shift) return 'redo';
  }
  if (k.modifier) return null;
  if (k.key === 'Escape') return 'escape';
  if (k.repeat) return null;
  if (k.key === ' ') return k.native ? null : 'hasard';
  if (k.key === 'l' || k.key === 'L') return k.typing ? null : 'lock';
  return null;
}

const TYPING = 'input:not([type=button]):not([type=color]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]';
const NATIVE = 'button, a[href], input, textarea, select, summary, [contenteditable], [role=button], [role=checkbox], [role=switch], [role=tab], [role=option], [role=menuitem]';

export function factsOf(e: KeyboardEvent): KeyFacts {
  const target = e.target instanceof Element ? e.target : null;
  return {
    key: e.key,
    repeat: e.repeat,
    modifier: e.ctrlKey || e.metaKey || e.altKey,
    command: (e.ctrlKey || e.metaKey) && !e.altKey,
    shift: e.shiftKey,
    ctrl: e.ctrlKey,
    typing: target?.closest(TYPING) != null,
    native: target?.closest(NATIVE) != null,
  };
}
