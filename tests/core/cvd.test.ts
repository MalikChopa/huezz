import { describe, expect, it } from 'vitest';
import { rgbToLinear } from '../../src/core/color';
import { CVD_KINDS, CVD_MATRICES, CVD_PREVIEW_KINDS, cvdDeltaE, simulateCvd, simulateCvdLinear, type Cvd } from '../../src/core/cvd';
import { deltaEOK } from '../../src/core/deltaE';
import { parseHex } from '../../src/core/hex';

const lin = (hex: string) => rgbToLinear(parseHex(hex) as NonNullable<ReturnType<typeof parseHex>>);

describe('cvd matrices (Vienot 1999, linear sRGB)', () => {
  it('are the published numbers, exactly', () => {
    expect(CVD_MATRICES.protan).toEqual([
      [0.11238, 0.88762, 0],
      [0.11238, 0.88762, 0],
      [0.00401, -0.00401, 1],
    ]);
    expect(CVD_MATRICES.deutan).toEqual([
      [0.29275, 0.70725, 0],
      [0.29275, 0.70725, 0],
      [-0.02234, 0.02234, 1],
    ]);
  });

  it('each row sums to 1', () => {
    for (const k of CVD_KINDS) for (const row of CVD_MATRICES[k]) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 12);
  });
});

describe('simulateCvdLinear: values quoted in the research (red and green, linear)', () => {
  it('pure red', () => {
    const p = simulateCvdLinear(lin('#FF0000'), 'protan');
    expect([p.r, p.g, p.b].map((v) => +v.toFixed(5))).toEqual([0.11238, 0.11238, 0.00401]);
    const d = simulateCvdLinear(lin('#FF0000'), 'deutan');
    expect([d.r, d.g, d.b].map((v) => +v.toFixed(5))).toEqual([0.29275, 0.29275, -0.02234]);
  });

  it('pure green', () => {
    const p = simulateCvdLinear(lin('#00FF00'), 'protan');
    expect([p.r, p.g, p.b].map((v) => +v.toFixed(5))).toEqual([0.88762, 0.88762, -0.00401]);
    const d = simulateCvdLinear(lin('#00FF00'), 'deutan');
    expect([d.r, d.g, d.b].map((v) => +v.toFixed(5))).toEqual([0.70725, 0.70725, 0.02234]);
  });
});

describe('simulateCvd (hex in, hex out)', () => {
  it('greys stay grey within 1e-4 in linear light, at several levels', () => {
    for (const v of [0, 1, 17, 64, 100, 128, 190, 230, 254, 255]) {
      const hex = '#' + v.toString(16).padStart(2, '0').repeat(3).toUpperCase();
      for (const k of CVD_KINDS) {
        const a = lin(hex);
        const b = simulateCvdLinear(a, k);
        expect(Math.abs(b.r - a.r)).toBeLessThan(1e-4);
        expect(Math.abs(b.g - a.g)).toBeLessThan(1e-4);
        expect(Math.abs(b.b - a.b)).toBeLessThan(1e-4);
        expect(simulateCvd(hex, k)).toBe(hex);
      }
    }
  });

  it('pure white, black and blue are unchanged; yellow too', () => {
    for (const k of CVD_KINDS) {
      expect(simulateCvd('#FFFFFF', k)).toBe('#FFFFFF');
      expect(simulateCvd('#000000', k)).toBe('#000000');
      expect(simulateCvd('#0000FF', k)).toBe('#0000FF');
      expect(simulateCvd('#FFFF00', k)).toBe('#FFFF00');
    }
  });

  it('own known values (computed apart in Python from the same matrices, gamma included)', () => {
    const table: [string, Cvd, string][] = [
      ['#FF0000', 'protan', '#5E5E0D'],
      ['#FF0000', 'deutan', '#939300'],
      ['#00FF00', 'protan', '#F2F200'],
      ['#00FF00', 'deutan', '#DBDB29'],
      ['#FF00FF', 'protan', '#5E5EFF'],
      ['#FF00FF', 'deutan', '#9393FC'],
      ['#00FFFF', 'protan', '#F2F2FF'],
      ['#00FFFF', 'deutan', '#DBDBFF'],
      ['#336699', 'protan', '#626299'],
      ['#336699', 'deutan', '#5B5B99'],
    ];
    for (const [hex, k, want] of table) expect(simulateCvd(hex, k)).toBe(want);
  });

  it('clamps to [0, 1] after the matrix: raw blue is negative (green protan, red deutan), the hex blue channel is 00', () => {
    expect(simulateCvdLinear(lin('#00FF00'), 'protan').b).toBeLessThan(0);
    expect(simulateCvdLinear(lin('#FF0000'), 'deutan').b).toBeLessThan(0);
    expect((simulateCvd('#00FF00', 'protan') as string).slice(5)).toBe('00');
    expect((simulateCvd('#FF0000', 'deutan') as string).slice(5)).toBe('00');
    expect(simulateCvdLinear(lin('#00FFFF'), 'deutan').b).toBeGreaterThan(1);
    expect((simulateCvd('#00FFFF', 'deutan') as string).slice(5)).toBe('FF');
  });

  it('accepts #RGB and no #, rejects invalid input with null, is pure', () => {
    expect(simulateCvd('f00', 'protan')).toBe('#5E5E0D');
    expect(simulateCvd('#zzzzzz', 'deutan')).toBeNull();
    expect(simulateCvd('', 'deutan')).toBeNull();
    expect(simulateCvd('#336699', 'deutan')).toBe(simulateCvd('#336699', 'deutan'));
  });

  it('red and green collapse toward the same colour (dE OK far smaller than for normal vision)', () => {
    const normal = deltaEOK('#C0392B', '#27AE60') as number;
    for (const k of CVD_KINDS) {
      const sim = cvdDeltaE('#C0392B', '#27AE60', k) as number;
      expect(sim).toBeLessThan(normal);
    }
  });

  it('cvdDeltaE of a colour with itself is 0, invalid gives null', () => {
    for (const k of CVD_KINDS) {
      expect(cvdDeltaE('#123456', '#123456', k)).toBe(0);
      expect(cvdDeltaE('#123456', 'nope', k)).toBeNull();
    }
  });
});

