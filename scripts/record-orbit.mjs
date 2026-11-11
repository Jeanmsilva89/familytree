/**
 * Phone-size capture of Orbit focus and the clear that follows.
 * CDP screencast frames, encoded as H.264 yuv420p with faststart.
 *
 *   node scripts/record-orbit.mjs
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(path.join(here, "fixtures", "verify-family-sky.json"), "utf8"));
const base = (process.env.VERIFY_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const out = process.env.ORBIT_MP4 || "/opt/cursor/artifacts/orbit-phone.mp4";
const framesDir = "/tmp/orbit-frames";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

await mkdir(framesDir, { recursive: true });
await rm(framesDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });
await mkdir(path.dirname(out), { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-frame-rate-limit", "--disable-gpu-vsync"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
  colorScheme: "dark",
  reducedMotion: "no-preference",
});
await context.addInitScript(() => window.localStorage.setItem("familytree-theme", "dark"));
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", (event) => {
  frames.push({ data: event.data, time: event.metadata.timestamp || 0 });
  cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
});

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
  await page.locator(".family-sky").waitFor();
  await page.getByRole("button", { name: "Orbit", exact: true }).click();
  await page.locator('.orbit-stage[data-ready="true"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const eli = await page.evaluate(() => {
    const rect = document.querySelector('[data-person-id="fx-eli"]').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });

  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    maxWidth: 390,
    maxHeight: 844,
    everyFrame: true,
  });
  await page.waitForTimeout(350);
  await page.mouse.move(eli.x, eli.y);
  await page.mouse.down();
  await page.waitForFunction(() => {
    const stage = document.querySelector(".orbit-stage");
    return stage?.dataset.layout === "orbit" && stage.dataset.lines === "shown" && stage.dataset.motion === "idle";
  });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const empty = await page.evaluate(() => {
    const stage = document.querySelector(".orbit-stage");
    const rect = stage.getBoundingClientRect();
    const spots = [
      [rect.left + 12, rect.bottom - 12],
      [rect.right - 18, rect.top + 14],
    ];
    for (const [x, y] of spots) {
      const hit = document.elementFromPoint(x, y);
      if (hit && !hit.closest(".portrait-card, button, a")) return { x, y };
    }
    return null;
  });
  if (!empty) throw new Error("no empty space");
  await page.mouse.click(empty.x, empty.y);
  await page.waitForFunction(() => {
    const stage = document.querySelector(".orbit-stage");
    return stage?.dataset.layout === "rows" && stage.dataset.lines === "shown" && stage.dataset.motion === "idle";
  });
  await page.waitForTimeout(500);
  await cdp.send("Page.stopScreencast");
  await page.waitForTimeout(200);
} finally {
  await browser.close();
}

if (frames.length < 10) throw new Error(`only ${frames.length} screencast frames`);
const stamps = frames.map((frame, index) => ({ index, time: frame.time || index / 60 }));
const gaps = [];
for (let i = 1; i < stamps.length; i += 1) gaps.push(stamps[i].time - stamps[i - 1].time);
gaps.sort((a, b) => a - b);
const median = gaps[Math.floor(gaps.length / 2)] || 1 / 60;
console.log(`frames ${frames.length} median gap ${median.toFixed(4)}s`);

let list = "ffconcat version 1.0\n";
for (let i = 0; i < frames.length; i += 1) {
  const name = `f${String(i).padStart(4, "0")}.jpg`;
  await writeFile(path.join(framesDir, name), Buffer.from(frames[i].data, "base64"));
  const gap = i < frames.length - 1 ? Math.max(1 / 120, Math.min(0.5, stamps[i + 1].time - stamps[i].time || median)) : Math.min(0.4, median);
  list += `file '${name}'\n`;
  list += `duration ${gap.toFixed(5)}\n`;
}
list += `file 'f${String(frames.length - 1).padStart(4, "0")}.jpg'\n`;
await writeFile(path.join(framesDir, "list.txt"), list);
await run("ffmpeg", [
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  path.join(framesDir, "list.txt"),
  "-vf",
  "scale=390:844:flags=lanczos,fps=60,format=yuv420p",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  out,
]);
console.log(`wrote ${out}`);
