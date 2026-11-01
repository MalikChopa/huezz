import { toOklch, type Oklch } from '../core/color';
import { contrastRatio, fixContrast } from '../core/contrast';
import { CVD_KINDS, cvdDeltaE } from '../core/cvd';
import { deltaEOK } from '../core/deltaE';
import { fromOklch, maxChroma } from '../core/gamut';
import {
  PAIRS,
  ROLES,
  type Mode,
  type Palette,
  type PairReport,
  type PairSpec,
  type Role,
  type ThemeColors,
  type ThemeReport,
} from './roles';

/** Per-role OKLCH starting values of one mode, before ensure(). */
export type Params = Readonly<Record<Role, Oklch>>;

export const DARK_L = { fond: 0.17, surface: 0.22, texte: 0.93 } as const;
/**
 * Dark status colours (research 2): L, c (capped to `cap` x the gamut maximum), and the hue of the light role
 * clamped to [lo, hi]. The small L shift drawn for the role still applies.
 */
export const DARK_STATUS = {
  succes: { l: 0.8, c: 0.13, lo: 150, hi: 155, cap: 0.9 },
  alerte: { l: 0.7, c: 0.15, lo: 28, hi: 30, cap: 0.95 },
} as const;
/** Light success never gets lighter than this (research 2: 4.5:1 on the surface). */
export const SUCCES_L_MAX = 0.52;
export const DARK_ACCENT_SHIFT = 0.22;
export const DARK_ACCENT_BOUNDS = [0.68, 0.8] as const;
export const DARK_ACCENT_CHROMA = 0.9;
/** A free accent never sits closer to the gamut edge than this share of the maximum chroma at (L, h). */
export const ACCENT_CHROMA_CAP = 0.95;

/** Chroma ceilings of the neutrals (c = chroma of the accent). Dark ceilings differ from light ones (research 1). */
export function neutralChroma(role: 'fond' | 'surface' | 'texte', accentChroma: number, mode: Mode = 'light'): number {
  if (mode === 'light') {
    if (role === 'fond') return Math.min(0.012, 0.15 * accentChroma);
    if (role === 'surface') return Math.min(0.005, 0.1 * accentChroma);
    return Math.min(0.03, 0.3 * accentChroma);
  }
  if (role === 'fond') return Math.min(0.02, 0.15 * accentChroma);
  if (role === 'surface') return Math.min(0.025, 0.18 * accentChroma);
  return Math.min(0.012, 0.1 * accentChroma);
}

/**
 * Dark values from the same hues. lightParams carry the (already shifted) light roles; dShift[role] is the
 * small L shift drawn for that role, reused in dark so a role moves coherently in both modes. cShift is the
 * drawn chroma factor of the neutrals (only a reduction applies, so the dark ceilings hold).
 */
