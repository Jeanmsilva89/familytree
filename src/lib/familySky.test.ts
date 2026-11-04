import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SKY_ZOOM,
  bucketAt,
  cameraToFit,
  curveHitsCards,
  layoutFamilySky,
  morphSky,
  overviewZoom,
  visibleBuckets,
  legibleLabels,
  skyBounds,
  skyMinScale,
  zoomLevel,
  type FamilySky,
} from "./familySky";
import { ALL_FAMILY_UNIT_FIXTURES, FIXTURE_MATERNAL_FAMILY, FIXTURE_MOVED_PARENT, fuId } from "./familyUnits.fixtures";
import { CARD } from "./layout";
import type { ChildLink, Person, TreeData, Union } from "./types";

function inside(b: FamilySky["buckets"][number], x: number, y: number) {
  return Math.pow(Math.abs(x - b.cx) / b.rx, b.n) + Math.pow(Math.abs(y - b.cy) / b.ry, b.n) <= 1.0001;
}

function assertNoOverlap(sky: FamilySky) {
  for (let i = 0; i < sky.buckets.length; i++) {
    for (let j = i + 1; j < sky.buckets.length; j++) {
      const a = sky.buckets[i];
      const b = sky.buckets[j];
      const apart = Math.abs(a.cx - b.cx) >= a.rx + b.rx - 0.5 || Math.abs(a.cy - b.cy) >= a.ry + b.ry - 0.5;
      assert.ok(apart, `${a.label} overlaps ${b.label}`);
    }
  }
}

/** FIXTURE: a large synthetic tree (many families, many generations). Names are FIXTURE ids only. */
function bigFixture(families: number): TreeData {
  const people: Person[] = [];
  const unions: Union[] = [];
  const childLinks: ChildLink[] = [];
  const add = (id: string) => {
    people.push({ id, givenName: `FIXTURE ${id}`, familyName: "FIXTURE", createdAt: "", updatedAt: "" });
    return id;
  };
  let prevDaughter: string | undefined;
  let prevSon: string | undefined;
  for (let f = 0; f < families; f++) {
    const mom = f % 3 === 0 && prevSon ? add(`w${f}`) : prevDaughter && f % 3 === 1 ? prevDaughter : add(`m${f}`);
    const dad = f % 3 === 0 && prevSon ? prevSon : add(`d${f}`);
    unions.push({ id: `u${f}`, partnerIds: [dad, mom], kind: f % 5 === 4 ? "separated" : "married" });
    const kids = [add(`k${f}a`), add(`k${f}b`), add(`k${f}c`)];
    for (const k of kids) childLinks.push({ id: `c${k}`, childId: k, parentIds: [dad, mom], roles: { [dad]: "father", [mom]: "mother" } });
    prevDaughter = kids[0];
    prevSon = kids[1];
  }
  return { people, unions, childLinks, focusPersonId: people[0].id };
}

