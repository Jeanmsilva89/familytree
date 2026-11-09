/**
 * Drive Family Tree the way a person would and confirm the Families lens.
 *
 * Loads the labeled fixture in scripts/fixtures/verify-family-sky.json (never
 * real relatives), opens Visualize, turns on Families, checks buckets, zooms
 * out to the star view, taps a star, and moves fixture people between family
 * units. Also checks a step-parent bucket: Wynn Fixture, whose only parent
 * is Stu as step, sits in their own bucket with a step link. Also checks a partnerless move, that a
 * person-to-person link does not cross an unrelated family's background, and
 * that a reload draws the same stars. In Families Edit mode, close up, a
 * horizontal drag along a row nudges that person and the nudge is still
 * there after a reload. Gather family, not a tap, enters a personal map.
 * In Families Edit mode, close up, tapping Ada Fixture's
 * link to Eli Fixture removes that parent link, and tapping Nia Fixture's
 * couple bar asks before unlinking her from Pal Fixture. Then the visibility
 * lens: arrange what Eli Fixture can see, preview it, and move Quinn Fixture's
 * invite from pending to accepted to revoked. Then, still on the fixture,
 * divorce Dee Fixture and Eli Fixture from Dee's editor and marry Dee to
 * Rema Fixture. The sky shows a quiet divorced line and a remarried bar.
 * Remarried is not stored. Runs at desktop 1280x800 and phone 390x844.
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
      fail(`${viewport.name}: tree layout did not return (${card.id} left ${card.left} -> ${next?.left} top ${card.top} -> ${next?.top})`);
    }
  }
}

function sharedPlaces(before, after, viewport, requiredIds) {
  const byId = new Map(after.map((card) => [card.id, card]));
  for (const id of requiredIds) {
    if (!byId.has(id)) fail(`${viewport.name}: ${id} left the layout`);
  }
  for (const card of before) {
    const next = byId.get(card.id);
    if (!next) continue;
    if (Math.abs(next.left - card.left) > 1.5 || Math.abs(next.top - card.top) > 1.5) {
      fail(`${viewport.name}: layout moved (${card.id} left ${card.left} -> ${next.left} top ${card.top} -> ${next.top})`);
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

async function cardPoint(locator) {
  const box = await locator.boundingBox();
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + Math.min(36, box.height / 2) };
}

async function holdCard(page, locator, viewport) {
  await panCardIntoView(page, locator);
  const point = await cardPoint(locator);
  if (!point) fail(`${viewport.name}: no card to hold`);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(680);
  await page.mouse.up();
  const menu = page.getByRole("menu");
  await menu.waitFor({ timeout: 2000 });
  await page.locator('[role="menu"][data-ready="true"]').waitFor({ timeout: 2000 });
  return menu;
}

async function dragCard(page, locator, viewport) {
  await panCardIntoView(page, locator);
  const point = await cardPoint(locator);
  if (!point) fail(`${viewport.name}: no card to drag`);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 36, point.y, { steps: 8 });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(80);
  if (viewport.name !== "phone") return;
  await page.evaluate((point) => {
    const target = document.elementFromPoint(point.x, point.y);
    if (!(target instanceof Element)) return;
    const eventAt = (type, x) => {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: "touch",
        isPrimary: true,
        clientX: x,
        clientY: point.y,
      }));
    };
    eventAt("pointerdown", point.x);
    eventAt("pointermove", point.x + 42);
    eventAt("pointerup", point.x + 42);
  }, point);
  await page.waitForTimeout(680);
}

async function assertNoMenu(page, viewport, why) {
  if (await page.getByRole("menu").count()) fail(`${viewport.name}: ${why}`);
}

async function panCardIntoView(page, locator) {
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
    await page.waitForTimeout(60);
  }
}

async function runPersonalMap(page, viewport, shot) {
  await turnFamiliesOff(page);
  await waitMapSettled(page);
  const before = await graphCards(page);
  if (before.length < 8) fail(`${viewport.name}: expected the fixture tree, saw ${before.length} cards`);
  await page.screenshot({ path: shot("before") });

  const eli = page.locator('.graph-stage:not(.family-sky) .portrait-card[data-person-id="fx-eli"]');
  await panCardIntoView(page, eli);
  await eli.click();
  if (await page.getByRole("dialog").count()) fail(`${viewport.name}: first tap opened edit`);
  await page.waitForTimeout(250);
  if ((await page.locator('.graph-stage:not(.family-sky)').getAttribute("data-layout")) !== "tree") {
    fail(`${viewport.name}: a tap rearranged the tree`);
  }
  samePlaces(before, await graphCards(page), viewport);
  await assertNoMenu(page, viewport, "a tap opened the hold menu");

  await eli.focus();
  await page.keyboard.press("Shift+F10");
  const keyed = page.getByRole("menu");
  await keyed.waitFor({ timeout: 2000 });
  await page.locator('[role="menu"][data-ready="true"]').waitFor({ timeout: 2000 });
  samePlaces(before, await graphCards(page), viewport);
  await page.keyboard.press("Escape");
  await keyed.waitFor({ state: "detached" });
  samePlaces(before, await graphCards(page), viewport);

  await dragCard(page, eli, viewport);
  await assertNoMenu(page, viewport, "a drag opened the hold menu");
  if ((await page.locator('.graph-stage:not(.family-sky)').getAttribute("data-layout")) !== "tree") {
    fail(`${viewport.name}: a drag gathered the tree`);
  }
  samePlaces(before, await graphCards(page), viewport);

  const menu = await holdCard(page, eli, viewport);
  samePlaces(before, await graphCards(page), viewport);
  await page.screenshot({ path: shot("menu") });
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  samePlaces(before, await graphCards(page), viewport);

  const gathering = await holdCard(page, eli, viewport);
  await gathering.getByRole("menuitem", { name: "Gather family" }).click();
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

  const again = await holdCard(page, eli, viewport);
  await again.getByRole("menuitem", { name: "Gather family" }).click();
  await page.locator('.graph-stage[data-layout="personal"]').waitFor();
  await waitMapSettled(page);
  await page.getByRole("button", { name: "Recenter" }).click();
  await page.locator('.graph-stage[data-layout="tree"]').waitFor();
  await waitMapSettled(page);
  samePlaces(before, await graphCards(page), viewport);
  await page.screenshot({ path: shot("after") });

  const cora = page.locator('.graph-stage:not(.family-sky) .portrait-card[data-person-id="fx-cora"]');
  await panCardIntoView(page, cora);
  await cora.click();
  await page.waitForTimeout(200);
  if ((await page.locator('.graph-stage:not(.family-sky)').getAttribute("data-layout")) !== "tree") {
    fail(`${viewport.name}: a tap on a second person rearranged the tree`);
  }
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
  await page.waitForTimeout(250);
  if ((await page.locator(".family-sky").getAttribute("data-layout")) !== "sky") {
    fail(`${viewport.name}: a tap rearranged the family sky`);
  }
  samePlaces(before, await skyCards(page), viewport);
  await assertNoMenu(page, viewport, "a Families tap opened the hold menu");

  await eli.focus();
  await page.keyboard.press("Shift+F10");
  const keyed = page.getByRole("menu");
  await keyed.waitFor({ timeout: 2000 });
  await page.locator('[role="menu"][data-ready="true"]').waitFor({ timeout: 2000 });
  samePlaces(before, await skyCards(page), viewport);
  await page.keyboard.press("Escape");
  await keyed.waitFor({ state: "detached" });
  samePlaces(before, await skyCards(page), viewport);

  await dragCard(page, eli, viewport);
  await assertNoMenu(page, viewport, "a Families drag opened the hold menu");
  if ((await page.locator(".family-sky").getAttribute("data-layout")) !== "sky") {
    fail(`${viewport.name}: a drag gathered the family sky`);
  }
  sharedPlaces(before, await skyCards(page), viewport, ["fx-eli", "fx-dee"]);
  const resting = await skyCards(page);

  const menu = await holdCard(page, eli, viewport);
  samePlaces(resting, await skyCards(page), viewport);
  await page.screenshot({ path: shot("menu") });
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  samePlaces(resting, await skyCards(page), viewport);

  const gathering = await holdCard(page, eli, viewport);
  await gathering.getByRole("menuitem", { name: "Gather family" }).click();
  await page.locator('.family-sky[data-layout="personal"]').waitFor();

  const samples = [];
  const deadline = Date.now() + 700;
  while (Date.now() < deadline) {
    // Card transform only. left/top stay on the destination seat, and the camera
    // moves the whole world, so neither of those is the glide.
    samples.push(
      await eli.evaluate((node) => {
        const value = getComputedStyle(node).transform;
        if (!value || value === "none") return "0,0";
        const match = /matrix\(([^)]+)\)/.exec(value);
        if (!match) return value;
        const parts = match[1].split(",").map((part) => Number(part.trim()));
        return `${Math.round(parts[4] || 0)},${Math.round(parts[5] || 0)}`;
      }),
    );
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
  samePlaces(resting, await skyCards(page), viewport);
  await page.screenshot({ path: shot("after") });

  const again = await holdCard(page, eli, viewport);
  await again.getByRole("menuitem", { name: "Gather family" }).click();
  await page.locator('.family-sky[data-layout="personal"]').waitFor();
  await waitSkySettled(page);
  await page.getByRole("button", { name: "All families" }).click();
  await page.locator('.family-sky[data-layout="sky"]').waitFor();
  await waitLevel(page, "far");

  const cora = await revealSkyPerson(page, viewport, "fx-cora");
  await cora.click();
  await page.waitForTimeout(200);
  if ((await page.locator(".family-sky").getAttribute("data-layout")) !== "sky") {
    fail(`${viewport.name}: a tap on a second person rearranged the family sky`);
  }
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

async function assertStepOnlyChild(page, viewport) {
  await revealSkyPerson(page, viewport, "fx-wynn");
  const members = await page.locator('.sky-bucket[data-members~="fx-wynn"]').getAttribute("data-members");
  const ids = (members || "").split(/\s+/).filter(Boolean);
  if (ids.length !== 1 || ids[0] !== "fx-wynn") {
    fail(`${viewport.name}: Wynn Fixture should sit alone, saw ${members}`);
  }
  const stuBucket = await page.locator('.sky-bucket[data-members~="fx-stu"]').getAttribute("data-members");
  if ((stuBucket || "").split(/\s+/).includes("fx-wynn")) {
    fail(`${viewport.name}: Wynn Fixture landed in Stu Fixture's family (${stuBucket})`);
  }
  const link = page.locator('.sky-link.is-step[data-from="fx-stu"][data-to="fx-wynn"]');
  if ((await link.count()) !== 1) fail(`${viewport.name}: expected a step link from Stu Fixture to Wynn Fixture`);
  for (let i = 0; i < 6; i += 1) {
    const both = await page.evaluate(() => {
      const see = (id) => {
        const el = document.querySelector(`.portrait-card[data-person-id="${id}"], .sky-avatar[data-person-id="${id}"]`);
        if (!(el instanceof HTMLElement)) return false;
        const rect = el.getBoundingClientRect();
        return rect.right > 8 && rect.bottom > 8 && rect.left < window.innerWidth - 8 && rect.top < window.innerHeight - 8;
      };
      return see("fx-wynn") && see("fx-stu");
    });
    if (both || (await level(page)) !== "near") break;
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await page.waitForTimeout(400);
  }
  if ((await level(page)) === "far") {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: path.join(outDir, `family-sky-${viewport.name}-step.png`) });
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

async function linkScreenPoint(page, selector, { mustHit = false } = {}) {
  return page.evaluate(({ sel, mustHit: hitOnly }) => {
    const el = document.querySelector(sel);
    const stage = document.querySelector(".family-sky");
    if (!(el instanceof Element) || !(stage instanceof HTMLElement)) return null;
    if (el instanceof HTMLElement) {
      const box = el.getBoundingClientRect();
      const rect = stage.getBoundingClientRect();
      const bar = document.querySelector(".graph-toolbar")?.getBoundingClientRect();
      const topLimit = Math.max(rect.top + 16, bar ? bar.bottom + 12 : rect.top + 16);
      const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      if (point.x < rect.left + 8 || point.x > rect.right - 8 || point.y < topLimit || point.y > rect.bottom - 8) return null;
      const top = document.elementFromPoint(point.x, point.y);
      if (!(top instanceof Element) || !stage.contains(top)) return null;
      if (hitOnly && top !== el && !el.contains(top)) return null;
      return point;
    }
    if (!(el instanceof SVGGeometryElement)) return null;
    const len = el.getTotalLength();
    const svg = el.ownerSVGElement;
    if (!svg || len < 1 || !svg.width.baseVal.value || !svg.height.baseVal.value) return null;
    const rect = stage.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const bar = document.querySelector(".graph-toolbar")?.getBoundingClientRect();
    const topLimit = Math.max(rect.top + 16, bar ? bar.bottom + 12 : rect.top + 16);
    const at = (t) => {
      const local = el.getPointAtLength(len * t);
      return {
        x: svgRect.left + (local.x / svg.width.baseVal.value) * svgRect.width,
        y: svgRect.top + (local.y / svg.height.baseVal.value) * svgRect.height,
      };
    };
    const usable = (point) => {
      if (point.x < rect.left + 16 || point.x > rect.right - 16 || point.y < topLimit || point.y > rect.bottom - 16) {
        return false;
      }
      const top = document.elementFromPoint(point.x, point.y);
      if (!(top instanceof Element) || !stage.contains(top)) return false;
      if (top.closest(".graph-toolbar, .graph-zoom, .graph-port, .sky-label, .btn")) return false;
      if (hitOnly) return top === el || top.closest(".graph-hit") === el;
      return !top.closest(".portrait-card, .sky-avatar");
    };
    const samples = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.15, 0.85];
    for (const t of samples) {
      const point = at(t);
      if (usable(point)) return { x: point.x, y: point.y };
    }
    for (let i = 0; i <= 32; i += 1) {
      const point = at(i / 32);
      if (usable(point)) return { x: point.x, y: point.y };
    }
    return null;
  }, { sel: selector, mustHit });
}

/** Zoom until `selector` is on screen and the sky is close enough to edit. */
async function zoomNearOn(page, viewport, selector) {
  await showStars(page);
  for (let i = 0; i < 8 && (await level(page)) === "far"; i += 1) {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.waitForTimeout(200);
  }
  if ((await level(page)) === "far") fail(`${viewport.name}: still in the star view`);
  await page.locator(selector).first().waitFor({ timeout: 8000 });
  for (let i = 0; i < 12 && (await level(page)) !== "near"; i += 1) {
    const point = await linkScreenPoint(page, selector);
    if (!point) {
      const stage = page.locator(".family-sky");
      const box = await stage.boundingBox();
      if (box) {
        const x = box.x + box.width / 2;
        const y = box.y + Math.min(box.height - 40, 180);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + 90);
        await page.mouse.up();
      }
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.waitForTimeout(200);
      continue;
    }
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, -160);
    await page.waitForTimeout(80);
  }
  await waitLevel(page, "near");
  await waitSkySettled(page);
  const point = await linkScreenPoint(page, selector);
  if (!point) fail(`${viewport.name}: ${selector} is not on screen at close zoom`);
  return point;
}

