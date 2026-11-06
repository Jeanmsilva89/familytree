import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layoutFamilySky, morphSky, type FamilySky } from "./familySky";
import { skyFromPersonalMap } from "./familySkyFocus";
import { FIXTURE_MATERNAL_FAMILY, fuId } from "./familyUnits.fixtures";
import { CARD } from "./layout";
import { layoutPersonalMap } from "./personalMap";
import type { Person, TreeData } from "./types";
import {
  bucketTransform,
  coupleBarGeometry,
  curvesPath,
  forkGuides,
  glideFrame,
  glideMotion,
  glideRemain,
  mapBucketPoint,
  placeBucket,
  placeCard,
} from "./skyGlide";

/**
 * FIXTURE people only. The glide plan has to land on the same picture as morphSky.
 */

function person(id: string, givenName: string, extras: Partial<Person> = {}): Person {
  return {
    id,
    givenName,
    familyName: "Fixture",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...extras,
  };
}

const focusTree: TreeData = {
  focusPersonId: "focus",
  people: [
    person("focus", "Focus"),
    person("partner", "Partner"),
    person("kid", "Kid", { birthDate: "2018-01-01" }),
    person("mom", "Mom"),
    person("dad", "Dad"),
    person("stranger", "Stranger"),
  ],
  unions: [
    { id: "u-focus", partnerIds: ["focus", "partner"], kind: "partnered" },
    { id: "u-parents", partnerIds: ["mom", "dad"], kind: "married" },
  ],
  childLinks: [
    { id: "c-focus", childId: "focus", parentIds: ["mom", "dad"], unionId: "u-parents" },
    { id: "c-kid", childId: "kid", parentIds: ["focus", "partner"], unionId: "u-focus" },
  ],
};

function moveJoe(tree: TreeData): TreeData {
  return { ...tree, familyUnitOverrides: [{ personId: fuId("joe"), unitOf: fuId("cora") }] };
}

function assertCloseSky(actual: FamilySky, expected: FamilySky) {
  assert.equal(actual.width, expected.width);
  assert.equal(actual.height, expected.height);
  assert.deepEqual(
    actual.cards.map((card) => [card.id, card.x, card.y]),
    expected.cards.map((card) => [card.id, card.x, card.y]),
  );
  assert.deepEqual(
    actual.buckets.map((bucket) => [bucket.id, bucket.cx, bucket.cy, bucket.rx, bucket.ry]),
    expected.buckets.map((bucket) => [bucket.id, bucket.cx, bucket.cy, bucket.rx, bucket.ry]),
  );
  assert.deepEqual(
    actual.couples.map((couple) => [couple.id, couple.cx, couple.cy]),
    expected.couples.map((couple) => [couple.id, couple.cx, couple.cy]),
  );
  assert.deepEqual(actual.forks, expected.forks);
  assert.deepEqual(actual.links, expected.links);
  assert.deepEqual(
    actual.unitEdges.map((edge) => [edge.id, edge.x1, edge.y1, edge.x2, edge.y2]),
    expected.unitEdges.map((edge) => [edge.id, edge.x1, edge.y1, edge.x2, edge.y2]),
  );
}

