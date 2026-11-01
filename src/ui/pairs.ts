import { AA_LARGE, AA_NORMAL, AAA_LARGE, AAA_NORMAL, levels, truncate2 } from '../core/contrast';
import { PAIRS, type PairId, type PairSpec, type Role } from '../palette/roles';
import { fixTarget, planFix } from '../state/fix';
import type { AppState } from '../state/state';
import { ROLE_LABEL } from './labels';

export const fr = (s: string): string => s.replace('.', ',');
/** Display ratio: truncated (never rounded) to 2 decimals, French decimal comma. */
export const shown = (ratio: number): string => fr(truncate2(ratio));
/** Exact ratio to 4 decimals, truncated the same way. */
export const exact4 = (ratio: number): string => fr((Math.floor(ratio * 10000 + 1e-9) / 10000).toFixed(4));

export type LevelRow = { name: string; threshold: number; pass: boolean };

export type FixOffer = { role: Role; from: string; to: string; ratio: number };
export type FixView =
  | { kind: 'none' }
  | { kind: 'fg'; offer: FixOffer }
  | { kind: 'bg'; offer: FixOffer }
  | { kind: 'stuck' };

export type PairView = {
  id: PairId;
  fg: Role;
  bg: Role;
  fgHex: string;
  bgHex: string;
  ratio: number;
  shown: string;
  exact: string;
  /** Level badge of the pill: AAA, AA or Échec (informative pair: OK or Échec). */
  badge: string;
  ok: boolean;
  informational: boolean;
  target: number;
  /** "Texte sur fond". */
  sentence: string;
  ariaLabel: string;
  levels: readonly [LevelRow, LevelRow, LevelRow, LevelRow];
  fix: FixView;
};

export const IMPOSSIBLE_MESSAGE = 'impossible avec ce fond, corriger le fond ?';
export const STUCK_MESSAGE = 'Impossible aussi en corrigeant le fond : change l\'une des deux couleurs à la main.';

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

export function specOf(id: PairId): PairSpec {
  const spec = PAIRS.find((p) => p.id === id);
  if (spec === undefined) throw new Error(`paire inconnue : ${id}`);
  return spec;
}

/** Everything the pills and the dialog show for one pair of the displayed mode. Pure. */
export function pairView(state: AppState, id: PairId): PairView {
  const spec = specOf(id);
  const palette = state.theme[state.mode];
  const report = state.report[state.mode].find((p) => p.id === id);
  if (report === undefined) throw new Error(`rapport manquant : ${id}`);
  const ratio = report.ratio;
  const lv = levels(ratio);
  const ok = report.ok;
  const sentence = `${ROLE_LABEL[spec.fg]} sur ${lower(ROLE_LABEL[spec.bg])}`;
  const badge = spec.informational ? (ok ? 'OK' : 'Échec') : lv.aaa ? 'AAA' : lv.aa ? 'AA' : 'Échec';
  const detail = spec.informational
    ? `indicatif, seuil 3 sur 1, ${ok ? 'atteint' : 'non atteint'}`
    : ok
      ? `niveau ${badge}`
      : 'niveau échec, sous AA, détails et correction';
  let fix: FixView = { kind: 'none' };
  if (!ok) {
    const fg = planFix(state, id, 'fg');
    if (fg.ok) fix = { kind: 'fg', offer: { role: fg.role, from: fg.from, to: fg.to, ratio: fg.ratio } };
    else {
      const bg = planFix(state, id, 'bg');
      fix = bg.ok ? { kind: 'bg', offer: { role: bg.role, from: bg.from, to: bg.to, ratio: bg.ratio } } : { kind: 'stuck' };
    }
  }
  return {
    id,
    fg: spec.fg,
    bg: spec.bg,
    fgHex: palette[spec.fg],
    bgHex: palette[spec.bg],
    ratio,
    shown: shown(ratio),
    exact: exact4(ratio),
    badge,
    ok,
    informational: spec.informational,
    target: fixTarget(id),
    sentence,
    ariaLabel: `${sentence} : ${shown(ratio)} sur 1, ${detail}`,
    levels: [
      { name: 'AA, texte courant', threshold: AA_NORMAL, pass: lv.aa },
      { name: 'AAA, texte courant', threshold: AAA_NORMAL, pass: lv.aaa },
      { name: 'AA, grand texte', threshold: AA_LARGE, pass: lv.aaLarge },
      { name: 'AAA, grand texte', threshold: AAA_LARGE, pass: lv.aaaLarge },
    ],
    fix,
  };
}

const FEMININE: ReadonlySet<Role> = new Set<Role>(['surface', 'alerte']);

/** «Texte corrigé : #AAAAAA → #BBBBBB (verrouillé). 5 sur 5 contrastes AA.» */
export function fixToast(role: Role, from: string, to: string, ok: number, total: number): string {
  const word = FEMININE.has(role) ? 'corrigée' : 'corrigé';
  return `${ROLE_LABEL[role]} ${word} : ${from} → ${to} (verrouillé${FEMININE.has(role) ? 'e' : ''}). ${ok} sur ${total} contrastes AA.`;
}
