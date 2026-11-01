import { HARMONIES, type Harmony } from '../core/harmony';
import { formatHex, parseHex } from '../core/hex';
import { hexToSeed, seedToHex } from '../core/random';
import { ROLES, type LockMask, type Mode, type Palette, type ThemeColors } from '../palette/roles';

/** Longest hash read; the v1 link is 119 characters. */
export const MAX_HASH_LENGTH = 256;

const HARMONY_CODE: Readonly<Record<Harmony, string>> = {
  complementary: 'co',
  analogous: 'an',
  triad: 'tr',
  tetrad: 'te',
  monochrome: 'mo',
  'split-complementary': 'sp',
};

export type Shared = { readonly mode: Mode; readonly harmony: Harmony; readonly seed: number; readonly locks: LockMask; readonly theme: ThemeColors };

export type DecodeError = 'too-long' | 'syntax' | 'duplicate' | 'newer' | 'invalid';
export type DecodeResult = { kind: 'none' } | { kind: 'ok'; value: Shared } | { kind: 'error'; reason: DecodeError; message: string };

const INVALID = 'Lien invalide : une palette neuve est affichée.';
export const MESSAGES: Readonly<Record<DecodeError, string>> = {
  'too-long': INVALID,
  syntax: INVALID,
  duplicate: INVALID,
  newer: 'Ce lien vient d\'une version plus récente de Huezz : une palette neuve est affichée.',
  invalid: INVALID,
};

const join = (palette: Palette): string => ROLES.map((role) => palette[role].slice(1)).join('');

/** `#v=1&m=l&h=co&s=<8 hex>&k=<2 hex>&l=<42 hex>&d=<42 hex>`: the 14 colours are stored as they are. */
export function encodeHash(s: Shared): string {
  const mask = (s.locks & 0x7f).toString(16).padStart(2, '0');
  return `#v=1&m=${s.mode === 'light' ? 'l' : 'd'}&h=${HARMONY_CODE[s.harmony]}&s=${seedToHex(s.seed)}&k=${mask}&l=${join(s.theme.light)}&d=${join(s.theme.dark)}`;
}

const fail = (reason: DecodeError): DecodeResult => ({ kind: 'error', reason, message: MESSAGES[reason] });

const KEY = /^[A-Za-z0-9_]{1,16}$/;
const VERSION = /^(?:0|[1-9][0-9]{0,2})$/;
const MODE = /^[ld]$/;
const SEED = /^[0-9a-f]{8}$/;
const MASK = /^[0-7][0-9a-f]$/;
const COLOURS = /^[0-9A-F]{42}$/;

function palette(digits: string): Palette | null {
  const out: Record<string, string> = {};
  for (const [i, role] of ROLES.entries()) {
    const rgb = parseHex(`#${digits.slice(i * 6, i * 6 + 6)}`);
    if (rgb === null) return null;
    out[role] = formatHex(rgb);
  }
  return out as Palette;
}

/**
 * Strict, all or nothing. No `%` decoding, no unbounded pattern, pairs in a Map (no prototype pollution),
 * a repeated key (known or not) rejects the link, an unknown key (unique) is ignored. Never throws.
 */
export function decodeHash(hash: string): DecodeResult {
  if (hash === '' || hash === '#') return { kind: 'none' };
  if (hash.length > MAX_HASH_LENGTH) return fail('too-long');
  if (!hash.startsWith('#')) return fail('syntax');
  const pairs = new Map<string, string>();
  for (const part of hash.slice(1).split('&')) {
    const eq = part.indexOf('=');
    const key = eq < 0 ? '' : part.slice(0, eq);
    if (!KEY.test(key)) return fail('syntax');
    if (pairs.has(key)) return fail('duplicate');
    pairs.set(key, part.slice(eq + 1));
  }
  const v = pairs.get('v');
  if (v === undefined || !VERSION.test(v) || Number(v) === 0) return fail('invalid');
  if (Number(v) > 1) return fail('newer');
  const m = pairs.get('m');
  const h = pairs.get('h');
  const s = pairs.get('s');
  const k = pairs.get('k');
  const l = pairs.get('l');
  const d = pairs.get('d');
  if (m === undefined || h === undefined || s === undefined || k === undefined || l === undefined || d === undefined) return fail('invalid');
  const harmony = HARMONIES.find((x) => HARMONY_CODE[x] === h);
  const seed = SEED.test(s) ? hexToSeed(s) : null;
  if (!MODE.test(m) || harmony === undefined || seed === null || !MASK.test(k) || !COLOURS.test(l) || !COLOURS.test(d)) return fail('invalid');
  const light = palette(l);
  const dark = palette(d);
  if (light === null || dark === null) return fail('invalid');
  return { kind: 'ok', value: { mode: m === 'l' ? 'light' : 'dark', harmony, seed, locks: parseInt(k, 16), theme: { light, dark } } };
}
