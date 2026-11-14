/**
 * Confirm a fixture blended family in the Families lens.
 *
 * Kip Fixture's only parent on the tree is Dale Fixture. Step Fixture is
 * Dale's spouse, not Kip's parent, so Kip sits with Dale and not with Step.
 * Pip Fixture's parents are not on the tree. Pip is a family of one, with a
 * step link from Step and a quiet "Parents unknown" line. No person-to-person
 * link crosses an unrelated family. The classic household areas use that same
 * rule: Kip's card sits in Dale's area, and Pip's area is Parents unknown.
 * Runs at 1280×800 and 390×844.
 *
 *   npm run build && npm start
 *   node scripts/verify-blended-family.mjs
 */
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(path.join(here, "fixtures", "verify-blended-family.json"), "utf8"));
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
  await page.waitForTimeout(800);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
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

function membersOf(value) {
  return (value || "").split(/\s+/).filter(Boolean);
}

async function turnFamiliesOff(page, viewport) {
  const families = page.getByRole("button", { name: "Families", exact: true });
  if ((await families.getAttribute("aria-pressed")) === "true") {
    await families.click();
    await page.locator(".family-sky").waitFor({ state: "detached" });
  }
  const stage = page.locator(".graph-stage:not(.family-sky)");
  await stage.waitFor();
  if ((await stage.getAttribute("data-layout")) !== "tree") {
    fail(`${viewport.name}: classic graph is not the generation layout`);
  }
}

async function assertClassicHouseholds(page, viewport) {
  await turnFamiliesOff(page, viewport);
  await page.locator('.graph-stage:not(.family-sky) .portrait-card[data-person-id="fx-kip"]').waitFor();
  await page.locator(".graph-stage:not(.family-sky) .household-area").first().waitFor();
  const placed = await page.evaluate(() => {
    const centerOf = (id) => {
      const card = document.querySelector(`.graph-stage:not(.family-sky) .portrait-card[data-person-id="${id}"]`);
      if (!(card instanceof HTMLElement)) return null;
      const left = Number.parseFloat(card.style.left);
      const top = Number.parseFloat(card.style.top);
      const width = Number.parseFloat(card.style.width) || 120;
      const height = Number.parseFloat(card.style.height) || 140;
      return { x: left + width / 2, y: top + height / 2 };
    };
    const areas = [...document.querySelectorAll(".graph-stage:not(.family-sky) .household-area")].map((area) => {
      const members = (area.getAttribute("data-members") || "").split(/\s+/).filter(Boolean);
      return {
        members,
        parents: area.getAttribute("data-parents") || "",
        holds(id) {
          const point = centerOf(id);
          return Boolean(
            point && area instanceof SVGPathElement && area.isPointInFill(new DOMPoint(point.x, point.y)),
          );
        },
      };
    });
    const forks = [...document.querySelectorAll(".graph-stage:not(.family-sky) .graph-fork")].map((fork) => ({
      kin: fork.getAttribute("data-kin") || "",
      parents: (fork.getAttribute("data-parents") || "").split(/\s+/).filter(Boolean),
      children: (fork.getAttribute("data-children") || "").split(/\s+/).filter(Boolean),
    }));
    const pip = document.querySelector('.graph-stage:not(.family-sky) .portrait-card[data-person-id="fx-pip"]');
    const dale = areas.find((area) => area.members.includes("fx-dale"));
    const step = areas.find((area) => area.members.includes("fx-step"));
    const pipArea = areas.find((area) => area.members.includes("fx-pip"));
    return {
      dale: dale && { members: dale.members, holdsKip: dale.holds("fx-kip"), holdsStep: dale.holds("fx-step"), holdsPip: dale.holds("fx-pip") },
      step: step && { members: step.members, holdsKip: step.holds("fx-kip"), holdsPip: step.holds("fx-pip") },
      pip: pipArea && { members: pipArea.members, parents: pipArea.parents, holdsPip: pipArea.holds("fx-pip") },
      forks,
      pipParents: pip?.getAttribute("data-parents") || "",
      pipText: pip?.querySelector(".is-unknown-parents")?.textContent || "",
    };
  });
  if (!placed.dale || !placed.dale.members.includes("fx-kip") || !placed.dale.holdsKip) {
    fail(`${viewport.name}: Kip Fixture is not in Dale Fixture's household area (${JSON.stringify(placed.dale)})`);
  }
  if (placed.dale.members.includes("fx-step") || placed.dale.holdsStep || placed.dale.holdsPip) {
    fail(`${viewport.name}: Dale Fixture's household area includes Step or Pip (${JSON.stringify(placed.dale)})`);
  }
  if (!placed.step || placed.step.members.includes("fx-kip") || placed.step.members.includes("fx-pip") || placed.step.holdsKip || placed.step.holdsPip) {
    fail(`${viewport.name}: Step Fixture's household area includes a step-child (${JSON.stringify(placed.step)})`);
  }
  if (!placed.pip || placed.pip.members.join(" ") !== "fx-pip" || placed.pip.parents !== "unknown" || !placed.pip.holdsPip) {
    fail(`${viewport.name}: Pip Fixture is not a Parents unknown household of one (${JSON.stringify(placed.pip)})`);
  }
  if (placed.pipParents !== "unknown" || !/parents unknown/i.test(placed.pipText)) {
    fail(`${viewport.name}: Pip Fixture's card does not say Parents unknown (${JSON.stringify(placed.pipText)})`);
  }
  const stepLink = placed.forks.find(
    (fork) => fork.kin === "step" && fork.parents.includes("fx-step") && fork.children.includes("fx-pip"),
  );
  if (!stepLink) fail(`${viewport.name}: classic graph has no step link from Step Fixture to Pip Fixture`);
  await page.screenshot({ path: path.join(outDir, `classic-household-${viewport.name}.png`) });
  console.log(`${viewport.name}: classic areas keep Kip with Dale and Pip as Parents unknown`);
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
}