/** Pan the sky until a relationship mark is under the pointer. */
async function bringMarkOnScreen(page, selector) {
  for (let i = 0; i < 6; i += 1) {
    const point = await linkScreenPoint(page, selector, { mustHit: true });
    if (point) return point;
    const delta = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const stage = document.querySelector(".family-sky");
      if (!(el instanceof Element) || !(stage instanceof HTMLElement)) return null;
      const box = el.getBoundingClientRect();
      const rect = stage.getBoundingClientRect();
      return {
        dx: rect.left + rect.width / 2 - (box.left + box.width / 2),
        dy: rect.top + rect.height / 2 - (box.top + box.height / 2),
      };
    }, selector);
    const start = await page.evaluate(() => {
      const stage = document.querySelector(".family-sky");
      if (!(stage instanceof HTMLElement)) return null;
      const rect = stage.getBoundingClientRect();
      for (let y = rect.top + 90; y < rect.bottom - 30; y += 28) {
        for (let x = rect.left + 24; x < rect.right - 30; x += 28) {
          const hit = document.elementFromPoint(x, y);
          if (!(hit instanceof Element) || !stage.contains(hit)) continue;
          if (hit.closest(".portrait-card, .graph-port, .graph-hit, .sky-label, .btn, .graph-zoom, .sky-avatar")) continue;
          return { x, y };
        }
      }
      return null;
    });
    if (!delta || !start) return null;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + Math.max(-280, Math.min(280, delta.dx)), start.y + Math.max(-280, Math.min(280, delta.dy)));
    await page.mouse.up();
    await page.waitForTimeout(180);
  }
  return linkScreenPoint(page, selector, { mustHit: true });
}

