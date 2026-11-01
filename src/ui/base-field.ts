import { formatHex, parseHex } from '../core/hex';

export const INVALID_MESSAGE = 'Code invalide : attendu #RRGGBB ou #RGB.';
export const TOO_LONG_MESSAGE = 'Code hex trop long : 6 chiffres attendus';

export type HexCheck = { ok: true; hex: string } | { ok: false; message: string };

/**
 * What the hex field does with what was typed or pasted: surrounding spaces are dropped, the leading `#` is optional,
 * `#RGB` is expanded. More than 6 digits is an error of its own (the value is never cut short).
 */
export function checkHex(raw: string): HexCheck {
  const text = raw.trim();
  const digits = text.startsWith('#') ? text.slice(1) : text;
  if (digits.length > 6) return { ok: false, message: TOO_LONG_MESSAGE };
  const rgb = parseHex(text);
  return rgb === null ? { ok: false, message: INVALID_MESSAGE } : { ok: true, hex: formatHex(rgb) };
}
