import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARD, buildGraph } from "./layout";
import { graphFromPersonalMap, layoutPersonalMap, morphGraph, type PersonalSeat } from "./personalMap";
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
    person("kidB", "KidB", { birthDate: "2020-01-01" }),
    person("full", "Full"),
    person("half", "Half"),
    person("foster", "Foster"),
    person("step", "Step"),
    person("mom", "Mom"),
    person("dad", "Dad"),
    person("stepdad", "Stepdad"),
    person("gran", "Gran"),
    person("stranger", "Stranger"),
  ],
  unions: [
    { id: "u-focus", partnerIds: ["focus", "partner"], kind: "partnered" },
    { id: "u-parents", partnerIds: ["mom", "dad"], kind: "married" },
    { id: "u-step", partnerIds: ["mom", "stepdad"], kind: "partnered" },
  ],
  childLinks: [
    { id: "c-focus", childId: "focus", parentIds: ["mom", "dad"], unionId: "u-parents" },
    { id: "c-full", childId: "full", parentIds: ["mom", "dad"], unionId: "u-parents" },
    { id: "c-half", childId: "half", parentIds: ["mom"] },
    { id: "c-foster", childId: "foster", parentIds: ["mom"], kin: { mom: "foster" } },
    { id: "c-step", childId: "step", parentIds: ["stepdad"] },
    { id: "c-kid", childId: "kid", parentIds: ["focus", "partner"], unionId: "u-focus" },
    { id: "c-kidB", childId: "kidB", parentIds: ["focus", "partner"], unionId: "u-focus" },
    { id: "c-mom", childId: "mom", parentIds: ["gran"] },
  ],
};

function seat(map: { seats: PersonalSeat[] }, id: string) {
  const found = map.seats.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}

