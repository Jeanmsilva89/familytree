/**
 * Drive the three sample directions the way a person would.
 *
 *   npm run build && npm start
 *   node scripts/verify-samples.mjs
 *
 * VERIFY_BASE_URL overrides the server. VERIFY_OUT receives screenshots.
 */
import { chromium } from "playwright";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const base = (process.env.VERIFY_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const outDir = process.env.VERIFY_OUT || path.join(root, "artifacts", "verify");
const baseline = JSON.parse(await readFile(path.join(here, "fixtures", "main-bundle-baseline.json"), "utf8"));

const failures = [];
function fail(message) {
  failures.push(message);
  console.error("fail:", message);
}

async function bundleBytes() {
  const manifestPath = path.join(root, ".next", "app-build-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const files = [...new Set([...(manifest.pages["/page"] || []), ...(manifest.pages["/layout"] || [])])];
  const sizes = [];
  for (const file of files) {
    if (file.includes("/webpack-")) {
      const text = await readFile(path.join(root, ".next", file));
      if (text.includes("WebGLRenderer")) fail(`${file} contains three.js`);
      continue;
    }
    const full = path.join(root, ".next", file);
    const text = await readFile(full);
    if (text.includes("WebGLRenderer")) fail(`${file} contains three.js`);
    sizes.push((await stat(full)).size);
  }
  sizes.sort((a, b) => a - b);
  const expected = [...baseline.sizes].sort((a, b) => a - b);
  if (sizes.join(",") !== expected.join(",")) {
    fail(`home bundle sizes changed: ${sizes.join(",")} vs ${expected.join(",")}`);
  } else {
    console.log("home bundle bytes unchanged", sizes.join(","));
  }
  let threeChunk = false;
  const chunkRoot = path.join(root, ".next", "static", "chunks");
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".js") && (await readFile(full)).includes("WebGLRenderer")) threeChunk = true;
    }
  };
  await walk(chunkRoot);
  if (!threeChunk) fail("no sample chunk contains three.js");
}

async function scriptHasThree(page) {
  const urls = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes(".js")),
  );
  let found = false;
  for (const url of urls) {
    const body = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return response.ok ? response.text() : "";
    }, url);
    if (body.includes("WebGLRenderer")) found = true;
  }
  return found;
}

async function drag(page, canvas) {
  const box = await canvas.boundingBox();
  const x = box.x + box.width * 0.55;
  const y = box.y + box.height * 0.5;
  const before = Number(await page.locator("[data-sample]").getAttribute("data-yaw"));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 90, y + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const after = Number(await page.locator("[data-sample]").getAttribute("data-yaw"));
  if (!(Math.abs(after - before) > 0.05)) fail(`pan did not turn the view (${before} -> ${after})`);
}

async function zoom(page, canvas, phone, cdp, direction) {
  const before = Number(await page.locator("[data-sample]").getAttribute("data-dist"));
  const box = await canvas.boundingBox();
  const inward = direction !== "out";
  if (phone) {
    const midX = box.x + box.width / 2;
    const midY = box.y + box.height / 2;
    const start = inward ? 34 : 120;
    const end = inward ? 130 : 40;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: midX - start, y: midY, id: 1 },
        { x: midX + start, y: midY, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: midX - end, y: midY, id: 1 },
        { x: midX + end, y: midY, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, inward ? -650 : 400);
  }
  await page.waitForTimeout(160);
  const after = Number(await page.locator("[data-sample]").getAttribute("data-dist"));
  if (!(Math.abs(after - before) > 0.4)) fail(`zoom did not change distance (${before} -> ${after})`);
}

