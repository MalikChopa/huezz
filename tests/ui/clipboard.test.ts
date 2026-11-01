import { describe, expect, it } from 'vitest';
import { copyText } from '../../src/ui/clipboard';

describe('copyText paths', () => {
  it('uses the clipboard API in a secure context', async () => {
    const seen: string[] = [];
    const path = await copyText('#AABBCC', { isSecure: true, writeText: async (t) => void seen.push(t), execCopy: () => false });
    expect(path).toBe('clipboard');
    expect(seen).toEqual(['#AABBCC']);
  });
  it('falls back to execCommand when not secure (API not even tried)', async () => {
    let tried = false;
    const path = await copyText('#AABBCC', { isSecure: false, writeText: async () => void (tried = true), execCopy: () => true });
    expect(path).toBe('execCommand');
    expect(tried).toBe(false);
  });
  it('falls back to execCommand when the API refuses', async () => {
    const path = await copyText('#AABBCC', { isSecure: true, writeText: () => Promise.reject(new Error('denied')), execCopy: () => true });
    expect(path).toBe('execCommand');
  });
  it('ends in manual mode when everything fails or throws', async () => {
    expect(await copyText('#AABBCC', { isSecure: false, execCopy: () => false })).toBe('manual');
    expect(await copyText('#AABBCC', { isSecure: true, writeText: () => Promise.reject(new Error('x')), execCopy: () => { throw new Error('y'); } })).toBe('manual');
    expect(await copyText('#AABBCC', { isSecure: false })).toBe('manual');
  });
});
