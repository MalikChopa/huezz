import { afterEach, describe, expect, it, vi } from 'vitest';
import { HARMONIES } from '../../src/core/harmony';
import { mulberry32, randomInt } from '../../src/core/random';
import { ROLES } from '../../src/palette/roles';
import { loadShared, stateFromShared } from '../../src/state/share';
import { hasard, setBase, setHarmony, setMode, toggleLock, type Action, type AppState } from '../../src/state/state';
import { fixedState } from '../fixed-state';
import { decodeHash, encodeHash, MAX_HASH_LENGTH, type Shared } from '../../src/state/url';

const sharedOf = (s: AppState): Shared => ({ mode: s.mode, harmony: s.harmony, seed: s.seed, locks: s.locks, theme: s.theme });
const hex14 = (s: { theme: AppState['theme'] }): string[] => (['light', 'dark'] as const).flatMap((m) => ROLES.map((r) => s.theme[m][r]));

describe('v1 hash', () => {
  it('has the documented shape and 119 characters', () => {
    const hash = encodeHash(sharedOf(fixedState('light')));
    expect(hash).toMatch(/^#v=1&m=l&h=co&s=[0-9a-f]{8}&k=[0-7][0-9a-f]&l=[0-9A-F]{42}&d=[0-9A-F]{42}$/);
    expect(hash).toHaveLength(119);
    expect(hash.startsWith('#v=1&m=l&h=co&s=01380f55&k=00&l=E7F2EF')).toBe(true);
  });
  it('codes the 6 harmonies', () => {
    const codes = HARMONIES.map((h) => /&h=([a-z]{2})&/.exec(encodeHash(sharedOf(setHarmony(h)(fixedState('light')))))?.[1]);
    expect(codes).toEqual(['co', 'an', 'tr', 'te', 'mo', 'sp']);
  });
  it('mode d, locks and the mask in 2 hex', () => {
    let s = setMode('dark')(fixedState('light'));
    s = toggleLock('fond')(toggleLock('alerte')(s));
    expect(encodeHash(sharedOf(s))).toMatch(/^#v=1&m=d&h=co&s=[0-9a-f]{8}&k=41&/);
  });
});

describe('round trip on 1 000 generated states', () => {
  it('the 14 colours, mode, harmony, seed and locks come back identical; the hash is canonical', () => {
    const rng = mulberry32(20261101);
    let s = fixedState('light');
    let bad = 0;
    for (let i = 0; i < 1000; i++) {
      const pick = randomInt(rng, 5);
      const actions: Action[] = [hasard(), setHarmony(HARMONIES[randomInt(rng, HARMONIES.length)]!), setMode(i % 2 === 0 ? 'dark' : 'light'), toggleLock(ROLES[randomInt(rng, 7)]!), setBase(`#${(randomInt(rng, 0x1000000)).toString(16).padStart(6, '0')}`)];
      s = actions[pick % actions.length]!(s);
      const hash = encodeHash(sharedOf(s));
      const r = decodeHash(hash);
      if (r.kind !== 'ok') {
        bad++;
        continue;
      }
      expect(hex14({ theme: r.value.theme })).toEqual(hex14(s));
      expect([r.value.mode, r.value.harmony, r.value.seed, r.value.locks]).toEqual([s.mode, s.harmony, s.seed, s.locks]);
      expect(encodeHash(r.value)).toBe(hash);
      expect(hash.length).toBe(119);
      const restored = stateFromShared(r.value);
      expect(hex14(restored)).toEqual(hex14(s));
    }
    expect(bad).toBe(0);
  });
  it('stateFromShared rebuilds the same report as the generator (no lock, no base)', () => {
    const s = hasard()(fixedState('dark'));
    const r = stateFromShared(sharedOf(s));
    expect(JSON.stringify(r.report)).toBe(JSON.stringify(s.report));
    expect(r.onAccent).toEqual(s.onAccent);
  });
  it('loadShared: same link = same object; shuffles are kept; a new link replaces the 14 colours as they are', () => {
    const a = fixedState('light');
    expect(loadShared(sharedOf(a))(a)).toBe(a);
    const b = hasard()(a);
    const loaded = loadShared(sharedOf(b))(a);
    expect(hex14(loaded)).toEqual(hex14(b));
    expect(loaded.shuffles).toBe(a.shuffles);
  });
});

const GOOD = encodeHash(sharedOf(fixedState('light')));
const L = GOOD.slice(GOOD.indexOf('&l=') + 3, GOOD.indexOf('&d='));
const D = GOOD.slice(GOOD.indexOf('&d=') + 3);
const base = (over: Record<string, string> = {}): string => {
  const f: Record<string, string> = { v: '1', m: 'l', h: 'co', s: '9a3c51e2', k: '0c', l: L, d: D, ...over };
  return `#${Object.entries(f).map(([k, v]) => `${k}=${v}`).join('&')}`;
};

describe('30 hostile hashes', () => {
  const HOSTILE: Array<[string, string]> = [
    ['<script>', '#<script>alert(1)</script>'],
    ['<script> dans une valeur', base({ l: '<script>alert(1)</script>0000000000000000' })],
    ['%00 dans une couleur', base({ l: `%00${L.slice(3)}` })],
    ['%00 seul', '#%00'],
    ['plus de 256 caractères (lien valide + clé inconnue longue)', `${base()}&x=${'a'.repeat(200)}`],
    ['10 000 &', `#${'&'.repeat(10_000)}`],
    ['clé en double (connue)', `${base()}&m=d`],
    ['clé en double (inconnue)', `${base()}&z=1&z=2`],
    ['__proto__ en double', `${base()}&__proto__=1&__proto__=2`],
    ['__proto__ seul', '#__proto__=1'],
    ['__proto__[x]', '#__proto__[polluted]=1'],
    ['constructor[prototype]', '#constructor[prototype][x]=1&v=1'],
    ['masque k=80 (hors plage)', base({ k: '80' })],
    ['masque k=ff', base({ k: 'ff' })],
    ['masque k=0g', base({ k: '0g' })],
    ['masque k sur 1 chiffre', base({ k: 'c' })],
    ['v=9 (version plus récente)', base({ v: '9' })],
    ['v=0', base({ v: '0' })],
    ['v vide', base({ v: '' })],
    ['v=01 (zéro de tête)', base({ v: '01' })],
    ['l de 41 hex', base({ l: L.slice(1) })],
    ['l de 43 hex', base({ l: `${L}0` })],
    ['d absent', base().replace(/&d=.*$/, '')],
    ['couleurs en minuscules', base({ l: L.toLowerCase() })],
    ['caractères hors hex (G, Z)', base({ d: `GZ${D.slice(2)}` })],
    ['graine en majuscules', base({ s: '9A3C51E2' })],
    ['graine de 7 hex', base({ s: '9a3c51e' })],
    ['valeurs vides', '#v=1&m=&h=&s=&k=&l=&d='],
    ['harmonie inconnue', base({ h: 'xx' })],
    ['mode inconnu', base({ m: 'x' })],
    ['sans # initial', base().slice(1)],
    ['& final (segment vide)', `${base()}&`],
    ['clé vide', '#v=1&=x'],
    ['JSON', '#{"__proto__":{"x":1}}'],
    ['javascript:', '#javascript:alert(1)'],
  ];
  it('there are 30 or more (the J5 row asks for 30)', () => {
    expect(HOSTILE.length).toBeGreaterThanOrEqual(30);
  });
  afterEach(() => vi.restoreAllMocks());
  for (const [name, hash] of HOSTILE) {
    it(`rejects: ${name}`, () => {
      const spies = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
      const before = fixedState('light');
      const r = decodeHash(hash);
      expect(r.kind).toBe('error');
      const after = r.kind === 'ok' ? loadShared(r.value)(before) : before;
      expect(after).toBe(before);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(({} as Record<string, unknown>).x).toBeUndefined();
    });
  }
  it('v=9 gives the "more recent version" message, the others the plain one', () => {
    const newer = decodeHash(base({ v: '9' }));
    expect(newer.kind === 'error' && newer.reason).toBe('newer');
    expect(newer.kind === 'error' && newer.message).toMatch(/version plus récente/);
    const bad = decodeHash(base({ k: '80' }));
    expect(bad.kind === 'error' && bad.message).toMatch(/Lien invalide/);
    const long = decodeHash(`${base()}&x=${'a'.repeat(200)}`);
    expect(long.kind === 'error' && long.reason).toBe('too-long');
    const dup = decodeHash(`${base()}&m=d`);
    expect(dup.kind === 'error' && dup.reason).toBe('duplicate');
  });
});

describe('J9: version boundary (audit I3, mutation M6 `> 1` -> `> 2`)', () => {
  const reasonOf = (v: string): string => {
    const r = decodeHash(base({ v }));
    return r.kind === 'ok' ? 'ok' : r.kind === 'error' ? r.reason : r.kind;
  };
  it('v=1 is read', () => {
    expect(reasonOf('1')).toBe('ok');
  });
  it('v=2, 3, 10 and 999 are a newer version (the message says so)', () => {
    for (const v of ['2', '3', '10', '999']) expect(reasonOf(v), `v=${v}`).toBe('newer');
    const r = decodeHash(base({ v: '2' }));
    expect(r.kind === 'error' && r.message).toMatch(/version plus récente/);
  });
  it('v=0, 01, 1.0, -1, +1, 1000, a space and a letter are invalid, never newer and never read', () => {
    for (const v of ['0', '00', '01', '1.0', '-1', '+1', '1000', '1 ', 'a', '1e1', '0x1']) expect(reasonOf(v), `v=${v}`).toBe('invalid');
  });
  it('no v at all is invalid', () => {
    expect(decodeHash(base().replace(/^#v=1&/, '#')).kind === 'error').toBe(true);
  });
});

describe('what is accepted', () => {
  it('no hash, or an empty one, means "nothing to load"', () => {
    expect(decodeHash('')).toEqual({ kind: 'none' });
    expect(decodeHash('#')).toEqual({ kind: 'none' });
  });
  it('exactly 256 characters is read, 257 is not', () => {
    const pad = (n: number) => `${base()}&x=${'a'.repeat(n - base().length - 3)}`;
    expect(pad(256)).toHaveLength(256);
    expect(decodeHash(pad(256)).kind).toBe('ok');
    expect(decodeHash(pad(257)).kind).toBe('error');
  });
  it('an unknown key (unique) is ignored; __proto__ as an unknown key pollutes nothing', () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    const r = decodeHash(`${base()}&__proto__=polluted&foo=%41`);
    expect(r.kind).toBe('ok');
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    if (r.kind === 'ok') expect(Object.getPrototypeOf(r.value.theme.light)).toBe(Object.prototype);
  });
  it('the order of the keys does not matter', () => {
    const r = decodeHash(`#d=${D}&l=${L}&k=0c&s=9a3c51e2&h=sp&m=d&v=1`);
    expect(r.kind === 'ok' && [r.value.mode, r.value.harmony, r.value.locks, r.value.seed]).toEqual(['dark', 'split-complementary', 12, 0x9a3c51e2]);
  });
  it('every colour is re-formatted by formatHex (uppercase #RRGGBB)', () => {
    const r = decodeHash(base());
    expect(r.kind === 'ok' && hex14({ theme: r.value.theme }).every((h) => /^#[0-9A-F]{6}$/.test(h))).toBe(true);
  });
});

describe('regular expressions stay fast on long hostile input', () => {
  it('1 million characters are refused at once; 256-character pathological inputs cost microseconds', () => {
    const inputs = [`#${'&'.repeat(1_000_000)}`, `#${'a'.repeat(1_000_000)}`, `#${'a='.repeat(500_000)}`];
    const t0 = performance.now();
    for (const i of inputs) expect(decodeHash(i).kind).toBe('error');
    const long = performance.now() - t0;
    const small = ['&', '=', 'a=', 'l=', '0', 'A'].map((c) => `#${c.repeat(Math.floor(255 / c.length))}`);
    const t1 = performance.now();
    for (let i = 0; i < 2000; i++) for (const s of small) decodeHash(s);
    const many = performance.now() - t1;
    expect(long).toBeLessThan(50);
    expect(many).toBeLessThan(500);
    console.info(`regex timing: 3 x 1 M characters ${long.toFixed(2)} ms, ${2000 * small.length} inputs of 255 characters ${many.toFixed(1)} ms`);
  });
});
