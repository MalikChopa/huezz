import { linearToOklab, linearToRgb, oklabToLinear, rgbToLinear } from '../../src/core/color';
import { contrastRatio } from '../../src/core/contrast';
import { formatHex, parseHex } from '../../src/core/hex';

type Lab = { l: number; a: number; b: number };
const toLab = (hex: string): Lab => {
  const rgb = parseHex(hex);
  if (rgb === null) throw new Error(`hex invalide : ${hex}`);
  return linearToOklab(rgbToLinear(rgb));
};
const fromLab = (lab: Lab): string => formatHex(linearToRgb(oklabToLinear(lab)));

/** color-mix(in oklab, A p%, B) = linear interpolation of the two colours in OKLab (opaque colours), then hex. */
export function mixOklab(a: string, p: number, b: string): string {
  const x = toLab(a);
  const y = toLab(b);
  const q = p / 100;
  return fromLab({ l: x.l * q + y.l * (1 - q), a: x.a * q + y.a * (1 - q), b: x.b * q + y.b * (1 - q) });
}

/** color-mix(in srgb, A p%, B): interpolation of the gamma-encoded channels (also what opacity does over an opaque background). */
export function mixSrgb(a: string, p: number, b: string): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (x === null || y === null) throw new Error('hex invalide');
  const q = p / 100;
  return formatHex({ r: x.r * q + y.r * (1 - q), g: x.g * q + y.g * (1 - q), b: x.b * q + y.b * (1 - q) });
}

/** Splits at top-level commas. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Evaluates `#HEX`, `var(--x)` and `color-mix(in oklab|srgb, A p%, B)` (nested) against a variable map. */
export function evalColor(expr: string, vars: ReadonlyMap<string, string>): string {
  const e = expr.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(e)) return e.toUpperCase();
  const v = /^var\((--[\w-]+)\)$/.exec(e);
  if (v !== null) {
    const value = vars.get(v[1] as string);
    if (value === undefined) throw new Error(`variable inconnue ${v[1]}`);
    return evalColor(value, vars);
  }
  const m = /^color-mix\((.*)\)$/s.exec(e);
  if (m !== null) {
    const [space, first, second] = splitArgs(m[1] as string);
    const part = /^(.*)\s+([\d.]+)%$/s.exec(first as string);
    if (space === undefined || first === undefined || second === undefined || part === null) throw new Error(`color-mix non géré : ${e}`);
    const a = evalColor(part[1] as string, vars);
    const b = evalColor(second, vars);
    const p = Number(part[2]);
    if (space === 'in oklab') return mixOklab(a, p, b);
    if (space === 'in srgb') return mixSrgb(a, p, b);
    throw new Error(`espace non géré : ${space}`);
  }
  throw new Error(`expression non gérée : ${e}`);
}

/** Custom properties declared in the `.pal{...}` rule of mockups.css. */
export function palDeclarations(css: string): Map<string, string> {
  const rule = /\.pal\{([^}]*)\}/.exec(css);
  if (rule === null) throw new Error('règle .pal introuvable');
  const out = new Map<string, string>();
  const body = rule[1] as string;
  let depth = 0;
  let cur = '';
  const decls: string[] = [];
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) {
      decls.push(cur);
      cur = '';
    } else cur += ch;
  }
  decls.push(cur);
  for (const d of decls) {
    const i = d.indexOf(':');
    if (i > 0) out.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
  }
  return out;
}

export type Tone = { id: string; what: string; fg: string; bg: string };

/** Small-text tones of the three mock-ups, with their real background (fg / bg are CSS expressions). */
export const TONES: readonly Tone[] = [
  { id: 'muted-fond', what: '.m-links, .m-hero p, .m-apphead small, .m-sec small, .m-dhead small', fg: 'var(--muted)', bg: 'var(--fond)' },
  { id: 'muted-surface', what: '.m-mini small, .m-feat p, .m-item small, .m-kpi small, .m-tabbar span, .m-tr span:first-child, .m-ch-head span', fg: 'var(--muted)', bg: 'var(--surface)' },
  { id: 'texte-fond', what: 'texte on fond (.m-ghost, .m-status, .m-nav)', fg: 'var(--texte)', bg: 'var(--fond)' },
  { id: 'texte-surface', what: 'texte on surface (.m-range, .m-tr, .m-item b, .m-tabbar .on)', fg: 'var(--texte)', bg: 'var(--surface)' },
  { id: 'texte-tint2', what: '.m-tag, .m-chip, .st-wait', fg: 'var(--texte)', bg: 'var(--tint2)' },
  { id: 'ok-ink-fond', what: '.m-ok', fg: 'var(--ok-ink)', bg: 'var(--fond)' },
  { id: 'succes-surface', what: '.m-kpi .up', fg: 'var(--succes)', bg: 'var(--surface)' },
  { id: 'ok-ink-tint-ok', what: '.st-ok', fg: 'var(--ok-ink)', bg: 'var(--tint-ok)' },
  { id: 'alerte-surface', what: '.m-kpi .bad, .m-al', fg: 'var(--alerte)', bg: 'var(--surface)' },
  { id: 'al-ink-tint-al', what: '.m-late, .st-bad', fg: 'var(--al-ink)', bg: 'var(--tint-al)' },
  { id: 'sur-accent-accent', what: '.m-btn, .m-card b', fg: 'var(--sur-accent)', bg: 'var(--accent)' },
  { id: 'soft-accent', what: '.m-card small, .m-card-foot', fg: 'var(--sur-accent-soft)', bg: 'var(--accent)' },
  { id: 'sur-accent2-accent2', what: '.m-avatar', fg: 'var(--sur-accent2)', bg: 'var(--accent2)' },
  { id: 'surface-succes', what: '.m-chk (check mark)', fg: 'var(--surface)', bg: 'var(--succes)' },
];

export function toneRatio(tone: Tone, vars: ReadonlyMap<string, string>): number {
  const r = contrastRatio(evalColor(tone.fg, vars), evalColor(tone.bg, vars));
  if (r === null) throw new Error('ratio nul');
  return r;
}
