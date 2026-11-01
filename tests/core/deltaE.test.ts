import { describe, expect, it } from 'vitest';
import { linearToOklab, rgbToLinear } from '../../src/core/color';
import { deltaEOK } from '../../src/core/deltaE';

describe('deltaEOK (Euclidean distance in OKLab)', () => {
  it('OKLab of white is (1, 0, 0) and of black (0, 0, 0)', () => {
    const w = linearToOklab(rgbToLinear({ r: 255, g: 255, b: 255 }));
    expect(w.l).toBeCloseTo(1, 6);
    expect(Math.abs(w.a)).toBeLessThan(1e-6);
    expect(Math.abs(w.b)).toBeLessThan(1e-6);
    expect(linearToOklab(rgbToLinear({ r: 0, g: 0, b: 0 }))).toEqual({ l: 0, a: 0, b: 0 });
  });
  it('identical = 0; white vs black = 1.0000 within 1e-4', () => {
    expect(deltaEOK('#336699', '#336699')).toBe(0);
    expect(Math.abs((deltaEOK('#FFFFFF', '#000000') as number) - 1)).toBeLessThan(1e-4);
  });
  it('own examples: red vs green 0.5198 (OKLab (0.62796, 0.22486, 0.12585) and (0.86644, -0.23389, 0.17943)), grey #808080 vs black 0.5999 (cbrt(0.21586))', () => {
    expect(deltaEOK('#FF0000', '#00FF00') as number).toBeCloseTo(0.5198, 4);
    expect(deltaEOK('#808080', '#000000') as number).toBeCloseTo(0.5999, 4);
  });
  it('is symmetric, case-insensitive, and null on an invalid hex', () => {
    expect(deltaEOK('#aabbcc', '#112233')).toBe(deltaEOK('#112233', '#AABBCC'));
    expect(deltaEOK('nope', '#000000')).toBeNull();
  });
});
