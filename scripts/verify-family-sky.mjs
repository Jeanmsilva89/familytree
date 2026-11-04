/**
 * Drive Family Tree the way a person would and confirm the Families lens.
 *
 * Loads the labeled fixture in scripts/fixtures/verify-family-sky.json (never
 * real relatives), opens Visualize, turns on Families, checks buckets, zooms
 * out to the star view, taps a star, and moves fixture people between family
 * units. Also checks a step-parent bucket, a partnerless move, and that a
 * reload draws the same stars. Runs at desktop 1280x800 and phone 390x844.
 *
 *   npm run build && npm start
 *   npm run verify
 *   VERIFY_BASE_URL=https://familytree-rose.vercel.app npm run verify
 *
 * Screenshots go to VERIFY_OUT (default artifacts/verify).
 */
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "verify-family-sky.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

const base = (process.env.VERIFY_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const outDir = path.resolve(process.env.VERIFY_OUT || "artifacts/verify");

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
];

function fail(message) {
  const error = new Error(message);
  error.verification = true;
  throw error;
}

async function settle(page) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
  // The service worker claims the page once and reloads. A second load is stable.
  await page.waitForTimeout(800);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
}

async function level(page) {
  return page.locator(".family-sky").getAttribute("data-level");
}

async function waitLevel(page, expected) {
  await page.waitForFunction(
    (value) => document.querySelector(".family-sky")?.getAttribute("data-level") === value,
    expected,
    { timeout: 8000 },
  );
  await page.waitForTimeout(500);
}

async function openVisualize(page) {
  if ((await page.locator(".graph-overlay").count()) === 0) {
    const inFamily = page.locator(".family-overlay").getByRole("button", { name: "Visualize", exact: true });
    if (await inFamily.count()) {
      await inFamily.click();
    } else {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("menuitem", { name: "Visualize tree" }).click();
    }
  }
  await page.locator(".graph-overlay").waitFor();
}

async function turnFamiliesOn(page, viewport) {
  const families = page.getByRole("button", { name: "Families", exact: true });
  await families.scrollIntoViewIfNeeded();
  if ((await families.getAttribute("aria-pressed")) === "true") {
    await families.click();
    await page.locator(".family-sky").waitFor({ state: "detached" });
  }
  await families.click();
  await page.locator(".family-sky").waitFor();
  if ((await families.getAttribute("aria-pressed")) !== "true") {
    fail(`${viewport.name}: Families lens did not turn on`);
  }
  await page.getByLabel(/Family sky, \d+ families/).waitFor();
}

async function showStars(page) {
  await page.getByRole("button", { name: "All families" }).click();
  await waitLevel(page, "far");
}

