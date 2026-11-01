// Pre-publication scan: personal data, secrets, machine traces and process traces in a folder.
//
//   node scripts/scan.mjs <folder> [--allowlist] [--allow-ai-mention] [--no-git]
//
// Exit code 0: nothing found. 1: at least one finding (listed). 2: usage or read error.
// No dependency. Sensitive literals are assembled at run time (see `join`), so that this file
// does not match its own rules and can be published with the rest of the repository.
// Personal name: only a SHA-256 hash is stored here, never the name itself. More strings can be
// supplied at run time without being stored: HUEZZ_SCAN_EXTRA="name1,name2" (case-insensitive).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { basename, join as pathJoin, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const join = (...parts) => parts.join('');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- configuration

/** The public GitHub handle (public by design: README, package.json, licence holder is the author name). */
const PUBLIC_HANDLE = 'MalikChopa';
/** The public author name used in LICENSE and package.json. */
const PUBLIC_AUTHOR = 'Chopa';
/** SHA-256 (hex) of the lower-case words that must never appear: the former personal family name. */
const NAME_HASHES = new Set(['800ae09f5bec65ab40aac2149a0ccb7b1b5518418a84f1b99c376410ef12e3d9']);

/**
 * URLs that may appear. Each entry: host (exact, or any sub-domain when `sub`), optional path prefix, optional file name.
 * Everything else is a finding. Reasons are given so the list can be audited.
 */
export const URL_ALLOWLIST = [
  { host: 'github.com', path: `/${PUBLIC_HANDLE}`, why: 'public profile and repository of the author' },
  { host: `${PUBLIC_HANDLE.toLowerCase()}.github.io`, why: 'demo site served by GitHub Pages (exists once Pages is enabled)' },
  { host: 'github.com', path: '/actions/', why: 'official actions used by the Pages workflow' },
  { host: 'docs.github.com', why: 'GitHub documentation (workflow comments)' },
  { host: 'www.w3.org', why: 'XML/SVG namespaces and the W3C specifications (WCAG, CSS)' },
  { host: 'developer.mozilla.org', why: 'MDN reference pages' },
  { host: 'designtokens.org', why: 'design tokens format referenced by the Figma export' },
  { host: 'bottosson.github.io', why: 'OKLab / OKLCH reference by its author' },
  { host: 'registry.npmjs.org', file: 'package-lock.json', why: 'resolved tarball addresses of the lockfile' },
  { host: 'github.com', file: 'package-lock.json', why: 'funding and sponsor links of the dependencies, only in the lockfile' },
  { host: 'opencollective.com', file: 'package-lock.json', why: 'funding links of the dependencies, only in the lockfile' },
  { host: 'tidelift.com', file: 'package-lock.json', why: 'funding links of the dependencies, only in the lockfile' },
  { host: 'huezz.test', why: 'fictive origin of the offline and share tests (reserved .test TLD)' },
  { host: 'control.test', why: 'fictive origin of a test control (reserved .test TLD)' },
  { host: 'example.com', sub: true, why: 'reserved example domain (RFC 2606)' },
  { host: 'localhost', why: 'local development server' },
  { host: '127.0.0.1', why: 'loopback address, no machine information' },
];
const EMAIL_ALLOWED_DOMAINS = ['users.noreply.github.com', 'example.com', 'example.org'];
const IP_ALLOWED = new Set(['127.0.0.1', '0.0.0.0', '::1']);

// ---------------------------------------------------------------- rules (text)

