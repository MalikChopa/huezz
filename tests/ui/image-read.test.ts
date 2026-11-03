import { describe, expect, it, vi } from 'vitest';
import { MAX_BYTES, MESSAGES, pickFile, readImage, withTimeout } from '../../src/ui/image-read';

const file = (name: string, type: string, body: BlobPart = 'x'): File => new File([body], name, { type });

describe('pickFile', () => {
  it('prefers the first image, else the first file, else nothing', () => {
    const txt = file('a.txt', 'text/plain');
    const a = file('a.png', 'image/png');
    const b = file('b.jpg', 'image/jpeg');
    expect(pickFile([txt, a, b])).toBe(a);
    expect(pickFile([txt])).toBe(txt);
    expect(pickFile([])).toBeNull();
    expect(pickFile(null)).toBeNull();
    expect(pickFile(undefined)).toBeNull();
  });
});

describe('withTimeout', () => {
  it('passes the value through when the work is on time, and never calls `late`', async () => {
    const late = vi.fn();
    await expect(withTimeout(Promise.resolve(5), 1000, late)).resolves.toBe(5);
    await new Promise((r) => setTimeout(r, 20));
    expect(late).not.toHaveBeenCalled();
  });
  it('rejects with the French message when the work is too slow, and hands the late value to `late` (to release it)', async () => {
    const late = vi.fn();
    let finish: (v: string) => void = () => undefined;
    const slow = new Promise<string>((r) => (finish = r));
    await expect(withTimeout(slow, 10, late)).rejects.toThrow(MESSAGES.timeout);
    finish('bitmap');
    await new Promise((r) => setTimeout(r, 20));
    expect(late).toHaveBeenCalledWith('bitmap');
  });
  it('lets a failure of the work through when it is on time, and ignores one that comes too late', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, () => undefined)).rejects.toThrow('boom');
    let fail: (e: Error) => void = () => undefined;
    const slow = new Promise<string>((_, r) => (fail = r));
    const guarded = withTimeout(slow, 10, () => undefined);
    await expect(guarded).rejects.toThrow(MESSAGES.timeout);
    fail(new Error('too late'));
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe('readImage: what is refused before any decoding (no DOM needed)', () => {
  it('a file over 25 MB is refused by its size alone', async () => {
    const big = { size: MAX_BYTES + 1, type: 'image/png', slice: () => { throw new Error('must not be read'); } } as unknown as Blob;
    expect(await readImage(big)).toEqual({ ok: false, message: MESSAGES.tooBig });
    const edge = new Blob([new Uint8Array(1024)], { type: 'image/png' });
    expect((await readImage(edge)).ok).toBe(false);
  });
  it('an SVG is refused by its type and by its content, whatever the name or the type say', async () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    expect(await readImage(file('a.svg', 'image/svg+xml', svg))).toEqual({ ok: false, message: MESSAGES.svg });
    expect(await readImage(file('a.png', 'image/png', svg))).toEqual({ ok: false, message: MESSAGES.svg });
    expect(await readImage(file('a', '', `  <SVG width="1">`))).toEqual({ ok: false, message: MESSAGES.svg });
  });
  it('what cannot be decoded gets the message that fits: HEIC-like, not an image, unreadable', async () => {
    const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
    expect(await readImage(file('IMG.HEIC', 'image/heic', heic))).toEqual({ ok: false, message: MESSAGES.unsupported });
    expect(await readImage(file('IMG', '', heic))).toEqual({ ok: false, message: MESSAGES.unsupported });
    expect(await readImage(file('a.txt', 'text/plain', 'hello'))).toEqual({ ok: false, message: MESSAGES.notImage });
    expect(await readImage(file('a.png', 'image/png', 'not a png'))).toEqual({ ok: false, message: MESSAGES.unreadable });
  });
  it('the French texts of the brief', () => {
    expect(MESSAGES.unsupported).toBe('Ce format d\'image n\'est pas lu par ton navigateur. Essaie JPEG, PNG ou WebP.');
    expect(MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});
