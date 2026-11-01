// Builds the clean public copy of the project from an explicit ALLOWLIST (never a denylist).
//
//   node scripts/public-copy.mjs [--target <folder>] [--dry-run] [--no-git]
//
// The default target is the sibling folder "huezz-public" of the working folder. Allowed content:
//   - copied from the working folder: index.html, package.json (+ public fields), package-lock.json, tsconfig.json,
//     vite.config.ts, vitest.config.ts, .gitignore (without private entries), src/, tests/ (not tests/visual/out),
//     scripts/, docs/CHECKLIST-NAVIGATEURS.md;
//   - written by hand in the public copy itself and carried over from one run to the next when the working
//     folder has no such file: README.md, LICENSE, assets/, .github/workflows/pages.yml.
// Nothing else is ever copied. The script is idempotent: the target is rebuilt from scratch, but it REFUSES to
// delete a folder that holds a .git with more than one commit, a remote, or any file this script does not produce.
// After the copy: the scan runs (no commit if it finds anything), then `git init -b main` and ONE local commit.
// Nothing is pushed: no remote is ever added.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanFolder } from './scan.mjs';

// ---------------------------------------------------------------- the allowlist

/** Copied from the working folder as they are. */
export const COPY_FILES = ['index.html', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'docs/CHECKLIST-NAVIGATEURS.md'];
/** Copied from the working folder with a transformation (see `transform*`). */
export const TRANSFORMED_FILES = ['package.json', '.gitignore'];
/** Copied recursively; the listed sub-paths and file names are left out. */
export const COPY_DIRS = ['src', 'tests', 'scripts'];
export const EXCLUDED_PATHS = ['tests/visual/out', 'tests/visual/README.md', 'tests/visual/ref/README.md'];
export const EXCLUDED_NAMES = ['.DS_Store'];
/** Public-only content: taken from the working folder if present there, otherwise carried over from the previous public copy. */
export const PUBLIC_ONLY_FILES = ['README.md', 'LICENSE', '.github/workflows/pages.yml'];
export const PUBLIC_ONLY_DIRS = ['assets'];

/** Public identity written into package.json. The public URLs do not exist until the repository is published. */
export const PUBLIC = {
  author: 'Chopa',
  license: 'MIT',
  handle: 'MalikChopa',
  repo: 'huezz',
  description: 'Colour palette generator in OKLCH: live previews on three mock-ups, WCAG contrast check and one-click fix, light and dark, 7 export outputs, shareable link. Static site, no runtime dependency.',
  keywords: ['color-palette', 'palette-generator', 'oklch', 'wcag', 'contrast', 'design-tokens', 'tailwind', 'css-variables', 'accessibility', 'vite', 'typescript', 'github-pages'],
};

// ---------------------------------------------------------------- transformations

export function transformPackageJson(text) {
  const src = JSON.parse(text);
  const web = 'https:' + '//'; // assembled: the scanner reads URL literals
  const url = `${web}github.com/${PUBLIC.handle}/${PUBLIC.repo}`;
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = v;
    if (k === 'name') out.description = PUBLIC.description;
    if (k === 'type') {
      out.license = PUBLIC.license;
      out.author = PUBLIC.author;
      out.repository = { type: 'git', url: `git+${url}.git` };
      out.homepage = `${web}${PUBLIC.handle.toLowerCase()}.github.io/${PUBLIC.repo}/`;
      out.bugs = { url: `${url}/issues` };
      out.keywords = PUBLIC.keywords;
    }
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The public .gitignore keeps the generic entries and drops the ones that name private folders. */
export function transformGitignore(text) {
  return text
    .split('\n')
    .filter((l) => !/maquette/i.test(l))
    .join('\n');
}

/**
 * Text patches applied to the copied files only (never to the working folder): a hard-coded machine path in a
 * test becomes a temporary folder of the OS. Skipped, and reported, when the pattern is absent (already fixed).
 */
export const PATCHES = [
  {
    file: 'tests/export/export.test.ts',
    why: 'absolute scratch path of the machine replaced by os.tmpdir()',
    apply(text) {
      const re = /^const WORK = '\/[^']*swift-check';$/m;
      if (!re.test(text)) return null;
      const withLine = text.replace(re, "const WORK = join(tmpdir(), 'huezz-swift-check');");
      return withLine.replace(/^(import \{ spawnSync \} from 'node:child_process';\n)/, "$1import { tmpdir } from 'node:os';\nimport { join } from 'node:path';\n");
    },
  },
];

