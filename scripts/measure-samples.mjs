/**
 * Phone frame times for the three sample directions.
 *
 * Chromium at 390x844, deviceScaleFactor 3, touch on, 4x CPU throttle.
 * The main motion is the depth orbit, the card zoom, and the orbit gather.
 *
 *   npm run build && npm start
 *   node scripts/measure-samples.mjs --check
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const base = (process.env.VERIFY_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const outPath = path.resolve(process.env.MEASURE_OUT || "/tmp/sample-perf.json");
const check = process.argv.includes("--check");
const budget = 16.8;

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function summarize(raw) {
  const frames = raw.frames.filter((delta) => delta > 0 && delta < 500);
  return {
    direction: raw.direction,
    motion: raw.motion,
    frameCount: frames.length,
    p50: round(percentile(frames, 0.5)),
    p95: round(percentile(frames, 0.95)),
    max: round(frames.reduce((max, delta) => Math.max(max, delta), 0)),
    over16: frames.filter((delta) => delta > 16.7).length,
    longTaskMax: round(raw.longTasks.reduce((max, duration) => Math.max(max, duration), 0)),
    dpr: raw.dpr,
    renderer: raw.renderer,
  };
}

async function readFrames(page, ms) {
  return page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const frames = [];
        const longTasks = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        });
        try {
          observer.observe({ type: "longtask", buffered: false });
        } catch {
          // Some builds omit long tasks.
        }
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          frames.push(now - last);
          last = now;
          if (now - start >= ms) {
            observer.disconnect();
            const stage = document.querySelector("[data-sample]");
            const canvas = document.querySelector("canvas");
            const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
            const renderer = gl ? gl.getParameter(gl.RENDERER) : "";
            resolve({ frames, longTasks, dpr: stage?.dataset.dpr || "", renderer });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

async function open(page, kind) {
  await page.goto(`${base}/samples/${kind}`, { waitUntil: "networkidle" });
  await page.locator(`[data-sample="${kind}"][data-ready="true"]`).waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
}

async function measureDepth(page) {
  const raw = await readFrames(page, 1600);
  raw.direction = "depth";
  raw.motion = "orbit";
  return summarize(raw);
}

async function measureCards(page) {
  const box = await page.locator("canvas").boundingBox();
  const started = page.evaluate(
    () =>
      new Promise((resolve) => {
        const frames = [];
        const longTasks = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        });
        try {
          observer.observe({ type: "longtask", buffered: false });
        } catch {
          // optional
        }
        let last = performance.now();
        let saw = false;
        const start = last;
        const tick = (now) => {
          const motion = document.querySelector("[data-sample]")?.dataset.motion;
          if (motion === "move") saw = true;
          frames.push(now - last);
          last = now;
          if ((saw && motion === "idle" && now - start > 400) || now - start > 4000) {
            observer.disconnect();
            const stage = document.querySelector("[data-sample]");
            const canvas = document.querySelector("canvas");
            const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
            resolve({
              frames: saw ? frames : [],
              longTasks,
              dpr: stage?.dataset.dpr || "",
              renderer: gl ? gl.getParameter(gl.RENDERER) : "",
              saw,
            });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 4; step += 1) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(40);
  }
  const raw = await started;
  raw.direction = "cards";
  raw.motion = "semantic-zoom";
  return summarize(raw);
}

async function measureOrbit(page) {
  const eli = await page.evaluate(() => {
    const el = document.querySelector('[data-person-id="fx-eli"]');
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  const started = page.evaluate(
    () =>
      new Promise((resolve) => {
        const frames = [];
        const longTasks = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        });
        try {
          observer.observe({ type: "longtask", buffered: false });
        } catch {
          // optional
        }
        let last = performance.now();
        let saw = false;
        const start = last;
        const tick = (now) => {
          const stage = document.querySelector("[data-sample]");
          const motion = stage?.dataset.motion;
          const lines = stage?.dataset.lines;
          if (motion === "move" || lines === "out" || lines === "hidden" || lines === "in") saw = true;
          frames.push(now - last);
          last = now;
          const settled = saw && motion === "idle" && lines === "shown";
          if ((settled && now - start > 500) || now - start > 5000) {
            observer.disconnect();
            const canvas = document.querySelector("canvas");
            const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
            resolve({
              frames: saw ? frames : [],
              longTasks,
              dpr: stage?.dataset.dpr || "",
              renderer: gl ? gl.getParameter(gl.RENDERER) : "",
              saw,
            });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.mouse.move(eli.x, eli.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  const raw = await started;
  raw.direction = "orbit";
  raw.motion = "gather";
  return summarize(raw);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  colorScheme: "dark",
  reducedMotion: "no-preference",
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const report = { viewport: "390x844", deviceScaleFactor: 3, cpuThrottle: 4, runs: [] };

try {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await open(page, "depth");
  await open(page, "cards");
  await open(page, "orbit");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.waitForTimeout(300);

  await open(page, "depth");
  await page.waitForTimeout(250);
  report.runs.push(await measureDepth(page));

  await open(page, "cards");
  await page.waitForTimeout(250);
  report.runs.push(await measureCards(page));

  await open(page, "orbit");
  await page.waitForTimeout(250);
  report.runs.push(await measureOrbit(page));
} finally {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => {});
  await browser.close();
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2));
for (const run of report.runs) {
  console.log(`${run.direction} ${run.motion}: frames=${run.frameCount} p50=${run.p50}ms p95=${run.p95}ms max=${run.max}ms over16=${run.over16} longMax=${run.longTaskMax}ms dpr=${run.dpr} gpu=${run.renderer}`);
}
console.log(`wrote ${outPath}`);

if (check) {
  const problems = report.runs.flatMap((run) => {
    const notes = [];
    if (run.frameCount < 20) notes.push(`only ${run.frameCount} frames`);
    if (run.p95 > budget) notes.push(`p95 ${run.p95}ms`);
    return notes.length ? [`${run.direction} ${run.motion}: ${notes.join(", ")}`] : [];
  });
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("sample frame budget held: p95 ≤ 16.8ms at 4x (one 60Hz tick; Chromium reports 16.7–16.8)");
  }
}