async function openFamilyNear(page, viewport, label) {
  await showStars(page);
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await page.waitForFunction(
    () => document.querySelector(".family-sky")?.getAttribute("data-level") !== "far",
    null,
    { timeout: 8000 },
  );
  await page.waitForTimeout(400);
  for (let i = 0; i < 8 && (await level(page)) !== "near"; i += 1) {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.waitForTimeout(180);
  }
  await waitLevel(page, "near");
  await waitSkySettled(page);
  if ((await level(page)) !== "near") fail(`${viewport.name}: ${label} did not open close up`);
}

/** Accept or dismiss the confirm while the tap is still in flight, so the page can continue. */
async function clickConfirm(page, point, accept) {
  let message = "";
  const dialogDone = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no confirm")), 5000);
    page.once("dialog", (dialog) => {
      clearTimeout(timer);
      message = dialog.message();
      (accept ? dialog.accept() : dialog.dismiss()).then(resolve, reject);
    });
  });
  await Promise.all([dialogDone, page.mouse.click(point.x, point.y)]);
  return message;
}

async function enterEdit(page, viewport) {
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await edit.scrollIntoViewIfNeeded();
  if ((await edit.getAttribute("aria-pressed")) !== "true") await edit.click();
  const done = page.getByRole("button", { name: "Done", exact: true });
  await page.locator(".family-sky.is-editing.is-near").waitFor({ timeout: 4000 });
  if ((await done.getAttribute("aria-pressed")) !== "true") fail(`${viewport.name}: Edit did not turn on`);
}

