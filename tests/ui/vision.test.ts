import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CVD_MATRICES, CVD_PREVIEW_KINDS } from '../../src/core/cvd';
import { visionSentence } from '../../src/ui/vision';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/styles/tool.css', import.meta.url), 'utf8');

describe('vision preview: the SVG filters of index.html are the matrices of src/core/cvd.ts (one source of truth, enforced here)', () => {
  for (const kind of CVD_PREVIEW_KINDS) {
    it(`${kind}: the 3 colour rows of the feColorMatrix equal CVD_MATRICES, alpha row untouched, linearRGB`, () => {
      const filter = new RegExp(`<filter id="cvd-${kind}"[^>]*color-interpolation-filters="linearRGB"[^>]*><feColorMatrix type="matrix" values="([^"]+)"/></filter>`).exec(html);
      expect(filter, `filter cvd-${kind}`).not.toBeNull();
      const v = (filter as RegExpExecArray)[1]!.split(/\s+/).map(Number);
      expect(v).toHaveLength(20);
      const m = CVD_MATRICES[kind];
      for (let row = 0; row < 3; row++) {
        expect(v.slice(row * 5, row * 5 + 3), `${kind} row ${row}`).toEqual([...m[row]!]);
        expect(v.slice(row * 5 + 3, row * 5 + 5)).toEqual([0, 0]);
      }
      expect(v.slice(15)).toEqual([0, 0, 0, 1, 0]);
    });
    it(`${kind}: a CSS rule puts the filter on the mock-ups and the dock swatches only`, () => {
      const rule = new RegExp(`:root\\[data-vision=${kind}\\] :is\\(\\.piece,\\.sw\\)\\{filter:url\\(#cvd-${kind}\\)\\}`);
      expect(css).toMatch(rule);
    });
  }
  it('exactly 3 filters, the defs are hidden from assistive technology, no style attribute anywhere in the page (CSP)', () => {
    expect(html.match(/<filter /g)).toHaveLength(3);
    expect(html).toMatch(/<svg class="vision-defs"[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });
  it('the select has the 4 options in French, Normale first and selected, and a visible label', () => {
    const options = [...html.matchAll(/<option value="(\w+)"( selected)?>([^<]+)<\/option>/g)].filter((m) => ['normal', 'protan', 'deutan', 'tritan'].includes(m[1]!));
    expect(options.map((m) => [m[1], m[3]])).toEqual([
      ['normal', 'Normale'],
      ['protan', 'Protanopie'],
      ['deutan', 'Deutéranopie'],
      ['tritan', 'Tritanopie'],
    ]);
    expect(options[0]![2]).toBe(' selected');
    expect(html).toMatch(/<label class="cap-k" for="vision">Vision<\/label>/);
  });
  it('the note says the simulation is approximate and that contrasts and exports are the real palette', () => {
    expect(html).toMatch(/id="visionNote" hidden>Simulation approchée[^<]*contrastes et exports/);
  });
  it('the filters never reach the tool itself: no rule applies them to the bar, the dialogs or the pills', () => {
    const rules = css.split('\n').filter((l) => l.includes('url(#cvd-'));
    expect(rules).toHaveLength(3);
    for (const r of rules) expect(r).not.toMatch(/\.bar|\.cdlg|\.pill|\.dock\b|\.xmenu/);
  });
});

describe('vision sentence (live region)', () => {
  it('normal says real colours; each kind says it is a simulation and that contrasts and exports are the real palette', () => {
    expect(visionSentence('normal')).toBe('Vision normale : aperçu en couleurs réelles');
    expect(visionSentence('protan')).toBe('Aperçu simulé, protanopie, simulation approchée : les contrastes et les exports restent ceux de la vraie palette');
    expect(visionSentence('deutan')).toMatch(/deutéranopie/);
    expect(visionSentence('tritan')).toMatch(/tritanopie/);
  });
});
