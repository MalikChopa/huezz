// Unit tests of scripts/scan.mjs. Every sensitive sample is assembled at run time (join), so that this file
// itself stays clean when the repository is scanned, and no fake secret is stored literally.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { URL_ALLOWLIST, machineProfile, scanFolder, scanImage, scanText } from '../../scripts/scan.mjs';
import { encodeGif } from '../../scripts/gif.mjs';

const S = (...p) => p.join('');
const machine = { username: 'zzuser', hostname: 'zzhost-machine.local', home: S('/Us', 'ers/zzuser'), extra: '' };
const rules = (text, name = 'f.txt', opts = {}) => scanText(text, name, { machine, ...opts }).map((f) => f.rule);
const has = (text, rule, opts) => expect(rules(text, 'f.txt', opts), text).toContain(rule);
const clean = (text, name, opts) => expect(scanText(text, name ?? 'f.txt', { machine, ...opts }), text).toEqual([]);

const tmp = mkdtempSync(pjoin(tmpdir(), 'scan-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('text rules: findings', () => {
  it('absolute personal paths', () => {
    has(S('open ', '/Us', 'ers/someone/Documents'), 'path');
    has(S('cd ', '/ho', 'me/someone/work'), 'path');
    has(S('C:\\\\Us', 'ers\\\\someone'), 'path');
    has(S('C:\\Us', 'ers\\someone'), 'path');
    has(S('cache in ', '/priv', 'ate/tmp/x'), 'path');
    has(S('/var/fol', 'ders/ab/cd'), 'path');
  });
  it('user name in a path context, the machine user name and host name', () => {
    has(S('see ', '/', 'chopa', '/notes'), 'path');
    has(S('~', 'chopa', '/x'), 'path');
    has(S('/data/', machine.username, '/x'), 'path');
    has(S('owner is ', machine.username, ' here'), 'machine');
    has(S('on host ', machine.hostname), 'machine');
    has(S('on host ', machine.hostname.replace('.local', '')), 'machine');
  });
  it('strings supplied at run time', () => {
    has('the word Plumbus appears', 'name', { machine: { ...machine, extra: 'plumbus,other' } });
  });
  it('personal names: the former family name (any case, inside a word) and the first name', () => {
    has(S('by ', 'Mous', 'saoui'), 'name');
    has(S('MOUS', 'SAOUI.pdf'), 'name');
    has(S('file_', 'mous', 'saoui', '_cv'), 'name');
    has(S('Ma', 'lik wrote this'), 'name');
    has(S('ma', 'lik'), 'name');
    has(S('Ma', 'likCho', 'pa/x ma', 'lik'), 'name'); // handle stripped, but the extra first name remains
  });
  it('e-mail addresses other than noreply and example domains', () => {
    has(S('mail ', 'someone', '@', 'gmail.com'), 'email');
    has(S('mail ', 'someone', '@', 'example.net'), 'email');
    has(S('42+someone', '@', 'users.noreply.github.com.evil.io'), 'email');
  });
  it('IPv4 and IPv6 addresses', () => {
    has(S('host 192', '.168', '.1.20'), 'ip');
    has(S('host 8.', '8.8', '.8'), 'ip');
    has(S('addr 2001', ':db8', ':85a3', ':0000:0000:8a2e:0370:7334'), 'ip');
    has(S('addr fe80', '::1', 'ff:fe23:4567'), 'ip');
    has(S('addr 2001', ':db8', '::', '42'), 'ip');
  });
  it('URLs outside the allowlist, ssh remotes', () => {
    has(S('see ', 'https:', '//', 'tracker.example.org/x'), 'url'); // example.org is not an allowed URL host (only example.com)
    has(S('see ', 'http:', '//', 'evil.invalid/path'), 'url');
    has(S('see ', 'https:', '//', 'github.com/someone/else'), 'url');
    has(S('see ', 'https:', '//', 'github.com/', 'MalikChopaX/huezz'), 'url');
    has(S('url = ', 'git@', 'github.com:someone/x.git'), 'url');
    has(S('src="', 'file:', '///x/y.png"'), 'url');
  });
  it('secret patterns', () => {
    has(S('gh', 'p_', 'a'.repeat(36)), 'secret');
    has(S('gh', 'o_', 'B'.repeat(30)), 'secret');
    has(S('github_', 'pat_', 'A1'.repeat(15)), 'secret');
    has(S('AK', 'IA', 'ABCDEFGHIJKLMNOP'), 'secret');
    has(S('s', 'k-', 'abcdefghijklmnopqrstuv'), 'secret');
    has(S('xo', 'xb-', '1234567890-abcdefghij'), 'secret');
    has(S('-----BEGIN RSA ', 'PRIV', 'ATE KEY-----'), 'secret');
    has(S('pass', 'word=', 'hunter22'), 'secret');
    has(S('to', 'ken=', 'abcd1234'), 'secret');
    has(S('const x = { to', "ken: '", "abcdef123456'", ' }'), 'secret');
    has(S('PASS', 'WORD = "', 'letmein99"'), 'secret');
  });
  it('phone-like numbers', () => {
    has(S('call +33 ', '6 12 34 56 78'), 'phone');
    has(S('call 0', '6 12 34 56 78'), 'phone');
    has(S('call 0', '612345678'.replace(/^(.{1})(.{2})(.{2})(.{2})(.{2})$/, '$1.$2.$3.$4.$5')), 'phone');
    has(S('call (415', ') 555-', '0132'), 'phone');
    has(S('call 415', '-555-', '0132'), 'phone');
  });
  it('internal process traces', () => {
    has(S('built by Dia', 'pason'), 'process');
    has(S('see HAND', 'OFF notes'), 'process');
    has(S('see CLAU', 'DE.md'), 'process');
    has(S('docs/brie', 'fs/01.md'), 'process');
    has(S('the .cla', 'ude folder'), 'process');
  });
  it('mentions of the tools used are findings unless allowed', () => {
    const text = S('made with Cla', 'ude and some sub-', 'agents');
    has(text, 'process');
    clean(text, 'f.txt', { allowAiMention: true });
  });
  it('line numbers are reported and secrets are redacted', () => {
    const secret = S('gh', 'p_', 'a'.repeat(36));
    const found = scanText(S('ok\nok\nkey ', secret, ' end'), 'x.txt', { machine });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: 'x.txt', line: 3, rule: 'secret' });
    expect(JSON.stringify(found)).not.toContain(secret);
  });
});

