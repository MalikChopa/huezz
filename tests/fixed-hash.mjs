// The ONE fixed starting palette of the tests and capture scripts (J9).
// The product opens on a RANDOM palette at every visit; whatever needs the same palette every time loads this link instead.
// It encodes (with the project's own `encodeHash`) what the old fixed first screen was: seed 0x01380f55, complementary harmony,
// light mode, no lock, accent #137A6B. A test (tests/state/fixed.test.ts) proves the constant is still what the generator gives.
export const FIXED_SEED = 0x01380f55;
export const FIXED_HASH = '#v=1&m=l&h=co&s=01380f55&k=00&l=E7F2EFF7FBFA071916137A6B845060206720B01F29&d=060E0D0F1917E1E9E76EBCADC792A179CF8DEE7063';
export const FIXED_HASH_DARK = FIXED_HASH.replace('&m=l&', '&m=d&');
/** The fixed link that goes with a system colour scheme (the link's mode wins over the system theme, so dark systems get the dark link). */
export const fixedHashFor = (scheme) => (scheme === 'dark' ? FIXED_HASH_DARK : FIXED_HASH);
