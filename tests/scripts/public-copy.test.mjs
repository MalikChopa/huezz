// Unit tests of scripts/public-copy.mjs on a fake working folder (fake data only, in the OS temporary folder).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { encodeGif } from '../../scripts/gif.mjs';
import { PATCHES, assertTargetDeletable, buildPublicCopy, isProducedPath, lineDiff, transformGitignore, transformPackageJson } from '../../scripts/public-copy.mjs';

const S = (...p) => p.join('');
const base = mkdtempSync(join(tmpdir(), 'public-copy-test-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));
let counter = 0;
const fresh = (name) => join(base, `${name}-${++counter}`);
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const identity = { name: 'Chopa', email: S('1+Chopa', '@', 'users.noreply.github.com') };

function put(root, rel, content = 'x\n') {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function files(dir, root = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(full, root));
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out.sort();
}

const PACKAGE = JSON.stringify({ name: 'huezz', private: true, version: '0.0.0', type: 'module', devDependencies: { vite: '8.3.5' }, scripts: { dev: 'vite', check: 'npm run typecheck && npm test' } }, null, 2) + '\n';

/** A fake working folder with allowed and forbidden content. */
function makeRoot() {
  const root = fresh('root');
  put(root, 'index.html', '<html></html>\n');
  put(root, 'package.json', PACKAGE);
  put(root, 'package-lock.json', '{}\n');
  put(root, 'tsconfig.json', '{}\n');
  put(root, 'vite.config.ts', 'export default {};\n');
  put(root, 'vitest.config.ts', 'export default {};\n');
  put(root, '.gitignore', 'node_modules/\ndist/\n.DS_Store\nmaquette/shots/\ntests/visual/out/\n');
  put(root, 'src/core/a.ts', 'export const a = 1;\n');
  put(root, 'src/.DS_Store', 'junk');
  put(root, 'tests/core/a.test.ts', 'import { a } from "../../src/core/a";\n');
  put(root, 'tests/visual/ref/b.png', PNG_1X1);
  put(root, 'tests/visual/out/shot.png', 'out');
  put(root, 'scripts/size.mjs', '// size\n');
  put(root, 'docs/CHECKLIST-NAVIGATEURS.md', '# list\n');
  // never copied
  put(root, 'docs/FICHE.md', 'private');
  put(root, 'docs/JOURNAL.md', 'private');
  put(root, S('docs/brie', 'fs/01.md'), 'private');
  put(root, S('CLAU', 'DE.md'), 'private');
  put(root, S('docs/HAND', 'OFF.md'), 'private');
  put(root, 'maquette/b/index.html', 'private');
  put(root, 'node_modules/x/index.js', 'dep');
  put(root, 'dist/index.html', 'built');
  put(root, 'notes.txt', 'private');
  return root;
}
/** A target holding the hand-written public files. */
function makeTarget(root) {
  const target = fresh('target');
  put(target, 'README.md', '# Huezz\n');
  put(target, 'LICENSE', 'MIT\n');
  put(target, 'assets/demo.gif', encodeGif({ width: 2, height: 2, frames: [{ data: new Uint8Array(16).fill(200), delay: 100 }] }));
  put(target, '.github/workflows/pages.yml', 'name: pages\n');
  return target;
}

describe('allowlist', () => {
  it('only the listed paths are produced', () => {
    for (const ok of ['index.html', 'package.json', 'src/a/b.ts', 'tests/visual/ref/x.png', 'scripts/gif.mjs', 'assets/demo.gif', 'README.md', 'LICENSE', '.github/workflows/pages.yml', 'docs/CHECKLIST-NAVIGATEURS.md', '.gitignore']) {
      expect(isProducedPath(ok), ok).toBe(true);
    }
    for (const no of ['docs/FICHE.md', 'docs/JOURNAL.md', S('CLAU', 'DE.md'), 'maquette/b/index.html', 'node_modules/x', 'dist/index.html', 'notes.txt', 'tests/visual/out/x.png', 'src/.DS_Store', '.github/workflows/other.yml', '.env']) {
      expect(isProducedPath(no), no).toBe(false);
    }
  });
});

describe('transformations', () => {
  it('package.json gets the public fields; scripts and versions are untouched', () => {
    const out = JSON.parse(transformPackageJson(PACKAGE));
    const src = JSON.parse(PACKAGE);
    expect(out.license).toBe('MIT');
    expect(out.author).toBe('Chopa');
    expect(out.repository.url).toContain('MalikChopa/huezz');
    expect(out.homepage).toContain('malikchopa.github.io/huezz');
    expect(out.bugs.url).toContain('MalikChopa/huezz/issues');
    expect(out.keywords.length).toBeGreaterThanOrEqual(10);
    expect(out.description.length).toBeGreaterThan(40);
    expect(out.scripts).toEqual(src.scripts);
    expect(out.devDependencies).toEqual(src.devDependencies);
    expect({ name: out.name, version: out.version, private: out.private, type: out.type }).toEqual({ name: src.name, version: src.version, private: src.private, type: src.type });
    expect(transformPackageJson(transformPackageJson(PACKAGE))).toBe(transformPackageJson(PACKAGE)); // stable
  });
  it('the diff only adds lines', () => {
    const diff = lineDiff(PACKAGE, transformPackageJson(PACKAGE));
    expect(diff.length).toBeGreaterThan(8);
    expect(diff.every((l) => l.startsWith('+ '))).toBe(true);
    expect(lineDiff('a\nb', 'a\nc')).toEqual(['- b', '+ c']);
  });
  it('.gitignore loses the private entries only', () => {
    expect(transformGitignore('node_modules/\nmaquette/shots/\ntests/visual/out/\n')).toBe('node_modules/\ntests/visual/out/\n');
  });
  it('the test patch replaces the machine path and is skipped when already fixed', () => {
    const patch = PATCHES[0];
    const before = S("import { spawnSync } from 'node:child_process';\nimport { x } from 'y';\nconst WORK = '", '/priv', "ate/tmp/a/swift-check';\n");
    const after = patch.apply(before);
    expect(after).toContain("const WORK = join(tmpdir(), 'huezz-swift-check');");
    expect(after).toContain("import { tmpdir } from 'node:os';");
    expect(patch.apply(after)).toBeNull();
  });
});

describe('buildPublicCopy', () => {
  it('copies exactly the allowlist, keeps the hand-written public files, no git when asked', () => {
    const root = makeRoot();
    const target = makeTarget(root);
    const r = buildPublicCopy({ root, target, git: false });
    expect(files(target)).toEqual([
      '.github/workflows/pages.yml',
      '.gitignore',
      'LICENSE',
      'README.md',
      'assets/demo.gif',
      'docs/CHECKLIST-NAVIGATEURS.md',
      'index.html',
      'package-lock.json',
      'package.json',
      'scripts/size.mjs',
      'src/core/a.ts',
      'tests/core/a.test.ts',
      'tests/visual/ref/b.png',
      'tsconfig.json',
      'vite.config.ts',
      'vitest.config.ts',
    ]);
    expect(r.scan.findings).toEqual([]);
    expect(readFileSync(join(target, '.gitignore'), 'utf8')).not.toContain('maquette');
    expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).license).toBe('MIT');
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(PACKAGE); // the working folder is untouched
    expect(existsSync(join(target, '.git'))).toBe(false);
  });
  it('is idempotent: a second run gives the same files and bytes', () => {
    const root = makeRoot();
    const target = makeTarget(root);
    buildPublicCopy({ root, target, git: false });
    const snapshot = files(target).map((f) => [f, readFileSync(join(target, f), 'utf8')]);
    buildPublicCopy({ root, target, git: false });
    expect(files(target).map((f) => [f, readFileSync(join(target, f), 'utf8')])).toEqual(snapshot);
  });
  it('one commit authored by the noreply identity, branch main, clean tree, no remote', () => {
    const root = makeRoot();
    const target = makeTarget(root);
    const r = buildPublicCopy({ root, target, identity });
    expect(r.committed).toBe(true);
    expect(r.clean).toBe(true);
    const g = (...a) => execFileSync('git', ['-C', target, ...a], { encoding: 'utf8' }).trim();
    expect(g('rev-list', '--count', 'HEAD')).toBe('1');
    expect(g('branch', '--show-current')).toBe('main');
    expect(g('log', '-1', '--format=%an|%ae|%cn|%ce|%s')).toBe(`Chopa|${identity.email}|Chopa|${identity.email}|Initial commit`);
    expect(g('remote')).toBe('');
    expect(g('ls-files').split('\n').length).toBe(r.tracked);
    // rebuilding over its own single commit is allowed and gives a single commit again
    buildPublicCopy({ root, target, identity });
    expect(g('rev-list', '--count', 'HEAD')).toBe('1');
    expect(g('status', '--porcelain')).toBe('');
  });
  it('refuses an identity that is not a noreply address', () => {
    const root = makeRoot();
    expect(() => buildPublicCopy({ root, target: makeTarget(root), identity: { name: 'X', email: S('x', '@', 'gmail.com') } })).toThrow(/noreply/);
  });
  it('a missing README or licence is an error', () => {
    const root = makeRoot();
    expect(() => buildPublicCopy({ root, target: fresh('empty'), git: false })).toThrow(/public-only/);
  });
  it('refuses to delete: stray file, long history, remote, symlink', () => {
    const root = makeRoot();
    const stray = makeTarget(root);
    put(stray, 'my-notes.txt', 'mine');
    expect(() => buildPublicCopy({ root, target: stray, git: false })).toThrow(/does not produce/);
    expect(readFileSync(join(stray, 'my-notes.txt'), 'utf8')).toBe('mine'); // nothing deleted

    const long = makeTarget(root);
    buildPublicCopy({ root, target: long, identity });
    put(long, 'extra.txt', 'x');
    const g = (...a) => execFileSync('git', ['-C', long, '-c', 'commit.gpgsign=false', ...a], { stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: identity.email } });
    g('add', '-A');
    g('commit', '-q', '-m', 'second');
    expect(() => buildPublicCopy({ root, target: long, identity })).toThrow(/2 commits/);

    const published = makeTarget(root);
    buildPublicCopy({ root, target: published, identity });
    execFileSync('git', ['-C', published, 'remote', 'add', 'origin', S('https:', '//', 'example.com/x.git')]);
    expect(() => assertTargetDeletable(published)).toThrow(/remote/);

    const linked = makeTarget(root);
    symlinkSync('/tmp', join(linked, 'node_modules'));
    expect(() => buildPublicCopy({ root, target: linked, git: false })).toThrow(/does not produce/);
  });
  it('a modified hand-written file (leading space in git status) does not block the rebuild', () => {
    const root = makeRoot();
    const target = makeTarget(root);
    buildPublicCopy({ root, target, identity });
    writeFileSync(join(target, 'assets/demo.gif'), encodeGif({ width: 2, height: 2, frames: [{ data: new Uint8Array(16).fill(10), delay: 100 }] }));
    writeFileSync(join(target, 'README.md'), '# changed\n');
    expect(() => buildPublicCopy({ root, target, identity })).not.toThrow();
    expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('# changed\n'); // carried over
    expect(execFileSync('git', ['-C', target, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('1');
  });
  it('refuses a target inside the working folder or equal to it', () => {
    const root = makeRoot();
    expect(() => buildPublicCopy({ root, target: join(root, 'out'), git: false })).toThrow(/separate/);
    expect(() => buildPublicCopy({ root, target: root, git: false })).toThrow(/separate/);
  });
  it('the scan blocks the commit when the copy is not clean', () => {
    const root = makeRoot();
    put(root, 'src/leak.ts', S('const p = "', '/Us', 'ers/someone/x";\n'));
    const target = makeTarget(root);
    const r = buildPublicCopy({ root, target, identity });
    expect(r.committed).toBe(false);
    expect(r.scan.findings.map((f) => f.file)).toContain('src/leak.ts');
    expect(existsSync(join(target, '.git'))).toBe(false);
  });
  it('dry run changes nothing', () => {
    const root = makeRoot();
    const target = makeTarget(root);
    const before = files(target);
    const lines = [];
    const r = buildPublicCopy({ root, target, git: false, dryRun: true, log: (l) => lines.push(l) });
    expect(r.dryRun).toBe(true);
    expect(files(target)).toEqual(before);
    expect(lines.some((l) => l.includes('copy index.html'))).toBe(true);
  });
});
