import { describe, expect, it } from 'vitest';
import { formatHex, parseHex } from '../../src/core/hex';

describe('parseHex', () => {
  it('parses #RRGGBB', () => {
    expect(parseHex('#2A9D8F')).toEqual({ r: 42, g: 157, b: 143 });
    expect(parseHex('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
  });
  it('expands the short form #RGB', () => {
    expect(parseHex('#f80')).toEqual({ r: 255, g: 136, b: 0 });
  });
  it('accepts a missing #', () => {
    expect(parseHex('2a9d8f')).toEqual({ r: 42, g: 157, b: 143 });
    expect(parseHex('FFF')).toEqual({ r: 255, g: 255, b: 255 });
  });
  it('returns null on invalid input without throwing', () => {
    for (const bad of ['', '#', '#12', '#1234', '#12345', '#1234567', '#GGGGGG', 'rgb(0,0,0)', ' #fff', '#fff\n', '##fff']) {
      expect(parseHex(bad)).toBeNull();
    }
  });
});

describe('formatHex', () => {
  it('writes uppercase #RRGGBB', () => {
    expect(formatHex({ r: 42, g: 157, b: 143 })).toBe('#2A9D8F');
    expect(formatHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
  });
  it('rounds and clamps channels', () => {
    expect(formatHex({ r: 254.6, g: -3, b: 300 })).toBe('#FF00FF');
  });
  it('round-trips with parseHex', () => {
    expect(formatHex(parseHex('abc')!)).toBe('#AABBCC');
  });
});