export function deriveDark(
  light: Params,
  accentChroma: number,
  dShift: Readonly<Record<Role, number>>,
  cShift: Readonly<Partial<Record<Role, number>>> = {},
): Params {
  const accentLike = (role: 'accent' | 'accent2'): Oklch => {
    const p = light[role];
    const l = Math.min(DARK_ACCENT_BOUNDS[1], Math.max(DARK_ACCENT_BOUNDS[0], p.l + DARK_ACCENT_SHIFT));
    const c = p.c * DARK_ACCENT_CHROMA;
    return { l, c: role === 'accent' ? Math.min(c, ACCENT_CHROMA_CAP * maxChroma(l, p.h)) : c, h: p.h };
  };
  const neutral = (role: 'fond' | 'surface' | 'texte'): Oklch => ({
    l: clamp01(DARK_L[role] + dShift[role]),
    c: neutralChroma(role, accentChroma, 'dark') * Math.min(1, cShift[role] ?? 1),
    h: light[role].h,
  });
  const status = (role: 'succes' | 'alerte'): Oklch => {
    const d = DARK_STATUS[role];
    const l = clamp01(d.l + dShift[role]);
    const h = Math.min(d.hi, Math.max(d.lo, light[role].h));
    return { l, c: Math.min(d.c * (cShift[role] ?? 1), d.cap * maxChroma(l, h)), h };
  };
  return {
    fond: neutral('fond'),
    surface: neutral('surface'),
    texte: neutral('texte'),
    accent: accentLike('accent'),
    accent2: accentLike('accent2'),
    succes: status('succes'),
    alerte: status('alerte'),
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function paramsToPalette(p: Params): Palette {
  const out = {} as Record<Role, string>;
  for (const role of ROLES) out[role] = fromOklch(p[role]);
  return out;
}

const ratio = (a: string, b: string): number => contrastRatio(a, b) as number;

type Partner = { hex: string; ladder: readonly number[] };

/** Moves a free background toward a fixed foreground: first ladder target reachable, else the best reachable. */
function moveBackground(free: string, fixed: string, ladder: readonly number[]): string {
  let last = free;
  for (const target of ladder) {
    const r = fixContrast(free, fixed, target);
    if (r.ok) return r.hex;
    if (r.best !== null) last = r.best.hex;
  }
  return last;
}

/**
 * Moves a free foreground against its (unmoving) backgrounds. For each ladder level, up to 4 passes of
 * fixContrast on every partner; the first level where all partners hold wins. Otherwise: whichever of
 * the original, L = 0 or L = 1 maximises the worst ratio (the pairs are then reported failing).
 */
function settle(start: string, partners: readonly Partner[]): string {
  const levels = Math.max(...partners.map((p) => p.ladder.length));
  const targetAt = (p: Partner, k: number): number => p.ladder[Math.min(k, p.ladder.length - 1)] as number;
  for (let k = 0; k < levels; k++) {
    let cur = start;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      let failed = false;
      for (const p of partners) {
        const r = fixContrast(cur, p.hex, targetAt(p, k));
        if (!r.ok) failed = true;
        else if (r.hex !== cur) {
          cur = r.hex;
          moved = true;
        }
      }
      if (failed) break;
      if (!moved) return cur;
    }
    if (partners.every((p) => ratio(cur, p.hex) >= targetAt(p, k))) return cur;
  }
  const o = toOklch(start);
  const candidates = [start];
  if (o !== null) candidates.push(fromOklch({ ...o, l: 0 }), fromOklch({ ...o, l: 1 }));
  const worst = (hex: string): number => Math.min(...partners.map((p) => ratio(hex, p.hex)));
  let best = start;
  for (const c of candidates) if (worst(c) > worst(best)) best = c;
  return best;
}

/** Moving L at constant chroma can put the accent past the cap: reduce c, then settle again (up to 4 rounds). */
function capAccent(start: string, partners: readonly Partner[]): string {
  let cur = start;
  for (let i = 0; i < 4; i++) {
    const o = toOklch(cur) as Oklch;
    const cap = ACCENT_CHROMA_CAP * maxChroma(o.l, o.h);
    if (o.c <= cap) return cur;
    cur = settle(fromOklch({ ...o, c: cap }), partners);
  }
  return cur;
}

/**
 * AA by construction on one mode. `fixed` roles (locked, or the typed base in light) are never changed.
 * Only the free member of a pair moves:
 *  - a free background moves only for a fixed texte (the primary readability pair);
 *  - a free foreground moves against its backgrounds.
 * A pair that cannot reach its target is left as is and shows up with ok:false in the report.
 */
export function ensure(palette: Palette, fixed: ReadonlySet<Role>): Palette {
  const out: Record<Role, string> = { ...palette };
  if (fixed.has('texte')) {
    for (const bg of ['fond', 'surface'] as const) {
      if (!fixed.has(bg)) out[bg] = moveBackground(out[bg], out.texte, [7, 4.5]);
    }
  }
  for (const fg of ['texte', 'accent', 'accent2', 'succes', 'alerte'] as const) {
    if (fixed.has(fg)) continue;
    const partners = PAIRS.filter((p) => p.fg === fg).map((p) => ({ hex: out[p.bg], ladder: p.ladder }));
    out[fg] = settle(out[fg], partners);
    if (fg === 'accent') out[fg] = capAccent(out[fg], partners);
  }
  return out;
}

export function reportPair(spec: PairSpec, palette: Palette, fixed: ReadonlySet<Role>): PairReport {
  const r = ratio(palette[spec.fg], palette[spec.bg]);
  const met = spec.ladder.find((t) => r >= t);
  return {
    id: spec.id,
    fg: spec.fg,
    bg: spec.bg,
    ratio: r,
    target: met ?? (spec.ladder[spec.ladder.length - 1] as number),
    ok: met !== undefined,
    informational: spec.informational,
    touchesFixed: fixed.has(spec.fg) || fixed.has(spec.bg),
  };
}

export function reportMode(palette: Palette, fixed: ReadonlySet<Role>): PairReport[] {
  return PAIRS.map((spec) => reportPair(spec, palette, fixed));
}

/** Pure black or pure white, whichever contrasts best with the accent (>= 4.58 on any colour). */
export function onAccent(accent: string): '#000000' | '#FFFFFF' {
  return ratio('#000000', accent) >= ratio('#FFFFFF', accent) ? '#000000' : '#FFFFFF';
}

export const DE_ACCENT_MIN = 0.08;
export const DE_NEUTRAL_MIN = { light: 0.03, dark: 0.04 } as const;
const SEPARATE_L_STEPS = [0.05, 0.1, 0.15] as const;
const SEPARATE_C_FACTORS = [1, 1.3, 0.7] as const;

export type Separation = {
  palette: Palette;
  /** Roles whose colour was shifted to reach the minimum dE. */
  moved: Role[];
  /** Pairs still under the minimum (the free role could not be shifted, or no candidate kept its contrast). */
  unresolved: string[];
};

/**
 * dE OK >= 0.08 between the accent and accent2 (not in monochrome), succes and alerte. The free secondary
 * role (never the accent, never a fixed role) is shifted: L by 0.05 first, then its chroma (x1.3, x0.7),
 * then L by 0.10 and 0.15. The contrast-increasing direction (darker in light, lighter in dark) is tried
 * first; a candidate is kept only if it equals no other role and its pairs keep the target they had.
 */
export function separate(palette: Palette, fixed: ReadonlySet<Role>, mode: Mode, monochrome: boolean): Separation {
  const out: Record<Role, string> = { ...palette };
  const moved: Role[] = [];
  const unresolved: string[] = [];
  const others: Role[] = monochrome ? ['succes', 'alerte'] : ['accent2', 'succes', 'alerte'];
  const preferred = mode === 'light' ? -1 : 1;
  if ((deltaEOK(out.fond, out.surface) as number) < DE_NEUTRAL_MIN[mode]) {
    // surface lighter first (free surface), else fond darker (free fond); contrast targets must hold
    const attempt = (role: 'fond' | 'surface', sign: 1 | -1): boolean => {
      if (fixed.has(role)) return false;
      const specs = PAIRS.filter((p) => p.fg === role || p.bg === role);
      const levels = specs.map((p) => {
        const r = ratio(out[p.fg], out[p.bg]);
        return p.ladder.find((t) => r >= t) ?? r;
      });
      const o = toOklch(out[role]) as Oklch;
      for (let i = 1; i <= 40; i++) {
        const hex = fromOklch({ ...o, l: Math.min(1, Math.max(0, o.l + sign * 0.0025 * i)) });
        const other = role === 'fond' ? out.surface : out.fond;
        if (hex === other || (deltaEOK(hex, other) as number) < DE_NEUTRAL_MIN[mode] + 0.002) continue;
        const prev = out[role];
        out[role] = hex;
        if (specs.every((p, k) => ratio(out[p.fg], out[p.bg]) >= (levels[k] as number))) {
          moved.push(role);
          return true;
        }
        out[role] = prev;
      }
      return false;
    };
    if (!attempt('surface', 1) && !attempt('fond', -1)) unresolved.push('fond/surface');
  }
  for (const role of others) {
    if ((deltaEOK(out.accent, out[role]) as number) >= DE_ACCENT_MIN) continue;
    if (fixed.has(role)) {
      unresolved.push(`accent/${role}`);
      continue;
    }
    const specs = PAIRS.filter((p) => p.fg === role);
    const need = specs.map((p) => {
      const r = ratio(out[role], out[p.bg]);
      return p.ladder.find((t) => r >= t) ?? r;
    });
    const o = toOklch(out[role]) as Oklch;
    let found: string | null = null;
    // dark alerte tries darker first (research 2: L <= 0.72), every other role the contrast-increasing direction
    const first = role === 'alerte' && mode === 'dark' ? -1 : preferred;
    search: for (const d of SEPARATE_L_STEPS) {
      for (const k of SEPARATE_C_FACTORS) {
        for (const sign of [first, -first]) {
          const l = Math.min(1, Math.max(0, o.l + sign * d));
          if (role === 'succes' && mode === 'light' && l > SUCCES_L_MAX) continue;
          const hex = fromOklch({ l, c: o.c * k, h: o.h });
          if ((deltaEOK(out.accent, hex) as number) < DE_ACCENT_MIN) continue;
          if (ROLES.some((other) => other !== role && out[other] === hex)) continue;
          if (specs.some((p, i) => ratio(hex, out[p.bg]) < (need[i] as number))) continue;
          found = hex;
          break search;
        }
      }
    }
    if (found === null) unresolved.push(`accent/${role}`);
    else {
      out[role] = found;
      moved.push(role);
    }
  }
  return { palette: out, moved, unresolved };
}

/** Simulated dE OK between succes and alerte below this is a failure (research 2); the rule aims at CVD_TARGET. */
export const CVD_MIN = 0.03;
export const CVD_TARGET = 0.05;
const CVD_L_STEPS = 15;
const CVD_L_STEP = 0.01;

/** Smaller of the protan and deutan dE OK between succes and alerte. */
export function cvdGap(palette: Palette): number {
  return Math.min(...CVD_KINDS.map((k) => cvdDeltaE(palette.succes, palette.alerte, k) as number));
}

export type CvdSeparation = { palette: Palette; moved: Role[]; unresolved: boolean };

/**
 * Keeps the simulated (protan, deutan) dE OK between succes and alerte at CVD_TARGET when it can. The free role
 * lighter in OKLab L goes lighter and the darker one darker (away from each other); alerte first, then succes.
 * Steps of 0.01 in L (up to 0.15), hue and chroma kept (chroma reduced by the gamut only). A candidate is refused if
 * it equals another role, if one of its contrast pairs falls under the level it had, or if its dE to the accent drops
 * under what it was (capped at DE_ACCENT_MIN). Light success never gets lighter (4.5:1 on the surface).
 * The smallest move reaching the target wins; otherwise the best improving candidate; `unresolved` if still < CVD_MIN.
 */
export function cvdSeparate(palette: Palette, fixed: ReadonlySet<Role>, mode: Mode): CvdSeparation {
  const out: Record<Role, string> = { ...palette };
  const start = cvdGap(out);
  if (start >= CVD_TARGET) return { palette: out, moved: [], unresolved: false };
  const lOf = (hex: string): number => (toOklch(hex) as Oklch).l;
  const sign = (role: 'succes' | 'alerte'): 1 | -1 => {
    const other = role === 'succes' ? 'alerte' : 'succes';
    const d = lOf(out[role]) - lOf(out[other]);
    if (d === 0) return mode === 'light' ? -1 : 1;
    return d > 0 ? 1 : -1;
  };
  let best: { role: 'succes' | 'alerte'; hex: string; gap: number } | null = null;
  for (const role of ['alerte', 'succes'] as const) {
    if (fixed.has(role)) continue;
    const specs = PAIRS.filter((p) => p.fg === role);
    const need = specs.map((p) => {
      const r = ratio(out[role], out[p.bg]);
      return p.ladder.find((t) => r >= t) ?? r;
    });
    const accentNow = deltaEOK(out.accent, out[role]) as number;
    const o = toOklch(out[role]) as Oklch;
    const dir = sign(role);
    for (let i = 1; i <= CVD_L_STEPS; i++) {
      const l = Math.min(1, Math.max(0, o.l + dir * i * CVD_L_STEP));
      if (role === 'succes' && mode === 'light' && l > SUCCES_L_MAX) continue;
      const hex = fromOklch({ ...o, l });
      if (ROLES.some((other) => other !== role && out[other] === hex)) continue;
      if (specs.some((p, k) => ratio(hex, out[p.bg]) < (need[k] as number))) continue;
      if ((deltaEOK(out.accent, hex) as number) < Math.min(DE_ACCENT_MIN, accentNow)) continue;
      const prev = out[role];
      out[role] = hex;
      const gap = cvdGap(out);
      out[role] = prev;
      if (gap >= CVD_TARGET) return { palette: { ...out, [role]: hex }, moved: [role], unresolved: false };
      if (gap > start && (best === null || gap > best.gap)) best = { role, hex, gap };
    }
  }
  if (best === null) return { palette: out, moved: [], unresolved: start < CVD_MIN };
  return { palette: { ...out, [best.role]: best.hex }, moved: [best.role], unresolved: best.gap < CVD_MIN };
}

export function ensureTheme(
  theme: ThemeColors,
  fixed: Readonly<Record<Mode, ReadonlySet<Role>>>,
  monochrome = false,
): { theme: ThemeColors; report: ThemeReport } {
  const finish = (mode: Mode): Palette => {
    const apart = separate(ensure(theme[mode], fixed[mode]), fixed[mode], mode, monochrome).palette;
    return cvdSeparate(apart, fixed[mode], mode).palette;
  };
  const light = finish('light');
  const dark = finish('dark');
  return {
    theme: { light, dark },
    report: { light: reportMode(light, fixed.light), dark: reportMode(dark, fixed.dark) },
  };
}