/**
 * Families Edit, close up: a parent curve unlinks through the classic confirm,
 * and a couple bar asks with the classic partner question before it unlinks.
 * Outside Edit, the same tap does not remove anyone.
 */
/**
 * Families Edit, close up: drag Fay Fixture along her row. The nudge is saved
 * and she is still sitting there after a reload. She stays in Dee's family.
 */
async function runSkyPlace(page, viewport) {
  const fayCard = '.portrait-card[data-person-id="fx-fay"]';
  await revealSkyPerson(page, viewport, "fx-fay");
  await enterEdit(page, viewport);
  const point = await bringMarkOnScreen(page, fayCard);
  if (!point) fail(`${viewport.name}: Fay Fixture is not on screen at close zoom`);
  const before = (await skyCards(page)).find((card) => card.id === "fx-fay");
  const box = await page.locator(fayCard).boundingBox();
  const stage = await page.locator(".family-sky").boundingBox();
  if (!before || !box || !stage) fail(`${viewport.name}: Fay Fixture is not on her row`);
  const scale = await page.evaluate(() => {
    const world = document.querySelector(".sky-world");
    const value = world ? getComputedStyle(world).transform : "none";
    const match = /matrix\(([^)]+)\)/.exec(value);
    const n = match ? Number(match[1].split(",")[0]) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  });
  const centerX = point.x;
  const centerY = point.y;
  const roomRight = stage.x + stage.width - centerX;
  const roomLeft = centerX - stage.x;
  const dir = roomRight >= 36 ? 1 : -1;
  const screenDelta = Math.min(40 * scale, (dir > 0 ? roomRight : roomLeft) - 20);
  if (screenDelta < 16) fail(`${viewport.name}: Fay Fixture is too close to the screen edge to nudge`);
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + dir * screenDelta, centerY, { steps: 12 });
  await page.mouse.up();
  try {
    await page.waitForFunction(async (sign) => {
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
      const fay = tree.people.find((person) => person.id === "fx-fay");
      return typeof fay?.rowNudge === "number" && Math.sign(fay.rowNudge) === sign;
    }, dir);
  } catch {
    fail(`${viewport.name}: dragging Fay Fixture along her row did not save a place`);
  }
  await waitSkySettled(page);
  const after = (await skyCards(page)).find((card) => card.id === "fx-fay");
  if (!after) fail(`${viewport.name}: Fay Fixture left the sky after the nudge`);
  if (Math.sign(after.left - before.left) !== dir) {
    fail(`${viewport.name}: Fay Fixture did not sit at the nudged place (${before.left} -> ${after.left})`);
  }
  if (after.top !== before.top) fail(`${viewport.name}: the nudge moved Fay Fixture off her row`);
  const members = await page.locator('.sky-bucket[data-members~="fx-fay"]').getAttribute("data-members");
  if (!members?.split(" ").includes("fx-dee") || !members.split(" ").includes("fx-rex")) {
    fail(`${viewport.name}: the nudge moved Fay Fixture out of Dee's family (${members})`);
  }
  await page.screenshot({ path: path.join(outDir, `family-sky-${viewport.name}-placed.png`) });
  const nudgedLeft = after.left;

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
  await page.getByText("Looking at Ada").waitFor();
  await openVisualize(page);
  await turnFamiliesOn(page, viewport);
  await revealSkyPerson(page, viewport, "fx-fay");
  await waitSkySettled(page);
  const restored = (await skyCards(page)).find((card) => card.id === "fx-fay");
  if (!restored || Math.abs(restored.left - nudgedLeft) > 0.5 || restored.top !== after.top) {
    fail(`${viewport.name}: Fay Fixture's nudge did not survive reload (${nudgedLeft} -> ${restored?.left})`);
  }
  const saved = await readTree(page);
  const fay = saved.people.find((person) => person.id === "fx-fay");
  if (typeof fay?.rowNudge !== "number" || Math.sign(fay.rowNudge) !== dir) {
    fail(`${viewport.name}: Fay Fixture's saved place was missing after reload`);
  }
  console.log(`${viewport.name}: edit mode nudged Fay along her row and kept it after reload`);
}