describe("sky glide plan", () => {
  const before = layoutFamilySky(FIXTURE_MATERNAL_FAMILY);
  const after = layoutFamilySky(moveJoe(FIXTURE_MATERNAL_FAMILY));

  it("reuses one plan for every frame morphSky would draw", () => {
    const motion = glideMotion(before, after);
    for (const k of [0, 0.2, 0.5, 0.83]) {
      assertCloseSky(glideFrame(after, motion, k), morphSky(before, after, k));
    }
  });

  it("moves a card by travel times the glide still remaining", () => {
    const motion = glideMotion(before, after);
    const end = after.cards.find((card) => card.id === fuId("joe"))!;
    const span = motion.cards.get(end.id)!;
    assert.notEqual(span.dx, 0);
    for (const k of [0, 0.35, 1]) {
      const placed = placeCard(end, span, k);
      const seen = (k >= 1 ? after : morphSky(before, after, k)).cards.find((card) => card.id === end.id)!;
      assert.equal(placed.x, seen.x);
      assert.equal(placed.y, seen.y);
      assert.equal(placed.x, end.x + span.dx * glideRemain(k));
      assert.equal(placed.y, end.y + span.dy * glideRemain(k));
    }
  });

  it("scales a bucket that is new to the destination the way morphSky does", () => {
    const dropped = { ...before, buckets: before.buckets.slice(1) };
    const motion = glideMotion(dropped, after);
    const newborn = after.buckets.find((bucket) => bucket.id === before.buckets[0].id)!;
    const fresh = motion.buckets.get(newborn.id);
    assert.equal(fresh?.kind, "fresh");
    for (const k of [0, 0.4, 1]) {
      const placed = placeBucket(newborn, fresh, motion.cards, k);
      const seen = (k >= 1 ? after : morphSky(dropped, after, k)).buckets.find((bucket) => bucket.id === newborn.id)!;
      assert.equal(placed.cx, seen.cx);
      assert.equal(placed.cy, seen.cy);
      assert.equal(placed.rx, seen.rx);
      assert.equal(placed.ry, seen.ry);
    }
    const atStart = placeBucket(newborn, fresh, motion.cards, 0);
    assert.equal(atStart.rx, newborn.rx * 0.6);
    assert.equal(atStart.ry, newborn.ry * 0.6);
  });

  it("turns a lerped bucket into a transform of the destination outline", () => {
    const bucket = after.buckets[0];
    const at = { cx: bucket.cx + 30, cy: bucket.cy - 12, rx: bucket.rx * 0.8, ry: bucket.ry * 1.1 };
    const edge = mapBucketPoint(bucket, at, bucket.cx + bucket.rx, bucket.cy);
    assert.ok(Math.abs(edge.x - (at.cx + at.rx)) < 1e-9);
    assert.ok(Math.abs(edge.y - at.cy) < 1e-9);
    assert.equal(bucketTransform(bucket, bucket), "");
    assert.match(bucketTransform(bucket, at), /^translate\(/);
  });

  it("glides the personal map with the same plan, including forks and the couple bar", () => {
    const sky = layoutFamilySky(focusTree);
    const map = layoutPersonalMap(focusTree, "focus");
    assert.ok(map);
    const focused = skyFromPersonalMap(sky, focusTree, map);
    const motion = glideMotion(sky, focused);
    const half = glideFrame(focused, motion, 0.5);
    assertCloseSky(half, morphSky(sky, focused, 0.5));
    const focus = half.cards.find((card) => card.id === "focus")!;
    const from = sky.cards.find((card) => card.id === "focus")!;
    const to = focused.cards.find((card) => card.id === "focus")!;
    assert.equal(focus.x, from.x + (to.x - from.x) * 0.5);
    const bar = focused.couples.find((couple) => couple.id === "u-focus");
    assert.ok(bar);
    const cards = half.cards.map((card) => ({ id: card.id, x: card.x, y: card.y }));
    const geom = coupleBarGeometry(cards, bar.partnerIds, half.couples.find((couple) => couple.id === bar.id)!.cy);
    assert.ok(geom);
    assert.equal(geom.showBar, geom.x2 > geom.x1);
    assert.equal(geom.tint.height, CARD.h + 20);
    const fork = half.forks[0];
    assert.ok(fork);
    const guides = forkGuides(fork.parentDrops, fork.childDrops, fork.joinY, fork.railY);
    assert.equal(guides.stemX, fork.parentDrops.reduce((sum, drop) => sum + drop.x, 0) / fork.parentDrops.length);
    assert.equal(guides.joinWide, guides.joinR - guides.joinL > 6);
    const path = curvesPath(half.links[0]?.pieces ?? []);
    if (half.links[0]) assert.match(path, /^M /);
  });
});