const reAbsPaths = [
  [new RegExp(join('\\/Us', 'ers\\/')), 'macOS home path'],
  [new RegExp(join('\\/ho', 'me\\/[A-Za-z0-9_.-]+')), 'Linux home path'],
  [new RegExp(join('[A-Za-z]:\\\\{1,2}Us', 'ers\\\\')), 'Windows home path'],
  [new RegExp(join('\\/priv', 'ate\\/(?:tmp|var)\\b')), 'machine temp path'],
  [new RegExp(join('\\/var\\/fol', 'ders\\/')), 'machine temp path'],
  [new RegExp(join('\\/Libr', 'ary\\/Application Support')), 'macOS application path'],
  [new RegExp(join('\\.cla', 'ude\\b'), 'i'), 'agent configuration folder'],
];
const reEmail = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g;
const reUrl = /\b(?:https?|ftp|ssh|git|file):\/\/[^\s"'<>)\]`,;\\]+/gi;
const reGitRemote = /\bgit@[\w.-]+:/g;
const reIp4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;
const reIp6Full = /(?<![\w:.])(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}(?![\w:])/g;
const reIp6Short = /(?<![\w:.])(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?::(?:[0-9A-Fa-f]{1,4}(?::[0-9A-Fa-f]{1,4}){0,6})?(?![\w:-])/g;
const secretPatterns = [
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'secret key (sk-)'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bnpm_[A-Za-z0-9]{30,}/, 'npm token'],
  [new RegExp(join('-----BEGIN [A-Z ]*PRIV', 'ATE KEY-----')), 'private key header'],
  // A name glued to its value (query string, ini file, shell) ...
  [/\b(?:password|passwd|token|secret|api[_-]?key)=[^\s&"',;)}\]]{4,}/i, 'password / token assignment'],
  // ... or followed by a quoted literal, or by a long unquoted value containing a digit; a code variable such as a call result is not one.
  [/\b(?:password|passwd|token|secret|api[_-]?key)["']?\s*[=:]\s*(?:["'][^"'\s]{6,}["']|(?=[A-Za-z0-9_+/=.-]*\d)[A-Za-z0-9_+/=.-]{12,})/i, 'password / token assignment'],
];
const phonePatterns = [
  /(?<![\w.#/-])\+\d{1,3}[ .-]?\(?\d{1,4}\)?(?:[ .-]?\d{2,4}){2,4}(?![\w.])/,
  /(?<![\w.#/-])0[1-9](?:[ .-]?\d{2}){4}(?![\w.-])/,
  /(?<![\w.#/-])\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\w.-])/,
];
const processWords = [
  [new RegExp(join('Dia', 'pason'), 'i'), 'internal process word'],
  [new RegExp(join('HAND', 'OFF')), 'internal process word'],
  [new RegExp(join('CLAU', 'DE\\.md')), 'internal process file'],
  [new RegExp(join('brie', 'fs\\/')), 'internal process folder'],
];
const aiWords = [[new RegExp(`\\b(?:${[join('Cla', 'ude'), join('Anthr', 'opic'), join('sub-?', 'agents?'), join('AI ', 'agents?'), join('agents? ', 'IA')].join('|')})\\b`, 'i'), 'mention of the tools used to build the project (decision left to the author)']];

function wordHashHit(line) {
  for (const m of line.matchAll(/[A-Za-z]{5,24}/g)) {
    const word = m[0];
    const parts = [word, ...(word.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) ?? [])];
    for (const p of parts) {
      if (p.length >= 5 && NAME_HASHES.has(createHash('sha256').update(p.toLowerCase()).digest('hex'))) return p;
    }
  }
  return null;
}

/** Values specific to the machine running the scan (overridable for tests). */
export function machineProfile(over = {}) {
  const username = over.username ?? safe(() => userInfo().username, '');
  const host = over.hostname ?? safe(() => hostname(), '');
  const home = over.home ?? safe(() => homedir(), '');
  const extra = (over.extra ?? process.env.HUEZZ_SCAN_EXTRA ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { username, hostname: host, home, extra };
}
const safe = (fn, d) => {
  try {
    return fn();
  } catch {
    return d;
  }
};

function urlAllowed(raw, fileName) {
  let u;
  try {
    u = new URL(raw.replace(/[.]+$/, ''));
  } catch {
    return false;
  }
  if (u.protocol === 'file:') return false;
  const host = u.hostname.toLowerCase();
  const path = decodeURIComponent(u.pathname);
  return URL_ALLOWLIST.some((a) => {
    if (a.file && a.file !== fileName) return false;
    const hostOk = host === a.host.toLowerCase() || (a.sub && host.endsWith(`.${a.host.toLowerCase()}`));
    if (!hostOk) return false;
    if (!a.path) return true;
    const boundary = a.path.endsWith('/') ? path.startsWith(a.path) : path === a.path || path.startsWith(`${a.path}/`);
    return boundary || path.toLowerCase() === a.path.toLowerCase() || path.toLowerCase().startsWith(`${a.path.toLowerCase()}/`);
  });
}

const snippet = (line, index, length = 0) => {
  const from = Math.max(0, index - 20);
  return line.slice(from, Math.min(line.length, index + Math.max(length, 1) + 30)).trim().slice(0, 90);
};

/** Scan one text. `name` is only used in findings and to pick file-specific allowances. */
export function scanText(text, name, options = {}) {
  const machine = options.machine ?? machineProfile();
  const findings = [];
  const add = (line, rule, detail) => findings.push({ file: name, line, rule, detail });
  const fileName = basename(name);
  const handle = new RegExp(esc(PUBLIC_HANDLE), 'gi');
  const usernameLower = machine.username.toLowerCase();
  const pathContext = (word) => new RegExp(`(?:[/\\\\~]|\\b[A-Za-z]:\\\\?)${esc(word)}(?![A-Za-z0-9])`, 'i');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const n = i + 1;
    if (!line) return;
    for (const [re, what] of reAbsPaths) {
      const m = re.exec(line);
      if (m) add(n, 'path', `${what}: ${snippet(line, m.index, m[0].length)}`);
    }
    // user name and machine names
    const pathWords = new Set(['chopa', ...(usernameLower.length >= 3 ? [usernameLower] : [])]);
    for (const w of pathWords) {
      const m = pathContext(w).exec(line);
      if (m) add(n, 'path', `user name in a path: ${snippet(line, m.index, m[0].length)}`);
    }
    if (usernameLower.length >= 3 && usernameLower !== PUBLIC_AUTHOR.toLowerCase()) {
      const m = new RegExp(`(?<![A-Za-z0-9])${esc(usernameLower)}(?![A-Za-z0-9])`, 'i').exec(line);
      if (m) add(n, 'machine', `machine user name: ${snippet(line, m.index, m[0].length)}`);
    }
    if (machine.hostname.length >= 6) {
      for (const h of new Set([machine.hostname, machine.hostname.replace(/\.local$/i, '')])) {
        const k = line.toLowerCase().indexOf(h.toLowerCase());
        if (h.length >= 6 && k >= 0) add(n, 'machine', `machine host name: ${snippet(line, k, h.length)}`);
      }
    }
    for (const w of machine.extra) {
      const k = line.toLowerCase().indexOf(w.toLowerCase());
      if (k >= 0) add(n, 'name', `listed string: ${snippet(line, k, w.length)}`);
    }
    // names
    const hit = wordHashHit(line);
    if (hit) add(n, 'name', `former personal name (${hit.length} letters, stored as a hash)`);
    const stripped = line.replace(handle, ' ');
    const first = new RegExp(join('ma', 'lik'), 'i').exec(stripped);
    if (first) add(n, 'name', `first name outside the public handle: ${snippet(stripped, first.index, 5)}`);
    // e-mail addresses
    for (const m of line.matchAll(reEmail)) {
      const domain = m[1].toLowerCase();
      if (!EMAIL_ALLOWED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) add(n, 'email', `address: ${m[0]}`);
    }
    // addresses
    for (const m of line.matchAll(reIp4)) {
      const parts = m[0].split('.').map(Number);
      if (parts.every((p) => p <= 255) && !IP_ALLOWED.has(m[0])) add(n, 'ip', `IPv4: ${m[0]}`);
    }
    for (const re of [reIp6Full, reIp6Short]) {
      for (const m of line.matchAll(re)) {
        if (m[0].length >= 3 && !IP_ALLOWED.has(m[0].toLowerCase())) add(n, 'ip', `IPv6: ${m[0]}`);
      }
    }
    for (const m of line.matchAll(reGitRemote)) add(n, 'url', `ssh remote: ${m[0]}`);
    for (const m of line.matchAll(reUrl)) {
      if (!urlAllowed(m[0], fileName)) add(n, 'url', `not in the allowlist: ${m[0].slice(0, 90)}`);
    }
    for (const [re, what] of secretPatterns) {
      const m = re.exec(line);
      if (m) add(n, 'secret', `${what}: ${m[0].slice(0, 6)}... (redacted)`);
    }
    for (const re of phonePatterns) {
      const m = re.exec(line);
      if (m) add(n, 'phone', `phone-like number: ${m[0]}`);
    }
    for (const [re, what] of processWords) {
      const m = re.exec(line);
      if (m) add(n, 'process', `${what}: ${snippet(line, m.index, m[0].length)}`);
    }
    if (!options.allowAiMention) {
      for (const [re, what] of aiWords) {
        const m = re.exec(line);
        if (m) add(n, 'process', `${what}: ${snippet(line, m.index, m[0].length)}`);
      }
    }
  });
  return findings;
}

// ---------------------------------------------------------------- binary metadata

const PNG_OK = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'sRGB', 'gAMA', 'cHRM', 'pHYs', 'sBIT', 'bKGD', 'iCCP']);

/** Check an image's container for metadata (EXIF, comments, text chunks...). Returns findings (file name left to the caller). */
export function scanImage(buf) {
  const out = [];
  const add = (detail) => out.push({ line: 0, rule: 'metadata', detail });
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) {
    let pos = 8;
    while (pos + 12 <= buf.length) {
      const len = buf.readUInt32BE(pos);
      const type = buf.toString('latin1', pos + 4, pos + 8);
      if (!PNG_OK.has(type)) {
        const text = /^(?:tEXt|zTXt|iTXt)$/.test(type) ? ` (keyword "${buf.toString('latin1', pos + 8, pos + 8 + Math.min(len, 20)).split('\0')[0]}")` : '';
        add(`PNG chunk ${type}${text}`);
      }
      if (type === 'IEND') break;
      pos += 12 + len;
    }
  } else if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let pos = 2;
    while (pos + 4 <= buf.length) {
      if (buf[pos] !== 0xff) break;
      const marker = buf[pos + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        pos += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan data
      const len = buf.readUInt16BE(pos + 2);
      const head = buf.toString('latin1', pos + 4, pos + 4 + Math.min(12, len - 2));
      if (marker === 0xe0) {
        if (!head.startsWith('JFIF')) add('JPEG APP0 that is not JFIF');
      } else if (marker === 0xe2) {
        if (!/^(?:ICC_PROFILE|MPF)/.test(head)) add(`JPEG APP2 ${JSON.stringify(head)}`);
      } else if (marker === 0xfe) add('JPEG comment');
      else if (marker >= 0xe1 && marker <= 0xef) add(`JPEG APP${marker - 0xe0} (${marker === 0xe1 ? 'EXIF / XMP' : marker === 0xed ? 'Photoshop / IPTC' : 'application data'})`);
      pos += 2 + len;
    }
  } else if (buf.toString('latin1', 0, 3) === 'GIF') {
    let pos = 13;
    if (buf[10] & 0x80) pos += 3 * (1 << ((buf[10] & 7) + 1));
    const skipSub = () => {
      while (pos < buf.length && buf[pos] !== 0) pos += buf[pos] + 1;
      pos++;
    };
    while (pos < buf.length && buf[pos] !== 0x3b) {
      if (buf[pos] === 0x21) {
        const label = buf[pos + 1];
        if (label === 0xfe) add('GIF comment extension');
        else if (label === 0x01) add('GIF plain text extension');
        else if (label === 0xff && buf.toString('latin1', pos + 3, pos + 14) !== 'NETSCAPE2.0') add(`GIF application extension ${JSON.stringify(buf.toString('latin1', pos + 3, pos + 14))}`);
        pos += 2;
        skipSub();
      } else if (buf[pos] === 0x2c) {
        const packed = buf[pos + 9];
        pos += 10;
        if (packed & 0x80) pos += 3 * (1 << ((packed & 7) + 1));
        pos++;
        skipSub();
      } else break;
    }
  }
  return out;
}

const isPng = (b) => b.length >= 8 && b.readUInt32BE(0) === 0x89504e47;
const isJpeg = (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isGif = (b) => b.length >= 6 && /^GIF8[79]a/.test(b.toString('latin1', 0, 6));

// ---------------------------------------------------------------- folder

function* walk(dir, base) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = pathJoin(dir, entry.name);
    if (entry.isSymbolicLink()) yield { full, rel: relative(base, full).split(sep).join('/'), symlink: true };
    else if (entry.isDirectory()) yield* walk(full, base);
    else if (entry.isFile()) yield { full, rel: relative(base, full).split(sep).join('/') };
  }
}

/** Scan a folder: all files (text rules, image metadata) and the git metadata when `.git` exists. */
export function scanFolder(dir, options = {}) {
  const findings = [];
  let files = 0;
  let bytes = 0;
  const images = [];
  for (const f of walk(dir, dir)) {
    if (f.symlink) {
      findings.push({ file: f.rel, line: 0, rule: 'symlink', detail: 'symbolic link in the tree' });
      continue;
    }
    const buf = readFileSync(f.full);
    files++;
    bytes += buf.length;
    // the file name itself is also scanned
    findings.push(...scanText(f.rel, f.rel, options).map((x) => ({ ...x, detail: `in the file name: ${x.detail}`, line: 0 })));
    if (isPng(buf) || isJpeg(buf) || isGif(buf)) {
      images.push(f.rel);
      for (const x of scanImage(buf)) findings.push({ file: f.rel, ...x });
      continue;
    }
    if (/\.(?:png|jpe?g|gif)$/i.test(f.rel)) {
      findings.push({ file: f.rel, line: 0, rule: 'metadata', detail: 'image extension but unknown content' });
      continue;
    }
    if (buf.subarray(0, 8192).includes(0)) {
      findings.push({ file: f.rel, line: 0, rule: 'binary', detail: 'unknown binary file' });
      continue;
    }
    findings.push(...scanText(buf.toString('utf8'), f.rel, options));
  }
  let gitNote = 'no .git';
  if (existsSync(pathJoin(dir, '.git')) && options.git !== false) {
    try {
      const run = (args) => execFileSync('git', ['-C', dir, '--no-pager', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const log = run(['log', '--all', '--format=author:%an <%ae>%ncommitter:%cn <%ce>%nsubject:%s%nbody:%b']);
      const config = run(['config', '--local', '--list']);
      const refs = run(['for-each-ref', '--format=%(refname)']);
      const gitFindings = [...scanText(log, '.git (log)', options), ...scanText(config, '.git (config)', options), ...scanText(refs, '.git (refs)', options)];
      findings.push(...gitFindings);
      gitNote = `git log, config and refs scanned (${log.split('\n').filter((l) => l.startsWith('author:')).length} commit(s))`;
    } catch {
      gitNote = '.git present but git could not be read';
      findings.push({ file: '.git', line: 0, rule: 'git', detail: 'git metadata could not be read' });
    }
  }
  return { files, bytes, images, findings, gitNote };
}

// ---------------------------------------------------------------- CLI

function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  if (args.includes('--allowlist')) {
    console.log('URL allowlist:');
    for (const a of URL_ALLOWLIST) console.log(`  ${a.host}${a.sub ? ' (and sub-domains)' : ''}${a.path ? a.path : ''}${a.file ? ` [only in ${a.file}]` : ''} : ${a.why}`);
    console.log(`E-mail domains allowed: ${EMAIL_ALLOWED_DOMAINS.join(', ')}`);
    console.log(`IP addresses allowed: ${[...IP_ALLOWED].join(', ')}`);
    console.log(`Public handle allowed: ${PUBLIC_HANDLE}; public author name: ${PUBLIC_AUTHOR}`);
    if (!target) return;
  }
  if (!target) {
    console.error('usage: node scripts/scan.mjs <folder> [--allowlist] [--allow-ai-mention] [--no-git]');
    process.exit(2);
  }
  if (!existsSync(target) || !lstatSync(target).isDirectory()) {
    console.error(`scan: not a folder: ${target}`);
    process.exit(2);
  }
  const result = scanFolder(target, { allowAiMention: args.includes('--allow-ai-mention'), git: !args.includes('--no-git') });
  console.log(`scan: ${result.files} files (${result.bytes} bytes), ${result.images.length} image(s) checked for metadata; ${result.gitNote}`);
  if (result.findings.length === 0) {
    console.log('scan: 0 findings');
    return;
  }
  for (const f of result.findings) console.log(`${f.file}${f.line ? `:${f.line}` : ''}  [${f.rule}]  ${f.detail}`);
  console.log(`scan: ${result.findings.length} finding(s)`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
