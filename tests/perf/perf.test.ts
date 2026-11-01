import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Smoothness and load measurements (ARCHITECTURE section 8). Not part of `npm run check`: run `npx vitest run tests/perf --silent=false`.
// HUEZZ_PERF_OUT=<folder> also writes the table as text.
const distFile = fileURLToPath(new URL('../../dist/index.html', import.meta.url));
const fileUrl = pathToFileURL(distFile).href;
const HTTPS = 'https://huezz.test/';
const RUNS = 5;
const EVENTS = 120;
const outDir = process.env['HUEZZ_PERF_OUT'] ?? null;

type Burst = { handler: number[]; render: number[]; intervals: number[]; longTasks: number[] };
type Metrics = { script: number; layout: number; style: number; task: number };
type Stat = { p50: number; p95: number; max: number };

const stat = (xs: number[]): Stat => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] ?? 0;
  return { p50: at(0.5), p95: at(0.95), max: s[s.length - 1] ?? 0 };
};
const fmt = (n: number) => n.toFixed(2);
const spread = (xs: number[]) => `${fmt(Math.min(...xs))} to ${fmt(Math.max(...xs))}`;

let browser: Browser;
const contexts: BrowserContext[] = [];
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
afterAll(async () => {
  for (const c of contexts) await c.close();
  await browser?.close();
});