describe("family sky layout (FIXTURE trees)", () => {
  for (const [name, tree] of Object.entries(ALL_FAMILY_UNIT_FIXTURES)) {
    it(`${name}: one card per person, inside their own bucket; buckets never overlap`, () => {
      const sky = layoutFamilySky(tree);
      assert.equal(sky.cards.length, tree.people.length);
      for (const card of sky.cards) {
        const bucket = sky.buckets.find((b) => b.id === card.unitId)!;
        assert.ok(bucket.memberIds.includes(card.id));
        for (const [x, y] of [
          [card.x - CARD.w / 2, card.y],
          [card.x + CARD.w / 2, card.y],
          [card.x - CARD.w / 2, card.y + CARD.h],
          [card.x + CARD.w / 2, card.y + CARD.h],
        ]) {
          assert.ok(inside(bucket, x, y), `${card.person.givenName} sits inside ${bucket.label}`);
        }
      }
      assertNoOverlap(sky);
      const box = skyBounds(sky);
      assert.ok(box.minX >= 0 && box.minY >= 0 && box.maxX <= sky.width && box.maxY <= sky.height);
    });
  }

  it("is deterministic", () => {
    assert.deepEqual(layoutFamilySky(FIXTURE_MATERNAL_FAMILY), layoutFamilySky(structuredClone(FIXTURE_MATERNAL_FAMILY)));
  });

  it("lays the same sky out for the same people no matter who is focused", () => {
    const positions = (tree: TreeData) =>
      layoutFamilySky(tree).buckets.map((b) => [b.id, b.cx, b.cy]);
    const cards = (tree: TreeData) => layoutFamilySky(tree).cards.map((c) => [c.id, c.x, c.y]);
    const base = FIXTURE_MATERNAL_FAMILY;
    const focused = { ...base, focusPersonId: fuId("tess") };
    assert.deepEqual(positions(focused), positions(base));
    assert.deepEqual(cards(focused), cards(base));
  });

  it("a partnerless person moved into a descendant's family joins that family's row", () => {
    const tree: TreeData = {
      ...FIXTURE_MOVED_PARENT,
      familyUnitOverrides: [{ personId: fuId("parent"), unitOf: fuId("spouse") }],
    };
    const sky = layoutFamilySky(tree);
    const card = (id: string) => sky.cards.find((c) => c.id === fuId(id))!;
    assert.equal(card("parent").unitId, card("spouse").unitId);
    assert.equal(card("parent").y, card("spouse").y);
    const elderTree: TreeData = {
      ...FIXTURE_MOVED_PARENT,
      familyUnitOverrides: [{ personId: fuId("elder"), unitOf: fuId("spouse") }],
    };
    const elderSky = layoutFamilySky(elderTree);
    const at = (id: string) => elderSky.cards.find((c) => c.id === fuId(id))!;
    assert.equal(at("elder").unitId, at("spouse").unitId);
    assert.equal(at("elder").y, at("spouse").y);
    assert.ok(at("parent").y >= at("spouse").y, "the people who come along are not left on a row above the family");
  });

  it("draws person-to-person links between buckets, and one thin bucket edge per pair", () => {
    const sky = layoutFamilySky(FIXTURE_MATERNAL_FAMILY);
    const jon = sky.cards.find((c) => c.id === fuId("jon"))!;
    const dad = sky.cards.find((c) => c.id === fuId("dad"))!;
    const link = sky.links.find((l) => l.fromPersonId === fuId("dad") && l.toPersonId === fuId("jon"))!;
    assert.equal(link.kind, "blood");
    // Each end sits just outside its person's card, in a small gap.
    const gapTo = (c: typeof dad, x: number, y: number) =>
      Math.max(Math.abs(x - c.x) - CARD.w / 2, Math.abs(y - (c.y + CARD.h / 2)) - CARD.h / 2);
    assert.ok(gapTo(dad, link.x1, link.y1) > 0 && gapTo(dad, link.x1, link.y1) < 12);
    assert.ok(gapTo(jon, link.x2, link.y2) > 0 && gapTo(jon, link.x2, link.y2) < 12);
    // Cora's unit ↔ Tess's unit carries two links (Carl→Joe, Cora→Joe) but one edge.
    assert.equal(sky.unitEdges.length, 3);
    const toTess = sky.unitEdges.find((e) => [e.aId, e.bId].includes(sky.units.unitOf[fuId("tess")]))!;
    assert.equal(toTess.count, 2);
    assert.deepEqual(toTess.kinds, ["blood"]);
  });

  it("puts older generations' buckets above younger ones", () => {
    const sky = layoutFamilySky(FIXTURE_MATERNAL_FAMILY);
    const of = (id: string) => sky.buckets.find((b) => b.id === sky.units.unitOf[fuId(id)])!;
    assert.ok(of("grandma").cy < of("tess").cy);
  });

  it("redraws the bucket around a reassigned person", () => {
    const moved = {
      ...FIXTURE_MATERNAL_FAMILY,
      familyUnitOverrides: [{ personId: fuId("joe"), unitOf: fuId("cora") }],
    };
    const sky = layoutFamilySky(moved);
    const home = sky.buckets.find((b) => b.memberIds.includes(fuId("cora")))!;
    const joe = sky.cards.find((c) => c.id === fuId("joe"))!;
    assert.ok(home.memberIds.includes(fuId("joe")));
    assert.ok(inside(home, joe.x, joe.y + CARD.h / 2));
  });

  it("a moved person sits beside their partner, with their children below, not wedged between siblings", () => {
    const moved = {
      ...FIXTURE_MATERNAL_FAMILY,
      familyUnitOverrides: [{ personId: fuId("joe"), unitOf: fuId("cora") }],
    };
    const sky = layoutFamilySky(moved);
    const card = (id: string) => sky.cards.find((c) => c.id === fuId(id))!;
    const [joe, tess] = [card("joe"), card("tess")];
    assert.equal(joe.unitId, tess.unitId);
    assert.equal(joe.y, tess.y, "same row");
    assert.ok(Math.abs(joe.x - tess.x) <= CARD.w + CARD.coupleGap + 1, "side by side");
    const [lo, hi] = [Math.min(joe.x, tess.x), Math.max(joe.x, tess.x)];
    assert.ok(!sky.cards.some((c) => c.y === joe.y && c.x > lo && c.x < hi), "nobody between them");
    for (const kid of ["lt1", "lt2"]) assert.ok(card(kid).y > joe.y, `${kid} sits below`);
  });

  it("a large FIXTURE tree lays out quickly without overlaps", () => {
    const tree = bigFixture(60);
    const t0 = performance.now();
    const sky = layoutFamilySky(tree);
    const ms = performance.now() - t0;
    assert.ok(ms < 4000, `took ${ms.toFixed(0)} ms`);
    assert.equal(sky.cards.length, tree.people.length);
    assertNoOverlap(sky);
  });
});

