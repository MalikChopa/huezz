import '../styles/tool.css';
import '../styles/mockups.css';
import { createHistory } from '../state/history';
import { stateFromShared } from '../state/share';
import { randomSeed } from '../state/seed';
import { initialState, toggleLock } from '../state/state';
import { createStore } from '../state/store';
import { decodeHash } from '../state/url';
import { initAnnouncer } from './announce';
import { browserEnv, copyText } from './clipboard';
import { initContrastDialog } from './contrast-dialog';
import { initControls, runHasard } from './controls';
import { initDock } from './dock';
import { getUi } from './dom';
import { initExportDialog } from './export-dialog';
import { initHarmonyFit } from './harmony-fit';
import { initHashSync } from './hash-sync';
import { initHistoryDialog } from './history-dialog';
import { factsOf, keyIntent } from './keyboard';
import { createRenderer, fillHarmonies } from './render';
import { initShare } from './share';
import { initSheetScroll } from './sheet';
import { initMotion, kindOf, transition } from './motion';
import { initPills } from './pills';
import { initScene, nameOfState } from './scene';
import { withUndo } from './undo';
import { initVision } from './vision';
import type { SystemTheme } from './tokens';
import { closeManualCopy, showManualCopy, showToast } from './toast';

const ui = getUi();
fillHarmonies(ui.harmony);
initHarmonyFit(ui.harmony);

const dark = window.matchMedia('(prefers-color-scheme: dark)');
const systemTheme = (): SystemTheme => (dark.matches ? 'dark' : 'light');
const scene = initScene();
const pills = initPills();
const renderShell = createRenderer(ui, systemTheme);
const announce = initAnnouncer(ui.live);
let dialog: ReturnType<typeof initContrastDialog> | null = null;
let exporter: ReturnType<typeof initExportDialog> | null = null;
let sync: ReturnType<typeof initHashSync> | null = null;
let past: ReturnType<typeof initHistoryDialog> | null = null;
// Set when a restore or an undo has its own toast: the generic «Nouvelle palette» sentence stays silent for that render.
let quiet = false;
// A valid hash wins over the system theme and the random seed; a bad one leaves a fresh random palette and a message.
const loaded = decodeHash(location.hash);
const undoable = withUndo(createStore(loaded.kind === 'ok' ? stateFromShared(loaded.value) : initialState(systemTheme(), randomSeed()), (prev, next) => {
  const update = (): void => {
    renderShell(prev, next);
    if (quiet) quiet = false;
    else announce(prev, next);
    scene.update(next);
    pills.update(next);
    dialog?.update(next);
    exporter?.update(next);
    sync?.write(next);
    past?.track(next);
  };
  const kind = kindOf(prev, next);
  if (kind) transition(ui, kind, next, update);
  else update();
}));
const store = undoable.store;
initMotion(ui.root);
dialog = initContrastDialog(ui, store, pills);
sync = initHashSync(ui, store);
if (loaded.kind === 'error') showToast(ui, loaded.message, undefined, 4000);
dark.addEventListener('change', () => store.invalidate());

const env = browserEnv();
async function copy(hex: string): Promise<void> {
  const path = await copyText(hex, env);
  if (path === 'manual') showManualCopy(ui, hex);
  else showToast(ui, `Copié : ${hex}`, path);
}

exporter = initExportDialog(ui, store.getState, env);
initShare(ui, store.getState, env);
document.getElementById('exportBtn')?.addEventListener('click', () => {
  if (exporter?.isOpen()) {
    dialog?.close(false);
    past?.close(false);
  }
});
for (const id of ['texte-fond', 'texte-surface', 'accent-fond', 'succes-surface', 'alerte-surface', 'accent2-fond'] as const) {
  pills.button(id).addEventListener('click', () => {
    exporter?.close(false);
    past?.close(false);
  });
}

initVision(ui.root, ui.live);
initSheetScroll();
const dock = initDock(ui, store, (hex) => void copy(hex));
initControls(ui, store);

const settings = createHistory(() => localStorage);
past = initHistoryDialog(ui, settings, store, () => (quiet = true));
const dockButton = document.getElementById('histBtn');
dockButton?.addEventListener('click', () => {
  if (past?.isOpen()) {
    exporter?.close(false);
    dialog?.close(false);
  }
});
/** Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (Ctrl+Y): the palette goes back or forward; the mode and Vision stay as they are. */
function step(back: boolean): void {
  const state = back ? undoable.undo() : undoable.redo();
  if (state === null) {
    showToast(ui, back ? 'Rien à annuler' : 'Rien à rétablir');
    return;
  }
  quiet = true;
  showToast(ui, `${back ? 'Annulé' : 'Rétabli'} : ${nameOfState(state)}`);
}

// Touch screens have no Esc key: a tap outside closes the manual copy panel.
document.addEventListener('pointerdown', (e) => {
  if (!ui.manual.hidden && e.target instanceof Node && !ui.manual.contains(e.target)) closeManualCopy(ui);
});

document.addEventListener('keydown', (e) => {
  const intent = keyIntent(factsOf(e));
  if (intent === 'hasard') {
    e.preventDefault();
    runHasard(ui, store);
  } else if (intent === 'lock') {
    const role = dock.targetRole();
    if (role) {
      e.preventDefault();
      store.dispatch(toggleLock(role));
    }
  } else if (intent === 'undo' || intent === 'redo') {
    e.preventDefault();
    step(intent === 'undo');
  } else if (intent === 'escape') {
    if (!closeManualCopy(ui) && !exporter?.close(true) && !past?.close(true)) dialog?.close(true);
  }
});
