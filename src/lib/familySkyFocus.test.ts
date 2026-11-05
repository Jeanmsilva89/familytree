import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { layoutFamilySky, morphSky } from "./familySky";
import { skyFromPersonalMap } from "./familySkyFocus";
import { CARD } from "./layout";
import { graphFromPersonalMap, layoutPersonalMap } from "./personalMap";
import type { Person, TreeData } from "./types";

/**
 * FIXTURE people only. Role names, not a real family.
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

const fixture: TreeData = {
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

describe("family sky personal map", () => {
  it("moves each card onto that person's personal-map seat", () => {
    const sky = layoutFamilySky(fixture);
    const map = layoutPersonalMap(fixture, "focus");
    assert.ok(map);
    assert.ok(sky.buckets.length >= 1, "the fixture sky has a family to hide");
    const before = sky.cards.map((card) => [card.id, card.x, card.y]);
    const focused = skyFromPersonalMap(sky, fixture, map);
    assert.deepEqual(
      sky.cards.map((card) => [card.id, card.x, card.y]),
      before,
      "the sky layout stays put",
    );
    assert.equal(focused.cards.length, sky.cards.length);
    for (const seat of map.seats) {
      const card = focused.cards.find((item) => item.id === seat.id);
      assert.ok(card, seat.id);
      assert.equal(card.x, seat.x);
      assert.equal(card.y, seat.y);
      assert.equal(card.unitId, sky.cards.find((item) => item.id === seat.id)?.unitId);
    }
    const focus = focused.cards.find((card) => card.id === "focus")!;
    const partner = focused.cards.find((card) => card.id === "partner")!;
    const kid = focused.cards.find((card) => card.id === "kid")!;
    const mom = focused.cards.find((card) => card.id === "mom")!;
    assert.equal(focus.y, partner.y);
    assert.ok(Math.abs(Math.abs(partner.x - focus.x) - (CARD.w + CARD.coupleGap)) < 0.01);
    assert.ok(kid.y > focus.y);
    assert.ok(mom.y < focus.y);
  });

  it("hides family buckets and cross-family links, and keeps the center couple bar", () => {
    const sky = layoutFamilySky(fixture);
    const map = layoutPersonalMap(fixture, "focus")!;
    const focused = skyFromPersonalMap(sky, fixture, map);
    assert.deepEqual(focused.buckets, []);
    assert.deepEqual(focused.links, []);
    assert.deepEqual(focused.unitEdges, []);
    const center = new Set(map.seats.filter((seat) => seat.ring === "center").map((seat) => seat.id));
    const bar = focused.couples.find((couple) => couple.bar && couple.partnerIds.every((id) => center.has(id)));
    assert.ok(bar, "center couple keeps a bar");
    assert.equal(bar?.id, "u-focus");
    const parents = focused.couples.find((couple) => couple.id === "u-parents");
    assert.equal(parents?.bar, true);
    const graph = graphFromPersonalMap(fixture, map);
    assert.deepEqual(
      focused.forks.map((fork) => fork.id),
      graph.forks.map((fork) => fork.id),
    );
    assert.equal(focused.units, sky.units);
  });

  it("glides a card from its family bucket toward its personal seat", () => {
    const sky = layoutFamilySky(fixture);
    const map = layoutPersonalMap(fixture, "focus")!;
    const focused = skyFromPersonalMap(sky, fixture, map);
    assert.equal(morphSky(sky, focused, 1), focused);
    const from = sky.cards.find((card) => card.id === "focus")!;
    const to = focused.cards.find((card) => card.id === "focus")!;
    const half = morphSky(sky, focused, 0.5).cards.find((card) => card.id === "focus")!;
    assert.ok(Math.abs(half.x - (from.x + to.x) / 2) < 1e-6);
    assert.ok(Math.abs(half.y - (from.y + to.y) / 2) < 1e-6);
    assert.ok(from.x !== to.x || from.y !== to.y, "the seat is not already the bucket place");
  });
});
