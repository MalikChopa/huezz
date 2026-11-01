import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import axe from 'axe-core';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const distFile = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
const html = readFileSync(distFile, 'utf8');

type Probe = { violations: { directive: string; blocked: string }[]; consoleErrors: string[]; requests: string[] };

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});

async function open(url: string): Promise<{ page: Page; probe: Probe }> {
  const page = await context.newPage();
  const probe: Probe = { violations: [], consoleErrors: [], requests: [] };
  await page.exposeFunction('__huezzViolation', (directive: string, blocked: string) => {
    probe.violations.push({ directive, blocked });
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __huezzViolation(d: string, b: string): void }).__huezzViolation(e.effectiveDirective, e.blockedURI);
    });
  });
  page.on('console', (m) => {
    if (m.type() === 'error') probe.consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => probe.consoleErrors.push(String(e)));
  page.on('request', (r) => probe.requests.push(r.url()));
  await page.goto(url);
  return { page, probe };
}

describe('CSP smoke test (file://, Chrome headless, no bypassCSP)', () => {
  it('loads the page and shows 7 swatches with no error and no violation', async () => {
    const { page, probe } = await open(pathToFileURL(distFile).href);
    await page.waitForSelector('html.is-ready');
    expect(await page.locator('.sw').count()).toBe(7);
    const hexes = await page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent));
    for (const hex of hexes) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(await page.locator('.brand').textContent()).toBe('Huezz');
    expect(probe.consoleErrors).toEqual([]);
    expect(probe.violations).toEqual([]);
    expect(probe.requests.filter((u) => !u.startsWith('file://'))).toEqual([]);
    await page.close();
  });

  it('blocks a script whose text differs by one character', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'huezz-'));
    const file = join(dir, 'index.html');
    writeFileSync(file, html.replace('<script type="module">', '<script type="module"> '));
    const { page, probe } = await open(pathToFileURL(file).href);
    await page.waitForTimeout(300);
    expect(await page.$$eval('.sw-hex', (els) => els.map((e) => e.textContent))).toEqual(Array(7).fill(''));
    expect(probe.violations.some((v) => v.directive === 'script-src-elem')).toBe(true);
    await page.close();
  });

  it('rejects fetch() by connect-src without any request leaving', async () => {
    const { page, probe } = await open(pathToFileURL(distFile).href);
    await page.waitForSelector('html.is-ready');
    const outcome = await page.evaluate(async () => {
      try {
        await fetch('https://example.com');
        return 'resolved';
      } catch (e) {
        return String(e);
      }
    });
    expect(outcome).toMatch(/TypeError/);
    await page.waitForTimeout(100);
    expect(probe.violations.some((v) => v.directive === 'connect-src' && v.blocked.startsWith('https://example.com'))).toBe(true);
    expect(probe.requests.filter((u) => !u.startsWith('file://'))).toEqual([]);
    await page.close();
  });

  it('ignores a style attribute (setAttribute and innerHTML) but accepts the CSSOM', async () => {
    const { page, probe } = await open(pathToFileURL(distFile).href);
    await page.waitForSelector('html.is-ready');
    const res = await page.evaluate(() => {
      const a = document.createElement('div');
      a.setAttribute('style', 'width: 123px; height: 5px');
      const holder = document.createElement('div');
      holder.innerHTML = '<p id="p" style="width: 123px; height: 5px">x</p>';
      document.body.append(a, holder);
      const c = document.createElement('div');
      c.style.setProperty('width', '77px');
      c.style.setProperty('height', '5px');
      document.body.append(c);
      return {
        attr: getComputedStyle(a).width,
        inner: getComputedStyle(holder.firstElementChild!).width,
        cssom: getComputedStyle(c).width,
      };
    });
    expect(res.attr).not.toBe('123px');
    expect(res.inner).not.toBe('123px');
    expect(res.cssom).toBe('77px');
    await page.waitForTimeout(200);
    expect(probe.violations.some((v) => v.directive.startsWith('style-src'))).toBe(true);
    await page.close();
  });

  it('runs axe-core injected through page.evaluate(axe.source) under the CSP', async () => {
    const { page, probe } = await open(pathToFileURL(distFile).href);
    await page.waitForSelector('html.is-ready');
    await page.evaluate(axe.source);
    const summary = await page.evaluate(async () => {
      const r = await (window as unknown as { axe: { run(): Promise<{ violations: { id: string }[]; passes: unknown[] }> } }).axe.run();
      return { violations: r.violations.map((v) => v.id), passes: r.passes.length };
    });
    expect(summary.passes).toBeGreaterThan(0);
    expect(Array.isArray(summary.violations)).toBe(true);
    expect(probe.violations).toEqual([]);
    expect(probe.consoleErrors).toEqual([]);
    console.log('axe violations:', JSON.stringify(summary.violations), 'passes:', summary.passes);
    await page.close();
  });
});
