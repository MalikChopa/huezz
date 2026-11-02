import { describe, expect, it } from 'vitest';
import { HARMONIES } from '../../src/core/harmony';
import { fromOklch } from '../../src/core/gamut';
import { next } from '../../src/core/random';
import { generate } from '../../src/palette/generate';
import { agree, HUE_WORDS, NOUN_ROWS, paletteName } from '../../src/palette/name';
import type { Mode } from '../../src/palette/roles';

const MODES: readonly Mode[] = ['light', 'dark'];
const accentOf = (l: number, c: number, h: number): string => fromOklch({ l, c, h });

describe('lists', () => {
  it('17 hue words (16 sectors + grey), 6 rows of 8 nouns, each noun marked f or m, no word twice', () => {
    expect(HUE_WORDS).toHaveLength(17);
    expect(NOUN_ROWS).toHaveLength(6);
    for (const row of NOUN_ROWS) expect(row).toHaveLength(8);
    const nouns = NOUN_ROWS.flat();
    expect(new Set(nouns).size).toBe(48);
    for (const n of nouns) expect(n).toMatch(/^[fm]\p{Lu}\p{Ll}+$/u);
    expect(new Set(HUE_WORDS).size).toBe(17);
  });
});

describe('length', () => {
  it('the longest possible name has at most 22 characters (so the live region sentence and the title stay short)', () => {
    const longest = Math.max(...NOUN_ROWS.flat().map((n) => n.length - 1 + 1 + Math.max(...HUE_WORDS.map((h) => agree(h, 'f').length))));
    console.log(`J12 longest name: ${longest} characters`);
    expect(longest).toBeLessThanOrEqual(22);
  });
});

describe('agreement of the hue adjective with the gender of the noun (table)', () => {
  const table: [string, 'f' | 'm', string][] = [
    ['doré', 'm', 'doré'],
    ['doré', 'f', 'dorée'],
    ['rosé', 'f', 'rosée'],
    ['cuivré', 'f', 'cuivrée'],
    ['ambré', 'm', 'ambré'],
    ['violacé', 'f', 'violacée'],
    ['azuré', 'f', 'azurée'],
    ['céruléen', 'm', 'céruléen'],
    ['céruléen', 'f', 'céruléenne'],
    ['écarlate', 'f', 'écarlate'],
    ['écarlate', 'm', 'écarlate'],
    ['neutre', 'f', 'neutre'],
    ['mauve', 'f', 'mauve'],
    ['corail', 'f', 'corail'],
    ['corail', 'm', 'corail'],
    ['turquoise', 'f', 'turquoise'],
    ['indigo', 'f', 'indigo'],
    ['outremer', 'f', 'outremer'],
    ['fuchsia', 'f', 'fuchsia'],
    ['jade', 'm', 'jade'],
    ['mousse', 'f', 'mousse'],
  ];
  for (const [adjective, gender, want] of table) it(`${adjective} (${gender}) -> ${want}`, () => expect(agree(adjective, gender)).toBe(want));

  it('every hue word agrees with every noun of the lists: feminine nouns get a feminine form, and the example «Brume dorée» exists', () => {
    for (const row of NOUN_ROWS) for (const n of row) for (const h of HUE_WORDS) expect(agree(h, n[0] === 'f' ? 'f' : 'm')).toMatch(/^\p{Ll}+$/u);
    // light mode, pale-ish mid accent, doré hue (112.5 degrees), faintly tinted background, soft chroma: the brief's example
    expect(paletteName({ accent: accentOf(0.55, 0.07, 112), fond: '#F2F2F2' }, 'light')).toBe('Brume dorée');
  });
});

