import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportText, FILE_NAME, outputOf, pngLayout, type OutputId } from '../../src/export';
import { KEY_NAMES } from '../../src/export/keys';
import { ROLES } from '../../src/palette/roles';
import { onAccent } from '../../src/palette/theme';
import { FIXTURES, OUTPUTS } from './fixtures';

const GOLDEN = new URL('./golden/', import.meta.url);
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const WORK = join(tmpdir(), 'huezz-swift-check');

type Golden = { name: string; actual: string };
function goldens(): Golden[] {
  const list: Golden[] = [];
  for (const [name, input] of Object.entries(FIXTURES)) {
    for (const o of OUTPUTS) list.push({ name: `${name}.${o.file}`, actual: exportText(o.id, input) });
    list.push({ name: `${name}.png-layout.json`, actual: `${JSON.stringify(pngLayout(input), null, 2)}\n` });
  }
  list.push({ name: 'lagune.figma-2025.10.json', actual: exportText('figma-2025.10', FIXTURES.lagune!) });
  return list;
}

describe('key names: one table (ARCHITECTURE section 7)', () => {
  it('equals the table of the architecture, role by role', () => {
    const expected: Record<string, string[]> = {
      // css, tailwind v4, tailwind v3, json, swift, figma
      fond: ['--huezz-fond', '--color-fond', 'fond', 'fond', 'fond', 'fond'],
      surface: ['--huezz-surface', '--color-surface', 'surface', 'surface', 'surface', 'surface'],
      texte: ['--huezz-texte', '--color-texte', 'texte', 'texte', 'texte', 'texte'],
      accent: ['--huezz-accent', '--color-accent', 'accent', 'accent', 'accent', 'accent'],
      accent2: ['--huezz-accent-2', '--color-accent-2', 'accent-2', 'accent2', 'accent2', 'accent2'],
      succes: ['--huezz-succes', '--color-succes', 'succes', 'succes', 'succes', 'succes'],
      alerte: ['--huezz-alerte', '--color-alerte', 'alerte', 'alerte', 'alerte', 'alerte'],
    };
    expect(Object.keys(KEY_NAMES)).toEqual([...ROLES]);
    for (const role of ROLES) {
      const k = KEY_NAMES[role];
      expect([k.css, k.tw4, k.tw3, k.json, k.swift, k.figma], role).toEqual(expected[role]);
    }
  });
  it('the Swift identifier of accent2 has no dash', () => {
    expect(KEY_NAMES.accent2.swift).toBe('accent2');
  });
});

describe('golden files (byte for byte; UPDATE_GOLDEN=1 rewrites them)', () => {
  const list = goldens();
  it('3 palettes x 7 outputs + 1 Figma 2025.10 = 22 files, no other file in the folder', () => {
    expect(list).toHaveLength(22);
    expect(new Set(list.map((g) => g.name)).size).toBe(22);
    if (!UPDATE) expect(readdirSync(GOLDEN).filter((f) => !f.startsWith('.')).sort()).toEqual(list.map((g) => g.name).sort());
  });
  for (const g of list) {
    it(g.name, () => {
      const file = new URL(g.name, GOLDEN);
      if (UPDATE) {
        mkdirSync(GOLDEN, { recursive: true });
        writeFileSync(file, g.actual);
      }
      expect(existsSync(file), `fichier de référence manquant : ${g.name} (UPDATE_GOLDEN=1)`).toBe(true);
      expect(g.actual).toBe(readFileSync(file, 'utf8'));
    });
  }
});

describe('headers: Huezz and the palette, nothing personal', () => {
  const texts: OutputId[] = ['css', 'tailwind-v4', 'tailwind-v3', 'json', 'swift', 'figma', 'figma-2025.10'];
  for (const [name, input] of Object.entries(FIXTURES)) {
    it(`${name}: every output names Huezz and the harmony; no URL, no date, no path`, () => {
      for (const id of texts) {
        const text = exportText(id as Exclude<OutputId, 'png'>, input);
        expect(text, id).toMatch(/Huezz/);
        expect(text, id).toMatch(/harmonie|harmony|"harmonie"/);
        expect(text, id).not.toMatch(/https?:|file:|\/Users\/|\d{4}-\d{2}-\d{2}/);
      }
    });
  }
});