async function showStars(page) {
  await page.getByRole("button", { name: "All families" }).click();
  await page.waitForFunction(
    () => document.querySelector(".family-sky")?.getAttribute("data-level") === "far",
    null,
    { timeout: 8000 },
  );
  await page.waitForTimeout(400);
}

async function reveal(page, viewport, personId) {
  await showStars(page);
  const star = page.locator(`.sky-star[data-members~="${personId}"]`);
  if ((await star.count()) === 0) fail(`${viewport.name}: no family star contains ${personId}`);
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
  fail(`${viewport.name}: could not zoom to ${personId}`);
}

async function assertClear(page, viewport) {
  const crossed = await page.evaluate(() => {
    const links = [...document.querySelectorAll(".family-sky .sky-link")];
    const buckets = [...document.querySelectorAll(".family-sky .sky-bucket")];
    const hits = [];
    for (const link of links) {
      if (!(link instanceof SVGPathElement)) continue;
      const from = link.getAttribute("data-from") || "";
      const to = link.getAttribute("data-to") || "";
      const len = link.getTotalLength();
      for (let i = 0; i <= 48; i += 1) {
        const point = link.getPointAtLength((len * i) / 48);
        for (const bucket of buckets) {
          if (!(bucket instanceof SVGPathElement)) continue;
          const members = (bucket.getAttribute("data-members") || "").split(/\s+/).filter(Boolean);
          if (members.includes(from) || members.includes(to)) continue;
          if (bucket.isPointInFill(new DOMPoint(point.x, point.y))) {
            hits.push({ from, to, bucket: bucket.getAttribute("data-unit-id") });
            i = 48;
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
  try {
    await settle(page);
    await page.getByLabel("Import backup JSON").setInputFiles({
      name: "verify-blended-family.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await page.getByText("Looking at Dale").waitFor();
    await openVisualize(page);
    await assertClassicHouseholds(page, viewport);
    await turnFamiliesOn(page, viewport);
    await showStars(page);

    const stars = await page.locator(".sky-star").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-members") || ""),
    );
    const starWith = (id) => stars.find((members) => membersOf(members).includes(id));
    const kip = starWith("fx-kip");
    const step = starWith("fx-step");
    const pip = starWith("fx-pip");
    if (!kip || !membersOf(kip).includes("fx-dale") || !membersOf(kip).includes("fx-gran")) {
      fail(`${viewport.name}: Kip Fixture should sit with Dale and Gran (${JSON.stringify(stars)})`);
    }
    if (membersOf(kip).includes("fx-step") || kip === step) {
      fail(`${viewport.name}: Kip Fixture landed in Step Fixture's family (${kip})`);
    }
    if (!pip || membersOf(pip).join(" ") !== "fx-pip") {
      fail(`${viewport.name}: Pip Fixture should be a family of one (${pip})`);
    }
    if (!step || membersOf(step).includes("fx-kip") || membersOf(step).includes("fx-pip")) {
      fail(`${viewport.name}: Step Fixture's family includes a step-child (${step})`);
    }

    const fresh = await page.locator(".sky-star").evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          id: node.getAttribute("data-unit-id"),
          cx: node.querySelector(".sky-star-core")?.getAttribute("cx") || "",
          cy: node.querySelector(".sky-star-core")?.getAttribute("cy") || "",
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /menu/i }).waitFor({ timeout: 20000 });
    await page.getByText("Looking at Dale").waitFor();
    await openVisualize(page);
    await turnFamiliesOn(page, viewport);
    await showStars(page);
    const again = await page.locator(".sky-star").evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          id: node.getAttribute("data-unit-id"),
          cx: node.querySelector(".sky-star-core")?.getAttribute("cx") || "",
          cy: node.querySelector(".sky-star-core")?.getAttribute("cy") || "",
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    if (JSON.stringify(fresh) !== JSON.stringify(again)) {
      fail(`${viewport.name}: star positions changed after reload`);
    }

    const pipCard = await reveal(page, viewport, "fx-pip");
    if ((await pipCard.getAttribute("data-parents")) !== "unknown") {
      fail(`${viewport.name}: Pip Fixture has no parents-unknown mark`);
    }
    const label = await pipCard.locator(".is-unknown-parents").innerText();
    if (!/parents unknown/i.test(label)) {
      fail(`${viewport.name}: Pip Fixture's card does not say Parents unknown (${JSON.stringify(label)})`);
    }
    const pipBucket = await page.locator('.sky-bucket[data-members="fx-pip"]').getAttribute("data-parents");
    if (pipBucket !== "unknown") fail(`${viewport.name}: Pip Fixture's bucket is not the unknown-parents bucket`);
    const stepLink = page.locator('.sky-link.is-step[data-from="fx-step"][data-to="fx-pip"]');
    if ((await stepLink.count()) !== 1) fail(`${viewport.name}: expected a step link from Step Fixture to Pip Fixture`);

    await reveal(page, viewport, "fx-kip");
    const kipMembers = membersOf(await page.locator('.sky-bucket[data-members~="fx-kip"]').getAttribute("data-members"));
    if (!kipMembers.includes("fx-dale") || kipMembers.includes("fx-step")) {
      fail(`${viewport.name}: Kip Fixture's bucket is ${kipMembers.join(" ")}`);
    }
    await assertClear(page, viewport);
    await page.screenshot({ path: path.join(outDir, `blended-${viewport.name}.png`) });
    console.log(`${viewport.name}: Kip stays with Dale, Pip is a family of one, links stay clear`);
  } finally {
    await context.close();
  }
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const viewport of VIEWPORTS) {
    await runViewport(browser, viewport);
    console.log(`${viewport.name}: passed`);
  }
} finally {
  await browser.close();
}
