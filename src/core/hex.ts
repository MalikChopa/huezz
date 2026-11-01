export type Rgb = { r: number; g: number; b: number };

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function parseHex(input: string): Rgb | null {
  const m = HEX_RE.exec(input);
  const digits = m?.[1];
  if (digits === undefined) return null;
  const full = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function formatHex({ r, g, b }: Rgb): string {
  const h = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