describe('text rules: no false alarm', () => {
  it('allowed e-mail, URLs, handle, loopback', () => {
    clean(S('Chopa <', '12345+Chopa', '@', 'users.noreply.github.com>'));
    clean(S('write to ', 'someone', '@', 'example.com'));
    clean(S('https:', '//', 'github.com/', 'MalikChopa'));
    clean(S('https:', '//', 'github.com/', 'MalikChopa/huezz/issues'));
    clean(S('https:', '//', 'malikchopa.github.io/huezz/'));
    clean(S('https:', '//', 'github.com/actions/checkout'));
    clean(S('xmlns="http:', '//', 'www.w3.org/2000/svg"'));
    clean(S('https:', '//', 'developer.mozilla.org/en-US/docs/Web/CSS'));
    clean(S('https:', '//', 'huezz.test/'));
    clean(S('fetch("https:', '//', 'example.com/")'));
    clean(S('http:', '//', 'localhost:5173/'));
    clean(S('listen 127.0', '.0.1 and ::1 and 0.0', '.0.0'));
    clean(S('Copyright (c) 2026 Chopa'));
  });
  it('lockfile addresses are allowed only in the lockfile', () => {
    const u = S('"resolved": "https:', '//', 'registry.npmjs.org/x/-/x-1.0.0.tgz"');
    clean(u, 'package-lock.json');
    has(u, 'url');
    const funding = S('"url": "https:', '//', 'opencollective.com/vitest"');
    clean(funding, 'package-lock.json');
    has(funding, 'url');
  });
  it('ordinary code and text', () => {
    clean('const token = parseToken(input); // not an assignment of a literal');
    clean('const { token } = state; let secret = compute(x);');
    clean('a::before { content: ""; } b::after, i::placeholder, ::-webkit-scrollbar');
    clean('"version": "4.14.0", "node": ">=24", vite@8.3.5');
    clean('color: rgb(255 255 255); viewBox="0 0 16 16"; rgba(0, 0, 0, 0.25)');
    clean('#v=1&m=l&h=co&s=00c0ffee&k=00&l=F5F8F7FFFFFF0E1F1D0F7C74D95A4E2C7A3FB93A2B');
    clean('1440 x 900, 96 308 octets, 27 895 octets gzip, p95 0,70 ms');
    clean('@media (max-width: 760px) { @property --t { syntax: "<time>"; } }');
    clean('# README\n\nHuezz is a palette generator.');
  });
});

