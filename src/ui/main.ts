import '../styles/tool.css';
import '../styles/mockups.css';
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
import { factsOf, keyIntent } from './keyboard';
import { createRenderer, fillHarmonies } from './render';
import { initShare } from './share';
import { initSheetScroll } from './sheet';
import { initMotion, kindOf, transition } from './motion';
import { initPills } from './pills';
import { initScene } from './scene';
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
// A valid hash wins over the system theme and the random seed; a bad one leaves a fresh random palette and a message.
const loaded = decodeHash(location.hash);
const store = createStore(loaded.kind === 'ok' ? stateFromShared(loaded.value) : initialState(systemTheme(), randomSeed()), (prev, next) => {
  const update = (): void => {
    renderShell(prev, next);
    announce(prev, next);
    scene.update(next);
    pills.update(next);
    dialog?.update(next);
    exporter?.update(next);
    sync?.write(next);
  };
  const kind = kindOf(prev, next);
  if (kind) transition(ui, kind, next, update);
  else update();
});
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
  if (exporter?.isOpen()) dialog?.close(false);
});
for (const id of ['texte-fond', 'texte-surface', 'accent-fond', 'succes-surface', 'alerte-surface', 'accent2-fond'] as const) {
  pills.button(id).addEventListener('click', () => exporter?.close(false));
}

initVision(ui.root, ui.live);
initSheetScroll();
const dock = initDock(ui, store, (hex) => void copy(hex));
initControls(ui, store);

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
  } else if (intent === 'escape') {
    if (!closeManualCopy(ui) && !exporter?.close(true)) dialog?.close(true);
  }
});
