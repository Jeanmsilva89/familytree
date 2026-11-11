/**
 * Drive the opt-in Orbit view the way a person would.
 *
 * Fixture people only. A press-and-hold brings someone to the center.
 * A tap never does. Lines hide while the cards glide, then draw back in.
 * Clear returns the generation rows.
 *
 *   npm run build && npm start
 *   node scripts/verify-orbit.mjs
 */
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(path.join(here, "fixtures", "verify-family-sky.json"), "utf8"));
const base = (process.env.VERIFY_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const outDir = path.resolve(process.env.VERIFY_OUT || path.join(here, "..", "artifacts", "verify"));
const failures = [];

function fail(message) {
  failures.push(message);
  console.error("fail:", message);
}

async function scriptHasThree(page) {
  const urls = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.includes(".js")),
  );
  for (const url of urls) {
    const body = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return response.ok ? response.text() : "";
    }, url);
    if (body.includes("WebGLRenderer")) return true;
  }
  return false;
}

async function settle(page) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
}

async function openTree(page) {
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
}

function cardBox(page, id) {
  return page.evaluate((id) => {
    const el = document.querySelector(`.orbit-stage [data-person-id="${id}"]`);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const stage = document.querySelector(".orbit-stage").getBoundingClientRect();
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      opacity: Number(getComputedStyle(el).opacity),
      ring: el.getAttribute("data-ring"),
      name: el.getAttribute("data-name"),
      stageX: stage.x + stage.width / 2,
      stageY: stage.y + stage.height / 2,
    };
  }, id);
}