describe('machine profile', () => {
  it('reads the machine and honours overrides', () => {
    const m = machineProfile({ extra: 'a, b' });
    expect(typeof m.username).toBe('string');
    expect(m.extra).toEqual(['a', 'b']);
    expect(machineProfile({ username: 'u', hostname: 'h', home: '/h', extra: '' })).toEqual({ username: 'u', hostname: 'h', home: '/h', extra: [] });
  });
});

describe('URL allowlist', () => {
  it('every entry has a reason', () => {
    expect(URL_ALLOWLIST.length).toBeGreaterThan(5);
    for (const a of URL_ALLOWLIST) expect(a.why.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------- images

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (b) => {
  let c = -1;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function pngChunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), body])));
  return Buffer.concat([len, Buffer.from(type), body, crc]);
}
function makePng(extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), ...extra, pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0, 0, 0, 4, 0, 1])), pngChunk('IEND', Buffer.alloc(0))]);
}
function jpegSeg(marker, body) {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
}
const makeJpeg = (segments = []) => Buffer.concat([Buffer.from([0xff, 0xd8]), jpegSeg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), ...segments, jpegSeg(0xdb, Buffer.alloc(65)), Buffer.from([0xff, 0xda, 0, 2]), Buffer.from([0xff, 0xd9])]);