async function openPage(https: boolean): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  contexts.push(context);
  if (https) await context.route(`${HTTPS}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(distFile) }));
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __ready: number };
    w.__ready = -1;
    new MutationObserver(() => {
      if (w.__ready < 0 && document.documentElement.classList.contains('is-ready')) w.__ready = performance.now();
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
  await page.goto(https ? HTTPS : fileUrl);
  await page.waitForSelector('html.is-ready');
  await page.waitForTimeout(500);
  return page;
}

/** 120 `input` events on the colour input, one per animation frame, the hue sweeping so that each one changes the palette. */
const burstScript = ({ events, forceStyle }: { events: number; forceStyle: boolean }) =>
  new Promise<Burst & { forced: number[] }>((resolve) => {
    const input = document.querySelector<HTMLInputElement>('#base');
    if (input === null) throw new Error('#base');
    const hex = (i: number) => {
      const h = (i * 3 + 20) % 360;
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const v = 0.55 - 0.35 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(v * 255).toString(16).padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    };
    const handler: number[] = [];
    const render: number[] = [];
    const forced: number[] = [];
    const intervals: number[] = [];
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)));
    observer.observe({ type: 'longtask' });
    let i = 0;
    let last = 0;
    let preEnd = 0;
    const tick = (t: number) => {
      if (last > 0) intervals.push(t - last);
      last = t;
      if (i < events) {
        // Frame n+1 runs: pre, the store's flush (registered by the handler), post: post - pre = the render callback.
        requestAnimationFrame(() => {
          preEnd = performance.now();
        });
        const t0 = performance.now();
        input.value = hex(i);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        handler.push(performance.now() - t0);
        requestAnimationFrame(() => {
          const t1 = performance.now();
          render.push(t1 - preEnd);
          if (forceStyle) {
            getComputedStyle(document.body).backgroundColor;
            void document.body.offsetHeight;
            forced.push(performance.now() - t1);
          }
        });
      }
      i++;
      if (i <= events + 1) requestAnimationFrame(tick);
      else {
        observer.disconnect();
        resolve({ handler, render, forced, intervals: intervals.slice(1), longTasks });
      }
    };
    requestAnimationFrame(tick);
  });

async function cpuMetrics(cdp: Awaited<ReturnType<BrowserContext['newCDPSession']>>): Promise<Metrics> {
  const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
  const get = (n: string) => (metrics.find((m) => m.name === n)?.value ?? 0) * 1000;
  return { script: get('ScriptDuration'), layout: get('LayoutDuration'), style: get('RecalcStyleDuration'), task: get('TaskDuration') };
}

type RunResult = { handler: Stat; render: Stat; sum: Stat; frames: Stat; longTasks: number[]; forced: Stat; metrics: Metrics; palettes: number };
async function oneRun(rate: number): Promise<RunResult> {
  const page = await openPage(false);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const before = await cpuMetrics(cdp);
  const hashBefore = await page.evaluate(() => location.hash);
  const burst = await page.evaluate(burstScript, { events: EVENTS, forceStyle: false });
  const after = await cpuMetrics(cdp);
  const forcedBurst = await page.evaluate(burstScript, { events: EVENTS, forceStyle: true });
  await page.waitForTimeout(450);
  const hashAfter = await page.evaluate(() => location.hash);
  expect(hashAfter).not.toBe(hashBefore);
  expect(burst.handler.length).toBe(EVENTS);
  expect(burst.render.length).toBe(EVENTS);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.context().close();
  return {
    handler: stat(burst.handler),
    render: stat(burst.render),
    sum: stat(burst.handler.map((h, k) => h + (burst.render[k] ?? 0))),
    frames: stat(burst.intervals),
    longTasks: burst.longTasks,
    forced: stat(forcedBurst.forced),
    metrics: { script: after.script - before.script, layout: after.layout - before.layout, style: after.style - before.style, task: after.task - before.task },
    palettes: EVENTS,
  };
}

const report: string[] = [];
const say = (line: string) => {
  report.push(line);
  console.log(line);
};

describe('performance (measured values, section 8)', () => {
  for (const rate of [1, 4]) {
    it(`120 input events at one per frame, CPU x${rate}, ${RUNS} runs`, async () => {
      const runs: RunResult[] = [];
      for (let r = 0; r < RUNS; r++) runs.push(await oneRun(rate));
      say(`\nBurst: ${EVENTS} input events on the colour input, one per animation frame, Chrome headless 1440x900, CPU x${rate}, ${RUNS} runs (ms)`);
      say('| run | handler p50/p95/max | render p50/p95/max | handler+render p50/p95/max | frame interval p50/p95/max | long tasks | style ms | layout ms | script ms | main-thread task ms per frame |');
      say('|---|---|---|---|---|---|---|---|---|---|');
      runs.forEach((r, k) => {
        const t = (s: Stat) => `${fmt(s.p50)} / ${fmt(s.p95)} / ${fmt(s.max)}`;
        say(`| ${k + 1} | ${t(r.handler)} | ${t(r.render)} | ${t(r.sum)} | ${t(r.frames)} | ${r.longTasks.length} | ${fmt(r.metrics.style)} | ${fmt(r.metrics.layout)} | ${fmt(r.metrics.script)} | ${fmt(r.metrics.task / EVENTS)} |`);
      });
      say(`Spread over ${RUNS} runs, p95 of handler+render: ${spread(runs.map((r) => r.sum.p95))} ; p95 of frame interval: ${spread(runs.map((r) => r.frames.p95))} ; max frame interval: ${spread(runs.map((r) => r.frames.max))}`);
      say(`Forced style recalc + layout after the render (probe, separate burst), p50/p95: ${runs.map((r) => `${fmt(r.forced.p50)}/${fmt(r.forced.p95)}`).join(' ; ')}`);
      // Thresholds of section 8, made blocking after the calibration of J7 (5 runs, spread far below the limits, see JOURNAL J7).
      for (const r of runs) {
        expect(r.sum.p95).toBeLessThanOrEqual(4);
        expect(r.frames.p95).toBeLessThanOrEqual(rate === 1 ? 20 : 33);
      }
    }, 180_000);
  }

  for (const https of [false, true]) {
    it(`time to first palette on ${https ? 'the fictitious https origin' : 'file://'}, ${RUNS} runs`, async () => {
      const rows: { dcl: number; load: number; fp: number; fcp: number; ready: number }[] = [];
      for (let r = 0; r < RUNS; r++) {
        const page = await openPage(https);
        rows.push(
          await page.evaluate(() => {
            const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
            const paint = (n: string) => performance.getEntriesByName(n)[0]?.startTime ?? -1;
            return { dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, fp: paint('first-paint'), fcp: paint('first-contentful-paint'), ready: (window as unknown as { __ready: number }).__ready };
          }),
        );
        await page.context().close();
      }
      say(`\nLoad on ${https ? 'https://huezz.test (interception)' : 'file://'}, 1440x900, CPU x1, ${RUNS} runs (ms from navigation start)`);
      say('| metric | min | median | max |');
      say('|---|---|---|---|');
      for (const key of ['dcl', 'load', 'fp', 'fcp', 'ready'] as const) {
        const xs = rows.map((x) => x[key]);
        say(`| ${{ dcl: 'DOMContentLoaded end', load: 'load end', fp: 'first-paint', fcp: 'first-contentful-paint', ready: 'palette ready (html.is-ready, 2 frames after the first render)' }[key]} | ${fmt(Math.min(...xs))} | ${fmt(stat(xs).p50)} | ${fmt(Math.max(...xs))} |`);
      }
      expect(rows.every((x) => x.ready > 0 && x.fcp > 0)).toBe(true);
    }, 120_000);
  }

  afterAll(() => {
    if (outDir !== null) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'perf-table.txt'), report.join('\n') + '\n');
    }
  });
});