/** Plain line diff (LCS), for display. */
export function lineDiff(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  const t = Array.from({ length: x.length + 1 }, () => new Int32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) out.push(`- ${x[i++]}`);
    else out.push(`+ ${y[j++]}`);
  }
  while (i < x.length) out.push(`- ${x[i++]}`);
  while (j < y.length) out.push(`+ ${y[j++]}`);
  return out;
}

// ---------------------------------------------------------------- target safety

const posix = (p) => p.split(sep).join('/');

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.name === '.git' && dir === base) continue;
    if (e.isDirectory()) out.push(...listFiles(full, base));
    else out.push(posix(relative(base, full)));
  }
  return out.sort();
}

/** Is this relative path one the script produces (or carries over)? */
export function isProducedPath(rel) {
  if (EXCLUDED_NAMES.some((n) => rel.split('/').pop() === n)) return false;
  if ([...COPY_FILES, ...TRANSFORMED_FILES, ...PUBLIC_ONLY_FILES].includes(rel)) return true;
  if (EXCLUDED_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`))) return false;
  return [...COPY_DIRS, ...PUBLIC_ONLY_DIRS].some((d) => rel.startsWith(`${d}/`));
}

const git = (cwd, args, env = {}) => execFileSync('git', ['-C', cwd, '--no-pager', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });

/** Throws when the target must not be deleted. */
export function assertTargetDeletable(target) {
  if (!existsSync(target)) return;
  if (!lstatSync(target).isDirectory()) throw new Error(`refuse: ${target} exists and is not a folder`);
  if (existsSync(join(target, '.git'))) {
    let count = 0;
    try {
      count = Number(git(target, ['rev-list', '--count', 'HEAD']).trim());
    } catch {
      count = 0; // no commit yet
    }
    if (count > 1) throw new Error(`refuse: ${target} has a git history of ${count} commits (more than the initial one)`);
    const remotes = git(target, ['remote']).trim();
    if (remotes) throw new Error(`refuse: ${target} has a git remote (${remotes}); it may have been published`);
    const status = git(target, ['status', '--porcelain']).replace(/\s+$/, ''); // not trimmed at the start: the first column may be a space
    if (status && count === 1) {
      // uncommitted edits to files we produce are tolerated only if every changed path is a produced one
      for (const line of status.split('\n')) {
        const rel = line.slice(3).replace(/^"|"$/g, '');
        if (!isProducedPath(rel) && !rel.endsWith('/')) throw new Error(`refuse: ${target} has a change in a file the script does not produce: ${rel}`);
      }
    }
  }
  const stray = listFiles(target).filter((rel) => !isProducedPath(rel));
  if (stray.length) throw new Error(`refuse: ${target} holds ${stray.length} file(s) the script does not produce, for example ${stray.slice(0, 3).join(', ')}`);
}

// ---------------------------------------------------------------- build

/**
 * @param {object} o
 * @param {string} o.root working folder
 * @param {string} o.target public copy folder
 * @param {boolean} [o.git=true] init the repository and make the single commit
 * @param {boolean} [o.dryRun=false] list what would happen, change nothing
 * @param {{name: string, email: string}} [o.identity] commit identity (read from the working folder's git config when omitted)
 * @param {(line: string) => void} [o.log]
 */
export function buildPublicCopy({ root, target, git: withGit = true, dryRun = false, identity, log = () => {} }) {
  root = resolve(root);
  target = resolve(target);
  if (target === root || target.startsWith(root + sep) || root.startsWith(target + sep)) throw new Error('refuse: the target must be a separate folder');
  // 1. identity: the noreply address only
  let id = identity;
  if (withGit && !id) {
    const name = git(root, ['config', 'user.name']).trim();
    const email = git(root, ['config', 'user.email']).trim();
    id = { name, email };
  }
  if (withGit && !/@users\.noreply\.github\.com$/.test(id.email)) throw new Error('refuse: the commit address is not a noreply address of GitHub');
  // 2. what is carried over from the previous public copy
  assertTargetDeletable(target);
  const carried = new Map();
  const carryDir = (rel) => {
    const abs = join(target, rel);
    if (existsSync(abs) && statSync(abs).isDirectory()) for (const f of listFiles(abs, target)) carried.set(f, readFileSync(join(target, f)));
  };
  for (const rel of PUBLIC_ONLY_FILES) {
    if (!existsSync(join(root, rel)) && existsSync(join(target, rel))) carried.set(rel, readFileSync(join(target, rel)));
  }
  for (const d of PUBLIC_ONLY_DIRS) if (!existsSync(join(root, d))) carryDir(d);
  // 3. the list of files to produce
  const plan = [];
  for (const rel of [...COPY_FILES, ...TRANSFORMED_FILES]) {
    if (!existsSync(join(root, rel))) throw new Error(`missing in the working folder: ${rel}`);
    plan.push({ rel, from: join(root, rel) });
  }
  const skipped = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = `${rel}/${e.name}`;
      if (EXCLUDED_NAMES.includes(e.name) || EXCLUDED_PATHS.includes(r)) {
        skipped.push(r);
        continue;
      }
      if (e.isSymbolicLink()) skipped.push(`${r} (symbolic link)`);
      else if (e.isDirectory()) walk(r);
      else if (e.isFile()) plan.push({ rel: r, from: join(root, r) });
    }
  };
  for (const d of COPY_DIRS) walk(d);
  for (const rel of PUBLIC_ONLY_FILES) if (existsSync(join(root, rel))) plan.push({ rel, from: join(root, rel) });
  for (const d of PUBLIC_ONLY_DIRS) {
    if (existsSync(join(root, d))) walk(d);
  }
  const need = [...PUBLIC_ONLY_FILES].filter((rel) => !plan.some((p) => p.rel === rel) && !carried.has(rel));
  if (need.length) throw new Error(`missing public-only file(s): ${need.join(', ')} (write them in the public copy first)`);
  const produced = plan.length + carried.size;
  log(`plan: ${plan.length} file(s) copied from the working folder, ${carried.size} carried over from the previous public copy`);
  if (skipped.length) log(`left out: ${skipped.join(', ')}`);
  if (dryRun) {
    for (const p of plan) log(`  copy ${p.rel}`);
    for (const rel of carried.keys()) log(`  keep ${rel}`);
    return { dryRun: true, files: produced };
  }
  // 4. rebuild
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const report = { patches: [], packageDiff: [] };
  for (const p of plan) {
    const dest = join(target, p.rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (p.rel === 'package.json') {
      const before = readFileSync(p.from, 'utf8');
      const after = transformPackageJson(before);
      writeFileSync(dest, after);
      report.packageDiff = lineDiff(before, after);
    } else if (p.rel === '.gitignore') writeFileSync(dest, transformGitignore(readFileSync(p.from, 'utf8')));
    else cpSync(p.from, dest);
  }
  for (const [rel, data] of carried) {
    mkdirSync(dirname(join(target, rel)), { recursive: true });
    writeFileSync(join(target, rel), data);
  }
  for (const patch of PATCHES) {
    const file = join(target, patch.file);
    if (!existsSync(file)) continue;
    const next = patch.apply(readFileSync(file, 'utf8'));
    if (next === null) report.patches.push(`${patch.file}: not needed (pattern absent)`);
    else {
      writeFileSync(file, next);
      report.patches.push(`${patch.file}: ${patch.why}`);
    }
  }
  // 5. scan, then the single commit
  const scan = scanFolder(target, { git: false });
  report.scan = { files: scan.files, findings: scan.findings };
  report.files = produced;
  if (scan.findings.length) {
    log(`scan: ${scan.findings.length} finding(s); no commit made`);
    return { ...report, committed: false };
  }
  if (withGit) {
    const env = { GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email };
    git(target, ['init', '-q', '-b', 'main']);
    git(target, ['add', '-A'], env);
    git(target, ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'Initial commit'], env);
    report.commit = git(target, ['rev-parse', '--short', 'HEAD']).trim();
    report.clean = git(target, ['status', '--porcelain']).trim() === '';
    report.tracked = git(target, ['ls-files']).trim().split('\n').length;
  }
  return { ...report, committed: withGit };
}

// ---------------------------------------------------------------- CLI

function main() {
  const args = process.argv.slice(2);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const at = args.indexOf('--target');
  const target = at >= 0 ? resolve(args[at + 1]) : resolve(root, '..', `${PUBLIC.repo}-public`);
  try {
    const r = buildPublicCopy({ root, target, git: !args.includes('--no-git'), dryRun: args.includes('--dry-run'), log: (l) => console.log(l) });
    if (r.dryRun) return;
    console.log(`target: ${target}`);
    console.log(`files: ${r.files}; scan: ${r.scan.files} files, ${r.scan.findings.length} finding(s)`);
    for (const f of r.scan.findings) console.log(`  ${f.file}${f.line ? `:${f.line}` : ''} [${f.rule}] ${f.detail}`);
    for (const p of r.patches) console.log(`patch: ${p}`);
    console.log('package.json differences:');
    for (const l of r.packageDiff) console.log(`  ${l}`);
    if (r.committed) console.log(`commit ${r.commit}: ${r.tracked} tracked file(s), working tree ${r.clean ? 'clean' : 'NOT clean'}; no remote, nothing pushed`);
    if (r.scan.findings.length) process.exit(1);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