describe('image metadata', () => {
  it('PNG: clean file passes, text and EXIF chunks and timestamps are findings', () => {
    expect(scanImage(makePng())).toEqual([]);
    expect(scanImage(makePng([pngChunk('sRGB', Buffer.from([0])), pngChunk('pHYs', Buffer.alloc(9))]))).toEqual([]);
    const text = scanImage(makePng([pngChunk('tEXt', Buffer.from(S('Comment\0', 'x')))]));
    expect(text).toHaveLength(1);
    expect(text[0].detail).toContain('tEXt');
    expect(scanImage(makePng([pngChunk('eXIf', Buffer.from('MM\0*'))]))).toHaveLength(1);
    expect(scanImage(makePng([pngChunk('tIME', Buffer.alloc(7))]))).toHaveLength(1);
    expect(scanImage(makePng([pngChunk('iTXt', Buffer.from('XML:com.adobe.xmp\0'))]))).toHaveLength(1);
  });
  it('JPEG: JFIF only passes; EXIF, XMP, IPTC and comments are findings', () => {
    expect(scanImage(makeJpeg())).toEqual([]);
    expect(scanImage(makeJpeg([jpegSeg(0xe2, Buffer.from('ICC_PROFILE\0abc'))]))).toEqual([]);
    expect(scanImage(makeJpeg([jpegSeg(0xe1, Buffer.from('Exif\0\0MM'))]))).toHaveLength(1);
    expect(scanImage(makeJpeg([jpegSeg(0xed, Buffer.from('Photoshop 3.0\0'))]))).toHaveLength(1);
    expect(scanImage(makeJpeg([jpegSeg(0xfe, Buffer.from('hello'))]))).toHaveLength(1);
  });
  it('GIF: the encoder output passes; a comment or an unknown application block is a finding', () => {
    const px = new Uint8Array(4 * 4 * 4).fill(255);
    const gif = encodeGif({ width: 4, height: 4, frames: [{ data: px, delay: 100 }] });
    expect(scanImage(gif)).toEqual([]);
    // insert an extension right after the logical screen descriptor and the global colour table
    const at = 13 + (gif[10] & 0x80 ? 3 * (1 << ((gif[10] & 7) + 1)) : 0);
    const withComment = Buffer.concat([gif.subarray(0, at), Buffer.from([0x21, 0xfe, 3, 0x61, 0x62, 0x63, 0]), gif.subarray(at)]);
    expect(scanImage(withComment).map((f) => f.detail)).toEqual(['GIF comment extension']);
    const app = Buffer.concat([gif.subarray(0, at), Buffer.from([0x21, 0xff, 11]), Buffer.from('ADOBE:IMAGE'), Buffer.from([1, 1, 0]), gif.subarray(at)]);
    expect(scanImage(app)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- folders

describe('scanFolder', () => {
  const folder = (name, files) => {
    const dir = pjoin(tmp, name);
    mkdirSync(dir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(pjoin(dir, rel, '..'), { recursive: true });
      writeFileSync(pjoin(dir, rel), content);
    }
    return dir;
  };
  it('a clean folder: 0 findings, files counted', () => {
    const dir = folder('clean', { 'README.md': '# Hello\n', 'src/a.ts': 'export const a = 1;\n', 'x.png': makePng(), 'y.jpg': makeJpeg() });
    const r = scanFolder(dir, { machine, git: false });
    expect(r.findings).toEqual([]);
    expect(r.files).toBe(4);
    expect(r.images.sort()).toEqual(['x.png', 'y.jpg']);
  });
  it('findings carry file and line; names of files are scanned; unknown binaries and symlinks are findings', () => {
    const dir = folder('dirty', {
      'a.txt': S('fine\nsee ', '/Us', 'ers/someone/x\n'),
      [S('notes-', 'Mous', 'saoui.txt')]: 'x\n',
      'blob.bin': Buffer.from([1, 2, 0, 3]),
      'fake.png': 'not an image',
      'meta.png': makePng([pngChunk('tEXt', Buffer.from('Author\0x'))]),
    });
    symlinkSync('/tmp', pjoin(dir, 'link'));
    const r = scanFolder(dir, { machine, git: false });
    const keys = r.findings.map((f) => `${f.file}|${f.rule}`);
    expect(keys).toContain('a.txt|path');
    expect(r.findings.find((f) => f.file === 'a.txt').line).toBe(2);
    expect(keys).toContain(S('notes-', 'Mous', 'saoui.txt|name'));
    expect(keys).toContain('blob.bin|binary');
    expect(keys).toContain('fake.png|metadata');
    expect(keys).toContain('meta.png|metadata');
    expect(keys).toContain('link|symlink');
  });
  it('node_modules is not scanned; the .git folder is read through git (author and committer)', () => {
    const dir = folder('repo', { 'node_modules/x/a.txt': S('/Us', 'ers/someone'), 'README.md': 'ok\n' });
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('-c', 'commit.gpgsign=false', '-c', S('user.', 'email=', 'someone', '@', 'users.noreply.github.com'), '-c', 'user.name=Chopa', 'add', '.');
    git('-c', 'commit.gpgsign=false', '-c', S('user.', 'email=', 'someone', '@', 'users.noreply.github.com'), '-c', 'user.name=Chopa', 'commit', '-q', '-m', 'Initial commit');
    const ok = scanFolder(dir, { machine });
    expect(ok.findings).toEqual([]);
    expect(ok.gitNote).toContain('1 commit');
    writeFileSync(pjoin(dir, 'more.txt'), 'x\n');
    git('add', '.');
    git('-c', 'commit.gpgsign=false', '-c', S('user.', 'email=', 'someone', '@', 'gmail.com'), '-c', 'user.name=Someone', 'commit', '-q', '-m', 'second');
    const bad = scanFolder(dir, { machine });
    expect(bad.findings.map((f) => `${f.file}|${f.rule}`)).toContain('.git (log)|email');
    git('remote', 'add', 'origin', S('https:', '//', 'github.com/someone/else.git'));
    expect(scanFolder(dir, { machine }).findings.map((f) => f.file)).toContain('.git (config)');
  });
});
