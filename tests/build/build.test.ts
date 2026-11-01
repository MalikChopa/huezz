import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = `${root}dist`;
const sha = (t: string) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`;

let html = '';

beforeAll(() => {
  execFileSync(process.execPath, [`${root}node_modules/vite/bin/vite.js`, 'build'], { cwd: root, stdio: 'pipe' });
  html = readFileSync(`${dist}/index.html`, 'utf8');
});

describe('single-file build with CSP', () => {
  it('produces exactly one file in dist', () => {
    expect(readdirSync(dist)).toEqual(['index.html']);
  });

  it('has the CSP meta as the very first child of head, before any script or style', () => {
    expect(html).toMatch(/<head>\s*<meta http-equiv="Content-Security-Policy"/);
    const meta = html.indexOf('Content-Security-Policy');
    expect(meta).toBeGreaterThan(-1);
    expect(meta).toBeLessThan(html.indexOf('<script'));
    expect(meta).toBeLessThan(html.indexOf('<style'));
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html.match(/<style\b/g)).toHaveLength(1);
  });

  it('writes the exact CSP', () => {
    const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
    expect(script).toBeTruthy();
    expect(style).toBeTruthy();
    const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1];
    expect(csp).toBe(
      `default-src 'none'; script-src ${sha(script!)}; style-src ${sha(style!)}; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'`,
    );
  });

  it('J9: the favicon is one inline data: SVG link (allowed by img-src data:), a two-colour mark that decodes to an SVG, no network address', () => {
    const links = html.match(/<link\b[^>]*>/g) ?? [];
    expect(links).toHaveLength(1);
    const m = /^<link rel="icon" href="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)">$/.exec(links[0] ?? '');
    expect(m, links[0]).not.toBeNull();
    const svg = Buffer.from(m?.[1] ?? '', 'base64').toString('utf8');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32">.*<\/svg>$/);
    expect(svg).not.toMatch(/<script|<image|href=|url\(|style=/);
    expect([...new Set(svg.match(/fill="(#[0-9A-Fa-f]{6})"/g))]).toHaveLength(2);
  });

  it('has no external src/href, no crossorigin, no modulepreload, no style attribute (the only href besides in-page anchors is the inline data: icon)', () => {
    expect(html).not.toMatch(/\ssrc=/);
    const hrefs = [...html.matchAll(/\shref=("[^"]*"|'[^']*'|[^\s>]*)/g)].map((m) => (m[1] ?? '').replace(/^["']|["']$/g, ''));
    const outside = hrefs.filter((h) => !h.startsWith('#'));
    expect(outside).toHaveLength(1);
    expect(outside[0]).toMatch(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/);
    expect(html).not.toMatch(/crossorigin/);
    expect(html).not.toMatch(/modulepreload/);
    expect(html).not.toMatch(/style\s*=\s*["']/);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
