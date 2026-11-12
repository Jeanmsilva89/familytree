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
    const portraits = await page.locator(".orbit-stage .portrait-card").evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.getAttribute("data-person-id"),
        portrait: node.getAttribute("data-portrait"),
        photo: Boolean(node.querySelector("img.portrait-photo")),
        avatar: Boolean(node.querySelector(".generated-avatar")),
      })),
    );
    for (const card of portraits) {
      if (card.portrait === "photo") {
        if (!card.photo || card.avatar) fail(`${label}: ${card.id} photo portrait is wrong`);
      } else if (card.portrait !== "generated" || !card.avatar || card.photo) {
        fail(`${label}: ${card.id} has no generated avatar`);
      }
    }
    if (!portraits.some((card) => card.id === "fx-dee" && card.portrait === "photo")) {
      fail(`${label}: Dee's fixture photo is not on her card`);
    }
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
      await runOrbitPermission(page, size);
    }
  } catch (error) {
    if (!failures.some((item) => item.startsWith(label))) fail(`${label}: ${error.message}`);
    await page.screenshot({ path: path.join(outDir, `orbit-${label}-error.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function readTree(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("familytree");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db.transaction("tree", "readonly").objectStore("tree").get("living");
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
      }),
  );
}

async function bringOrbitPerson(page, id, viewport) {
  const chrome = await page.locator(".graph-toolbar").evaluate((el) => el.getBoundingClientRect().bottom).catch(() => 160);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const box = await cardBox(page, id);
    if (!box) return null;
    const inside = box.x > 28 && box.x < viewport.width - 28 && box.y > chrome + 24 && box.y < viewport.height - 28;
    if (inside) return box;
    const empty = await page.evaluate(() => {
      const stage = document.querySelector(".orbit-stage");
      const rect = stage.getBoundingClientRect();
      const spots = [
        [rect.left + 14, rect.bottom - 16],
        [rect.right - 16, rect.top + 150],
        [rect.left + 14, rect.top + 150],
      ];
      for (const [x, y] of spots) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !hit.closest(".portrait-card, button, a, .sheet")) return { x, y };
      }
      return null;
    });
    if (!empty) return box;
    const dx = Math.max(-900, Math.min(900, viewport.width / 2 - box.x));
    const dy = Math.max(-700, Math.min(700, Math.max(chrome + 80, viewport.height / 2) - box.y));
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x + dx, empty.y + dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(60);
  }
  const last = await cardBox(page, id);
  if (!last || last.x < 8 || last.x > viewport.width - 8 || last.y < 80 || last.y > viewport.height - 8) return null;
  return last;
}

async function tapOrbit(page, id, viewport) {
  const box = await bringOrbitPerson(page, id, viewport);
  if (!box) {
    fail(`${viewport.name}: ${id} is not on the orbit stage`);
    return;
  }
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest?.("[data-person-id]")?.getAttribute("data-person-id") ?? el?.getAttribute?.("aria-label") ?? el?.textContent?.trim()?.slice(0, 40) ?? "nothing";
  }, box);
  if (hit !== id) {
    fail(`${viewport.name}: a tap meant for ${id} hit ${hit}`);
    return;
  }
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(180);
}

async function orbitIds(page) {
  return page.locator(".orbit-stage [data-person-id]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-person-id")).sort(),
  );
}

async function runOrbitPermission(page, size) {
  const label = size.name;
  const lens = page.getByRole("button", { name: "Lens", exact: true });
  await lens.scrollIntoViewIfNeeded();
  if ((await lens.getAttribute("aria-pressed")) !== "true") await lens.click();
  await page.getByRole("button", { name: "Look as Eli Fixture", exact: true }).click();
  const orbit = page.getByRole("button", { name: "Orbit", exact: true });
  if ((await orbit.getAttribute("aria-pressed")) !== "true") await orbit.click();
  await page.locator('.orbit-stage[data-ready="true"]').waitFor({ timeout: 15000 });
  await page.locator('.orbit-stage[data-layout="rows"]').waitFor();

  await tapOrbit(page, "fx-eli", size);
  await tapOrbit(page, "fx-ada", size);
  await tapOrbit(page, "fx-fay", size);
  await tapOrbit(page, "fx-fay", size);
  await tapOrbit(page, "fx-rex", size);
  await tapOrbit(page, "fx-rex", size);
  await tapOrbit(page, "fx-rex", size);
  await page.locator('.orbit-stage [data-person-id="fx-rex"][data-lens="hide"]').waitFor({ timeout: 4000 });
  if ((await page.locator(".orbit-stage").getAttribute("data-layout")) !== "rows") {
    fail(`${label}: arranging the lens gathered Orbit`);
  }

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForTimeout(250);
  const previewIds = await orbitIds(page);
  if (JSON.stringify(previewIds) !== JSON.stringify(["fx-ada", "fx-eli", "fx-fay"])) {
    fail(`${label}: Eli's orbit preview showed ${previewIds.join(" ")}`);
  }
  const linked = (await page.locator(".orbit-stage").getAttribute("data-linked")) ?? "";
  if (linked.includes("fx-rex") || linked.includes("fx-dee")) {
    fail(`${label}: a hidden person is a line endpoint (${linked})`);
  }
  const fay = page.locator('.orbit-stage [data-person-id="fx-fay"]');
  const adaCard = page.locator('.orbit-stage [data-person-id="fx-ada"]');
  const eliCard = page.locator('.orbit-stage [data-person-id="fx-eli"]');
  if (!(await fay.getAttribute("class"))?.includes("is-lens-dim")) fail(`${label}: dimmed Fay is not reduced`);
  if ((await fay.getAttribute("data-details")) !== "withheld") fail(`${label}: Fay's details were open`);
  if (await fay.locator("img.portrait-photo").count()) fail(`${label}: Fay's photo leaked`);
  if (await fay.locator(".identity em").count()) fail(`${label}: Fay's date leaked`);
  if (!(await fay.locator(".generated-avatar").count())) fail(`${label}: Fay has no generated avatar`);
  if ((await adaCard.getAttribute("data-details")) !== "withheld") fail(`${label}: Ada's details were open`);
  if (await adaCard.locator(".identity em").count()) fail(`${label}: withheld Ada showed a date`);
  if (!(await adaCard.locator(".generated-avatar").count())) fail(`${label}: Ada has no generated avatar`);
  if ((await eliCard.getAttribute("data-portrait")) !== "generated") fail(`${label}: Eli has no generated avatar`);
  if ((await eliCard.locator(".identity strong").innerText()).trim() !== "Eli") fail(`${label}: Eli's name was hidden`);

  const before = await bringOrbitPerson(page, "fx-eli", size);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.waitForFunction(
    () => {
      const stage = document.querySelector(".orbit-stage");
      return stage?.dataset.layout === "orbit" && stage?.dataset.lines === "shown" && stage?.dataset.motion === "idle";
    },
    null,
    { timeout: 8000 },
  );
  await page.mouse.up();
  const gathered = await orbitIds(page);
  if (JSON.stringify(gathered) !== JSON.stringify(["fx-ada", "fx-eli", "fx-fay"])) {
    fail(`${label}: gathering Eli revealed ${gathered.join(" ")}`);
  }
  const center = await cardBox(page, "fx-eli");
  const adaNow = await cardBox(page, "fx-ada");
  const fayNow = await cardBox(page, "fx-fay");
  const partners = await page.locator('.orbit-stage [data-ring="partner"]').count();
  if (!center || center.ring !== "center") fail(`${label}: Eli is not the center`);
  if (partners !== 0) fail(`${label}: a hidden partner kept a seat`);
  if (!adaNow || adaNow.ring !== "near" || !(adaNow.y < center.y - 8)) fail(`${label}: Ada is not above Eli`);
  if (!fayNow || fayNow.ring !== "outer" || !(fayNow.opacity < 0.5)) fail(`${label}: dimmed Fay is not on the outer ring`);
  const gatheredLinks = (await page.locator(".orbit-stage").getAttribute("data-linked")) ?? "";
  if (gatheredLinks.includes("fx-dee") || gatheredLinks.includes("fx-rex")) {
    fail(`${label}: gather drew a line to a hidden person`);
  }
  const stageBox = await page.locator(".orbit-stage").boundingBox();
  if (stageBox) {
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + Math.min(stageBox.height / 2, stageBox.height - 40));
    for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, 280);
    await page.waitForTimeout(180);
  }
  await page.screenshot({ path: path.join(outDir, `orbit-${size.name}-preview.png`) });

  const empty = await page.evaluate(() => {
    const stage = document.querySelector(".orbit-stage");
    const rect = stage.getBoundingClientRect();
    const spots = [
      [rect.left + 10, rect.bottom - 10],
      [rect.right - 16, rect.top + 12],
    ];
    for (const [x, y] of spots) {
      const hit = document.elementFromPoint(x, y);
      if (hit && !hit.closest(".portrait-card, button, a, .sheet")) return { x, y };
    }
    return null;
  });
  if (!empty) fail(`${label}: no empty space to leave the preview gather`);
  else {
    await page.mouse.click(empty.x, empty.y);
    await page.waitForFunction(
      () => document.querySelector(".orbit-stage")?.dataset.layout === "rows",
      null,
      { timeout: 8000 },
    );
  }

  const quinn = page.getByRole("button", { name: "Look as Quinn Fixture, pending", exact: true });
  await quinn.scrollIntoViewIfNeeded();
  await quinn.click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForTimeout(250);
  if ((await orbitIds(page)).length) fail(`${label}: a pending invite still drew people in Orbit`);

  const lensBtn = page.getByRole("button", { name: "Lens", exact: true });
  await lensBtn.scrollIntoViewIfNeeded();
  if ((await lensBtn.getAttribute("aria-pressed")) !== "true") await lensBtn.click();
  await page.getByRole("button", { name: "You", exact: true }).click();
  if ((await page.getByRole("button", { name: "Orbit", exact: true }).getAttribute("aria-pressed")) === "true") {
    await page.getByRole("button", { name: "Orbit", exact: true }).click();
  }
  await page.locator(".family-sky").waitFor();
  const invite = page.getByRole("button", { name: "Invite card", exact: true });
  await invite.scrollIntoViewIfNeeded();
  await invite.click();
  await page.getByLabel("Guest name").fill("Lane Fixture");
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  await page.getByRole("button", { name: "Look as Lane Fixture, pending", exact: true }).waitFor();

  await page.getByRole("button", { name: "All families" }).click();
  await page.locator('.family-sky[data-level="far"]').waitFor();
  await page.locator('.sky-star[data-members~="fx-eli"] .sky-star-core').click({ force: true });
  await page.waitForFunction(() => document.querySelector(".family-sky")?.getAttribute("data-level") !== "far");
  const skyEli = page.locator('.family-sky .portrait-card[data-person-id="fx-eli"]');
  for (let i = 0; i < 8 && (await skyEli.count()) === 0; i += 1) {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.waitForTimeout(400);
  }
  await skyEli.waitFor({ timeout: 8000 });
  const skyBox = await skyEli.boundingBox();
  if (!skyBox) fail(`${label}: Eli is not on the sky`);
  else {
    await page.mouse.move(skyBox.x + skyBox.width / 2, skyBox.y + 28);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    const menu = page.getByRole("menu");
    await menu.waitFor({ timeout: 3000 });
    await page.locator('[role="menu"][data-ready="true"]').waitFor({ timeout: 2000 });
    await menu.getByRole("menuitem", { name: "Branch owner" }).click();
    await menu.getByRole("menuitemradio", { name: "Give this branch to Lane Fixture" }).click();
    await menu.waitFor({ state: "detached" });
  }
  const lane = page.getByRole("button", { name: "Look as Lane Fixture, pending", exact: true });
  await lane.scrollIntoViewIfNeeded();
  await lane.click();
  if ((await page.getByRole("button", { name: "Orbit", exact: true }).getAttribute("aria-pressed")) !== "true") {
    await page.getByRole("button", { name: "Orbit", exact: true }).click();
  }
  await page.locator('.orbit-stage[data-ready="true"]').waitFor({ timeout: 15000 });
  for (const id of ["fx-eli", "fx-dee", "fx-fay", "fx-ada", "fx-ben"]) await tapOrbit(page, id, size);
  const accept = page.getByRole("button", { name: "Accept invite for Lane Fixture", exact: true });
  await accept.scrollIntoViewIfNeeded();
  await accept.click();
  await page.waitForTimeout(300);
  const laneIds = await orbitIds(page);
  const expected = ["fx-ada", "fx-ben", "fx-dee", "fx-eli", "fx-fay"];
  if (JSON.stringify(laneIds) !== JSON.stringify(expected)) {
    fail(`${label}: Lane's orbit showed ${laneIds.join(" ")}`);
  }
  for (const id of ["fx-eli", "fx-dee", "fx-fay"]) {
    const card = page.locator(`.orbit-stage [data-person-id="${id}"]`);
    if ((await card.getAttribute("data-branch-owner")) !== "Lane") fail(`${label}: ${id} did not wear Lane's mark`);
    if ((await card.getAttribute("data-edit")) !== "open") fail(`${label}: ${id} was not editable`);
  }
  for (const id of ["fx-ada", "fx-ben"]) {
    const card = page.locator(`.orbit-stage [data-person-id="${id}"]`);
    if (await card.getAttribute("data-branch-owner")) fail(`${label}: ${id} wore an owner mark`);
    if ((await card.getAttribute("data-edit")) !== "locked") fail(`${label}: ${id} was editable outside the branch`);
  }

  const deeBox = await bringOrbitPerson(page, "fx-dee", size);
  await page.mouse.move(deeBox.x, deeBox.y);
  await page.mouse.down();
  await page.mouse.move(deeBox.x + 72, deeBox.y, { steps: 8 });
  await page.mouse.up();
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
    const dee = tree.people.find((person) => person.id === "fx-dee");
    return typeof dee?.graphX === "number";
  }, null, { timeout: 4000 });

  const adaBefore = (await readTree(page)).people.find((person) => person.id === "fx-ada")?.graphX;
  const adaBox = await bringOrbitPerson(page, "fx-ada", size);
  await page.mouse.move(adaBox.x, adaBox.y);
  await page.mouse.down();
  await page.mouse.move(adaBox.x + 72, adaBox.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const adaAfter = (await readTree(page)).people.find((person) => person.id === "fx-ada")?.graphX;
  if (adaAfter !== adaBefore) fail(`${label}: dragging Ada outside the branch saved a place`);

  await tapOrbit(page, "fx-ada", size);
  await tapOrbit(page, "fx-ada", size);
  if (await page.locator(".sheet").count()) fail(`${label}: Ada's editor opened for Lane`);
  await tapOrbit(page, "fx-dee", size);
  await tapOrbit(page, "fx-dee", size);
  await page.locator(".sheet").waitFor({ timeout: 4000 });
  if (!(await page.locator(".sheet").getByRole("button", { name: "Save name" }).count())) {
    fail(`${label}: Dee's editor did not open`);
  }
  await page.locator(".sheet-close").click();
  await page.locator(".sheet").waitFor({ state: "hidden" });
  await page.screenshot({ path: path.join(outDir, `orbit-${size.name}-branch.png`) });
  console.log(`${label}: orbit preview hid people, and Lane edited only Eli's branch`);
}

