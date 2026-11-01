/** What `crypto` must offer here; the real `crypto` fits. */
export type SeedSource = { getRandomValues(array: Uint32Array): Uint32Array };

const TWO_32 = 4294967296;

/**
 * A fresh uint32 seed for the first screen (the product opens on a random palette at every visit).
 * `crypto.getRandomValues` when it exists; only without it (or if it throws) the clock mixed with `Math.random`.
 * The three sources are parameters so that the tests can drive each path; the defaults are the real ones.
 */
export function randomSeed(
  source: SeedSource | null = (globalThis as { crypto?: SeedSource }).crypto ?? null,
  now: () => number = Date.now,
  random: () => number = Math.random,
): number {
  if (source !== null && typeof source.getRandomValues === 'function') {
    try {
      const out = new Uint32Array(1);
      source.getRandomValues(out);
      return (out[0] ?? 0) >>> 0;
    } catch {
      /* fall through to the clock */
    }
  }
  return (((now() >>> 0) ^ Math.imul(Math.floor(random() * TWO_32) >>> 0, 0x9e3779b1)) >>> 0);
}
