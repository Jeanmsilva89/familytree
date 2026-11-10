/**
 * Phone-size capture of Gather family and the clear that follows.
 * CDP screencast frames, encoded as H.264 yuv420p with faststart.
 *
 *   node scripts/record-gather.mjs
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(path.join(here, "fixtures", "verify-family-sky.json"), "utf8"));
const base = (process.env.VERIFY_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const out = process.env.GATHER_MP4 || "/opt/cursor/artifacts/gather-phone.mp4";
const framesDir = "/tmp/gather-frames";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function settle(page) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
}

async function reveal(page) {
  const home = page.getByRole("button", { name: "All families" });
  if (await home.count()) await home.click();
  await page.waitForTimeout(500);
  const star = page.locator('.sky-star[data-members~="fx-eli"]');
  await star.first().waitFor({ timeout: 8000 });
  await star.locator(".sky-star-core").click({ force: true });
  await page.waitForFunction(() => document.querySelector(".family-sky")?.getAttribute("data-level") !== "far");
  const card = page.locator('.family-sky .portrait-card[data-person-id="fx-eli"]');
  for (let i = 0; i < 8; i += 1) {
    if (await card.count()) return card;
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.waitForTimeout(350);
  }
  throw new Error("could not show Eli");
}

async function hold(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no card");
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(36, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(680);
  await page.mouse.up();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  await page.locator('[role="menu"][data-ready="true"]').waitFor();
  return menu;
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
  await settle(page);
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
  const eli = await reveal(page);
  await page.waitForFunction(() => document.querySelector(".family-sky")?.getAttribute("data-animating") === "false");
  await page.waitForTimeout(400);

  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    maxWidth: 390,
    maxHeight: 844,
    everyFrame: true,
  });
  await page.waitForTimeout(300);
  const menu = await hold(page, eli);
  await menu.getByRole("menuitem", { name: "Gather family" }).click();
  await page.locator('.family-sky[data-layout="personal"]').waitFor();
  await page.waitForFunction(() => document.querySelector(".family-sky")?.getAttribute("data-animating") === "false");
  await page.waitForTimeout(450);
  const empty = await page.evaluate(() => {
    const stage = document.querySelector(".family-sky");
    if (!(stage instanceof HTMLElement)) return null;
    const rect = stage.getBoundingClientRect();
    for (let y = rect.top + 16; y < rect.bottom - 16; y += 16) {
      for (let x = rect.left + 16; x < rect.right - 16; x += 16) {
        const hit = document.elementFromPoint(x, y);
        if (!(hit instanceof Element) || !stage.contains(hit)) continue;
        if (hit.closest(".portrait-card, .sky-avatar, .sky-label, .graph-zoom, .graph-toolbar, .couple-tint, .btn, .icon-btn")) continue;
        return { x, y };
      }
    }
    return null;
  });
  if (!empty) throw new Error("no empty space");
  await page.mouse.click(empty.x, empty.y);
  await page.locator('.family-sky[data-layout="sky"]').waitFor();
  await page.waitForFunction(() => document.querySelector(".family-sky")?.getAttribute("data-animating") === "false");
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
  "-crf",
  "18",
  out,
]);
console.log(`wrote ${out}`);
