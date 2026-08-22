import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, CARD } from "./layout";
import { buildGenerationLanes } from "./generations";
import type { TreeData } from "./types";

function person(id: string, givenName: string) {
  return {
    id,
    givenName,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

const fiveGen: TreeData = {
  focusPersonId: "focus",
  people: [
    person("gm", "Grandma"),
    person("gf", "Grandpa"),
    person("mom", "Mom"),
    person("dad", "Dad"),
    person("focus", "Focus"),
    person("partner", "Partner"),
    person("kid", "Kid"),
    person("gk", "Grandkid"),
  ],
  unions: [
    { id: "u-gp", partnerIds: ["gm", "gf"], kind: "married" },
    { id: "u-par", partnerIds: ["mom", "dad"], kind: "married" },
    { id: "u-f", partnerIds: ["focus", "partner"], kind: "partnered" },
    { id: "u-k", partnerIds: ["kid"], kind: "unspecified" },
  ],
  childLinks: [
    { id: "c-mom", childId: "mom", parentIds: ["gm", "gf"], unionId: "u-gp" },
    { id: "c-f", childId: "focus", parentIds: ["mom", "dad"], unionId: "u-par" },
    { id: "c-k", childId: "kid", parentIds: ["focus", "partner"], unionId: "u-f" },
    { id: "c-gk", childId: "gk", parentIds: ["kid"] },
  ],
};

describe("generation lanes", () => {
  it("shows five lanes from grandparents through grandkids", () => {
    const lanes = buildGenerationLanes(fiveGen, "focus");
    assert.deepEqual(lanes.map((l) => l.id), [
      "grandparents",
      "parents",
      "focus",
      "children",
      "grandchildren",
    ]);
    assert.deepEqual(lanes.find((l) => l.id === "grandparents")?.people.map((p) => p.id).sort(), ["gf", "gm"]);
    assert.deepEqual(lanes.find((l) => l.id === "parents")?.people.map((p) => p.id).sort(), ["dad", "mom"]);
    assert.deepEqual(lanes.find((l) => l.id === "focus")?.people.map((p) => p.id), ["focus", "partner"]);
    assert.equal(lanes.find((l) => l.id === "focus")?.coupleBar, true);
    assert.deepEqual(lanes.find((l) => l.id === "children")?.people.map((p) => p.id), ["kid"]);
    const gk = lanes.find((l) => l.id === "grandchildren");
    assert.equal(gk?.groups?.[0]?.parentId, "kid");
    assert.deepEqual(gk?.people.map((p) => p.id), ["gk"]);
  });
});

describe("five-generation graph", () => {
  it("places grandparents through grandkids with finite, non-overlapping cards", () => {
    const layout = buildGraph(fiveGen, "focus");
    const need = ["gm", "gf", "mom", "dad", "focus", "partner", "kid", "gk"];
    for (const id of need) {
      const card = layout.cards.find((c) => c.id === id);
      assert.ok(card, `missing ${id}`);
      assert.ok(Number.isFinite(card!.x));
      assert.ok(Number.isFinite(card!.y));
    }
    assert.ok(Number.isFinite(layout.width));
    assert.ok(Number.isFinite(layout.height));
    const gens = new Map<number, typeof layout.cards>();
    for (const card of layout.cards) {
      const list = gens.get(card.gen) ?? [];
      list.push(card);
      gens.set(card.gen, list);
    }
    for (const [, cards] of gens) {
      const sorted = [...cards].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i].x - sorted[i - 1].x >= CARD.w + CARD.gap - 0.01);
      }
    }
    assert.equal(layout.cards.find((c) => c.id === "gm")?.gen, 2);
    assert.equal(layout.cards.find((c) => c.id === "mom")?.gen, 1);
    assert.equal(layout.cards.find((c) => c.id === "focus")?.gen, 0);
    assert.equal(layout.cards.find((c) => c.id === "kid")?.gen, -1);
    assert.equal(layout.cards.find((c) => c.id === "gk")?.gen, -2);
  });
});