async function runSkyUnlink(page, viewport) {
  const parentSelector = '.sky-link[data-from="fx-ada"][data-to="fx-eli"]';
  const point = await zoomNearOn(page, viewport, parentSelector);
  if ((await page.locator(".family-sky .graph-hit").count()) !== 0) {
    fail(`${viewport.name}: sky links offer unlink before Edit`);
  }
  let stray = false;
  const onStray = (dialog) => {
    stray = true;
    dialog.dismiss().catch(() => undefined);
  };
  page.on("dialog", onStray);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(250);
  page.off("dialog", onStray);
  if (stray) fail(`${viewport.name}: tapping a sky link outside Edit asked to unlink`);
  const before = await readTree(page);
  if (!before.childLinks.some((link) => link.childId === "fx-eli" && link.parentIds.includes("fx-ada"))) {
    fail(`${viewport.name}: Ada's parent link disappeared before Edit`);
  }

  await enterEdit(page, viewport);
  await page.locator(`.graph-hit[data-mark="curve"][data-from="fx-ada"][data-to="fx-eli"]`).waitFor();
  const hit = await linkScreenPoint(page, `.graph-hit[data-mark="curve"][data-from="fx-ada"][data-to="fx-eli"]`, { mustHit: true });
  if (!hit) fail(`${viewport.name}: Ada and Eli's link is not tappable in Edit`);
  let parentMessage = "";
  try {
    parentMessage = await clickConfirm(page, hit, true);
  } catch {
    fail(`${viewport.name}: tapping Ada and Eli's link did not ask to unlink`);
  }
  if (parentMessage !== "Remove the parent link from Ada Fixture to Eli Fixture?") {
    fail(`${viewport.name}: parent confirm said ${JSON.stringify(parentMessage)}`);
  }
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
    return !tree.childLinks.some((link) => link.childId === "fx-eli" && link.parentIds.includes("fx-ada"));
  });
  await page.locator(parentSelector).waitFor({ state: "detached", timeout: 4000 }).catch(() => {
    fail(`${viewport.name}: Ada and Eli's sky link is still drawn`);
  });
  await waitSkySettled(page);
  const afterParent = await readTree(page);
  if (!afterParent.childLinks.some((link) => link.childId === "fx-eli" && link.parentIds.includes("fx-ben"))) {
    fail(`${viewport.name}: unlinking Ada also removed Ben`);
  }
  if (!afterParent.people.some((person) => person.id === "fx-ada" && person.familyName === "Fixture")) {
    fail(`${viewport.name}: Ada Fixture was removed from the tree`);
  }

  await openFamilyNear(page, viewport, "Nia & Pal family");
  const couple = '.sky-unlink[data-mark="couple"][data-partners="fx-nia fx-pal"]';
  await page.locator(couple).waitFor({ state: "attached", timeout: 8000 });
  const couplePoint = await bringMarkOnScreen(page, couple);
  if (!couplePoint) fail(`${viewport.name}: Nia and Pal's couple link is not on screen`);
  let declineMessage = "";
  try {
    declineMessage = await clickConfirm(page, couplePoint, false);
  } catch {
    fail(`${viewport.name}: tapping the couple link did not ask to unlink`);
  }
  if (declineMessage !== "Unlink Nia Fixture and Pal Fixture as partners?") {
    fail(`${viewport.name}: partner confirm said ${JSON.stringify(declineMessage)}`);
  }
  const kept = await readTree(page);
  if (!kept.unions.some((union) => union.partnerIds.includes("fx-nia") && union.partnerIds.includes("fx-pal"))) {
    fail(`${viewport.name}: declining the confirm still unlinked Nia and Pal`);
  }
  try {
    await clickConfirm(page, couplePoint, true);
  } catch {
    fail(`${viewport.name}: the couple link did not ask again`);
  }
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
    const stillPartners = tree.unions.some((union) => union.partnerIds.includes("fx-nia") && union.partnerIds.includes("fx-pal"));
    const bothStay = tree.people.some((person) => person.id === "fx-nia") && tree.people.some((person) => person.id === "fx-pal");
    return !stillPartners && bothStay;
  });
  await waitSkySettled(page);
  await page.screenshot({ path: path.join(outDir, `family-sky-${viewport.name}-unlinked.png`) });
  console.log(`${viewport.name}: edit mode unlinked a parent curve and a couple`);
}

