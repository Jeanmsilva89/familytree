/**
 * Phone pan, zoom, and focus-glide timings for the Families lens.
 *
 * Chromium at 390x844, deviceScaleFactor 3, CPU throttle 6, fixture sky.
 * A pan that starts at the screen edge, or on a person near that edge, has to
 * move the sky by the finger's distance. Wheel zoom, pinch, and the focus
 * glide have to stay within a frame budget.
 *
 *   npm run build && npm start
 *   node scripts/measure-sky.mjs
 *   node scripts/measure-sky.mjs --check
 *
 * MEASURE_OUT writes the JSON report. VERIFY_BASE_URL overrides the server.
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(path.join(here, "fixtures", "verify-family-sky.json"), "utf8"));
const base = (process.env.VERIFY_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const outPath = path.resolve(process.env.MEASURE_OUT || "/tmp/sky-perf.json");
const check = process.argv.includes("--check");
const runs = Number(process.env.SKY_RUNS || (check ? "2" : "3"));
const budget = 18.7;
const gapBudget = 2;

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function summarize(frames, tasks) {
  const deltas = frames.filter((delta) => delta > 0 && delta < 800);
  const during = tasks.filter((task) => task.duration >= 50);
  return {
    frameCount: deltas.length,
    p50: round(percentile(deltas, 0.5)),
    p95: round(percentile(deltas, 0.95)),
    max: round(deltas.reduce((max, delta) => Math.max(max, delta), 0)),
    over20: deltas.filter((delta) => delta > 20).length,
    over33: deltas.filter((delta) => delta > 33.4).length,
    longTaskCount: during.length,
    longTaskMax: round(during.reduce((max, task) => Math.max(max, task.duration), 0)),
  };
}

async function boot(page) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
  await page.getByLabel("Import backup JSON").setInputFiles({
    name: "verify-family-sky.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.getByText("Looking at Ada").waitFor();
  const inFamily = page.locator(".family-overlay").getByRole("button", { name: "Visualize", exact: true });
  if (await inFamily.count()) await inFamily.click();
  else {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Visualize tree" }).click();
  }
  await page.locator(".graph-overlay").waitFor();
  const families = page.getByRole("button", { name: "Families", exact: true });
  if ((await families.getAttribute("aria-pressed")) !== "true") {
    await families.click();
    await page.locator(".family-sky").waitFor();
  }
  await page.locator('.family-sky[data-level="far"][data-layout="sky"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
}

async function stars(page) {
  const home = page.getByRole("button", { name: "All families" });
  if (await home.count()) await home.click();
  await page.locator('.family-sky[data-level="far"][data-layout="sky"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
}

async function install(page) {
  await page.evaluate(() => {
    const state = { frames: [], tasks: [], on: false, last: 0, raf: 0 };
    window.__skyPerf = state;
    try {
      new PerformanceObserver((list) => {
        if (!state.on) return;
        for (const entry of list.getEntries()) state.tasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: false });
    } catch {
      // Long tasks are optional. Frame times still decide the budget.
    }
    const tick = (now) => {
      if (!state.on) return;
      state.frames.push(now - state.last);
      state.last = now;
      state.raf = requestAnimationFrame(tick);
    };
    state.start = () => {
      state.frames = [];
      state.tasks = [];
      state.on = true;
      state.last = performance.now();
      cancelAnimationFrame(state.raf);
      state.raf = requestAnimationFrame(tick);
    };
    state.stop = () => {
      state.on = false;
      cancelAnimationFrame(state.raf);
      return { frames: state.frames, tasks: state.tasks };
    };
  });
}

async function camera(page) {
  return page.evaluate(() => {
    const world = document.querySelector(".sky-world");
    const sky = document.querySelector(".family-sky");
    const matrix = new DOMMatrix(getComputedStyle(world).transform);
    return {
      x: matrix.e,
      y: matrix.f,
      s: matrix.a,
      level: sky?.getAttribute("data-level") || "",
      layout: sky?.getAttribute("data-layout") || "",
    };
  });
}

async function begin(page) {
  await page.evaluate(() => window.__skyPerf.start());
}

async function end(page) {
  const raw = await page.evaluate(() => window.__skyPerf.stop());
  return summarize(raw.frames, raw.tasks);
}

function gap(skyDelta, fingerDelta) {
  return round(skyDelta - fingerDelta);
}

async function pan(page, from, to, steps = 16) {
  const before = await camera(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await page.mouse.move(x, y);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await page.mouse.up();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await camera(page);
  return {
    before,
    after,
    fingerDx: to.x - from.x,
    fingerDy: to.y - from.y,
    skyDx: round(after.x - before.x),
    skyDy: round(after.y - before.y),
  };
}

async function hit(page, point) {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return "none";
    const card = el.closest(".portrait-card, .sky-avatar, .sky-label");
    return `${el.tagName}.${String(el.className || "").slice(0, 40)} ${card ? "on-person" : "on-sky"}`;
  }, point);
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
const report = {
  fixture: "verify-family-sky.json",
  viewport: "390x844",
  deviceScaleFactor: 3,
  cpuThrottle: 6,
  budget,
  gapBudget,
  runs: [],
};

try {
  await boot(page);
  await install(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.waitForTimeout(200);

  for (let run = 1; run <= runs; run += 1) {
    const entry = { run };
    await stars(page);

    const edgeHit = await hit(page, { x: 8, y: 480 });
    await begin(page);
    const edge = await pan(page, { x: 8, y: 480 }, { x: 188, y: 460 });
    entry.edgePan = {
      ...(await end(page)),
      hit: edgeHit,
      fingerDx: edge.fingerDx,
      fingerDy: edge.fingerDy,
      skyDx: edge.skyDx,
      skyDy: edge.skyDy,
      gapX: gap(edge.skyDx, edge.fingerDx),
      gapY: gap(edge.skyDy, edge.fingerDy),
      level: edge.after.level,
      layout: edge.after.layout,
    };

    await stars(page);
    await begin(page);
    const across = await pan(page, { x: 80, y: 430 }, { x: 280, y: 470 });
    entry.pan = {
      ...(await end(page)),
      fingerDx: across.fingerDx,
      skyDx: across.skyDx,
      gapX: gap(across.skyDx, across.fingerDx),
      gapY: gap(across.skyDy, across.fingerDy),
    };

    await stars(page);
    const star = await page.evaluate(() => {
      const el = document.querySelector(".sky-star");
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.move(star.x, star.y);
    await begin(page);
    for (let i = 0; i < 14; i += 1) {
      await page.mouse.wheel(0, -140);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(200);
    entry.wheelZoom = { ...(await end(page)), endLevel: (await camera(page)).level };

    await stars(page);
    await page.mouse.move(195, 420);
    await begin(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: 150, y: 420, id: 1, radiusX: 2, radiusY: 2, force: 1 },
        { x: 240, y: 420, id: 2, radiusX: 2, radiusY: 2, force: 1 },
      ],
    });
    for (let i = 1; i <= 12; i += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: 150 - i * 8, y: 420, id: 1, radiusX: 2, radiusY: 2, force: 1 },
          { x: 240 + i * 8, y: 420, id: 2, radiusX: 2, radiusY: 2, force: 1 },
        ],
      });
      await page.waitForTimeout(32);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(80);
    entry.pinch = { ...(await end(page)), endLevel: (await camera(page)).level, scale: round((await camera(page)).s) };

    await stars(page);
    const focusStar = await page.evaluate(() => {
      const el = document.querySelector('.sky-star[data-members~="fx-eli"]') || document.querySelector(".sky-star");
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await begin(page);
    await page.mouse.click(focusStar.x, focusStar.y);
    const focusDeadline = Date.now() + 2500;
    let stable = 0;
    let previous = "";
    while (Date.now() < focusDeadline && stable < 4) {
      await page.waitForTimeout(40);
      const now = await camera(page);
      const key = `${now.level}|${Math.round(now.x)}|${Math.round(now.s * 100)}`;
      if (now.level === "near" && key === previous) stable += 1;
      else stable = 0;
      previous = key;
    }
    entry.focusGlide = { ...(await end(page)), endLevel: (await camera(page)).level, layout: (await camera(page)).layout };

    const placed = await page.evaluate(() => {
      const card = document.querySelector('.family-sky .portrait-card[data-person-id="fx-dee"]');
      if (!(card instanceof HTMLElement)) return null;
      const rect = card.getBoundingClientRect();
      return { x: rect.x + Math.min(36, rect.width / 2), y: rect.y + 36, left: rect.x };
    });
    if (!placed) throw new Error("Dee Fixture's card was not on the sky after the focus glide");
    const shift = placed.x - 18;
    if (Math.abs(shift) > 4) {
      const spot = await page.evaluate(() => {
        const stage = document.querySelector(".family-sky");
        const rect = stage.getBoundingClientRect();
        for (let y = rect.top + 140; y < rect.bottom - 80; y += 22) {
          for (let x = rect.left + 40; x < rect.right - 40; x += 22) {
            const target = document.elementFromPoint(x, y);
            if (!(target instanceof Element) || !stage.contains(target)) continue;
            if (target.closest(".portrait-card, .sky-avatar, .sky-label, .graph-zoom, .btn, .icon-btn")) continue;
            return { x, y };
          }
        }
        return { x: 200, y: 640 };
      });
      await pan(page, spot, { x: spot.x - Math.max(-180, Math.min(180, shift)), y: spot.y });
      await page.waitForTimeout(40);
    }
    const start = await page.evaluate(() => {
      const card = document.querySelector('.family-sky .portrait-card[data-person-id="fx-dee"]');
      const rect = card.getBoundingClientRect();
      const x = Math.max(rect.left + 12, Math.min(rect.right - 12, 20));
      const y = Math.max(rect.top + 20, Math.min(rect.bottom - 20, rect.top + 40));
      const el = document.elementFromPoint(x, y);
      return {
        x,
        y,
        onPerson: Boolean(el?.closest(".portrait-card, .sky-avatar")),
        tag: el?.tagName || "none",
      };
    });
    await begin(page);
    const cardPan = await pan(page, start, { x: start.x + 150, y: start.y + 10 }, 14);
    entry.edgeCardPan = {
      ...(await end(page)),
      start,
      fingerDx: cardPan.fingerDx,
      fingerDy: cardPan.fingerDy,
      skyDx: cardPan.skyDx,
      skyDy: cardPan.skyDy,
      gapX: gap(cardPan.skyDx, cardPan.fingerDx),
      gapY: gap(cardPan.skyDy, cardPan.fingerDy),
      layout: cardPan.after.layout,
    };

    report.runs.push(entry);
    console.log(
      JSON.stringify(
        {
          run,
          edge: { p50: entry.edgePan.p50, p95: entry.edgePan.p95, max: entry.edgePan.max, gapX: entry.edgePan.gapX, gapY: entry.edgePan.gapY },
          pan: { p50: entry.pan.p50, p95: entry.pan.p95, max: entry.pan.max, gapX: entry.pan.gapX },
          wheel: { p50: entry.wheelZoom.p50, p95: entry.wheelZoom.p95, max: entry.wheelZoom.max, level: entry.wheelZoom.endLevel, over33: entry.wheelZoom.over33 },
          pinch: { p50: entry.pinch.p50, p95: entry.pinch.p95, max: entry.pinch.max, level: entry.pinch.endLevel, scale: entry.pinch.scale },
          focus: { p50: entry.focusGlide.p50, p95: entry.focusGlide.p95, max: entry.focusGlide.max, level: entry.focusGlide.endLevel, over33: entry.focusGlide.over33 },
          card: { p50: entry.edgeCardPan.p50, p95: entry.edgeCardPan.p95, gapX: entry.edgeCardPan.gapX, gapY: entry.edgeCardPan.gapY, onPerson: entry.edgeCardPan.start.onPerson, tag: entry.edgeCardPan.start.tag },
        },
        null,
        2,
      ),
    );
  }
} finally {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => {});
  await browser.close();
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`wrote ${outPath}`);

if (check) {
  const notes = [];
  if (report.runs.length < runs) notes.push(`only ${report.runs.length} runs`);
  for (const entry of report.runs) {
    for (const [name, gesture] of [
      ["edge pan", entry.edgePan],
      ["pan", entry.pan],
      ["wheel zoom", entry.wheelZoom],
      ["pinch", entry.pinch],
      ["focus glide", entry.focusGlide],
      ["edge card pan", entry.edgeCardPan],
    ]) {
      if (!gesture || gesture.frameCount < 8) notes.push(`run ${entry.run} ${name} recorded ${gesture?.frameCount || 0} frames`);
      if (gesture && gesture.p95 > budget) notes.push(`run ${entry.run} ${name} p95 ${gesture.p95}ms`);
    }
    if (Math.abs(entry.edgePan.gapX) > gapBudget || Math.abs(entry.edgePan.gapY) > gapBudget) {
      notes.push(`run ${entry.run} edge pan missed the finger by ${entry.edgePan.gapX},${entry.edgePan.gapY}px`);
    }
    if (entry.edgePan.layout !== "sky") notes.push(`run ${entry.run} edge pan left the sky layout`);
    if (entry.wheelZoom.endLevel !== "near") notes.push(`run ${entry.run} wheel zoom ended at ${entry.wheelZoom.endLevel}`);
    if (entry.pinch.endLevel === "far") notes.push(`run ${entry.run} pinch stayed on the star view`);
    if (entry.focusGlide.endLevel !== "near" || entry.focusGlide.layout !== "sky") {
      notes.push(`run ${entry.run} focus glide ended at ${entry.focusGlide.endLevel} ${entry.focusGlide.layout}`);
    }
    if (!entry.edgeCardPan.start.onPerson) notes.push(`run ${entry.run} edge card pan did not start on a person`);
    if (Math.abs(entry.edgeCardPan.gapX) > gapBudget || Math.abs(entry.edgeCardPan.gapY) > gapBudget) {
      notes.push(`run ${entry.run} edge card pan missed the finger by ${entry.edgeCardPan.gapX},${entry.edgeCardPan.gapY}px`);
    }
    if (entry.edgeCardPan.layout !== "sky") notes.push(`run ${entry.run} panning a person gathered the sky`);
  }
  if (notes.length) {
    console.error(`sky gestures failed: ${notes.join("; ")}`);
    process.exit(1);
  }
  console.log(`sky gestures passed (${runs} runs, p95 <= ${budget}ms, edge gap <= ${gapBudget}px)`);
}
