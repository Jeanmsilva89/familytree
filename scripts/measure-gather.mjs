/**
 * Phone-sized gather/clear frame timings.
 *
 * Chromium at 390x844, deviceScaleFactor 3, touch on, CDP CPU throttle.
 * Records rAF deltas plus longtask and long-animation-frame entries for the
 * Families gather, the Families clear, and the same pair on the classic tree.
 *
 *   npm run build && npm start
 *   node scripts/measure-gather.mjs
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
const outPath = path.resolve(process.env.MEASURE_OUT || "/tmp/gather-perf.json");
const check = process.argv.includes("--check");
const rates = (process.env.MEASURE_RATES || (check ? "4" : "4,6")).split(",").map((rate) => Number(rate.trim())).filter(Boolean);

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function summarize(raw) {
  const frames = raw.frames.map((frame) => frame.delta);
  const longTasks = raw.longTasks.filter((task) => task.start >= raw.t0 && task.start <= raw.t1);
  const lafs = raw.lafs.filter((frame) => frame.start >= raw.t0 && frame.start <= raw.t1);
  const over20 = frames.filter((delta) => delta > 20).length;
  const dropped = frames.filter((delta) => delta > 33.4).length;
  return {
    surface: raw.surface,
    action: raw.action,
    rate: raw.rate,
    frameCount: frames.length,
    p50: round(percentile(frames, 0.5)),
    p95: round(percentile(frames, 0.95)),
    max: round(frames.reduce((max, delta) => Math.max(max, delta), 0)),
    over20,
    dropped,
    longTaskCount: longTasks.length,
    longTaskMax: round(longTasks.reduce((max, task) => Math.max(max, task.duration), 0)),
    longTasks: longTasks.map((task) => round(task.duration)),
    lafCount: lafs.length,
    lafMax: round(lafs.reduce((max, frame) => Math.max(max, frame.duration), 0)),
    lafs: lafs.map((frame) => ({ duration: round(frame.duration), blocking: round(frame.blocking || 0) })),
    probes: raw.probes,
    snapshot: raw.snapshot,
    mutations: raw.mutations,
  };
}

function round(n) {
  return Math.round(n * 10) / 10;
}

async function settle(page) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(600);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
}

async function openVisualize(page) {
  if ((await page.locator(".graph-overlay").count()) === 0) {
    const inFamily = page.locator(".family-overlay").getByRole("button", { name: "Visualize", exact: true });
    if (await inFamily.count()) await inFamily.click();
    else {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("menuitem", { name: "Visualize tree" }).click();
    }
  }
  await page.locator(".graph-overlay").waitFor();
}

async function turnFamilies(page, on) {
  const families = page.getByRole("button", { name: "Families", exact: true });
  await families.scrollIntoViewIfNeeded();
  const pressed = (await families.getAttribute("aria-pressed")) === "true";
  if (pressed !== on) {
    await families.click();
    if (on) await page.locator(".family-sky").waitFor();
    else await page.locator(".family-sky").waitFor({ state: "detached" });
  }
  if (!on) await page.locator('.graph-stage[data-layout="tree"][data-framed="true"]').waitFor();
}

async function cardPoint(locator) {
  const box = await locator.boundingBox();
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + Math.min(36, box.height / 2) };
}

async function panClassic(page, locator) {
  for (let i = 0; i < 12; i += 1) {
    const box = await locator.boundingBox();
    const view = page.viewportSize();
    if (!box || !view) return;
    const dx = box.x < 16 ? 180 : box.x + box.width > view.width - 16 ? -180 : 0;
    const dy = box.y < 72 ? 140 : box.y + box.height > view.height - 16 ? -140 : 0;
    if (!dx && !dy) return;
    const point = await page.evaluate(() => {
      const stage = document.querySelector(".graph-stage:not(.family-sky)");
      if (!(stage instanceof HTMLElement)) return null;
      const rect = stage.getBoundingClientRect();
      for (let y = rect.top + 28; y < rect.bottom - 28; y += 18) {
        for (let x = rect.left + 28; x < rect.right - 28; x += 18) {
          const hit = document.elementFromPoint(x, y);
          if (!(hit instanceof Element) || !stage.contains(hit)) continue;
          if (hit.closest(".portrait-card, .graph-zoom, .graph-toolbar, .graph-port, .btn, .icon-btn")) continue;
          return { x, y };
        }
      }
      return null;
    });
    if (!point) return;
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + dx, point.y + dy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(40);
  }
}

async function revealSkyPerson(page, personId) {
  const home = page.getByRole("button", { name: "All families" });
  if (await home.count()) await home.click();
  await page.waitForTimeout(400);
  const star = page.locator(`.sky-star[data-members~="${personId}"]`);
  await star.first().waitFor({ timeout: 8000 });
  await star.locator(".sky-star-core").click({ force: true });
  await page.waitForFunction(
    () => document.querySelector(".family-sky")?.getAttribute("data-level") !== "far",
    null,
    { timeout: 8000 },
  );
  const card = page.locator(`.family-sky .portrait-card[data-person-id="${personId}"]`);
  for (let i = 0; i < 8; i += 1) {
    if (await card.count()) return card;
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.waitForTimeout(400);
  }
  throw new Error(`could not zoom to ${personId}`);
}

async function holdCard(page, locator) {
  const point = await cardPoint(locator);
  if (!point) throw new Error("no card to hold");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(680);
  await page.mouse.up();
  const menu = page.getByRole("menu");
  await menu.waitFor({ timeout: 2000 });
  await page.locator('[role="menu"][data-ready="true"]').waitFor({ timeout: 2000 });
  return menu;
}

async function installProbes(page) {
  await page.evaluate(() => {
    if (window.__gatherProbes) return;
    const counts = () => ({
      getTotalLength: 0,
      getBoundingClientRect: 0,
      offsetWidth: 0,
      setAttribute: 0,
      style: {},
    });
    let bucket = counts();
    const bumpStyle = (name) => {
      bucket.style[name] = (bucket.style[name] || 0) + 1;
    };
    const length = SVGGeometryElement.prototype.getTotalLength;
    SVGGeometryElement.prototype.getTotalLength = function patchedLength() {
      bucket.getTotalLength += 1;
      return length.call(this);
    };
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function patchedRect() {
      bucket.getBoundingClientRect += 1;
      return rect.call(this);
    };
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    if (width?.get) {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get() {
          bucket.offsetWidth += 1;
          return width.get.call(this);
        },
      });
    }
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function patchedAttr(name, value) {
      bucket.setAttribute += 1;
      return setAttribute.call(this, name, value);
    };
    const proto = CSSStyleDeclaration.prototype;
    const setProperty = proto.setProperty;
    proto.setProperty = function patchedSet(name, value, priority) {
      bumpStyle(name);
      return setProperty.call(this, name, value, priority);
    };
    for (const prop of ["transform", "opacity", "willChange", "zIndex", "left", "top", "width", "height"]) {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc?.set || !desc.get) continue;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(value) {
          bumpStyle(prop);
          desc.set.call(this, value);
        },
      });
    }
    window.__gatherProbes = {
      reset() {
        bucket = counts();
      },
      take() {
        const shot = {
          getTotalLength: bucket.getTotalLength,
          getBoundingClientRect: bucket.getBoundingClientRect,
          offsetWidth: bucket.offsetWidth,
          setAttribute: bucket.setAttribute,
          style: { ...bucket.style },
        };
        bucket = counts();
        return shot;
      },
    };
  });
}

async function measure(page, surface, action, rate) {
  const raw = await page.evaluate(async ({ surface, action }) => {
    const stage =
      surface === "families"
        ? document.querySelector(".family-sky")
        : document.querySelector(".graph-stage:not(.family-sky)");
    if (!(stage instanceof HTMLElement)) throw new Error(`missing ${surface} stage`);
    const probes = window.__gatherProbes;
    probes.reset();
    const frames = [];
    const longTasks = [];
    const lafs = [];
    const mutations = { childList: 0, attributes: 0, characterData: 0 };
    let snapshot = null;
    const tClick = performance.now();
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "longtask") {
          const attribution = [...(entry.attribution || [])].map((item) => item.name || item.containerName || "");
          longTasks.push({ start: entry.startTime, duration: entry.duration, attribution });
        }
        if (entry.entryType === "long-animation-frame") {
          lafs.push({ start: entry.startTime, duration: entry.duration, blocking: entry.blockingDuration || 0 });
        }
      }
    });
    observer.observe({ type: "longtask", buffered: false });
    try {
      observer.observe({ type: "long-animation-frame", buffered: false });
    } catch {
      // Older Chromium builds omit this entry type.
    }
    const world = stage.querySelector(".graph-world");
    const mo = new MutationObserver((records) => {
      for (const record of records) mutations[record.type] += 1;
    });
    if (world) mo.observe(world, { childList: true, subtree: true, attributes: true });
    let last = performance.now();
    let sawMotion = false;
    let settledAt = 0;
    const sampleSnap = () => {
      if (snapshot) return;
      const line = stage.querySelector(".graph-lines");
      const geom = stage.querySelector(".graph-lines line, .graph-lines path");
      const card = stage.querySelector(".portrait-card.is-active") || stage.querySelector(".portrait-card");
      const ripple = stage.querySelector("[data-gather-ripple]");
      const read = (node, prop) => (node ? getComputedStyle(node)[prop] : "");
      snapshot = {
        linesMode: stage.getAttribute("data-lines") || "shown",
        animating: stage.getAttribute("data-animating"),
        lineOpacity: read(line, "opacity"),
        dashOffset: read(geom, "strokeDashoffset"),
        dashArray: read(geom, "strokeDasharray"),
        cardShadow: read(card, "boxShadow"),
        cardFilter: read(card, "filter"),
        cardWillChange: read(card, "willChange"),
        worldWillChange: world ? getComputedStyle(world).willChange : "",
        rippleShadow: read(ripple, "boxShadow"),
        world: world ? { w: world.clientWidth, h: world.clientHeight } : null,
        cards: stage.querySelectorAll(".portrait-card, .sky-avatar").length,
        geoms: stage.querySelectorAll(".graph-lines line, .graph-lines path").length,
      };
    };
    await new Promise((resolve) => {
      const tick = (now) => {
        frames.push({ t: now, delta: now - last });
        last = now;
        const mode = stage.getAttribute("data-lines") || "shown";
        const animating = stage.getAttribute("data-animating") === "true";
        if (animating || mode === "out" || mode === "hidden" || mode === "in") {
          sawMotion = true;
          if (!snapshot && (mode === "out" || mode === "in" || mode === "hidden")) sampleSnap();
        }
        if (sawMotion && !animating && mode !== "out" && mode !== "hidden" && mode !== "in") {
          if (!settledAt) settledAt = now;
          if (now - settledAt > 80) {
            resolve();
            return;
          }
        }
        if (now - tClick > 6000) resolve();
        else requestAnimationFrame(tick);
      };
      const item = document.querySelector('[role="menuitem"]');
      if (action === "gather" && item instanceof HTMLElement) item.click();
      else if (action === "clear") {
        const rect = stage.getBoundingClientRect();
        const ignore = ".portrait-card, .sky-avatar, .sky-label, .graph-zoom, .graph-toolbar, .graph-port, .couple-tint, .btn, .icon-btn, .person-hold-menu";
        let point = null;
        for (let y = rect.top + 12; y < rect.bottom - 12 && !point; y += 16) {
          for (let x = rect.left + 12; x < rect.right - 12; x += 16) {
            const hit = document.elementFromPoint(x, y);
            if (!(hit instanceof Element) || !stage.contains(hit) || hit.closest(ignore)) continue;
            point = { x, y };
            break;
          }
        }
        if (!point) throw new Error("no empty space");
        stage.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: point.x, clientY: point.y, pointerId: 1, pointerType: "touch" }));
        stage.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: point.x, clientY: point.y, pointerId: 1, pointerType: "touch" }));
        stage.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: point.x, clientY: point.y }));
      }
      requestAnimationFrame(tick);
    });
    mo.disconnect();
    observer.disconnect();
    if (!snapshot) sampleSnap();
    return {
      surface,
      action,
      t0: tClick,
      t1: performance.now(),
      frames,
      longTasks,
      lafs,
      probes: probes.take(),
      snapshot,
      mutations,
      sawMotion,
    };
  }, { surface, action });
  raw.rate = rate;
  return summarize(raw);
}

async function prepare(page, surface) {
  if (surface === "families") {
    await turnFamilies(page, true);
    await revealSkyPerson(page, "fx-eli");
    await page.waitForFunction(
      () => document.querySelector(".family-sky")?.getAttribute("data-animating") === "false",
      null,
      { timeout: 4000 },
    );
    return page.locator('.family-sky .portrait-card[data-person-id="fx-eli"]');
  }
  await turnFamilies(page, false);
  await page.waitForFunction(
    () => document.querySelector(".graph-stage:not(.family-sky)")?.getAttribute("data-animating") === "false",
    null,
    { timeout: 4000 },
  );
  const eli = page.locator('.graph-stage:not(.family-sky) .portrait-card[data-person-id="fx-eli"]');
  await panClassic(page, eli);
  return eli;
}

async function runPair(page, cdp, surface, rate) {
  const eli = await prepare(page, surface);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await holdCard(page, eli);
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.waitForTimeout(250);
  await holdCard(page, eli);
  const gather = await measure(page, surface, "gather", rate);
  await page.waitForTimeout(200);
  const clear = await measure(page, surface, "clear", rate);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.getAttribute("data-animating") === "false",
    surface === "families" ? ".family-sky" : ".graph-stage:not(.family-sky)",
    { timeout: 4000 },
  );
  return [gather, clear];
}

function budgetProblems(run) {
  const problems = [];
  if (run.frameCount < 20) problems.push(`only ${run.frameCount} frames`);
  if (run.p95 > 20) problems.push(`p95 ${run.p95}ms`);
  if (run.longTaskMax > 50) problems.push(`long task ${run.longTaskMax}ms`);
  if (run.probes.getTotalLength !== 0) problems.push(`getTotalLength ${run.probes.getTotalLength}`);
  if (run.probes.style["--line-off"] || run.probes.style["--gather-len"]) problems.push("per-frame line dash");
  if ((run.mutations?.attributes || 0) > 500) problems.push(`${run.mutations.attributes} attribute writes`);
  return problems;
}

async function measureAll() {
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  colorScheme: "dark",
  reducedMotion: "no-preference",
});
await context.addInitScript(() => {
  window.localStorage.setItem("familytree-theme", "dark");
});
const page = await context.newPage();
const report = { base, viewport: "390x844", deviceScaleFactor: 3, touch: true, runs: [] };
try {
  await settle(page);
  await page.getByLabel("Import backup JSON").setInputFiles({
    name: "verify-family-sky.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.getByText("Looking at Ada").waitFor();
  await openVisualize(page);
  await installProbes(page);
  const cdp = await context.newCDPSession(page);
  for (const rate of rates) {
    for (const surface of ["families", "classic"]) {
      const pair = await runPair(page, cdp, surface, rate);
      report.runs.push(...pair);
      for (const run of pair) {
        console.log(
          `${surface} ${run.action} @${rate}x  frames=${run.frameCount} p95=${run.p95}ms max=${run.max}ms dropped=${run.dropped} over20=${run.over20} longTasks=${run.longTaskCount} longMax=${run.longTaskMax}ms laf=${run.lafCount} len=${run.probes.getTotalLength} rect=${run.probes.getBoundingClientRect} offsetW=${run.probes.offsetWidth} attr=${run.probes.setAttribute} style=${JSON.stringify(run.probes.style)} mut=${JSON.stringify(run.mutations)} snap=${JSON.stringify(run.snapshot)}`,
        );
      }
    }
  }
} finally {
  await browser.close();
}
return report;
}

let report = await measureAll();
if (check && report.runs.some((run) => budgetProblems(run).length)) {
  console.log("retrying gather budget once");
  report = await measureAll();
}
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`wrote ${outPath}`);
if (check) {
  const failures = report.runs.flatMap((run) => {
    const problems = budgetProblems(run);
    return problems.length ? [`${run.surface} ${run.action} @${run.rate}x: ${problems.join(", ")}`] : [];
  });
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("gather budget held at 4x: p95 ≤ 20ms, no long task over 50ms");
  }
}