const FIXTURE_IDS = [
  "fx-ada", "fx-ben", "fx-cora", "fx-dee", "fx-eli", "fx-fay",
  "fx-gran", "fx-mae", "fx-nia", "fx-pal", "fx-rex", "fx-stu", "fx-wynn",
];

async function tapLensPerson(page, personId) {
  const card = page.locator(`.portrait-card[data-person-id="${personId}"]`);
  await card.waitFor({ timeout: 8000 });
  try {
    await card.click({ timeout: 1500 });
  } catch {
    await card.click({ force: true });
  }
}

async function resolved(page) {
  return (await page.locator(".family-sky").getAttribute("data-resolved")) ?? "";
}

async function readAccess(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("familytree");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("access")) {
            resolve(null);
            return;
          }
          const get = db.transaction("access", "readonly").objectStore("access").get("living");
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
      }),
  );
}

async function runVisibilityLens(page, viewport) {
  if ((await page.locator("html").getAttribute("data-theme")) !== "dark") {
    fail(`${viewport.name}: lens check expected the dark theme`);
  }
  const done = page.locator(".graph-toolbar").getByRole("button", { name: "Done", exact: true });
  if (await done.count()) await done.click();
  await revealSkyPerson(page, viewport, "fx-fay");
  await page.getByRole("button", { name: "Lens", exact: true }).click();
  await page.locator('.family-sky.is-lens[data-lens-phase="working"]').waitFor();
  const everyone = (await resolved(page)).split(" ").filter(Boolean).sort();
  if (JSON.stringify(everyone) !== JSON.stringify([...FIXTURE_IDS].sort())) {
    fail(`${viewport.name}: the working view is not the full fixture tree (${everyone.join(" ")})`);
  }
  await page.getByRole("button", { name: "Look as Eli Fixture", exact: true }).click();
  await page.locator('.family-sky[data-lens-phase="arrange"]').waitFor();
  await tapLensPerson(page, "fx-dee");
  await page.locator('[data-person-id="fx-dee"][data-lens="include"]').waitFor();
  await tapLensPerson(page, "fx-fay");
  await tapLensPerson(page, "fx-fay");
  await page.locator('[data-person-id="fx-fay"][data-lens="dim"][data-draw="shown"]').waitFor();
  await tapLensPerson(page, "fx-rex");
  await tapLensPerson(page, "fx-rex");
  await tapLensPerson(page, "fx-rex");
  await page.locator('[data-person-id="fx-rex"][data-lens="hide"][data-draw="ghost"]').waitFor();
  if ((await page.locator(".family-sky").getAttribute("data-layout")) !== "sky") {
    fail(`${viewport.name}: arranging a lens gathered the sky`);
  }
  if (await page.getByRole("dialog").count()) fail(`${viewport.name}: arranging a lens opened the editor`);
  await page.screenshot({ path: path.join(outDir, `lens-${viewport.name}-arrange.png`) });

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.locator('.family-sky[data-lens-phase="preview"]').waitFor();
  if ((await resolved(page)) !== "fx-dee fx-fay") {
    fail(`${viewport.name}: Eli's preview is ${JSON.stringify(await resolved(page))}, expected Dee shown and Fay dimmed`);
  }
  const fay = page.locator('.portrait-card[data-person-id="fx-fay"]');
  const dee = page.locator('.portrait-card[data-person-id="fx-dee"]');
  await fay.waitFor();
  if (!(await fay.getAttribute("class"))?.includes("is-lens-dim")) {
    fail(`${viewport.name}: dimmed Fay is not visually reduced`);
  }
  if ((await fay.getAttribute("data-details")) !== "withheld") {
    fail(`${viewport.name}: Fay's living details were opened for Eli`);
  }
  const opacity = await fay.evaluate((el) => Number(getComputedStyle(el).opacity));
  const deeOpacity = await dee.evaluate((el) => Number(getComputedStyle(el).opacity));
  if (!(opacity < 0.5) || !(deeOpacity > 0.85)) {
    fail(`${viewport.name}: dimmed opacity ${opacity} should sit below Dee's ${deeOpacity}`);
  }
  if (await page.locator('[data-person-id="fx-rex"]').count()) {
    fail(`${viewport.name}: hidden Rex is still on the sky`);
  }
  await page.screenshot({ path: path.join(outDir, `lens-${viewport.name}-preview.png`) });

  const quinn = page.getByRole("button", { name: "Look as Quinn Fixture, pending", exact: true });
  await quinn.scrollIntoViewIfNeeded();
  await quinn.click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.locator('.family-sky[data-lens-phase="preview"]').waitFor();
  if ((await resolved(page)) !== "") fail(`${viewport.name}: a pending invite showed ${JSON.stringify(await resolved(page))}`);
  if (await page.locator(".portrait-card, .sky-avatar").count()) {
    fail(`${viewport.name}: a pending invite still drew people`);
  }
  await page.screenshot({ path: path.join(outDir, `lens-${viewport.name}-guest-pending.png`) });

  await page.getByRole("button", { name: "Accept invite for Quinn Fixture", exact: true }).click();
  await page.locator('.invite-card[data-invite-status="accepted"]').waitFor();
  await page.locator('.family-sky[data-lens-phase="preview"]').waitFor();
  if ((await resolved(page)) !== "fx-dee fx-eli") {
    fail(`${viewport.name}: accepted invite showed ${JSON.stringify(await resolved(page))}`);
  }
  for (const id of ["fx-dee", "fx-eli"]) {
    if ((await page.locator(`[data-person-id="${id}"]`).getAttribute("data-details")) !== "withheld") {
      fail(`${viewport.name}: ${id} details were open to the guest`);
    }
  }
  if (await page.locator('[data-person-id="fx-fay"]').count()) {
    fail(`${viewport.name}: the invite showed Fay, who was not granted`);
  }
  await page.screenshot({ path: path.join(outDir, `lens-${viewport.name}-guest-accepted.png`) });

  await page.getByRole("button", { name: "Revoke invite for Quinn Fixture", exact: true }).click();
  await page.locator('.invite-card[data-invite-status="revoked"]').waitFor();
  if ((await resolved(page)) !== "") fail(`${viewport.name}: a revoked invite showed ${JSON.stringify(await resolved(page))}`);
  await page.screenshot({ path: path.join(outDir, `lens-${viewport.name}-guest-revoked.png`) });

  await page.getByRole("button", { name: "You", exact: true }).click();
  await page.locator('.family-sky[data-lens-phase="working"]').waitFor();
  const restored = (await resolved(page)).split(" ").filter(Boolean).sort();
  if (JSON.stringify(restored) !== JSON.stringify([...FIXTURE_IDS].sort())) {
    fail(`${viewport.name}: switching back did not restore the working view (${restored.join(" ")})`);
  }
  const fayHome = page.locator('.portrait-card[data-person-id="fx-fay"]');
  if (await fayHome.count()) {
    if ((await fayHome.getAttribute("data-details")) !== "open") {
      fail(`${viewport.name}: the working view withheld Fay's details`);
    }
    if ((await fayHome.getAttribute("class"))?.includes("is-lens-dim")) {
      fail(`${viewport.name}: the working view left Fay dimmed`);
    }
  }
  await page.screenshot({ path: path.join(outDir, `lens-${viewport.name}-owner.png`) });

  await page.waitForFunction(async () => {
    const access = await new Promise((resolve, reject) => {
      const request = indexedDB.open("familytree");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("access")) {
          resolve(null);
          return;
        }
        const get = db.transaction("access", "readonly").objectStore("access").get("living");
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      };
    });
    const invite = access?.links?.find((link) => link.id === "fx-invite-quinn");
    const lens = access?.lenses?.find((item) => item.viewer?.personId === "fx-eli");
    const fay = lens?.rules?.find((rule) => rule.personId === "fx-fay");
    const rex = lens?.rules?.find((rule) => rule.personId === "fx-rex");
    return invite?.status === "revoked" && fay?.effect === "dim" && rex?.effect === "hide";
  });
  const before = await readAccess(page);
  const treeBefore = await readTree(page);
  if (!before || before.links?.find((link) => link.id === "fx-invite-quinn")?.status !== "revoked") {
    fail(`${viewport.name}: the invite was not saved as revoked`);
  }
  if ("access" in treeBefore) fail(`${viewport.name}: access was stored inside the tree`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
  await openVisualize(page);
  await turnFamiliesOn(page, viewport);
  await page.getByRole("button", { name: "Lens", exact: true }).click();
  await page.getByRole("button", { name: "Look as Eli Fixture", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.locator('.family-sky[data-lens-phase="preview"]').waitFor();
  if ((await resolved(page)) !== "fx-dee fx-fay") {
    fail(`${viewport.name}: Eli's lens did not survive reload (${JSON.stringify(await resolved(page))})`);
  }
  await page.getByRole("button", { name: "Look as Quinn Fixture, revoked", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  if ((await resolved(page)) !== "") fail(`${viewport.name}: the revoked invite did not survive reload`);
  const after = await readAccess(page);
  if (after?.links?.find((link) => link.id === "fx-invite-quinn")?.status !== "revoked") {
    fail(`${viewport.name}: reloaded access lost the revoked invite`);
  }
  console.log(`${viewport.name}: visibility lens arranged, previewed, and reloaded`);
}

async function runPartnerStatus(page, viewport) {
  const lens = page.getByRole("button", { name: "Lens", exact: true });
  if ((await lens.getAttribute("aria-pressed")) === "true") await lens.click();
  const done = page.getByRole("button", { name: "Done", exact: true });
  if (await done.count()) await done.click();
  await page.locator(".family-sky[data-layout='sky']").waitFor();

  await openFamilyNear(page, viewport, "Dee & Eli");
  const sheet = await openPerson(page, "fx-dee");
  const couple = sheet.getByLabel("Couple type for Eli Fixture");
  await couple.scrollIntoViewIfNeeded();
  await couple.selectOption("divorced");
  await sheet.getByText("Partner · Divorced").waitFor();

  await sheet.getByRole("tab", { name: "Partner" }).click();
  await sheet.locator("#rel-name").fill("Rema Fixture");
  await sheet.locator("#union-kind").selectOption("married");
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await sheet.getByText("Partner · Remarried").waitFor();
  await sheet.getByText("Remarried. An earlier union is divorced.").waitFor();
  await sheet.getByRole("button", { name: "Close" }).click();
  await sheet.waitFor({ state: "detached" });
  await waitSkySettled(page);

  const saved = await readTree(page);
  const ended = saved.unions.find((union) => union.partnerIds.includes("fx-dee") && union.partnerIds.includes("fx-eli"));
  if (ended?.kind !== "divorced") fail(`${viewport.name}: Dee and Eli were not saved as divorced`);
  const rema = saved.people.find((person) => person.givenName === "Rema Fixture");
  if (!rema) fail(`${viewport.name}: Rema Fixture was not added`);
  const next = saved.unions.find((union) => union.partnerIds.includes("fx-dee") && union.partnerIds.includes(rema.id));
  if (next?.kind !== "married") fail(`${viewport.name}: the new union was not saved as married`);
  if (JSON.stringify(saved).includes("remarried")) fail(`${viewport.name}: remarried was stored on the tree`);

  await page.locator('.sky-link.is-divorced[data-status="divorced"]').waitFor({ state: "attached", timeout: 8000 });
  const remarried = page.locator('button.partner-status[data-status="remarried"]');
  await remarried.waitFor({ state: "attached", timeout: 8000 });
  await remarried.click({ force: true });
  if ((await remarried.getAttribute("data-open")) !== "true") fail(`${viewport.name}: the remarried label did not open`);
  if (!(await remarried.innerText()).includes("Remarried")) fail(`${viewport.name}: the remarried label was blank`);
  const divorced = page.locator('button.partner-status[data-status="divorced"]');
  await divorced.click({ force: true });
  if (!(await divorced.innerText()).includes("Divorced")) fail(`${viewport.name}: the divorced label was blank`);
  await page.screenshot({ path: path.join(outDir, `partner-status-${viewport.name}.png`) });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
  await openVisualize(page);
  await turnFamiliesOn(page, viewport);
  await revealSkyPerson(page, viewport, "fx-dee");
  await page.locator('.sky-link.is-divorced[data-status="divorced"]').waitFor({ state: "attached", timeout: 8000 });
  await page.locator('[data-status="remarried"]').first().waitFor({ state: "attached", timeout: 8000 });
  const again = await readTree(page);
  const againNext = again.unions.find((union) => union.partnerIds.includes("fx-dee") && union.partnerIds.includes(rema.id));
  if (againNext?.kind !== "married" || again.unions.find((union) => union.id === ended.id)?.kind !== "divorced") {
    fail(`${viewport.name}: partner status did not survive reload`);
  }
  console.log(`${viewport.name}: divorce and remarriage saved, shown, and reloaded`);
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
    const wynnStar = stars.find((star) => star.members.split(" ").includes("fx-wynn"));
    if (!wynnStar || wynnStar.id === stu.id || wynnStar.members.trim() !== "fx-wynn") {
      fail(`${viewport.name}: Wynn Fixture should be a family of one, not Stu's (${wynnStar?.members})`);
    }
    await page.getByText("Tap a family to zoom in").waitFor();
    await page.screenshot({ path: shot("stars") });

    await assertStepOnlyChild(page, viewport);
    await showStars(page);

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
    await runSkyPlace(page, viewport);
    await runSkyUnlink(page, viewport);
    await runVisibilityLens(page, viewport);
    await runPartnerStatus(page, viewport);
    console.log(`${viewport.name}: links, buckets, stars, step-only child, row move, reload, place, unlink, lens, and partner status passed`);
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