describe('tritanopia (Machado, Oliveira, Fernandes 2009, severity 1.0, linear sRGB)', () => {
  it('is the published matrix, exactly; rows sum to 1 within 1e-6', () => {
    expect(CVD_MATRICES.tritan).toEqual([
      [1.255528, -0.076749, -0.178779],
      [-0.078411, 0.930809, 0.147602],
      [0.004733, 0.691367, 0.3039],
    ]);
    for (const row of CVD_MATRICES.tritan) expect(Math.abs(row[0] + row[1] + row[2] - 1)).toBeLessThan(1e-6);
  });

  it('adding tritan changes nothing for the generator: CVD_KINDS is still protan + deutan, the preview list has the three', () => {
    expect([...CVD_KINDS]).toEqual(['protan', 'deutan']);
    expect([...CVD_PREVIEW_KINDS]).toEqual(['protan', 'deutan', 'tritan']);
  });

  it('greys stay grey within 1e-3 in linear light, at several levels (hex round trip too)', () => {
    for (const v of [0, 1, 17, 64, 100, 128, 190, 230, 254, 255]) {
      const hex = '#' + v.toString(16).padStart(2, '0').repeat(3).toUpperCase();
      const a = lin(hex);
      const b = simulateCvdLinear(a, 'tritan');
      expect(Math.abs(b.r - a.r)).toBeLessThan(1e-3);
      expect(Math.abs(b.g - a.g)).toBeLessThan(1e-3);
      expect(Math.abs(b.b - a.b)).toBeLessThan(1e-3);
      expect(simulateCvd(hex, 'tritan')).toBe(hex);
    }
  });

  it('own known values (computed apart in Python from the same matrix, gamma included, clamped)', () => {
    const table: [string, string][] = [
      ['#FF0000', '#FF000F'],
      ['#00FF00', '#00F7D9'],
      ['#0000FF', '#006B96'],
      ['#FFFF00', '#FFEED9'],
      ['#FF00FF', '#FF4A97'],
      ['#00FFFF', '#00FFFE'],
      ['#336699', '#007278'],
      ['#C0392B', '#D30137'],
      ['#FFFFFF', '#FFFFFF'],
      ['#000000', '#000000'],
    ];
    for (const [hex, want] of table) expect(simulateCvd(hex, 'tritan'), hex).toBe(want);
  });

  it('blue and green move toward each other, red stays red (the tritan confusion axis)', () => {
    const blue = simulateCvd('#0000FF', 'tritan') as string;
    const green = simulateCvd('#00FF00', 'tritan') as string;
    expect(deltaEOK(blue, green) as number).toBeLessThan(deltaEOK('#0000FF', '#00FF00') as number);
    expect((simulateCvd('#FF0000', 'tritan') as string).slice(0, 3)).toBe('#FF');
  });

  it('cvdDeltaE works with tritan and a colour against itself is 0', () => {
    expect(cvdDeltaE('#123456', '#123456', 'tritan')).toBe(0);
    expect(cvdDeltaE('#C0392B', '#27AE60', 'tritan') as number).toBeGreaterThan(0);
  });
});
