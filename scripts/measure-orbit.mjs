/**
 * Phone frame times for the live Orbit view.
 *
 * Chromium at 390x844, deviceScaleFactor 3, 6x CPU throttle, while a
 * press-and-hold glides the fixture cards.
 *
 *   npm run build && npm start
 *   node scripts/measure-orbit.mjs --check
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(path.join(here, "fixtures", "verify-family-sky.json"), "utf8"));
const base = (process.env.VERIFY_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const outPath = path.resolve(process.env.MEASURE_OUT || "/tmp/orbit-perf.json");
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

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  colorScheme: "dark",
  reducedMotion: "no-preference",
});
await context.addInitScript(() => window.localStorage.setItem("familytree-theme", "dark"));
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const report = { viewport: "390x844", deviceScaleFactor: 3, cpuThrottle: 6, p95: 0, frameCount: 0 };

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByLabel("Import backup JSON").setInputFiles({
    name: "verify-family-sky.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.getByText("Looking at Ada").waitFor();
  if ((await page.locator(".graph-overlay").count()) === 0) {
    await page.locator(".family-overlay").getByRole("button", { name: "Visualize", exact: true }).click();
  }
  await page.getByRole("button", { name: "Orbit", exact: true }).click();
  await page.locator('.orbit-stage[data-ready="true"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const eli = await page.evaluate(() => {
    const rect = document.querySelector('[data-person-id="fx-eli"]').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.waitForTimeout(200);
  const started = page.evaluate(
    () =>
      new Promise((resolve) => {
        const frames = [];
        let last = performance.now();
        let saw = false;
        const start = last;
        const tick = (now) => {
          const stage = document.querySelector(".orbit-stage");
          const motion = stage?.dataset.motion;
          const lines = stage?.dataset.lines;
          if (motion === "glide" || lines === "out" || lines === "hidden" || lines === "in") saw = true;
          frames.push(now - last);
          last = now;
          const settled = saw && motion === "idle" && lines === "shown" && stage?.dataset.layout === "orbit";
          if ((settled && now - start > 400) || now - start > 6000) {
            resolve({ frames: saw ? frames : [], saw });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.mouse.move(eli.x, eli.y);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  const raw = await started;
  const frames = raw.frames.filter((delta) => delta > 0 && delta < 500);
  report.frameCount = frames.length;
  report.p50 = round(percentile(frames, 0.5));
  report.p95 = round(percentile(frames, 0.95));
  report.max = round(frames.reduce((max, delta) => Math.max(max, delta), 0));
  report.saw = raw.saw;
} finally {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => {});
  await browser.close();
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`orbit gather: frames=${report.frameCount} p50=${report.p50}ms p95=${report.p95}ms max=${report.max}ms saw=${report.saw}`);
console.log(`wrote ${outPath}`);

if (check) {
  const notes = [];
  if (!report.saw) notes.push("the glide was not seen");
  if (report.frameCount < 20) notes.push(`only ${report.frameCount} frames`);
  if (report.p95 > budget) notes.push(`p95 ${report.p95}ms`);
  if (notes.length) {
    console.error(notes.join(", "));
    process.exitCode = 1;
  } else {
    console.log("orbit frame budget held: p95 ≤ 16.8ms at 6x (one 60Hz tick; Chromium reports 16.7–16.8)");
  }
}