async function starSnapshot(page) {
  return page.locator(".sky-star").evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const core = node.querySelector(".sky-star-core");
        return {
          id: node.getAttribute("data-unit-id"),
          members: node.getAttribute("data-members") || "",
          cx: core?.getAttribute("cx") || "",
          cy: core?.getAttribute("cy") || "",
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

async function openPerson(page, personId) {
  const portrait = page.locator(`.portrait-card[data-person-id="${personId}"]`);
  const avatar = page.locator(`.sky-avatar[data-person-id="${personId}"]`);
  if (await avatar.count()) {
    await avatar.click({ force: true });
    await portrait.waitFor({ timeout: 8000 });
  }
  await portrait.click();
  if ((await page.getByRole("dialog").count()) === 0) await portrait.click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  return sheet;
}

async function moveToUnit(page, sheet, unitRootId) {
  const select = sheet.locator("label.family-unit-field select");
  await select.scrollIntoViewIfNeeded();
  await select.selectOption(unitRootId);
  await page.waitForFunction(
    (value) => document.querySelector("label.family-unit-field select")?.value === value,
    unitRootId,
    { timeout: 8000 },
  );
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: "dark",
    hasTouch: viewport.name === "phone",
    isMobile: viewport.name === "phone",
  });
  await context.addInitScript(() => {
    window.localStorage.setItem("familytree-theme", "dark");
  });
  const page = await context.newPage();
  const shot = (step) => path.join(outDir, `family-sky-${viewport.name}-${step}.png`);

  try {
    await settle(page);
    await page.getByLabel("Import backup JSON").setInputFiles({
      name: "verify-family-sky.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await page.getByText("Looking at Ada").waitFor();
    await openVisualize(page);
    await turnFamiliesOn(page, viewport);

    for (let i = 0; i < 8; i += 1) {
      const now = await level(page);
      const buckets = await page.locator(".sky-bucket").count();
      if (now && now !== "far" && buckets >= 2) break;
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.waitForTimeout(480);
    }
    const bucketCount = await page.locator(".sky-bucket").count();
    if ((await level(page)) === "far" || bucketCount < 2) {
      fail(`${viewport.name}: expected family buckets, saw level ${await level(page)} and ${bucketCount} buckets`);
    }
    const blood = await page.locator(".sky-link.is-blood").count();
    if (blood < 1) fail(`${viewport.name}: expected a blood link between family buckets`);
    await page.screenshot({ path: shot("buckets") });

    await showStars(page);
    const stars = await starSnapshot(page);
    if (stars.length < 2) fail(`${viewport.name}: expected glowing stars, saw ${stars.length}`);
    const nia = stars.find((star) => star.members.split(" ").includes("fx-nia"));
    const stu = stars.find((star) => star.members.split(" ").includes("fx-stu"));
    if (!nia || !nia.members.split(" ").includes("fx-pal")) {
      fail(`${viewport.name}: Nia and Pal should share a family (${JSON.stringify(stars.map((s) => s.members))})`);
    }
    if (!stu || nia.id === stu.id || stu.members.split(" ").includes("fx-pal")) {
      fail(`${viewport.name}: Pal landed in Stu's family (${stu?.members})`);
    }
    await page.getByText("Tap a family to zoom in").waitFor();
    await page.screenshot({ path: shot("stars") });

    await page.getByRole("button", { name: /Ada & Ben family/ }).click();
    await page.waitForFunction(
      () => document.querySelector(".family-sky")?.getAttribute("data-level") !== "far",
      null,
      { timeout: 8000 },
    );
    await page.waitForTimeout(500);
    if ((await level(page)) === "far") fail(`${viewport.name}: tapping a star did not zoom in`);
    await page.screenshot({ path: shot("zoomed") });

    const sheet = await openPerson(page, "fx-cora");
    const options = await sheet.locator("label.family-unit-field select option").evaluateAll((nodes) =>
      nodes.map((node) => ({ value: node.value, label: node.textContent?.trim() ?? "" })),
    );
    if (!options.some((option) => option.value === "fx-dee")) {
      fail(`${viewport.name}: Dee's family unit is not a choice (${JSON.stringify(options)})`);
    }
    await moveToUnit(page, sheet, "fx-dee");
    await page.waitForFunction(async () => {
      const tree = await new Promise((resolve, reject) => {
        const request = indexedDB.open("familytree");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction("tree", "readonly").objectStore("tree").get("living");
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
      });
      return tree?.familyUnitOverrides?.some((row) => row.personId === "fx-cora" && row.unitOf === "fx-dee");
    });
    await page.screenshot({ path: shot("unit") });

    await sheet.getByRole("button", { name: "Close" }).click();
    await sheet.waitFor({ state: "detached" });
    await showStars(page);
    const rexButton = page.getByRole("button", { name: /Rex family/ });
    if (await rexButton.count()) await rexButton.click();
    else await page.locator('.sky-star[data-members="fx-rex"] .sky-star-core').click({ force: true });
    await page.waitForFunction(
      () => document.querySelector(".family-sky")?.getAttribute("data-level") !== "far",
      null,
      { timeout: 8000 },
    );
    await page.waitForTimeout(800);
    const rexSheet = await openPerson(page, "fx-rex");
    await moveToUnit(page, rexSheet, "fx-dee");
    await page.waitForFunction(async () => {
      const tree = await new Promise((resolve, reject) => {
        const request = indexedDB.open("familytree");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction("tree", "readonly").objectStore("tree").get("living");
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
      });
      return tree?.familyUnitOverrides?.some((row) => row.personId === "fx-rex" && row.unitOf === "fx-dee");
    });
    await rexSheet.getByRole("button", { name: "Close" }).click();
    await rexSheet.waitFor({ state: "detached" });
    try {
      await page.waitForFunction(() => {
        const top = (id) => {
          const el = document.querySelector(`.portrait-card[data-person-id="${id}"]`)
            || document.querySelector(`.sky-avatar[data-person-id="${id}"]`);
          return el instanceof HTMLElement ? el.style.top : "";
        };
        const rex = top("fx-rex");
        const dee = top("fx-dee");
        const fay = top("fx-fay");
        return Boolean(rex && dee && fay && rex === dee && fay !== dee);
      }, null, { timeout: 8000 });
    } catch {
      const tops = await page.evaluate(() => {
        const top = (id) => {
          const el = document.querySelector(`[data-person-id="${id}"]`);
          return el instanceof HTMLElement ? `${el.className} ${el.style.top}` : "missing";
        };
        return { rex: top("fx-rex"), dee: top("fx-dee"), fay: top("fx-fay") };
      });
      fail(`${viewport.name}: Rex did not join Dee's row (${JSON.stringify(tops)})`);
    }
    await page.screenshot({ path: shot("row") });

    await showStars(page);
    const beforeReload = await starSnapshot(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
    await page.getByText("Looking at Ada").waitFor();
    await openVisualize(page);
    await turnFamiliesOn(page, viewport);
    await showStars(page);
    const afterReload = await starSnapshot(page);
    if (JSON.stringify(beforeReload) !== JSON.stringify(afterReload)) {
      fail(`${viewport.name}: star positions changed after reload`);
    }
    console.log(`${viewport.name}: buckets, stars, step family, row move, and reload passed`);
  } catch (error) {
    await page.screenshot({ path: shot("failed") }).catch(() => undefined);
    throw error;
  } finally {
    await context.close();
  }
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of VIEWPORTS) {
    await runViewport(browser, viewport);
  }
} finally {
  await browser.close();
}
console.log(`verification passed (${base})`);
console.log(`screenshots in ${outDir}`);