function dist(a: PersonalSeat, b: PersonalSeat) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("personal map", () => {
  it("centers the selected person with their partner as a couple", () => {
    const map = layoutPersonalMap(fixture, "focus");
    assert.ok(map);
    const focus = seat(map, "focus");
    const partner = seat(map, "partner");
    assert.equal(focus.ring, "center");
    assert.equal(partner.ring, "center");
    assert.equal(focus.y, partner.y);
    assert.ok(Math.abs(Math.abs(partner.x - focus.x) - (CARD.w + CARD.coupleGap)) < 0.01);
    const graph = graphFromPersonalMap(fixture, map);
    const bar = graph.couples.find((couple) => couple.id === "u-focus");
    assert.equal(bar?.bar, true);
  });

  it("gathers children below, parents above, and siblings beside the person", () => {
    const map = layoutPersonalMap(fixture, "focus")!;
    const focus = seat(map, "focus");
    const mom = seat(map, "mom");
    const dad = seat(map, "dad");
    const kid = seat(map, "kid");
    const kidB = seat(map, "kidB");
    const full = seat(map, "full");
    assert.equal(mom.ring, "near");
    assert.equal(dad.ring, "near");
    assert.equal(kid.ring, "near");
    assert.equal(full.ring, "near");
    assert.ok(mom.y < focus.y, "parents sit above");
    assert.ok(dad.y === mom.y);
    assert.ok(kid.y > focus.y, "children sit below");
    assert.equal(kidB.y, kid.y);
    assert.equal(full.y, focus.y, "siblings stay on the person's row");
    const parentMid = (mom.x + dad.x) / 2;
    const coupleMid = (focus.x + seat(map, "partner").x) / 2;
    assert.ok(Math.abs(parentMid - coupleMid) < 1);
  });

  it("keeps a full sibling closer than a half-sibling, and a half-sibling closer than a step-sibling", () => {
    const map = layoutPersonalMap(fixture, "focus")!;
    const focus = seat(map, "focus");
    const full = dist(focus, seat(map, "full"));
    const half = dist(focus, seat(map, "half"));
    const foster = dist(focus, seat(map, "foster"));
    const step = dist(focus, seat(map, "step"));
    assert.ok(full < half, `full ${full} should be closer than half ${half}`);
    assert.ok(half < foster, `half ${half} should be closer than foster ${foster}`);
    assert.ok(foster < step, `foster ${foster} should be closer than step ${step}`);
    assert.equal(seat(map, "half").ring, "near");
    assert.equal(seat(map, "step").ring, "near");
  });

  it("puts grandparents further out than parents and dims everyone else", () => {
    const map = layoutPersonalMap(fixture, "focus")!;
    const focus = seat(map, "focus");
    const mom = seat(map, "mom");
    const gran = seat(map, "gran");
    const stranger = seat(map, "stranger");
    const stepdad = seat(map, "stepdad");
    assert.equal(gran.ring, "outer");
    assert.ok(gran.y < mom.y);
    assert.ok(dist(focus, gran) > dist(focus, mom));
    assert.equal(stranger.ring, "dim");
    assert.equal(stepdad.ring, "dim");
    assert.ok(dist(focus, stranger) > dist(focus, gran));
    assert.ok(dist(focus, stepdad) > dist(focus, seat(map, "step")));
  });

  it("does not overlap cards", () => {
    const map = layoutPersonalMap(fixture, "focus")!;
    const seats = map.seats;
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const dx = Math.abs(seats[i].x - seats[j].x);
        const dy = Math.abs(seats[i].y - seats[j].y);
        const clear = dx + 0.01 >= CARD.w || dy + 0.01 >= CARD.h;
        assert.ok(clear, `${seats[i].id} overlaps ${seats[j].id}`);
      }
    }
  });

  it("is a pure function of the tree and the focused person", () => {
    const once = layoutPersonalMap(fixture, "focus");
    const twice = layoutPersonalMap(structuredClone(fixture), "focus");
    assert.deepEqual(once, twice);
    const nudged: TreeData = {
      ...fixture,
      people: fixture.people.map((item) => (item.id === "focus" ? { ...item, graphX: 4000 } : item)),
    };
    assert.deepEqual(
      layoutPersonalMap(nudged, "focus")?.seats.map((item) => [item.id, item.x, item.y, item.ring]),
      once?.seats.map((item) => [item.id, item.x, item.y, item.ring]),
    );
  });

  it("returns nothing when that person is not on the tree", () => {
    assert.equal(layoutPersonalMap(fixture, "missing"), null);
    assert.equal(layoutPersonalMap({ people: [], unions: [], childLinks: [] }, "focus"), null);
  });

  it("glides each card from the tree layout to the personal map", () => {
    const map = layoutPersonalMap(fixture, "focus")!;
    const from = buildGraph(fixture, "focus");
    const to = graphFromPersonalMap(fixture, map);
    assert.equal(morphGraph(from, to, 1, fixture), to);
    const start = morphGraph(from, to, 0, fixture);
    const focusFrom = from.cards.find((card) => card.id === "focus")!;
    const focusTo = to.cards.find((card) => card.id === "focus")!;
    const focusStart = start.cards.find((card) => card.id === "focus")!;
    assert.equal(focusStart.x, focusFrom.x);
    assert.equal(focusStart.y, focusFrom.y);
    const half = morphGraph(from, to, 0.5, fixture).cards.find((card) => card.id === "focus")!;
    assert.ok(Math.abs(half.x - (focusFrom.x + focusTo.x) / 2) < 1e-6);
    assert.ok(Math.abs(half.y - (focusFrom.y + focusTo.y) / 2) < 1e-6);
    const kid = half && morphGraph(from, to, 0.5, fixture);
    const kidCard = kid.cards.find((card) => card.id === "kid")!;
    const edge = kid.edges.find((item) => item.childId === "kid");
    assert.ok(edge);
    assert.equal(edge.toX, kidCard.x);
    assert.equal(edge.toY, kidCard.y);
  });
});
