/**
 * Drive Family Tree the way a person would and confirm the Families lens.
 *
 * Loads the labeled fixture in scripts/fixtures/verify-family-sky.json (never
 * real relatives), opens Visualize, turns on Families, checks buckets, zooms
 * out to the star view, taps a star, and moves fixture people between family
 * units. Also checks a step-parent bucket, a partnerless move, that a
 * person-to-person link does not cross an unrelated family's background, and
 * that a reload draws the same stars. On the classic graph (Families off),
 * a first tap gathers that fixture person's family into a personal map and
 * clearing the selection restores the tree. On the Families lens, the same
 * first tap gathers that person inside the sky, and empty space or All families
 * restores the sky. Runs at desktop 1280x800 and phone 390x844.
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

async function turnFamiliesOff(page) {
  const families = page.getByRole("button", { name: "Families", exact: true });
  await families.scrollIntoViewIfNeeded();
  if ((await families.getAttribute("aria-pressed")) === "true") {
    await families.click();
    await page.locator(".family-sky").waitFor({ state: "detached" });
  }
  await page.locator('.graph-stage[data-layout="tree"][data-framed="true"]').waitFor();
}

async function waitMapSettled(page) {
  await page.waitForFunction(
    () => document.querySelector(".graph-stage:not(.family-sky)")?.getAttribute("data-animating") === "false",
    null,
    { timeout: 4000 },
  );
  await page.waitForTimeout(60);
}

async function graphCards(page) {
  return page.locator(".graph-stage:not(.family-sky) .portrait-card").evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = node.getAttribute("style") || "";
      const left = Number(/left:\s*([-.\d]+)px/.exec(style)?.[1]);
      const top = Number(/top:\s*([-.\d]+)px/.exec(style)?.[1]);
      const width = Number(/width:\s*([-.\d]+)px/.exec(style)?.[1]) || 120;
      const height = Number(/height:\s*([-.\d]+)px/.exec(style)?.[1]) || 140;
      const rect = node.getBoundingClientRect();
      return {
        id: node.getAttribute("data-person-id"),
        ring: node.getAttribute("data-ring"),
        left,
        top,
        cx: left + width / 2,
        cy: top + height / 2,
        screenX: rect.left + rect.width / 2,
        screenY: rect.top + rect.height / 2,
      };
    }),
  );
}

function samePlaces(before, after, viewport) {
  const byId = new Map(after.map((card) => [card.id, card]));
  for (const card of before) {
    const next = byId.get(card.id);
    if (!next || Math.abs(next.left - card.left) > 1.5 || Math.abs(next.top - card.top) > 1.5) {
      fail(`${viewport.name}: tree layout did not return (${card.id})`);
    }
  }
}

async function tapEmptyGraph(page, viewport) {
  const point = await page.evaluate(() => {
    const stage = document.querySelector(".graph-stage:not(.family-sky)");
    if (!(stage instanceof HTMLElement)) return null;
    const rect = stage.getBoundingClientRect();
    for (let y = rect.top + 12; y < rect.bottom - 12; y += 16) {
      for (let x = rect.left + 12; x < rect.right - 12; x += 16) {
        const hit = document.elementFromPoint(x, y);
        if (!(hit instanceof Element) || !stage.contains(hit)) continue;
        if (hit.closest(".portrait-card, .graph-zoom, .graph-toolbar, .graph-port, .btn, .icon-btn")) continue;
        return { x: x - rect.left, y: y - rect.top };
      }
    }
    return null;
  });
  if (!point) fail(`${viewport.name}: no empty space to leave the personal map`);
  await page.locator(".graph-stage:not(.family-sky)").click({ position: point });
}

async function runPersonalMap(page, viewport, shot) {
  await turnFamiliesOff(page);
  await waitMapSettled(page);
  const before = await graphCards(page);
  if (before.length < 8) fail(`${viewport.name}: expected the fixture tree, saw ${before.length} cards`);
  await page.screenshot({ path: shot("before") });

  const eli = page.locator('.graph-stage:not(.family-sky) .portrait-card[data-person-id="fx-eli"]');
  await eli.click();
  if (await page.getByRole("dialog").count()) fail(`${viewport.name}: first tap opened edit`);
  await page.locator('.graph-stage[data-layout="personal"]').waitFor();

  const samples = [];
  const deadline = Date.now() + 700;
  while (Date.now() < deadline) {
    samples.push(await eli.evaluate((node) => node.style.left));
    await page.waitForTimeout(35);
  }
  if (new Set(samples).size < 2) fail(`${viewport.name}: the selected card did not glide into the personal map`);

  await waitMapSettled(page);
  const cards = await graphCards(page);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const focus = byId.get("fx-eli");
  const partner = byId.get("fx-dee");
  const child = byId.get("fx-fay");
  const parent = byId.get("fx-ada");
  const sibling = byId.get("fx-cora");
  const distant = byId.get("fx-gran");
  if (!focus || !partner || !child || !parent || !sibling || !distant) {
    fail(`${viewport.name}: personal map is missing a fixture relative`);
  }
  if (focus.ring !== "center" || partner.ring !== "center") {
    fail(`${viewport.name}: the selected person and partner should sit in the center`);
  }
  if (Math.abs(focus.top - partner.top) > 2 || Math.abs(Math.abs(focus.cx - partner.cx) - 126) > 3) {
    fail(`${viewport.name}: partner is not beside the selected person as a couple`);
  }
  if (child.ring !== "near" || child.top <= focus.top) fail(`${viewport.name}: child should sit below, nearby`);
  if (parent.ring !== "near" || parent.top >= focus.top) fail(`${viewport.name}: parent should sit above, nearby`);
  if (sibling.ring !== "near" || Math.abs(sibling.top - focus.top) > 2) {
    fail(`${viewport.name}: sibling should sit on the selected person's row`);
  }
  if (distant.ring !== "dim") fail(`${viewport.name}: a distant fixture person should be dimmed`);
  const gathered = Math.hypot(focus.cx - sibling.cx, focus.cy - sibling.cy);
  const far = Math.hypot(focus.cx - distant.cx, focus.cy - distant.cy);
  if (!(gathered < far)) fail(`${viewport.name}: family did not gather closer than the rest of the tree`);
  const lit = cards.filter((card) => card.ring && card.ring !== "dim");
  const mid = (focus.cx + partner.cx) / 2;
  const spanMid = (Math.min(...lit.map((card) => card.left)) + Math.max(...lit.map((card) => card.left + 120))) / 2;
  if (Math.abs(mid - spanMid) > 90) fail(`${viewport.name}: the selected couple is not in the middle of the map`);
  const view = page.viewportSize();
  if (!view) fail(`${viewport.name}: no viewport`);
  const screenMidX = (focus.screenX + partner.screenX) / 2;
  const screenMidY = (focus.screenY + partner.screenY) / 2;
  if (Math.abs(screenMidX - view.width / 2) > view.width * 0.22 || Math.abs(screenMidY - view.height / 2) > view.height * 0.3) {
    fail(`${viewport.name}: personal map is not centered on screen (${Math.round(screenMidX)}, ${Math.round(screenMidY)})`);
  }
  await page.screenshot({ path: shot("focused") });

  await tapEmptyGraph(page, viewport);
  await page.locator('.graph-stage[data-layout="tree"]').waitFor();
  await waitMapSettled(page);
  samePlaces(before, await graphCards(page), viewport);

  await eli.click();
  await page.locator('.graph-stage[data-layout="personal"]').waitFor();
  await waitMapSettled(page);
  await page.getByRole("button", { name: "Recenter" }).click();
  await page.locator('.graph-stage[data-layout="tree"]').waitFor();
  await waitMapSettled(page);
  samePlaces(before, await graphCards(page), viewport);
  await page.screenshot({ path: shot("after") });

  const cora = page.locator('.graph-stage:not(.family-sky) .portrait-card[data-person-id="fx-cora"]');
  await cora.click();
  await page.locator('.graph-stage[data-layout="personal"]').waitFor();
  await waitMapSettled(page);
  await cora.click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  await sheet.getByRole("button", { name: "Close" }).click();
  await sheet.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Recenter" }).click();
  await page.locator('.graph-stage[data-layout="tree"]').waitFor();
  await waitMapSettled(page);
  console.log(`${viewport.name}: personal map gathered, restored, and second tap still edits`);
}

async function skyCards(page) {
  return page.locator(".family-sky .portrait-card").evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = node.getAttribute("style") || "";
      const left = Number(/left:\s*([-.\d]+)px/.exec(style)?.[1]);
      const top = Number(/top:\s*([-.\d]+)px/.exec(style)?.[1]);
      const width = Number(/width:\s*([-.\d]+)px/.exec(style)?.[1]) || 120;
      const height = Number(/height:\s*([-.\d]+)px/.exec(style)?.[1]) || 140;
      const rect = node.getBoundingClientRect();
      return {
        id: node.getAttribute("data-person-id"),
        ring: node.getAttribute("data-ring"),
        left,
        top,
        cx: left + width / 2,
        cy: top + height / 2,
        screenX: rect.left + rect.width / 2,
        screenY: rect.top + rect.height / 2,
      };
    }),
  );
}

async function waitSkySettled(page) {
  await page.waitForFunction(
    () => document.querySelector(".family-sky")?.getAttribute("data-animating") === "false",
    null,
    { timeout: 4000 },
  );
  await page.waitForTimeout(80);
}

async function revealSkyPerson(page, viewport, personId) {
  await showStars(page);
  const star = page.locator(`.sky-star[data-members~="${personId}"]`);
  if ((await star.count()) === 0) fail(`${viewport.name}: no family star contains ${personId}`);
  await star.locator(".sky-star-core").click({ force: true });
  await page.waitForFunction(
    () => document.querySelector(".family-sky")?.getAttribute("data-level") !== "far",
    null,
    { timeout: 8000 },
  );
  await page.waitForTimeout(500);
  const card = page.locator(`.family-sky .portrait-card[data-person-id="${personId}"]`);
  for (let i = 0; i < 8; i += 1) {
    if (await card.count()) return card;
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.waitForTimeout(450);
  }
  fail(`${viewport.name}: could not zoom to ${personId}`);
}

async function tapEmptySky(page, viewport) {
  const point = await page.evaluate(() => {
    const stage = document.querySelector(".family-sky");
    if (!(stage instanceof HTMLElement)) return null;
    const rect = stage.getBoundingClientRect();
    for (let y = rect.top + 12; y < rect.bottom - 12; y += 16) {
      for (let x = rect.left + 12; x < rect.right - 12; x += 16) {
        const hit = document.elementFromPoint(x, y);
        if (!(hit instanceof Element) || !stage.contains(hit)) continue;
        if (hit.closest(".portrait-card, .sky-avatar, .sky-label, .graph-zoom, .graph-toolbar, .graph-port, .couple-tint, .btn, .icon-btn")) continue;
        return { x: x - rect.left, y: y - rect.top };
      }
    }
    return null;
  });
  if (!point) fail(`${viewport.name}: no empty space to leave the family personal map`);
  await page.locator(".family-sky").click({ position: point });
}

async function runFamilyPersonalMap(page, viewport) {
  const shot = (step) => path.join(outDir, `family-sky-personal-${viewport.name}-${step}.png`);
  const eli = await revealSkyPerson(page, viewport, "fx-eli");
  await waitSkySettled(page);
  const before = await skyCards(page);
  if (!before.some((card) => card.id === "fx-eli")) fail(`${viewport.name}: Eli Fixture is not on the sky`);

  await eli.click();
  if (await page.getByRole("dialog").count()) fail(`${viewport.name}: first Families tap opened edit`);
  await page.locator('.family-sky[data-layout="personal"]').waitFor();

  const samples = [];
  const deadline = Date.now() + 700;
  while (Date.now() < deadline) {
    samples.push(await eli.evaluate((node) => `${node.style.left}|${node.style.top}`));
    await page.waitForTimeout(35);
  }
  if (new Set(samples).size < 2) fail(`${viewport.name}: the selected card did not glide into the family personal map`);

  await waitSkySettled(page);
  const cards = await skyCards(page);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const focus = byId.get("fx-eli");
  const partner = byId.get("fx-dee");
  const child = byId.get("fx-fay");
  const parent = byId.get("fx-ada");
  const sibling = byId.get("fx-cora");
  const distant = byId.get("fx-gran");
  if (!focus || !partner || !child || !parent || !sibling || !distant) {
    fail(`${viewport.name}: family personal map is missing a fixture relative`);
  }
  if (focus.ring !== "center" || partner.ring !== "center") {
    fail(`${viewport.name}: the selected person and partner should sit in the center`);
  }
  if (Math.abs(focus.top - partner.top) > 2 || Math.abs(Math.abs(focus.cx - partner.cx) - 126) > 3) {
    fail(`${viewport.name}: partner is not beside the selected person as a couple`);
  }
  if (child.ring !== "near" || child.top <= focus.top) fail(`${viewport.name}: child should sit below, nearby`);
  if (parent.ring !== "near" || parent.top >= focus.top) fail(`${viewport.name}: parent should sit above, nearby`);
  if (sibling.ring !== "near" || Math.abs(sibling.top - focus.top) > 2) {
    fail(`${viewport.name}: sibling should sit on the selected person's row`);
  }
  if (distant.ring !== "dim") fail(`${viewport.name}: a distant fixture person should be dimmed`);
  const gathered = Math.hypot(focus.cx - sibling.cx, focus.cy - sibling.cy);
  const far = Math.hypot(focus.cx - distant.cx, focus.cy - distant.cy);
  if (!(gathered < far)) fail(`${viewport.name}: family did not gather closer than the rest of the sky`);
  const partners = await page.locator(".family-sky line[data-partners]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-partners") || ""),
  );
  if (!partners.some((value) => value.includes("fx-eli") && value.includes("fx-dee"))) {
    fail(`${viewport.name}: the center couple has no bar`);
  }
  const view = page.viewportSize();
  if (!view) fail(`${viewport.name}: no viewport`);
  const screenMidX = (focus.screenX + partner.screenX) / 2;
  const screenMidY = (focus.screenY + partner.screenY) / 2;
  if (Math.abs(screenMidX - view.width / 2) > view.width * 0.22 || Math.abs(screenMidY - view.height / 2) > view.height * 0.3) {
    fail(`${viewport.name}: family personal map is not centered on screen (${Math.round(screenMidX)}, ${Math.round(screenMidY)})`);
  }
  await page.screenshot({ path: shot("focused") });

  await tapEmptySky(page, viewport);
  await page.locator('.family-sky[data-layout="sky"]').waitFor();
  await waitSkySettled(page);
  samePlaces(before, await skyCards(page), viewport);
  await page.screenshot({ path: shot("after") });

  await eli.click();
  await page.locator('.family-sky[data-layout="personal"]').waitFor();
  await waitSkySettled(page);
  await page.getByRole("button", { name: "All families" }).click();
  await page.locator('.family-sky[data-layout="sky"]').waitFor();
  await waitLevel(page, "far");

  const cora = await revealSkyPerson(page, viewport, "fx-cora");
  await cora.click();
  await page.locator('.family-sky[data-layout="personal"]').waitFor();
  await waitSkySettled(page);
  await cora.click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  await sheet.getByRole("button", { name: "Close" }).click();
  await sheet.waitFor({ state: "detached" });
  await showStars(page);
  if ((await page.locator(".family-sky").getAttribute("data-layout")) !== "sky") {
    fail(`${viewport.name}: Families personal map stayed up after All families`);
  }
  console.log(`${viewport.name}: Families personal map gathered, restored, and second tap still edits`);
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

async function assertLinksStayClear(page, viewport) {
  const crossed = await page.evaluate(() => {
    const links = [...document.querySelectorAll(".family-sky .sky-link")];
    const buckets = [...document.querySelectorAll(".family-sky .sky-bucket")];
    const hits = [];
    for (const link of links) {
      if (!(link instanceof SVGPathElement)) continue;
      const from = link.getAttribute("data-from") || "";
      const to = link.getAttribute("data-to") || "";
      const len = link.getTotalLength();
      const steps = 48;
      for (let i = 0; i <= steps; i += 1) {
        const point = link.getPointAtLength((len * i) / steps);
        for (const bucket of buckets) {
          if (!(bucket instanceof SVGPathElement)) continue;
          const members = (bucket.getAttribute("data-members") || "").split(/\s+/).filter(Boolean);
          if (members.includes(from) || members.includes(to)) continue;
          if (bucket.isPointInFill(new DOMPoint(point.x, point.y))) {
            hits.push({ from, to, bucket: bucket.getAttribute("data-unit-id") });
            i = steps;
            break;
          }
        }
      }
    }
    return { links: links.length, buckets: buckets.length, hits };
  });
  if (crossed.links < 1 || crossed.buckets < 2) {
    fail(`${viewport.name}: expected links and family backgrounds, saw ${crossed.links} links and ${crossed.buckets} buckets`);
  }
  if (crossed.hits.length) {
    fail(`${viewport.name}: a link crosses an unrelated family (${JSON.stringify(crossed.hits)})`);
  }
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
    await runPersonalMap(page, viewport, (step) => path.join(outDir, `personal-map-${viewport.name}-${step}.png`));
    await turnFamiliesOn(page, viewport);
    await runFamilyPersonalMap(page, viewport);

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
    await assertLinksStayClear(page, viewport);
    await page.screenshot({ path: shot("links") });
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
    console.log(`${viewport.name}: links, buckets, stars, step family, row move, and reload passed`);
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