describe('paletteName', () => {
  it('is deterministic and pure', () => {
    const p = { accent: '#137A6B', fond: '#E7F2EF' };
    expect(paletteName(p, 'light')).toBe(paletteName({ ...p }, 'light'));
    expect(paletteName(p, 'light')).toMatch(/^\p{Lu}\p{Ll}+ \p{Ll}+$/u);
  });
  it('mode defaults to the lightness of the fond; an explicit mode wins', () => {
    const light = { accent: '#137A6B', fond: '#E7F2EF' };
    const dark = { accent: '#6EBCAD', fond: '#060E0D' };
    expect(paletteName(dark)).toBe(paletteName(dark, 'dark'));
    expect(paletteName(light)).toBe(paletteName(light, 'light'));
    expect(paletteName(light, 'dark')).not.toBe(paletteName(light, 'light'));
  });
  it('the lightness, the chroma and the background tint each move the noun; the hue moves the adjective only', () => {
    const noun = (l: number, c: number, fond = '#EEF2F1', mode: Mode = 'light') => paletteName({ accent: accentOf(l, c, 30), fond }, mode).split(' ')[0];
    expect(new Set([0.3, 0.55, 0.8].map((l) => noun(l, 0.1))).size).toBe(3);
    expect(new Set([0.06, 0.095, 0.115, 0.15].map((c) => noun(0.55, c))).size).toBe(4);
    expect(noun(0.55, 0.1, '#FFFFFF')).not.toBe(noun(0.55, 0.1, '#E7F2EF'));
    const parts = (h: number) => paletteName({ accent: accentOf(0.55, 0.1, h), fond: '#EEF2F1' }, 'light').split(' ');
    expect(parts(60)[0]).toBe(parts(150)[0]);
    expect(parts(60)[1]).not.toBe(parts(150)[1]);
  });
  it('a grey accent is «neutre», whatever its hue number', () => {
    expect(paletteName({ accent: '#808080', fond: '#EEEEEE' }, 'light')).toMatch(/ neutre$/);
    expect(paletteName({ accent: '#7F8080', fond: '#EEEEEE' }, 'light')).toMatch(/ neutre$/);
  });
  it('an invalid hex still gives a name', () => {
    expect(paletteName({ accent: 'zzz', fond: '#FFFFFF' })).toBe('Palette neutre');
  });
  it('hue sectors are 22.5 degrees wide and centred on the multiples of 22.5, wrapping at 360', () => {
    const adjective = (h: number) => (paletteName({ accent: accentOf(0.55, 0.1, h), fond: '#EEF2F1' }, 'light').split(' ')[1] as string).replace(/e$/, '');
    expect(adjective(2)).toBe(adjective(358));
    expect(adjective(340)).not.toBe(adjective(2));
  });
  it('a hue step of 20 degrees on the accent alone changes the name in every window of 5 steps (and at 16 of 17 steps at least)', () => {
    for (const mode of MODES) {
      const fond = mode === 'light' ? '#EEF2F1' : '#0B1110';
      const l = mode === 'light' ? 0.5 : 0.72;
      const names = Array.from({ length: 18 }, (_, i) => paletteName({ accent: accentOf(l, 0.1, i * 20), fond }, mode));
      let changes = 0;
      const changed: boolean[] = [];
      for (let i = 1; i < names.length; i++) {
        changed.push(names[i] !== names[i - 1]);
        if (names[i] !== names[i - 1]) changes++;
      }
      for (let i = 0; i + 5 <= changed.length; i++) expect(changed.slice(i, i + 5).some(Boolean), `${mode} window ${i}`).toBe(true);
      expect(changes).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('over generated palettes', () => {
  it('5 000 seeds x 6 harmonies x 2 modes: never empty, 2 words, nothing raw; same palette same name; distinct count reported', () => {
    const seen = new Map<string, number>();
    let seed = 20261102;
    let total = 0;
    for (let i = 0; i < 5000; i++) {
      seed = next(seed);
      for (const harmony of HARMONIES) {
        const r = generate({ harmony, seed, locks: 0 });
        for (const mode of MODES) {
          const name = paletteName(r[mode], mode);
          total++;
          expect(name).toMatch(/^\p{Lu}\p{Ll}+ \p{Ll}+$/u);
          expect(name.split(' ')).toHaveLength(2);
          expect(name).not.toMatch(/undefined|null|NaN/);
          if (i < 200) expect(paletteName(r[mode], mode)).toBe(name);
          seen.set(name, (seen.get(name) ?? 0) + 1);
        }
      }
    }
    expect(total).toBe(60000);
    const counts = [...seen.values()].sort((a, b) => b - a);
    console.log(`J12 names: ${seen.size} distinct names over ${total} palettes; most frequent ${counts[0]} (${((100 * (counts[0] as number)) / total).toFixed(1)} %), 16 hue words x 48 nouns = ${16 * 48} reachable (+ grey)`);
    expect(seen.size).toBeGreaterThanOrEqual(100);
    // the 16 hue sectors all show up for both modes
    for (const mode of MODES) {
      const adj = new Set<string>();
      for (let i = 0; i < 400; i++) {
        seed = next(seed);
        adj.add(paletteName(generate({ harmony: 'complementary', seed, locks: 0 })[mode], mode).split(' ')[1]!.replace(/e$/, ''));
      }
      expect(adj.size).toBeGreaterThanOrEqual(12);
    }
  });
});