describe("semantic zoom", () => {
  it("names the level for a scale, with hysteresis at each threshold", () => {
    assert.equal(zoomLevel(0.05), "far");
    assert.equal(zoomLevel(0.25), "mid");
    assert.equal(zoomLevel(1), "near");
    assert.equal(zoomLevel(SKY_ZOOM.near * 0.98, "near"), "near");
    assert.equal(zoomLevel(SKY_ZOOM.near * 0.9, "near"), "mid");
    assert.equal(zoomLevel(SKY_ZOOM.far * 1.02, "far"), "far");
    assert.equal(zoomLevel(SKY_ZOOM.far * 1.1, "far"), "mid");
  });

  it("keeps the whole-sky overview starry even when it fits at a larger scale", () => {
    const sky = layoutFamilySky(FIXTURE_MATERNAL_FAMILY);
    for (const [w, h] of [[390, 844], [1280, 800], [2560, 1440]]) {
      const { s, farAt } = overviewZoom(w, h, sky);
      assert.equal(zoomLevel(s, "mid", farAt), "far");
      assert.equal(zoomLevel(s, "near", farAt), "far");
      assert.ok(s <= cameraToFit(w, h, skyBounds(sky)).s + 1e-9, "overview never crops the sky");
      assert.equal(zoomLevel(SKY_ZOOM.near * 1.1, "far", farAt), "near");
    }
  });

  it("fits the whole sky on a 390×844 phone, and the zoom floor allows it", () => {
    for (const tree of [FIXTURE_MATERNAL_FAMILY, bigFixture(60)]) {
      const sky = layoutFamilySky(tree);
      const box = skyBounds(sky);
      const cam = cameraToFit(390, 844, box);
      assert.ok(cam.s >= skyMinScale(390, 844, sky), "zoom floor is low enough");
      assert.ok(box.minX * cam.s + cam.x >= -0.5 && box.maxX * cam.s + cam.x <= 390.5);
      assert.ok(box.minY * cam.s + cam.y >= -0.5 && box.maxY * cam.s + cam.y <= 844.5);
    }
  });

  it("culls buckets outside the camera at close zoom, and keeps all at the overview", () => {
    const sky = layoutFamilySky(bigFixture(60));
    const all = cameraToFit(390, 844, skyBounds(sky));
    assert.equal(visibleBuckets(sky, all, 390, 844).length, sky.buckets.length);
    const b = sky.buckets[0];
    const close = { x: 195 - b.cx * 0.8, y: 422 - b.cy * 0.8, s: 0.8 };
    const seen = visibleBuckets(sky, close, 390, 844);
    assert.ok(seen.includes(b.id));
    assert.ok(seen.length < sky.buckets.length / 2, `${seen.length} of ${sky.buckets.length}`);
  });

  it("shows only labels that do not collide on screen, all of them when there is room", () => {
    const sky = layoutFamilySky(bigFixture(60));
    const { s } = overviewZoom(390, 844, sky);
    const few = legibleLabels(sky, s, "far");
    assert.ok(few.length >= 1 && few.length < sky.buckets.length);
    assert.equal(legibleLabels(sky, 5, "far").length, sky.buckets.length);
    const small = layoutFamilySky(FIXTURE_MATERNAL_FAMILY);
    assert.equal(legibleLabels(small, overviewZoom(390, 844, small).s, "far").length, small.buckets.length);
    const pick = sky.buckets[sky.buckets.length - 1].id;
    assert.equal(legibleLabels(sky, s, "far", pick)[0], pick);
  });

  it("finds the bucket under a tap", () => {
    const sky = layoutFamilySky(FIXTURE_MATERNAL_FAMILY);
    const b = sky.buckets[0];
    assert.equal(bucketAt(sky, b.cx, b.cy, 0.05)?.id, b.id);
    assert.equal(bucketAt(sky, -1e6, -1e6, 0.05), undefined);
  });
});

