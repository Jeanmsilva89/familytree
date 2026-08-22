import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ageLabel,
  buildGraph,
  kidClusterCenters,
  lineageIds,
  showsCoupleBar,
} from "./layout";
import type { TreeData } from "./types";

function person(id: string, givenName: string, extras: Record<string, string> = {}) {
  return {
    id,
    givenName,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...extras,
  };
}

const tree: TreeData = {
  focusPersonId: "focus",
  people: [
    person("focus", "Focus"),
    person("partner", "Partner"),
    person("kidA", "KidA"),
    person("kidB", "KidB"),
    person("half", "Half"),
    person("step", "Step"),
    person("mom", "Mom"),
    person("dad", "Dad"),
    person("stepdad", "Stepdad"),
    person("cousin", "Cousin"),
    person("aunt", "Aunt"),
    person("uncleKid", "UncleKid"),
  ],
  unions: [
    { id: "u-focus", partnerIds: ["focus", "partner"], kind: "partnered" },
    { id: "u-parents", partnerIds: ["mom", "dad"], kind: "married" },
    { id: "u-mom-step", partnerIds: ["mom", "stepdad"], kind: "partnered" },
    { id: "u-aunt", partnerIds: ["aunt", "dad"], kind: "unspecified" },
  ],
  childLinks: [
    { id: "c1", childId: "focus", parentIds: ["mom", "dad"], unionId: "u-parents" },
    { id: "c2", childId: "kidA", parentIds: ["focus", "partner"], unionId: "u-focus" },
    { id: "c3", childId: "kidB", parentIds: ["focus", "partner"], unionId: "u-focus" },
    { id: "c4", childId: "half", parentIds: ["mom"], unionId: undefined },
    { id: "c5", childId: "step", parentIds: ["stepdad"], unionId: undefined },
    { id: "c6", childId: "uncleKid", parentIds: ["aunt"], unionId: undefined },
  ],
};

describe("graph layout", () => {
  it("clusters kids under the couple that produced them", () => {
    const layout = buildGraph(tree, "focus");
    const [cluster] = kidClusterCenters(layout, tree).filter((c) => c.unionId === "u-focus");
    assert.ok(cluster);
    assert.equal(cluster.kids.length, 2);
    assert.ok(Math.abs(cluster.parentMid - cluster.kidMid) < 40);
  });

  it("keeps half-siblings closer to the focus than step-siblings", () => {
    const layout = buildGraph(tree, "focus");
    const focus = layout.cards.find((c) => c.id === "focus")!;
    const half = layout.cards.find((c) => c.id === "half")!;
    const step = layout.cards.find((c) => c.id === "step")!;
    assert.ok(Math.abs(half.x - focus.x) < Math.abs(step.x - focus.x));
    assert.equal(half.gen, 0);
    assert.equal(step.gen, 0);
  });

  it("does not fake a marriage bar for unspecified unions", () => {
    assert.equal(showsCoupleBar("unspecified", 2), false);
    assert.equal(showsCoupleBar("partnered", 2), true);
    assert.equal(showsCoupleBar("married", 1), false);
    const layout = buildGraph(tree, "focus");
    const auntUnion = layout.couples.find((c) => c.id === "u-aunt");
    assert.equal(auntUnion?.bar, false);
  });

  it("highlights partner, parents, and children — not a cousin", () => {
    const linked = lineageIds(tree, "focus");
    assert.ok(linked.has("partner"));
    assert.ok(linked.has("mom"));
    assert.ok(linked.has("dad"));
    assert.ok(linked.has("kidA"));
    assert.equal(linked.has("uncleKid"), false);
  });

  it("reads a small age from a birth date", () => {
    assert.equal(ageLabel("2000-01-01", new Date("2026-08-22")), "26");
  });
});
