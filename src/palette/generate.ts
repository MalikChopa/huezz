import { normalizeHue, toOklch, type Oklch } from '../core/color';
import { fromOklch, maxChroma } from '../core/gamut';
import { HARMONY_OFFSETS, harmonyHues, type Harmony } from '../core/harmony';
import { formatHex, parseHex } from '../core/hex';
import { mulberry32, randomRange, randomSigned, randomSign } from '../core/random';
import {
  ROLES,
  isLocked,
  type LockMask,
  type Mode,
  type Palette,
  type Role,
  type ThemeColors,
  type ThemeReport,
} from './roles';
import {
  ACCENT_CHROMA_CAP,
  SUCCES_L_MAX,
  deriveDark,
  ensureTheme,
  neutralChroma,
  onAccent,
  paramsToPalette,
  type Params,
} from './theme';

export type GenerateInput = {
  /** User-typed accent (light mode). Used exactly: never moved, even if it fails a pair. */
  base?: string;
  harmony: Harmony;
  /** uint32. Space bar: seed <- next(seed), then generate again. */
  seed: number;
  locks: LockMask;
  /**
   * Current colours. A locked role keeps its two hex from here (a lock bit without a valid
   * previous hex is ignored: the role is free).
   */
  previous?: ThemeColors;
  /**
   * Hook for the future image extraction (post-MVP): OKLCH colours that will seed the base and the roles.
   * Accepted from J2, unused for now.
   */
  preset?: readonly Oklch[];
};

export type GenerateResult = ThemeColors & {
  report: ThemeReport;
  /** Pure black or pure white to put on the accent, per mode. */
  onAccent: Readonly<Record<Mode, '#000000' | '#FFFFFF'>>;
};

export const LIGHT_L = { fond: 0.965, surface: 0.995, texte: 0.2 } as const;
/**
 * Light status colours (research 2): base L / c / h, allowed hue range [lo, hi], largest pull toward a harmony
 * hue, chroma cap as a share of the gamut maximum at (L, h), and an L ceiling (success must keep 4.5:1 on the surface).
 */
export const STATUS = {
  succes: { l: 0.52, lMax: SUCCES_L_MAX, c: 0.13, h: 153, lo: 142, hi: 165, pull: 10, cap: 0.9 },
  alerte: { l: 0.48, lMax: 1, c: 0.17, h: 29, lo: 22, hi: 35, pull: 5, cap: 0.95 },
} as const;
export const ACCENT_DRAW = { l: [0.48, 0.54], c: [0.09, 0.16] } as const;
/** The drawn accent chroma never exceeds this share of the gamut maximum at (L, h). */
export const ACCENT2 = { cf: 0.75, dl: 0.04 } as const;
/** Minimum dE OK between fond and surface (with a margin of 0.004 over the research's 0.03 / 0.04 for hex rounding). */
export const NEUTRAL_GAP = { light: 0.034, dark: 0.044 } as const;
export const FOND_L_LIGHT = [0.945, 0.98] as const;
export const SHIFT_L = 0.02;
export const SHIFT_C = 0.1;
export const ACCENT2_MONO = { dl: 0.15, cf: 0.6 } as const;

/** Surface above fond by at least `gap` in L: the free role moves (surface up first, then fond down). */
function spreadNeutrals(
  fond: number,
  surface: number,
  gap: number,
  free: { fond: boolean; surface: boolean },
): { fond: number; surface: number } {
  let f = fond;
  let s = surface;
  if (s - f >= gap) return { fond: f, surface: s };
  if (free.surface) s = Math.min(1, f + gap);
  if (free.fond && s - f < gap) f = s - gap;
  return { fond: f, surface: s };
}

const SHIFTED = ['fond', 'surface', 'texte', 'accent2', 'succes', 'alerte'] as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Signed shortest angular distance from a to b, in (-180, 180]. */
function angleDiff(a: number, b: number): number {
  const d = normalizeHue(b - a);
  return d > 180 ? d - 360 : d;
}

/** Hue nominal, pulled by at most STATUS[role].pull degrees toward the nearest harmony hue, kept inside [lo, hi]. */
function statusHue(role: 'succes' | 'alerte', hues: readonly number[]): number {
  const s = STATUS[role];
  let pull = 0;
  let nearest = Infinity;
  for (const hue of hues) {
    const d = angleDiff(s.h, hue);
    if (Math.abs(d) < nearest) {
      nearest = Math.abs(d);
      pull = clamp(d, -s.pull, s.pull);
    }
  }
  return clamp(s.h + pull, s.lo, s.hi);
}

function validHex(hex: string | undefined): string | null {
  if (hex === undefined) return null;
  const rgb = parseHex(hex);
  return rgb === null ? null : formatHex(rgb);
}

/**
 * Pure. All randomness comes from `seed`; the draws are always consumed in the same order, so locking
 * a role never changes what the others get.
 */
export function generate(input: GenerateInput): GenerateResult {
  const { light, dark, fixed } = plan(input);
  const { theme, report } = ensureTheme({ light, dark }, fixed, input.harmony === 'monochrome');
  const frozen = (p: Palette): Palette => Object.freeze({ ...p });
  return {
    light: frozen(theme.light),
    dark: frozen(theme.dark),
    report,
    onAccent: { light: onAccent(theme.light.accent), dark: onAccent(theme.dark.accent) },
  };
}