describe("family sky links (FIXTURE trees)", () => {
  const trees: [string, TreeData][] = [
    ...Object.entries(ALL_FAMILY_UNIT_FIXTURES),
    ["moved", { ...FIXTURE_MATERNAL_FAMILY, familyUnitOverrides: [{ personId: fuId("joe"), unitOf: fuId("cora") }] }],
    ["big", bigFixture(20)],
  ];
  for (const [name, tree] of trees) {
    it(`${name}: cross-bucket links are never drawn under a card`, () => {
      const sky = layoutFamilySky(tree);
      for (const link of sky.links) {
        const others = sky.cards.filter((c) => c.id !== link.fromPersonId && c.id !== link.toPersonId);
        const ends = sky.cards.filter((c) => c.id === link.fromPersonId || c.id === link.toPersonId);
        assert.equal(curveHitsCards(link, ends), 0, `${link.id} runs into its own cards`);
        // Drawn pieces never pass under any card: they stop short and resume after it.
        for (const piece of link.pieces) assert.equal(curveHitsCards(piece, others), 0, `${link.id} runs under a card`);
        assert.ok(link.pieces.length >= 1);
      }
    });
  }
  it("routes the maternal fixture's links around cards without gaps", () => {
    const sky = layoutFamilySky(FIXTURE_MATERNAL_FAMILY);
    const gaps = sky.links.filter((l) => l.pieces.length > 1).map((l) => l.id);
    assert.ok(gaps.length <= 1, `links with gaps: ${gaps.join(", ")}`);
  });
});

describe("family sky stability (FIXTURE trees)", () => {
  const moveJoe = (tree: TreeData): TreeData => ({
    ...tree,
    familyUnitOverrides: [{ personId: fuId("joe"), unitOf: fuId("cora") }],
  });

  it("an edited tree lays out the same on a fresh call as it would after a reload", () => {
    const edited = moveJoe(FIXTURE_MATERNAL_FAMILY);
    const a = layoutFamilySky(edited);
    const b = layoutFamilySky(structuredClone(edited));
    assertNoOverlap(a);
    assert.deepEqual(
      a.buckets.map((bucket) => [bucket.id, bucket.cx, bucket.cy]),
      b.buckets.map((bucket) => [bucket.id, bucket.cx, bucket.cy]),
    );
    assert.deepEqual(
      a.cards.map((card) => [card.id, card.x, card.y]),
      b.cards.map((card) => [card.id, card.x, card.y]),
    );
  });

  it("a big edited sky is deterministic too", () => {
    const tree = bigFixture(30);
    const before = layoutFamilySky(tree);
    const someone = before.buckets[3].memberIds.at(-1)!;
    const target = before.buckets[0].headIds[0];
    const edited = { ...tree, familyUnitOverrides: [{ personId: someone, unitOf: target }] };
    const after = layoutFamilySky(edited);
    assertNoOverlap(after);
    assert.deepEqual(
      after.buckets.map((bucket) => [bucket.cx, bucket.cy]),
      layoutFamilySky(structuredClone(edited)).buckets.map((bucket) => [bucket.cx, bucket.cy]),
    );
  });

  it("morphSky glides people and buckets from the old layout to the new", () => {
    const before = layoutFamilySky(FIXTURE_MATERNAL_FAMILY);
    const after = layoutFamilySky(moveJoe(FIXTURE_MATERNAL_FAMILY));
    const joe = (sky: FamilySky) => sky.cards.find((c) => c.id === fuId("joe"))!;
    const start = morphSky(before, after, 0);
    const { x: sx, y: sy } = after.shift;
    assert.deepEqual([joe(start).x, joe(start).y], [joe(before).x + sx, joe(before).y + sy]);
    const half = morphSky(before, after, 0.5);
    assert.ok(Math.abs(joe(half).x - (joe(before).x + sx + joe(after).x) / 2) < 1e-6);
    assert.equal(morphSky(before, after, 1), after);
    const home = (sky: FamilySky) => sky.buckets.find((b) => b.id === sky.units.unitOf[fuId("cora")])!;
    const old = before.buckets.find((b) => b.id === home(after).id)!;
    assert.equal(home(start).cx, old.cx + sx);
    const link = half.links[0];
    const target = half.cards.find((c) => c.id === link.toPersonId)!;
    assert.equal(link.x2 - target.x, after.links[0].x2 - after.cards.find((c) => c.id === link.toPersonId)!.x);
  });
});
