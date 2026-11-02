import { decodeHash, encodeHash, type Shared } from './url';

/** The one `localStorage` key of the page (this feature only). */
export const STORAGE_KEY = 'huezz.history.v1';
export const MAX_RECENT = 20;
export const MAX_FAVOURITES = 200;
/** Anything longer is not ours (20 + 200 links of 120 characters is about 28 000). */
const MAX_RAW = 65536;
/** Entries examined per list, so a hostile array of a million items costs a bounded time. */
const MAX_SCAN = 1000;

/** A stored palette: its link (mode forced to light), the decoded value and its identity (harmony + 14 colours: not the mode, the seed or the locks). */
export type Entry = { readonly hash: string; readonly id: string; readonly shared: Shared };
export type Data = { readonly recent: readonly Entry[]; readonly fav: readonly Entry[] };
export const EMPTY: Data = { recent: [], fav: [] };

const asLight = (s: Shared): Shared => ({ ...s, mode: 'light' });

export function entryOf(s: Shared): Entry {
  const shared = asLight(s);
  return { hash: encodeHash(shared), id: encodeHash({ ...shared, seed: 0, locks: 0 }), shared };
}

/** Untrusted text from storage: only what the real link decoder accepts becomes an entry, rewritten by the encoder. */
function entryFromHash(value: unknown): Entry | null {
  if (typeof value !== 'string') return null;
  const decoded = decodeHash(value);
  return decoded.kind === 'ok' ? entryOf(decoded.value) : null;
}

function list(value: unknown, cap: number): Entry[] {
  const out: Entry[] = [];
  if (!Array.isArray(value)) return out;
  const seen = new Set<string>();
  for (let i = 0; i < Math.min(value.length, MAX_SCAN) && out.length < cap; i++) {
    const entry = entryFromHash(value[i]);
    if (entry === null || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

/** Never throws; anything that is not `{ v: 1, recent: [...], fav: [...] }` of valid links gives an empty list (unknown fields are ignored). */
export function parse(raw: unknown): Data {
  if (typeof raw !== 'string' || raw.length > MAX_RAW) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return EMPTY;
    const o = value as Record<string, unknown>;
    return { recent: list(o.recent, MAX_RECENT), fav: list(o.fav, MAX_FAVOURITES) };
  } catch {
    return EMPTY;
  }
}

export const serialize = (d: Data): string => JSON.stringify({ v: 1, recent: d.recent.map((e) => e.hash), fav: d.fav.map((e) => e.hash) });

/** The same palette as the latest one refreshes it (its locks may have changed) and adds nothing; an older copy moves up; the oldest beyond 20 goes. */
export function addRecent(d: Data, e: Entry): Data {
  const top = d.recent[0];
  if (top !== undefined && top.id === e.id) return top.hash === e.hash ? d : { ...d, recent: [e, ...d.recent.slice(1)] };
  return { ...d, recent: [e, ...d.recent.filter((x) => x.id !== e.id)].slice(0, MAX_RECENT) };
}

export const isFavourite = (d: Data, e: Entry): boolean => d.fav.some((x) => x.id === e.id);

/** Stars or unstars; a full list refuses a new star (a favourite is never evicted). Unstarring leaves the recent list as it is. */
export function toggleFavourite(d: Data, e: Entry): Data {
  if (isFavourite(d, e)) return { ...d, fav: d.fav.filter((x) => x.id !== e.id) };
  return d.fav.length >= MAX_FAVOURITES ? d : { ...d, fav: [e, ...d.fav] };
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type History = {
  data(): Data;
  add(shared: Shared): void;
  toggle(shared: Shared): 'added' | 'removed' | 'full';
  clear(): void;
  /** False when nothing could be kept on this device (storage blocked or full): the lists then live in memory for the visit. */
  persisted(): boolean;
};

/** `open` returns the storage, or null; it may throw (blocked storage): the lists then stay in memory. Nothing here ever throws. */
export function createHistory(open: () => StorageLike | null): History {
  let ok = true;
  const storage = (): StorageLike | null => {
    try {
      return open();
    } catch {
      return null;
    }
  };
  let data: Data = EMPTY;
  const first = storage();
  if (first === null) ok = false;
  else {
    try {
      data = parse(first.getItem(STORAGE_KEY));
    } catch {
      ok = false;
    }
  }
  const save = (): void => {
    const s = storage();
    try {
      if (s === null) throw new Error('storage');
      s.setItem(STORAGE_KEY, serialize(data));
      ok = true;
    } catch {
      ok = false;
    }
  };
  const set = (next: Data): void => {
    if (next === data) return;
    data = next;
    save();
  };
  return {
    data: () => data,
    add: (shared) => set(addRecent(data, entryOf(shared))),
    toggle(shared) {
      const e = entryOf(shared);
      const had = isFavourite(data, e);
      set(toggleFavourite(data, e));
      return had ? 'removed' : isFavourite(data, e) ? 'added' : 'full';
    },
    clear() {
      data = EMPTY;
      const s = storage();
      try {
        s?.removeItem(STORAGE_KEY);
      } catch {
        ok = false;
      }
    },
    persisted: () => ok,
  };
}