/** The colours before ensure(): the §4 table, shifts, locks and typed base applied. Exported for tests. */
export function plan(input: GenerateInput): { light: Palette; dark: Palette; fixed: Record<Mode, ReadonlySet<Role>> } {
  const { harmony, previous } = input;
  const rng = mulberry32(input.seed);

  const drawnL = randomRange(rng, ACCENT_DRAW.l[0], ACCENT_DRAW.l[1]);
  const rawC = randomRange(rng, ACCENT_DRAW.c[0], ACCENT_DRAW.c[1]);
  const drawnH = randomRange(rng, 0, 360);
  const drawnC = Math.min(rawC, ACCENT_CHROMA_CAP * maxChroma(drawnL, drawnH));
  const sign = randomSign(rng);
  const dL = {} as Record<Role, number>;
  const cF = {} as Record<Role, number>;
  for (const role of ROLES) {
    dL[role] = 0;
    cF[role] = 1;
  }
  for (const role of SHIFTED) {
    dL[role] = randomSigned(rng) * SHIFT_L;
    cF[role] = 1 + randomSigned(rng) * SHIFT_C;
  }
  const accent2Sign = randomSign(rng);

  const kept = {} as Partial<Record<Role, { light: string; dark: string }>>;
  if (previous !== undefined) {
    for (const role of ROLES) {
      if (!isLocked(input.locks, role)) continue;
      const light = validHex(previous.light[role]);
      const dark = validHex(previous.dark[role]);
      if (light !== null && dark !== null) kept[role] = { light, dark };
    }
  }

  const base = validHex(input.base);
  const accentKept = kept.accent;
  const accentHex = accentKept?.light ?? base ?? fromOklch({ l: drawnL, c: drawnC, h: drawnH });
  const acc = toOklch(accentHex) as Oklch;

  let accent2: Oklch;
  if (harmony === 'monochrome') {
    accent2 = { l: acc.l + ACCENT2_MONO.dl, c: acc.c * ACCENT2_MONO.cf, h: acc.h };
  } else {
    const first = HARMONY_OFFSETS[harmony][0] as number;
    const offset = harmony === 'analogous' ? sign * Math.abs(first) : first;
    accent2 = { l: acc.l + accent2Sign * ACCENT2.dl, c: acc.c * ACCENT2.cf, h: normalizeHue(acc.h + offset) };
  }

  const hues = harmonyHues(acc.h, harmony);
  const shifted = (role: Role, p: Oklch): Oklch => ({ l: clamp(p.l + dL[role], 0, 1), c: p.c * cF[role], h: p.h });
  const neutral = (role: 'fond' | 'surface' | 'texte'): Oklch => ({
    l: clamp(LIGHT_L[role] + dL[role], 0, 1),
    c: neutralChroma(role, acc.c, 'light') * Math.min(1, cF[role]),
    h: acc.h,
  });
  const status = (role: 'succes' | 'alerte'): Oklch => {
    const s = STATUS[role];
    const l = clamp(Math.min(s.lMax, s.l + dL[role]), 0, 1);
    const h = statusHue(role, hues);
    return { l, c: Math.min(s.c * cF[role], s.cap * maxChroma(l, h)), h };
  };
  const lightParams: Params = {
    fond: neutral('fond'),
    surface: neutral('surface'),
    texte: neutral('texte'),
    accent: acc,
    accent2: shifted('accent2', accent2),
    succes: status('succes'),
    alerte: status('alerte'),
  };
  const darkRaw = deriveDark(lightParams, acc.c, dL, cF);

  // fond/surface keep the research's dE minimum whatever the drawn shifts. Computed on the drawn values only
  // (never on locked ones) so that locking colours generated by the same seed changes nothing; a locked
  // neighbour is handled afterwards by separate().
  const spread = (mode: Mode, params: Params): Params => {
    const fondL = mode === 'light' ? clamp(params.fond.l, FOND_L_LIGHT[0], FOND_L_LIGHT[1]) : params.fond.l;
    const r = spreadNeutrals(fondL, params.surface.l, NEUTRAL_GAP[mode], { fond: true, surface: true });
    return { ...params, fond: { ...params.fond, l: r.fond }, surface: { ...params.surface, l: r.surface } };
  };
  const lightFinal = spread('light', lightParams);
  const darkParams = spread('dark', darkRaw);

  const light: Record<Role, string> = { ...paramsToPalette(lightFinal), accent: accentHex };
  const dark: Record<Role, string> = paramsToPalette(darkParams);
  const fixedLight = new Set<Role>();
  const fixedDark = new Set<Role>();
  for (const role of ROLES) {
    const k = kept[role];
    if (k === undefined) continue;
    light[role] = k.light;
    dark[role] = k.dark;
    fixedLight.add(role);
    fixedDark.add(role);
  }
  if (accentKept === undefined && base !== null) fixedLight.add('accent');

  return { light, dark, fixed: { light: fixedLight, dark: fixedDark } };
}
