export const ROLES = ['fond', 'surface', 'texte', 'accent', 'accent2', 'succes', 'alerte'] as const;
export type Role = (typeof ROLES)[number];

/** One mode: 7 uppercase #RRGGBB. */
export type Palette = Readonly<Record<Role, string>>;
export type Mode = 'light' | 'dark';
export type ThemeColors = { readonly light: Palette; readonly dark: Palette };

/** 7 bits, bit i = ROLES[i] (fond = bit 0 ... alerte = bit 6). */
export type LockMask = number;
export const LOCK_NONE: LockMask = 0;
export const LOCK_ALL: LockMask = (1 << ROLES.length) - 1;

export function normalizeMask(mask: number): LockMask {
  return Number.isFinite(mask) ? Math.trunc(mask) & LOCK_ALL : 0;
}

export function isLocked(mask: LockMask, role: Role): boolean {
  return (normalizeMask(mask) & (1 << ROLES.indexOf(role))) !== 0;
}

export function toggleLock(mask: LockMask, role: Role): LockMask {
  return normalizeMask(mask) ^ (1 << ROLES.indexOf(role));
}

export type PairId = 'texte-fond' | 'texte-surface' | 'accent-fond' | 'succes-surface' | 'alerte-surface' | 'accent2-fond';

export type PairSpec = {
  readonly id: PairId;
  readonly fg: Role;
  readonly bg: Role;
  /** Targets tried in order; the first reachable one is used. If none is reachable the pair is reported failing. */
  readonly ladder: readonly number[];
  /** Shown as informational (accent2/fond): excluded from the "5 of 5" count. */
  readonly informational: boolean;
};

export const PAIRS: readonly PairSpec[] = [
  { id: 'texte-fond', fg: 'texte', bg: 'fond', ladder: [7, 4.5], informational: false },
  { id: 'texte-surface', fg: 'texte', bg: 'surface', ladder: [7, 4.5], informational: false },
  { id: 'accent-fond', fg: 'accent', bg: 'fond', ladder: [4.5], informational: false },
  { id: 'succes-surface', fg: 'succes', bg: 'surface', ladder: [4.5], informational: false },
  { id: 'alerte-surface', fg: 'alerte', bg: 'surface', ladder: [4.5], informational: false },
  { id: 'accent2-fond', fg: 'accent2', bg: 'fond', ladder: [3], informational: true },
];

export type PairReport = {
  readonly id: PairId;
  readonly fg: Role;
  readonly bg: Role;
  /** Exact ratio of the final colours. */
  readonly ratio: number;
  /** Highest ladder target met, else the last (lowest) one, which then failed. */
  readonly target: number;
  readonly ok: boolean;
  readonly informational: boolean;
  /** One member is locked or is the user's typed base: it was never moved. */
  readonly touchesFixed: boolean;
};

export type ThemeReport = { readonly light: readonly PairReport[]; readonly dark: readonly PairReport[] };
