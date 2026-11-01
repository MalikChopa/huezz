import { describe, expect, it } from 'vitest';
import { checkHex, INVALID_MESSAGE, TOO_LONG_MESSAGE } from '../../src/ui/base-field';

describe('checkHex (G3, G5): what the hex field accepts', () => {
  it('trims surrounding spaces and accepts the # or none, in any case, 3 or 6 digits', () => {
    for (const [input, hex] of [
      ['#2E86AB', '#2E86AB'],
      ['2E86AB', '#2E86AB'],
      ['  #2E86AB  ', '#2E86AB'],
      ['\t2e86ab\n', '#2E86AB'],
      [' #2e86ab ', '#2E86AB'],
      ['#abc', '#AABBCC'],
      ['abc', '#AABBCC'],
    ] as const) expect(checkHex(input), input).toEqual({ ok: true, hex });
  });
  it('more than 6 digits is an error of its own and is never cut short', () => {
    for (const input of ['#2E86ABCDEF', '2E86ABCDEF', '#2E86AB1', '  #2E86ABCD ', '#' + 'F'.repeat(300), 'F'.repeat(300)]) {
      expect(checkHex(input), input.slice(0, 20)).toEqual({ ok: false, message: TOO_LONG_MESSAGE });
    }
    // any text of more than 6 digits after the optional #, hex or not: the length is the first thing said
    expect(checkHex('rgb(1,2,3)')).toEqual({ ok: false, message: TOO_LONG_MESSAGE });
    expect(TOO_LONG_MESSAGE).toBe('Code hex trop long : 6 chiffres attendus');
  });
  it('the other bad values are plain invalid codes', () => {
    for (const input of ['', '   ', '#', 'g12', '#12345G', '#2E86A', '#12', 'zz', '#<b>']) {
      expect(checkHex(input), input).toEqual({ ok: false, message: INVALID_MESSAGE });
    }
  });
});
