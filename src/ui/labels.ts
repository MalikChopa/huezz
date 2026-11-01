import type { Harmony } from '../core/harmony';
import type { Role } from '../palette/roles';

export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  fond: 'Fond',
  surface: 'Surface',
  texte: 'Texte',
  accent: 'Accent',
  accent2: 'Accent secondaire',
  succes: 'Succès',
  alerte: 'Alerte',
};

export const HARMONY_LABEL: Readonly<Record<Harmony, string>> = {
  complementary: 'Complémentaire',
  analogous: 'Analogue',
  triad: 'Triade',
  tetrad: 'Tétrade',
  monochrome: 'Monochrome',
  'split-complementary': 'Split-complémentaire',
};

const FEMININE: ReadonlySet<Role> = new Set<Role>(['surface', 'alerte']);

/** «Fond verrouillé», «Surface déverrouillée»: the sentence of a lock change (polite live region). */
export function lockSentence(role: Role, locked: boolean): string {
  return `${ROLE_LABEL[role]} ${locked ? 'verrouillé' : 'déverrouillé'}${FEMININE.has(role) ? 'e' : ''}`;
}