async function runSharedReadonly(browser, size) {
  const label = size.name;
  const host = JSON.parse(await readFile(path.join(here, "fixtures", "verify-share-host.json"), "utf8"));
  const bundle = {
    format: "familytree-share",
    version: 1,
    source: {
      treeId: "fixture-source",
      ownerPersonId: "fx-ada",
      ownerName: "Ada Fixture",
      exportedAt: "2024-01-01T00:00:00.000Z",
    },
    people: [
      {
        id: "fx-nia-share",
        givenName: "Nia",
        familyName: "Fixture",
        presence: "shown",
        details: "withheld",
      },
    ],
    unions: [],
    childLinks: [],
  };
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    hasTouch: size.name === "phone",
    isMobile: size.name === "phone",
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  await context.addInitScript(() => window.localStorage.setItem("familytree-theme", "dark"));
  const page = await context.newPage();
  try {
    await settle(page);
    await page.getByLabel("Import backup JSON").setInputFiles({
      name: "verify-share-host.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(host)),
    });
    await page.getByText("Looking at Host").waitFor();
    const familyClose = page.locator(".family-overlay").getByRole("button", { name: "Close", exact: true });
    if (await familyClose.count()) await familyClose.click();
    await page.getByRole("button", { name: "Open menu" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Add a shared family" }).click();
    await (await chooser).setFiles({
      name: "nia-fixture-share.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bundle)),
    });
    const preview = page.locator('[data-share-preview="true"]');
    await preview.waitFor();
    await preview.getByRole("button", { name: "Add to my tree" }).click();
    await preview.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Orbit", exact: true }).click();
    await page.locator('.orbit-stage[data-ready="true"]').waitFor({ timeout: 15000 });
    const nia = page.locator('.orbit-stage [data-name="Nia Fixture"]');
    await nia.waitFor();
    if ((await nia.getAttribute("data-shared")) !== "true") fail(`shared ${label}: Nia is not marked shared`);
    if ((await nia.getAttribute("data-edit")) !== "locked") fail(`shared ${label}: a shared person can be edited from Orbit`);
    if ((await nia.getAttribute("data-portrait")) !== "generated") fail(`shared ${label}: shared Nia has no generated avatar`);
    if (await nia.locator("img.portrait-photo").count()) fail(`shared ${label}: withheld Nia showed a photo`);
    const niaId = await nia.getAttribute("data-person-id");
    const openAt = await bringOrbitPerson(page, niaId, size);
    await page.mouse.click(openAt.x, openAt.y);
    await page.waitForTimeout(180);
    const openAgain = await bringOrbitPerson(page, niaId, size);
    await page.mouse.click(openAgain.x, openAgain.y);
    const sheet = page.locator(".sheet");
    await sheet.waitFor({ timeout: 4000 });
    if ((await sheet.getAttribute("data-shared-readonly")) !== "true") fail(`shared ${label}: the shared sheet can be edited`);
    await sheet.getByText("Shared by Ada Fixture. Read only.").waitFor();
    if (await sheet.getByRole("button", { name: "Save name" }).count()) fail(`shared ${label}: a shared person can be renamed from Orbit`);
    await page.locator(".sheet-close").click();
    await sheet.waitFor({ state: "hidden" });
    const box = await bringOrbitPerson(page, niaId, size);
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + 70, box.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const stored = (await readTree(page)).people.find((person) => person.id === niaId);
    if (typeof stored?.graphX === "number") fail(`shared ${label}: dragging shared Nia saved a place`);
    console.log(`${label}: imported Nia Fixture stayed read only in Orbit`);
  } catch (error) {
    fail(`shared ${label}: ${error.message}`);
    await page.screenshot({ path: path.join(outDir, `orbit-${label}-shared-error.png`) }).catch(() => {});
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
    await runSharedReadonly(browser, size);
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
