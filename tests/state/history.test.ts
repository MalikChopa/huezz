import { describe, expect, it } from 'vitest';
import { hasard, initialState, setHarmony, setMode, toggleLock, type AppState } from '../../src/state/state';
import {
  EMPTY, MAX_FAVOURITES, MAX_RECENT, STORAGE_KEY, addRecent, createHistory, entryOf, isFavourite, parse, serialize, toggleFavourite, type Data, type StorageLike,
} from '../../src/state/history';
import { encodeHash, type Shared } from '../../src/state/url';
import { fixedState } from '../fixed-state';

const sharedOf = (s: AppState): Shared => ({ mode: s.mode, harmony: s.harmony, seed: s.seed, locks: s.locks, theme: s.theme });
/** n different palettes (different seeds). */
const palettes = (n: number): Shared[] => Array.from({ length: n }, (_, i) => sharedOf(initialState('light', 1000 + i * 7919)));
const fake = (initial: Record<string, string> = {}): StorageLike & { map: Map<string, string>; writes: number } => {
  const map = new Map(Object.entries(initial));
  const s = {
    map,
    writes: 0,
    getItem: (k: string) => map.get(k) ?? null,
    setItem(k: string, v: string) {
      s.writes++;
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
  return s;
};
const ids = (d: Data): string[] => d.recent.map((e) => e.id);

describe('entries', () => {
  it('the mode, the seed and the locks are not part of the identity; the palette and the harmony are', () => {
    const s = fixedState('light');
    const a = entryOf(sharedOf(s));
    expect(entryOf(sharedOf(setMode('dark')(s))).id).toBe(a.id);
    expect(entryOf(sharedOf(toggleLock('accent')(s))).id).toBe(a.id);
    expect(entryOf({ ...sharedOf(s), seed: 5 }).id).toBe(a.id);
    expect(entryOf(sharedOf(hasard()(s))).id).not.toBe(a.id);
    expect(entryOf(sharedOf(setHarmony('triad')(s))).id).not.toBe(a.id);
  });
  it('is stored as a light link that the real decoder reads back', () => {
    const e = entryOf(sharedOf(setMode('dark')(fixedState('light'))));
    expect(e.hash).toMatch(/^#v=1&m=l&/);
    expect(e.hash).toBe(encodeHash(e.shared));
  });
});

describe('recent list', () => {
  it('a consecutive duplicate is not recorded (same object back)', () => {
    const e = entryOf(palettes(1)[0] as Shared);
    const d = addRecent(EMPTY, e);
    expect(addRecent(d, e)).toBe(d);
    expect(d.recent).toHaveLength(1);
  });
  it('the same colours with other locks refresh the top entry and add no line', () => {
    const s = fixedState('light');
    const d = addRecent(EMPTY, entryOf(sharedOf(s)));
    const locked = addRecent(d, entryOf(sharedOf(toggleLock('accent')(s))));
    expect(locked.recent).toHaveLength(1);
    expect(locked.recent[0]?.shared.locks).toBe(s.locks | (1 << 3));
  });
  it('an older copy moves to the top instead of appearing twice', () => {
    const [a, b, c] = palettes(3).map(entryOf);
    let d = addRecent(addRecent(addRecent(EMPTY, a!), b!), c!);
    d = addRecent(d, a!);
    expect(ids(d)).toEqual([a!.id, c!.id, b!.id]);
  });
  it('keeps the 20 last, the oldest goes', () => {
    const all = palettes(25).map(entryOf);
    const d = all.reduce(addRecent, EMPTY);
    expect(d.recent).toHaveLength(MAX_RECENT);
    expect(d.recent[0]?.id).toBe(all[24]?.id);
    expect(d.recent[19]?.id).toBe(all[5]?.id);
  });
});

describe('favourites', () => {
  it('survive the eviction of the recent list', () => {
    const all = palettes(30).map(entryOf);
    let d = addRecent(EMPTY, all[0]!);
    d = toggleFavourite(d, all[0]!);
    for (const e of all.slice(1)) d = addRecent(d, e);
    expect(d.recent.some((e) => e.id === all[0]!.id)).toBe(false);
    expect(isFavourite(d, all[0]!)).toBe(true);
  });
  it('starring a recent palette keeps it in the recent list; unstarring leaves the recent list alone', () => {
    const e = entryOf(palettes(1)[0] as Shared);
    const d = toggleFavourite(addRecent(EMPTY, e), e);
    expect(d.recent).toHaveLength(1);
    expect(d.fav).toHaveLength(1);
    const back = toggleFavourite(d, e);
    expect(back.fav).toHaveLength(0);
    expect(back.recent).toHaveLength(1);
  });
  it('stops at the cap and never evicts a favourite', () => {
    const all = palettes(MAX_FAVOURITES + 1).map(entryOf);
    const full = all.slice(0, MAX_FAVOURITES).reduce(toggleFavourite, EMPTY);
    expect(full.fav).toHaveLength(MAX_FAVOURITES);
    expect(toggleFavourite(full, all[MAX_FAVOURITES]!)).toBe(full);
    expect(toggleFavourite(full, all[0]!).fav).toHaveLength(MAX_FAVOURITES - 1);
  });
});

describe('reading what storage gives back (untrusted)', () => {
  const good = (n: number): string[] => palettes(n).map((s) => encodeHash(s));
  it('round trip', () => {
    const e = palettes(4).map(entryOf);
    const d: Data = { recent: e.slice(0, 3), fav: e.slice(2) };
    const back = parse(serialize(d));
    expect(back.recent.map((x) => x.hash)).toEqual(d.recent.map((x) => x.hash));
    expect(back.fav.map((x) => x.hash)).toEqual(d.fav.map((x) => x.hash));
  });
  it('empty for null, a number, an object that is not a string, bad JSON, a bare array, null, a string', () => {
    for (const raw of [null, undefined, 5, {}, '', '{', 'not json', '[]', 'null', '"x"', '12', 'true', '{"recent":', '[[[[[[[[[[']) expect(parse(raw), String(raw)).toEqual(EMPTY);
  });
  it('wrong types inside give empty lists, not an error', () => {
    for (const raw of ['{"recent":5,"fav":"x"}', '{"recent":{"a":1},"fav":null}', '{"recent":[1,null,{},[],true],"fav":[["#v=1"]]}', '{"v":"1"}']) expect(parse(raw), raw).toEqual(EMPTY);
  });
  it('drops entries that the link decoder refuses and keeps the good ones in order', () => {
    const g = good(3);
    const bad = ['', '#', 'v=1', '#v=2&m=l', g[0]!.replace('v=1', 'v=1&v=1'), g[0]!.slice(0, -1), g[0]!.replace('&k=00', '&k=ff'), `${g[0]}&x=1&x=2`, 'javascript:alert(1)', '#' + 'a'.repeat(500)];
    const back = parse(JSON.stringify({ recent: [bad[0], g[0], ...bad.slice(1), g[1], g[2]], fav: bad }));
    expect(back.recent.map((e) => e.hash)).toEqual(g.map((h) => entryOf(parse(JSON.stringify({ recent: [h] })).recent[0]!.shared).hash));
    expect(back.fav).toHaveLength(0);
  });
  it('rewrites a link with an unknown extra key or a lower-case colour as the canonical one', () => {
    const [h] = good(1);
    const back = parse(JSON.stringify({ recent: [`${h}&zz=9`, (h as string).toLowerCase().replace('#v=1&m=l', '#v=1&m=l')] }));
    for (const e of back.recent) expect(e.hash).toBe(encodeHash(e.shared));
  });
  it('a 10 000-entry array is cut at the caps and read in bounded work', () => {
    const g = good(30);
    const raw = JSON.stringify({ recent: Array.from({ length: 10000 }, (_, i) => g[i % 30]), fav: Array.from({ length: 10000 }, () => 'x') });
    const t0 = performance.now();
    const back = parse(raw.length > 65536 ? raw : raw);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(back.recent.length).toBeLessThanOrEqual(MAX_RECENT);
    expect(back.fav).toHaveLength(0);
  });
  it('more than 20 valid recent and 200 valid favourites in storage are cut', () => {
    const g = good(260);
    const back = parse(JSON.stringify({ recent: g.slice(0, 100), fav: g }));
    expect(back.recent).toHaveLength(MAX_RECENT);
    expect(back.fav).toHaveLength(MAX_FAVOURITES);
  });
  it('a value above 64 KB is not even parsed', () => {
    expect(parse(JSON.stringify({ recent: good(2), pad: 'x'.repeat(70000) }))).toEqual(EMPTY);
  });
  it('a duplicate inside storage is read once; unknown fields are ignored; no prototype pollution', () => {
    const [h] = good(1);
    const back = parse(`{"recent":["${h}","${h}"],"fav":[],"__proto__":{"polluted":1},"extra":[1]}`);
    expect(back.recent).toHaveLength(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('createHistory with a fake storage', () => {
  it('records, persists and loads again', () => {
    const st = fake();
    const h = createHistory(() => st);
    const [a, b] = palettes(2) as [Shared, Shared];
    h.add(a);
    h.add(b);
    expect(h.toggle(a)).toBe('added');
    expect(h.persisted()).toBe(true);
    expect(st.map.has(STORAGE_KEY)).toBe(true);
    const again = createHistory(() => st);
    expect(again.data().recent.map((e) => e.id)).toEqual([entryOf(b).id, entryOf(a).id]);
    expect(again.data().fav.map((e) => e.id)).toEqual([entryOf(a).id]);
    expect(h.toggle(a)).toBe('removed');
  });
  it('writes nothing when nothing changed (a duplicate)', () => {
    const st = fake();
    const h = createHistory(() => st);
    const [a] = palettes(1) as [Shared];
    h.add(a);
    h.add(a);
    expect(st.writes).toBe(1);
  });
  it('clear empties the lists and removes the key', () => {
    const st = fake();
    const h = createHistory(() => st);
    const [a] = palettes(1) as [Shared];
    h.add(a);
    h.toggle(a);
    h.clear();
    expect(h.data()).toEqual(EMPTY);
    expect(st.map.has(STORAGE_KEY)).toBe(false);
    expect(createHistory(() => st).data()).toEqual(EMPTY);
  });
  it('a corrupted stored value gives an empty list and a working history', () => {
    const h = createHistory(() => fake({ [STORAGE_KEY]: '{"recent":[' }));
    expect(h.data()).toEqual(EMPTY);
    h.add(palettes(1)[0] as Shared);
    expect(h.data().recent).toHaveLength(1);
  });
  it('a storage getter that throws: in memory for the visit, not persisted, no error', () => {
    const h = createHistory(() => {
      throw new Error('SecurityError');
    });
    expect(h.persisted()).toBe(false);
    const [a, b] = palettes(2) as [Shared, Shared];
    h.add(a);
    h.add(b);
    expect(h.toggle(a)).toBe('added');
    expect(h.data().recent).toHaveLength(2);
    expect(() => h.clear()).not.toThrow();
  });
  it('no storage at all (null): same', () => {
    const h = createHistory(() => null);
    h.add(palettes(1)[0] as Shared);
    expect(h.persisted()).toBe(false);
    expect(h.data().recent).toHaveLength(1);
  });
  it('quota exceeded on write: kept in memory, flagged not persisted, and persisted again once a write works', () => {
    const st = fake();
    let full = true;
    const quota: StorageLike = {
      getItem: (k) => st.getItem(k),
      setItem(k, v) {
        if (full) throw new DOMException('quota', 'QuotaExceededError');
        st.setItem(k, v);
      },
      removeItem: (k) => st.removeItem(k),
    };
    const h = createHistory(() => quota);
    const [a, b] = palettes(2) as [Shared, Shared];
    h.add(a);
    expect(h.persisted()).toBe(false);
    expect(h.data().recent).toHaveLength(1);
    full = false;
    h.add(b);
    expect(h.persisted()).toBe(true);
    expect(createHistory(() => st).data().recent).toHaveLength(2);
  });
  it('a getItem that throws on load: empty, not persisted', () => {
    const h = createHistory(() => ({ getItem: () => { throw new Error('x'); }, setItem: () => undefined, removeItem: () => undefined }));
    expect(h.data()).toEqual(EMPTY);
    expect(h.persisted()).toBe(false);
  });
  it('a removeItem that throws on clear does not throw', () => {
    const h = createHistory(() => ({ getItem: () => null, setItem: () => undefined, removeItem: () => { throw new Error('x'); } }));
    expect(() => h.clear()).not.toThrow();
  });
  it('the favourites cap is reported as full', () => {
    const h = createHistory(() => fake());
    for (const s of palettes(MAX_FAVOURITES)) h.toggle(s);
    expect(h.toggle(palettes(MAX_FAVOURITES + 1)[MAX_FAVOURITES] as Shared)).toBe('full');
    expect(h.data().fav).toHaveLength(MAX_FAVOURITES);
  });
});
