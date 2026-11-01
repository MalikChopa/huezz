import type { Harmony } from '../src/core/harmony';
import type { Mode } from '../src/palette/roles';
import { initialState, type AppState } from '../src/state/state';
import { FIXED_SEED } from './fixed-hash.mjs';

export { FIXED_HASH, FIXED_HASH_DARK, FIXED_SEED } from './fixed-hash.mjs';

/** The fixed starting state of the unit tests (seed 0x01380f55, complementary, no lock): what the first screen used to be. */
export const fixedState = (mode: Mode = 'light', harmony: Harmony = 'complementary'): AppState => initialState(mode, FIXED_SEED, harmony);