async function runSize(browser, size, reduced) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    hasTouch: size.name === "phone",
    isMobile: size.name === "phone",
    colorScheme: "dark",
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await context.addInitScript(() => window.localStorage.setItem("familytree-theme", "dark"));
  const page = await context.newPage();
  const label = `${size.name}${reduced ? "-reduced" : ""}`;
  try {
    await openTree(page);
    if (await scriptHasThree(page)) fail(`${label}: three.js loaded before Orbit was opened`);
    await page.getByRole("button", { name: "Orbit", exact: true }).click();
    await page.locator('.orbit-stage[data-ready="true"]').waitFor({ timeout: 15000 });
    const renderer = await page.locator(".orbit-stage").getAttribute("data-renderer");
    if (reduced) {
      if (renderer !== "fallback") fail(`${label}: reduced motion renderer is ${renderer}`);
      if (await scriptHasThree(page)) fail(`${label}: reduced motion loaded three.js`);
    } else if (renderer !== "webgl") {
      fail(`${label}: renderer is ${renderer}`);
    } else if (!(await scriptHasThree(page))) {
      fail(`${label}: Orbit did not lazy-load three.js`);
    }
    const fixtureLabel = (await page.locator(".orbit-note").textContent())?.trim();
    if (fixtureLabel !== "Fixture") fail(`${label}: fixture label is ${fixtureLabel || "missing"}`);
    if ((await page.locator(".orbit-stage").getAttribute("data-layout")) !== "rows") fail(`${label}: did not open on generation rows`);

    const ada = await cardBox(page, "fx-ada");
    const eli = await cardBox(page, "fx-eli");
    const fay = await cardBox(page, "fx-fay");
    if (!ada || !eli || !fay) fail(`${label}: a generation card is missing`);
    else if (!(ada.y < eli.y - 8 && eli.y < fay.y - 8)) fail(`${label}: generation rows are out of order`);
    else if (!ada.name?.endsWith("Fixture") || !eli.name?.endsWith("Fixture")) fail(`${label}: a card is not fixture data`);
    await page.screenshot({ path: path.join(outDir, `orbit-${size.name}${reduced ? "-reduced" : ""}-rows.png`) });

    await page.mouse.click(eli.x, eli.y);
    await page.waitForTimeout(200);
    if ((await page.locator(".orbit-stage").getAttribute("data-layout")) !== "rows") fail(`${label}: a tap left the generation rows`);
    if (await page.locator(".sheet").count()) fail(`${label}: the first tap opened the editor`);
    await page.mouse.click(eli.x, eli.y);
    await page.locator(".sheet").waitFor({ timeout: 4000 });
    const title = await page.locator(".sheet h2, .sheet [id$='title']").first().textContent();
    if (!title?.includes("Eli Fixture")) fail(`${label}: editor opened ${title || "without Eli Fixture"}`);
    await page.locator(".sheet-close").click();
    await page.locator(".sheet").waitFor({ state: "hidden" });
    if ((await page.locator(".orbit-stage").getAttribute("data-layout")) !== "rows") fail(`${label}: closing the editor gathered the tree`);

    const before = await cardBox(page, "fx-eli");
    await page.evaluate(() => {
      window.__orbit = { sawOutOnRows: false, transforms: [] };
      let last = "";
      const tick = () => {
        const stage = document.querySelector(".orbit-stage");
        if (stage?.dataset.lines === "out" && stage.dataset.layout === "rows") window.__orbit.sawOutOnRows = true;
        if (stage?.dataset.motion === "glide") {
          const el = document.querySelector('[data-person-id="fx-eli"]');
          const value = el ? getComputedStyle(el).transform : "";
          if (value && value !== last) {
            window.__orbit.transforms.push(value);
            last = value;
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    await page.waitForFunction(
      () => {
        const stage = document.querySelector(".orbit-stage");
        return stage?.dataset.layout === "orbit" && stage.dataset.lines === "shown" && stage.dataset.motion === "idle";
      },
      null,
      { timeout: 8000 },
    );
    await page.mouse.up();
    const trace = await page.evaluate(() => window.__orbit);
    if (!trace.sawOutOnRows) fail(`${label}: lines did not hide before the cards moved`);
    if (!reduced && trace.transforms.length < 2) fail(`${label}: Eli's transform did not glide (${trace.transforms.length} samples)`);

    const center = await cardBox(page, "fx-eli");
    const dee = await cardBox(page, "fx-dee");
    const adaNow = await cardBox(page, "fx-ada");
    const fayNow = await cardBox(page, "fx-fay");
    const wynn = await cardBox(page, "fx-wynn");
    if (!center || !dee || !adaNow || !fayNow || !wynn) fail(`${label}: a seated card is missing`);
    else {
      const beforeDist = Math.hypot(before.x - before.stageX, before.y - before.stageY);
      const afterDist = Math.hypot(center.x - center.stageX, center.y - center.stageY);
      if (afterDist > 130) fail(`${label}: Eli is not near the center (${afterDist.toFixed(0)}px)`);
      if (beforeDist > 110 && !(afterDist < beforeDist - 4)) {
        fail(`${label}: Eli did not move toward the center (${beforeDist.toFixed(0)} -> ${afterDist.toFixed(0)})`);
      }
      if (center.ring !== "center") fail(`${label}: Eli ring is ${center.ring}`);
      if (dee.ring !== "partner" || !(dee.x > center.x + 12)) fail(`${label}: Dee is not beside Eli`);
      if (fayNow.ring !== "near" || !(fayNow.y > center.y + 12)) fail(`${label}: Fay is not below Eli`);
      if (adaNow.ring !== "near" || !(adaNow.y < center.y - 12)) fail(`${label}: Ada is not above Eli`);
      if (wynn.ring !== "outer" || !(wynn.opacity < 0.5)) fail(`${label}: Wynn is not dialed back (${wynn.ring}, ${wynn.opacity})`);
    }
    await page.screenshot({ path: path.join(outDir, `orbit-${size.name}${reduced ? "-reduced" : ""}-focused.png`) });

    const empty = await page.evaluate(() => {
      const stage = document.querySelector(".orbit-stage");
      const rect = stage.getBoundingClientRect();
      const spots = [
        [rect.left + 10, rect.bottom - 10],
        [rect.right - 16, rect.top + 12],
        [rect.left + 12, rect.top + 12],
      ];
      for (const [x, y] of spots) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !hit.closest(".portrait-card, button, a, .sheet")) return { x, y };
      }
      return null;
    });
    if (!empty) fail(`${label}: no empty space to clear`);
    else {
      await page.mouse.click(empty.x, empty.y);
      await page.waitForFunction(
        () => {
          const stage = document.querySelector(".orbit-stage");
          return stage?.dataset.layout === "rows" && stage.dataset.lines === "shown" && stage.dataset.motion === "idle";
        },
        null,
        { timeout: 8000 },
      );
    }
    const returned = await cardBox(page, "fx-eli");
    if (returned && (await page.locator(".orbit-stage").getAttribute("data-layout")) !== "rows") {
      fail(`${label}: clear did not restore the rows`);
    }
    await page.mouse.click(returned.x, returned.y);
    await page.waitForTimeout(250);
    if ((await page.locator(".orbit-stage").getAttribute("data-layout")) !== "rows") fail(`${label}: a tap after clear gathered the tree`);
    if (await page.locator(".sheet").count()) {
      await page.locator(".sheet-close").click();
      await page.locator(".sheet").waitFor({ state: "hidden" });
    }
    await page.screenshot({ path: path.join(outDir, `orbit-${size.name}${reduced ? "-reduced" : ""}-rows-again.png`) });

    if (!reduced) {
      await page.getByRole("button", { name: "Orbit", exact: true }).click();
      await page.locator(".family-sky").waitFor({ timeout: 8000 });
      if (await page.locator(".orbit-stage").count()) fail(`${label}: Orbit stayed on after the chip was turned off`);
    }
  } catch (error) {
    if (!failures.some((item) => item.startsWith(label))) fail(`${label}: ${error.message}`);
    await page.screenshot({ path: path.join(outDir, `orbit-${label}-error.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const size of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    await runSize(browser, size, false);
  }
  await runSize(browser, { name: "phone", width: 390, height: 844 }, true);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`orbit verify failed (${failures.length})`);
  process.exitCode = 1;
} else {
  console.log("orbit verify passed");
}
