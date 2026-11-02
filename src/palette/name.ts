import { toOklch } from '../core/color';
import type { Mode, Palette } from './roles';

/** Hue words (masculine form), one per 22.5 degree sector of the OKLCH hue circle, sector 0 centred on 0 degrees; the last one is for greys. */
export const HUE_WORDS = 'rosé,écarlate,corail,cuivré,ambré,doré,mousse,jade,turquoise,azuré,céruléen,outremer,indigo,violacé,mauve,fuchsia,neutre'.split(',');

/**
 * Nouns, 6 rows (mode x lightness class), 8 per row: 4 chroma classes (soft to vivid) for a faintly tinted background, then the same for a plainly tinted one.
 * The first letter is the gender (f or m).
 */
export const NOUN_ROWS: readonly (readonly string[])[] = [
  // light mode: deep, mid, pale accent
  'fArdoise,fEncre,mBasalte,mCorbeau,fSuie,mCuir,fObsidienne,mCacao',
  'fBrume,fTerre,fToile,mÉclat,mLin,fArgile,mPigment,mCarnaval',
  'mNuage,fCraie,fSoie,fLumière,fMatinée,fPorcelaine,mSorbet,mConfetti',
  // dark mode: deep, mid, pale accent
  'fNuit,mNocturne,mOrage,mÉclair,fCrypte,mGoudron,fBraise,mVolcan',
  'fCendre,mBrouillard,fVeilleuse,fÉtincelle,mÉtain,mBronze,fLueur,mRayon',
  'fLune,fOpale,mNéon,mFluo,mGivre,mCristal,mPrisme,mMirage',
].map((row) => row.split(','));

/** Accent lightness classes (deep, mid, pale), accent chroma classes (4), and the chroma under which a hue means nothing. */
const L_CUTS = [0.45, 0.65] as const;
const C_CUTS = [0.085, 0.105, 0.13] as const;
const GREY = 0.02;
/** A background is "plainly tinted" from this chroma (about the median of generated palettes: light 0.0118, dark 0.0158). */
const TINT_CUT = { light: 0.0118, dark: 0.0158 } as const;

/** Colour adjectives that name a thing (corail, jade, turquoise...) do not change; the others follow the noun. Singular only. */
export function agree(adjective: string, gender: 'f' | 'm'): string {
  if (gender === 'm') return adjective;
  if (adjective.endsWith('é')) return `${adjective}e`;
  if (adjective.endsWith('en')) return `${adjective}ne`;
  return adjective;
}

const classOf = (value: number, cuts: readonly number[]): number => cuts.filter((cut) => value >= cut).length;

/**
 * French two-word name of a palette (noun + adjective, e.g. «Brume dorée»), pure and deterministic.
 * Noun: displayed mode, lightness, chroma and background tint of the accent / fond. Adjective: hue sector of the accent (grey if almost no chroma).
 * `mode` defaults to the lightness of the fond. Always non-empty, even for an invalid hex.
 */
export function paletteName(palette: Pick<Palette, 'accent' | 'fond'>, mode?: Mode): string {
  const accent = toOklch(palette.accent);
  const fond = toOklch(palette.fond);
  if (accent === null || fond === null) return 'Palette neutre';
  const dark = (mode ?? (fond.l < 0.5 ? 'dark' : 'light')) === 'dark';
  const row = NOUN_ROWS[(dark ? 3 : 0) + classOf(accent.l, L_CUTS)] as string[];
  const tinted = fond.c >= TINT_CUT[dark ? 'dark' : 'light'] ? 4 : 0;
  const noun = row[tinted + classOf(accent.c, C_CUTS)] as string;
  const hue = HUE_WORDS[accent.c < GREY ? 16 : Math.floor(((accent.h + 11.25) % 360) / 22.5)] as string;
  return `${noun.slice(1)} ${agree(hue, noun[0] === 'f' ? 'f' : 'm')}`;
}