async function visiblePerson(page, id) {
  return page.evaluate((id) => {
    const nodes = [...document.querySelectorAll("[data-person-id]")];
    const pick = nodes.find((el) => {
      if (id && el.getAttribute("data-person-id") !== id) return false;
      const opacity = Number(getComputedStyle(el).opacity);
      const rect = el.getBoundingClientRect();
      // Stay clear of the edges. A card clipped by the frame can pass a loose box check and still miss the tap.
      return opacity > 0.55 && rect.width > 8 && rect.left > 48 && rect.right < innerWidth - 48 && rect.top > 64 && rect.bottom < innerHeight - 64;
    });
    if (!pick) return null;
    const rect = pick.getBoundingClientRect();
    return {
      id: pick.getAttribute("data-person-id"),
      name: pick.getAttribute("data-name"),
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  }, id);
}

async function tapPerson(page, person) {
  await page.mouse.click(person.x, person.y);
  await page.waitForTimeout(150);
  const selected = await page.locator("[data-selected-name]").getAttribute("data-selected-name");
  if (selected !== person.name) fail(`tap showed ${selected || "nothing"} instead of ${person.name}`);
}

async function runDirection(page, cdp, kind, phone, size) {
  await page.goto(`${base}/samples/${kind}`, { waitUntil: "networkidle" });
  await page.locator(`[data-sample="${kind}"][data-ready="true"]`).waitFor({ timeout: 15000 });
  const renderer = await page.locator("[data-sample]").getAttribute("data-renderer");
  if (renderer !== "webgl") fail(`${kind} renderer is ${renderer}`);
  const canvas = page.locator("canvas");
  await drag(page, canvas);
  if (kind !== "cards") await zoom(page, canvas, phone, cdp, "out");

  if (kind === "depth") {
    const family = page.locator("[data-family-id]", { hasText: "Dee & Eli" });
    const box = await family.boundingBox();
    if (!box) fail("Dee & Eli is not on the depth sky");
    else {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => document.querySelector('[data-sample="depth"]')?.dataset.level === "near", null, { timeout: 4000 });
    }
    const person = (await visiblePerson(page, "fx-eli")) || (await visiblePerson(page));
    if (!person) fail("no readable person on the depth sky");
    else await tapPerson(page, person);
  }

  if (kind === "cards") {
    await zoom(page, canvas, phone, cdp, "in");
    await page.waitForFunction(
      () => {
        const stage = document.querySelector('[data-sample="cards"]');
        return stage?.dataset.level === "near" && stage.dataset.motion === "idle";
      },
      null,
      { timeout: 5000 },
    );
    const person = await visiblePerson(page);
    if (!person) fail("no readable card after zooming in");
    else await tapPerson(page, person);
  }

  if (kind === "orbit") {
    const eli = await visiblePerson(page, "fx-eli");
    if (!eli) fail("Eli is not readable on the orbit sky");
    else {
      await page.mouse.move(eli.x, eli.y);
      await page.mouse.down();
      await page.waitForFunction(() => {
        const lines = document.querySelector('[data-sample="orbit"]')?.dataset.lines;
        return lines === "out" || lines === "hidden";
      }, null, { timeout: 3000 });
      await page.mouse.up();
      await page.waitForFunction(() => {
        const stage = document.querySelector('[data-sample="orbit"]');
        return stage?.dataset.layout === "orbit" && stage.dataset.lines === "shown" && stage.dataset.motion === "idle";
      }, null, { timeout: 5000 });
      const rings = await page.evaluate(() =>
        Object.fromEntries([...document.querySelectorAll("[data-person-id]")].map((el) => [el.getAttribute("data-person-id"), el.getAttribute("data-ring")])),
      );
      if (rings["fx-dee"] !== "partner") fail(`Dee ring is ${rings["fx-dee"]}`);
      if (rings["fx-fay"] !== "near") fail(`Fay ring is ${rings["fx-fay"]}`);
      if (rings["fx-wynn"] !== "outer") fail(`Wynn ring is ${rings["fx-wynn"]}`);
      const selected = await page.locator("[data-selected-name]").getAttribute("data-selected-name");
      if (selected !== "Eli Fixture") fail(`hold showed ${selected || "nothing"}`);
    }
  }

  if (phone) await page.screenshot({ path: path.join(outDir, `sample-${kind}-phone.png`) });
  console.log(size, kind, "ok");
}

async function runSize(browser, size, viewport, phone) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: phone ? 2 : 1,
    hasTouch: phone,
    isMobile: phone,
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.on("pageerror", (error) => fail(`${size} ${error.message}`));

  await page.goto(base, { waitUntil: "networkidle" });
  const linked = await page.locator('a[href="/samples"], a[href^="/samples/"]').count();
  if (linked) fail("samples are linked from the home page");
  if (await scriptHasThree(page)) fail("home page loaded three.js");

  await page.goto(`${base}/samples`, { waitUntil: "networkidle" });
  for (const [title, line] of [
    ["Depth sky", "Households sit on glowing discs, and distant generations fall softly out of focus."],
    ["Floating cards", "Families begin as stars, then ease open into cards as you pinch closer."],
    ["Orbit focus", "Press and hold someone to bring them center, with relatives on rings."],
  ]) {
    const link = page.getByRole("link", { name: new RegExp(title) });
    await link.waitFor();
    const text = await link.innerText();
    if (!text.includes(line)) fail(`index card for ${title} does not include its description`);
  }
  if (phone) await page.screenshot({ path: path.join(outDir, "sample-index-phone.png") });

  for (const kind of ["depth", "cards", "orbit"]) {
    try {
      await runDirection(page, cdp, kind, phone, size);
    } catch (error) {
      fail(`${size} ${kind} ${error.message}`);
    }
  }
  await context.close();
}

async function runFallback(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(`${base}/samples/depth`, { waitUntil: "networkidle" });
  await page.locator('[data-renderer="fallback"][data-ready="true"]').waitFor();
  const reason = await page.locator("[data-sample]").getAttribute("data-reason");
  if (reason !== "reduced-motion") fail(`fallback reason is ${reason}`);
  if (await page.locator("canvas").count()) fail("reduced motion still mounted a canvas");
  if (await scriptHasThree(page)) fail("reduced motion loaded three.js");
  const button = page.locator("[data-person-id='fx-eli']");
  await button.click();
  const selected = await page.locator("[data-selected-name]").getAttribute("data-selected-name");
  if (selected !== "Eli Fixture") fail(`fallback tap showed ${selected || "nothing"}`);
  console.log("fallback reduced-motion ok");
  await context.close();

  const plain = await chromium.launch({ headless: true, args: ["--disable-webgl", "--disable-webgl2"] });
  const noGl = await plain.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "no-preference" });
  const glPage = await noGl.newPage();
  await glPage.goto(`${base}/samples/orbit`, { waitUntil: "networkidle" });
  await glPage.locator("[data-ready='true']").waitFor();
  const renderer = await glPage.locator("[data-sample]").getAttribute("data-renderer");
  if (renderer !== "fallback") fail(`no-webgl renderer is ${renderer}`);
  else console.log("fallback no-webgl ok");
  await plain.close();
}

await mkdir(outDir, { recursive: true });
try {
  await bundleBytes();
} catch (error) {
  fail(`bundle ${error.message}`);
}

const browser = await chromium.launch({ headless: true });
try {
  await runSize(browser, "desktop", { width: 1280, height: 800 }, false);
  await runSize(browser, "phone", { width: 390, height: 844 }, true);
  await runFallback(browser);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} sample check(s) failed`);
  process.exit(1);
}
console.log("samples passed");