describe('CSS and Tailwind', () => {
  const input = FIXTURES.lagune!;
  it('CSS: 7 variables per block, dark block under prefers-color-scheme', () => {
    const css = exportText('css', input);
    const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
    expect(light!.match(/--huezz-[a-z0-9-]+: #[0-9A-F]{6};/g)).toHaveLength(7);
    expect(dark!.match(/--huezz-[a-z0-9-]+: #[0-9A-F]{6};/g)).toHaveLength(7);
    for (const role of ROLES) {
      expect(light).toContain(`${KEY_NAMES[role].css}: ${input.theme.light[role]};`);
      expect(dark).toContain(`${KEY_NAMES[role].css}: ${input.theme.dark[role]};`);
    }
  });
  it('Tailwind v4: @theme for light, dark overrides under the media query', () => {
    const css = exportText('tailwind-v4', input);
    expect(css).toMatch(/^\/\* Huezz[^\n]*\*\/\n@theme \{\n/);
    const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
    for (const role of ROLES) {
      expect(light).toContain(`${KEY_NAMES[role].tw4}: ${input.theme.light[role]};`);
      expect(dark).toContain(`${KEY_NAMES[role].tw4}: ${input.theme.dark[role]};`);
    }
    expect(dark).toContain(':root {');
  });
  it('Tailwind v3: the file is a valid CommonJS config with { DEFAULT, sombre } and darkMode media', () => {
    const code = exportText('tailwind-v3', input);
    const module = { exports: {} as { darkMode?: string; theme?: { extend?: { colors?: Record<string, { DEFAULT: string; sombre: string }> } } } };
    new Function('module', code)(module);
    expect(module.exports.darkMode).toBe('media');
    const colors = module.exports.theme?.extend?.colors ?? {};
    expect(Object.keys(colors)).toEqual(ROLES.map((r) => KEY_NAMES[r].tw3));
    for (const role of ROLES) expect(colors[KEY_NAMES[role].tw3]).toEqual({ DEFAULT: input.theme.light[role], sombre: input.theme.dark[role] });
  });
});

describe('JSON', () => {
  it('{ version: 1, harmonie, clair, sombre } and nothing else but the generator name', () => {
    for (const input of Object.values(FIXTURES)) {
      const data = JSON.parse(exportText('json', input)) as Record<string, unknown>;
      expect(Object.keys(data).sort()).toEqual(['clair', 'generateur', 'harmonie', 'sombre', 'version']);
      expect(data.version).toBe(1);
      expect(data.harmonie).toBe(input.harmony);
      expect(data.clair).toEqual(input.theme.light);
      expect(data.sombre).toEqual(input.theme.dark);
    }
  });
});

describe('Figma tokens: hand-written schema, both forms', () => {
  const HEX_UP = /^#[0-9A-F]{6}$/;
  const HEX_LOW = /^#[0-9a-f]{6}$/;
  type Check = (value: unknown, hex: string) => string | null;
  const forHex: Check = (v, hex) => (typeof v === 'string' && HEX_UP.test(v) && v === hex ? null : `valeur hex attendue ${hex}`);
  const forObject: Check = (v, hex) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'objet attendu';
    const o = v as Record<string, unknown>;
    if (Object.keys(o).sort().join() !== 'colorSpace,components,hex') return `clés : ${Object.keys(o).join()}`;
    if (o.colorSpace !== 'srgb') return 'colorSpace srgb attendu';
    const c = o.components;
    if (!Array.isArray(c) || c.length !== 3 || c.some((x) => typeof x !== 'number' || x < 0 || x > 1)) return 'components : 3 nombres dans [0 ; 1]';
    if (typeof o.hex !== 'string' || !HEX_LOW.test(o.hex) || o.hex.toUpperCase() !== hex) return 'hex de repli égal à la couleur';
    const back = (c as number[]).map((x) => Math.round(x * 255));
    const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return back.every((x, i) => x === want[i]) ? null : `composantes ${back.join()} != ${want.join()}`;
  };
  function validate(text: string, check: Check, input: (typeof FIXTURES)[string]): string[] {
    const errors: string[] = [];
    const data = JSON.parse(text) as Record<string, unknown>;
    if (Object.keys(data).sort().join() !== '$description,clair,sombre') errors.push(`racine : ${Object.keys(data).join()}`);
    if (typeof data.$description !== 'string' || !data.$description.includes('Huezz')) errors.push('$description');
    for (const [group, mode] of [['clair', 'light'], ['sombre', 'dark']] as const) {
      const g = data[group] as Record<string, unknown> | undefined;
      if (g === undefined || g.$type !== 'color') errors.push(`${group}.$type`);
      for (const role of ROLES) {
        const key = KEY_NAMES[role].figma;
        const token = g?.[key] as Record<string, unknown> | undefined;
        if (token === undefined || Object.keys(token).join() !== '$value') errors.push(`${group}.${key}: jeton`);
        else {
          const err = check(token.$value, input.theme[mode][role]);
          if (err !== null) errors.push(`${group}.${key}: ${err}`);
        }
      }
      const extra = Object.keys(g ?? {}).filter((k) => k !== '$type' && !ROLES.some((r) => KEY_NAMES[r].figma === k));
      if (extra.length > 0) errors.push(`${group}: clés en trop ${extra.join()}`);
    }
    return errors;
  }
  for (const [name, input] of Object.entries(FIXTURES)) {
    it(`${name}: default form "$value": "#RRGGBB" passes JSON.parse and the schema`, () => {
      expect(validate(exportText('figma', input), forHex, input)).toEqual([]);
    });
    it(`${name}: 2025.10 form (colour object) passes JSON.parse and the schema`, () => {
      expect(validate(exportText('figma-2025.10', input), forObject, input)).toEqual([]);
    });
  }
  it('the schema is not vacuous: each form refuses the other and a wrong value', () => {
    const input = FIXTURES.lagune!;
    expect(validate(exportText('figma', input), forObject, input)).not.toEqual([]);
    expect(validate(exportText('figma-2025.10', input), forHex, input)).not.toEqual([]);
    expect(validate(exportText('figma', input).replace('#137A6B', '#137A6C'), forHex, input)).not.toEqual([]);
    expect(validate(exportText('figma-2025.10', input).replace('"srgb"', '"p3"'), forObject, input)).not.toEqual([]);
  });
});

describe('PNG layout (pure data)', () => {
  it('1400 x 400, 7 bands of 200 x 400 in role order, filled with the displayed mode', () => {
    for (const input of Object.values(FIXTURES)) {
      const layout = pngLayout(input);
      expect([layout.width, layout.height]).toEqual([1400, 400]);
      expect(layout.rects).toHaveLength(7);
      for (const [i, role] of ROLES.entries()) {
        expect(layout.rects[i]).toEqual({ x: i * 200, y: 0, w: 200, h: 400, fill: input.theme[input.mode][role] });
      }
      expect(layout.texts).toHaveLength(14);
    }
  });
  it('texts stay inside their band, away from the centre and the top-left corner, in black or white', () => {
    for (const input of Object.values(FIXTURES)) {
      for (const [k, t] of pngLayout(input).texts.entries()) {
        const band = Math.floor(k / 2);
        expect(t.x).toBeGreaterThanOrEqual(band * 200 + 8);
        expect(t.x).toBeLessThan(band * 200 + 100);
        expect(t.y).toBeGreaterThan(300);
        expect(t.fill).toBe(onAccent(input.theme[input.mode][ROLES[band]!]));
      }
    }
  });
  it('file names and the choice mapping', () => {
    expect(outputOf({ format: 'tailwind', tailwind: 'v3', figma: 'hex' })).toBe('tailwind-v3');
    expect(outputOf({ format: 'tailwind', tailwind: 'v4', figma: '2025.10' })).toBe('tailwind-v4');
    expect(outputOf({ format: 'figma', tailwind: 'v4', figma: '2025.10' })).toBe('figma-2025.10');
    expect(outputOf({ format: 'png', tailwind: 'v4', figma: 'hex' })).toBe('png');
    expect(FILE_NAME.png).toBe('huezz.png');
  });
});

describe('Swift compiles (swiftc -typecheck)', () => {
  const swiftc = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
  const present = swiftc.status === 0 && process.platform === 'darwin';
  it.skipIf(!present)('the three palettes type-check, a broken file does not (skipped when swiftc is absent or the machine is not a Mac: SwiftUI exists only on Apple platforms)', () => {
    mkdirSync(WORK, { recursive: true });
    for (const [name, input] of Object.entries(FIXTURES)) {
      const file = `${WORK}/${name}.swift`;
      writeFileSync(file, exportText('swift', input));
      const r = spawnSync('swiftc', ['-typecheck', file], { encoding: 'utf8' });
      expect(r.status, `${name}: ${r.stderr.slice(0, 400)}`).toBe(0);
    }
    const bad = `${WORK}/broken.swift`;
    writeFileSync(bad, exportText('swift', FIXTURES.lagune!).replace('accent2', 'accent-2'));
    expect(spawnSync('swiftc', ['-typecheck', bad], { encoding: 'utf8' }).status).not.toBe(0);
  });
});
