import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layoutFamilySky } from "./familySky";
import { buildGraph } from "./layoutGraph";
import { loadTree, resetTreeStoreForTests, saveTree, type TreeBackend } from "./db";
import { seedFamilySky, treeForLens } from "./layoutSeed";
import { layoutOrbit } from "./orbitView";
import { parseTreeJson, serializeTreeJson } from "./tree";
import type { Person, TreeData } from "./types";

/**
 * FIXTURE only. These people are invented for the layout checks.
 * The note on the file says so, and every family name is Fixture.
 */

const fixture = JSON.parse(
  readFileSync(new URL("../../scripts/fixtures/verify-family-sky.json", import.meta.url), "utf8"),
) as TreeData & { note?: string };

function person(id: string, givenName: string): Person {
  return {
    id,
    givenName,
    familyName: "Fixture",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function reversePeople(tree: TreeData): TreeData {
  return { ...tree, people: [...tree.people].reverse() };
}

function reverseLinks(tree: TreeData): TreeData {
  return { ...tree, childLinks: [...tree.childLinks].reverse() };
}

function reverseUnions(tree: TreeData): TreeData {
  return { ...tree, unions: [...tree.unions].reverse() };
}

function places(tree: TreeData, visible?: ReadonlySet<string>) {
  const sky = layoutFamilySky(tree, undefined, visible);
  return {
    buckets: sky.buckets.map((bucket) => [bucket.id, bucket.cx, bucket.cy]).sort(),
    cards: sky.cards.map((card) => [card.id, card.x, card.y]).sort(),
  };
}

function addUnlinked(tree: TreeData, id: string): TreeData {
  return { ...tree, people: [...tree.people, person(id, "New")] };
}

function addChildOfDee(tree: TreeData): TreeData {
  return {
    ...tree,
    people: [...tree.people, person("fx-neo", "Neo")],
    childLinks: [
      ...tree.childLinks,
      {
        id: "fx-c-neo",
        childId: "fx-neo",
        parentIds: ["fx-dee", "fx-eli"],
        roles: { "fx-dee": "mother", "fx-eli": "father" },
      },
    ],
  };
}

function delta(before: ReturnType<typeof places>, after: ReturnType<typeof places>, id: string) {
  const from = before.cards.find((card) => card[0] === id)!;
  const to = after.cards.find((card) => card[0] === id)!;
  return { dx: (to[1] as number) - (from[1] as number), dy: (to[2] as number) - (from[2] as number) };
}

describe("family sky seed (FIXTURE)", () => {
  it("labels the verify file as fixture data", () => {
    assert.match(fixture.note ?? "", /FIXTURE/);
    assert.ok(fixture.people.every((item) => item.familyName === "Fixture"));
  });

  it("is the same seed after a reload and after the saved arrays are reversed", () => {
    const seed = seedFamilySky(fixture);
    assert.deepEqual(seed, seedFamilySky(structuredClone(fixture)));
    assert.deepEqual(seed, seedFamilySky(reversePeople(fixture)));
    assert.deepEqual(seed, seedFamilySky(reverseLinks(fixture)));
    assert.deepEqual(seed, seedFamilySky(reverseUnions(fixture)));
    assert.ok(seed.buckets.length >= 4);
  });

  it("lays the same sky out after a reload and after the saved arrays are reversed", () => {
    const laid = places(fixture);
    assert.deepEqual(laid, places(structuredClone(fixture)));
    assert.deepEqual(laid, places(reversePeople(fixture)));
    assert.deepEqual(laid, places(reverseLinks(fixture)));
    assert.deepEqual(laid, places(reverseUnions(fixture)));
  });

  it("keeps the generation rows in the same places when the people array is reversed", () => {
    const row = (tree: TreeData) =>
      buildGraph(tree, tree.focusPersonId).cards.map((card) => [card.id, card.x, card.y]).sort();
    assert.deepEqual(row(fixture), row(reversePeople(fixture)));
    assert.deepEqual(row(fixture), row(reverseLinks(fixture)));
  });

  it("keeps orbit seats in the same places when the saved arrays are reversed", () => {
    const seats = (tree: TreeData) =>
      layoutOrbit(tree, "fx-eli")!.map((seat) => [seat.id, seat.ring, seat.x, seat.y]).sort();
    assert.deepEqual(seats(fixture), seats(reversePeople(fixture)));
    assert.deepEqual(seats(fixture), seats(reverseLinks(fixture)));
    assert.deepEqual(seats(fixture), seats(reverseUnions(fixture)));
  });

  it("adds an unlinked person without moving families that sort before them", () => {
    const before = places(fixture);
    const late = places(addUnlinked(fixture, "fx-zzz"));
    for (const bucket of before.buckets) {
      assert.deepEqual(late.buckets.find((item) => item[0] === bucket[0]), bucket);
    }
    const early = places(addUnlinked(fixture, "fx-000"));
    const shifts = before.cards.map((card) => delta(before, early, card[0] as string));
    assert.ok(shifts.every((shift) => Math.abs(shift.dy) < 1e-6));
    assert.ok(shifts.every((shift) => Math.abs(shift.dx - shifts[0].dx) < 1e-6));
    assert.ok(shifts[0].dx > 0);
  });

  it("adding one child slides only the families to the right, and leaves the parents' bucket", () => {
    const before = places(fixture);
    const after = places(addChildOfDee(fixture));
    for (const id of ["fx-ada", "fx-ben", "fx-cora"]) {
      assert.deepEqual(delta(before, after, id), { dx: 0, dy: 0 }, id);
    }
    const aside = ["fx-gran", "fx-mae", "fx-stu", "fx-nia", "fx-pal", "fx-wynn"].map((id) => delta(before, after, id));
    assert.ok(aside.every((shift) => shift.dy === aside[0].dy && shift.dx === aside[0].dx));
  });

  it("moving one person into another family does not scramble an unrelated family", () => {
    const before = places(fixture);
    const moved: TreeData = {
      ...fixture,
      familyUnitOverrides: [{ personId: "fx-cora", unitOf: "fx-dee" }],
    };
    const after = places(moved);
    const aside = ["fx-gran", "fx-mae", "fx-stu", "fx-nia", "fx-pal", "fx-wynn"].map((id) => delta(before, after, id));
    assert.ok(aside.every((shift) => Math.abs(shift.dy - aside[0].dy) < 1e-6 && Math.abs(shift.dx - aside[0].dx) < 1e-6));
    assert.equal(after.cards.find((card) => card[0] === "fx-cora")![2], after.cards.find((card) => card[0] === "fx-dee")![2]);
  });

  it("drops a hidden person from the layout, nudge and all, and restores them with the full lens", () => {
    const visible = new Set(fixture.people.map((item) => item.id));
    visible.delete("fx-rex");
    const nudged: TreeData = {
      ...fixture,
      people: fixture.people.map((item) => (item.id === "fx-rex" ? { ...item, rowNudge: 48 } : item)),
    };
    const hidden = layoutFamilySky(nudged, undefined, visible);
    const hiddenPlain = layoutFamilySky(fixture, undefined, visible);
    const dumped = JSON.stringify({ cards: hidden.cards, buckets: hidden.buckets, links: hidden.links, units: hidden.units });
    assert.equal(dumped.includes("fx-rex"), false);
    assert.equal(dumped.includes("Rex"), false);
    assert.deepEqual(
      hidden.cards.map((card) => [card.id, card.x, card.y]).sort(),
      hiddenPlain.cards.map((card) => [card.id, card.x, card.y]).sort(),
    );
    const full = places(fixture);
    const again = places(nudged);
    assert.notDeepEqual(
      again.cards.find((card) => card[0] === "fx-rex"),
      full.cards.find((card) => card[0] === "fx-rex"),
    );
    const everyone = new Set(fixture.people.map((item) => item.id));
    assert.deepEqual(places(fixture, everyone), places(fixture));
    const lens = treeForLens(nudged, visible);
    assert.equal(lens.people.some((item) => item.id === "fx-rex"), false);
    assert.equal(JSON.stringify(lens).includes("fx-rex"), false);
  });

  it("migrates an older backup that already stored nudges and family-unit overrides", async () => {
    const legacy: TreeData = {
      people: fixture.people.map((item) =>
        item.id === "fx-fay" ? { ...item, rowNudge: 24 } : item.id === "fx-eli" ? { ...item, graphX: 900 } : item,
      ),
      unions: fixture.unions,
      childLinks: fixture.childLinks,
      focusPersonId: fixture.focusPersonId,
      familyUnitOverrides: [{ personId: "fx-cora", unitOf: "fx-dee" }],
    };
    const parsed = parseTreeJson(serializeTreeJson(legacy));
    assert.equal(parsed.people.find((item) => item.id === "fx-fay")?.rowNudge, 24);
    assert.equal(parsed.people.find((item) => item.id === "fx-eli")?.graphX, 900);
    assert.deepEqual(parsed.familyUnitOverrides, legacy.familyUnitOverrides);
    const bare = parseTreeJson(JSON.stringify({ people: [person("fx-ada", "Ada")], unions: [], childLinks: [] }));
    assert.equal(bare.familyUnitOverrides, undefined);
    assert.equal(bare.people[0].rowNudge, undefined);

    const store: { current?: TreeData } = {};
    const backend: TreeBackend = {
      async get() {
        return store.current ? structuredClone(store.current) : undefined;
      },
      async put(tree) {
        store.current = structuredClone(tree);
      },
      async del() {
        store.current = undefined;
      },
    };
    resetTreeStoreForTests();
    await saveTree(parsed, backend);
    resetTreeStoreForTests();
    const loaded = await loadTree(backend);
    assert.equal(loaded.people.find((item) => item.id === "fx-fay")?.rowNudge, 24);
    assert.deepEqual(loaded.familyUnitOverrides, legacy.familyUnitOverrides);
    assert.deepEqual(places(loaded), places(legacy));
    resetTreeStoreForTests();
  });
});
