import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, CARD } from "./layout";
import { buildGenerationLanes } from "./generations";
import type { TreeData } from "./types";
import { addChild, addParent, addSibling, setFocus, startWithName } from "./tree";

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
    assert.equal(gk?.groups?.[0]?.label, "Kid's");
    assert.deepEqual(gk?.people.map((p) => p.id), ["gk"]);
  });

  it("keeps grandparents of parent A off parent B's side", () => {
    const split: TreeData = {
      focusPersonId: "jean",
      people: [
        person("jay", "Jay"),
        person("andreia", "Andreia"),
        person("craig", "Craig"),
        person("jean", "Jean"),
        person("leah", "Leah"),
        person("pat", "Pat"),
      ],
      unions: [
        { id: "u-ja", partnerIds: ["jay", "andreia"], kind: "married" },
        { id: "u-jl", partnerIds: ["jean", "leah"], kind: "partnered" },
      ],
      childLinks: [
        { id: "c-jean", childId: "jean", parentIds: ["jay", "andreia"], unionId: "u-ja" },
        { id: "c-leah", childId: "leah", parentIds: ["craig"] },
        { id: "c-craig", childId: "craig", parentIds: ["pat"] },
      ],
    };
    const lanes = buildGenerationLanes(split, "jean");
    const parents = lanes.find((l) => l.id === "parents");
    const jeanSide = parents!.groups!.find((g) => g.parentId === "jean");
    const leahSide = parents!.groups!.find((g) => g.parentId === "leah");
    assert.deepEqual(jeanSide?.people.map((p) => p.id).sort(), ["andreia", "jay"]);
    assert.equal(jeanSide?.label, "Jean's parents");
    assert.equal(jeanSide?.coupleBar, true);
    assert.deepEqual(leahSide?.people.map((p) => p.id), ["craig"]);
    assert.equal(leahSide?.label, "Leah's parents");
    assert.equal(leahSide?.coupleBar, false);
    assert.ok(!jeanSide?.people.some((p) => p.id === "craig"));
    assert.ok(!leahSide?.people.some((p) => p.id === "jay" || p.id === "andreia"));

    const twoGp: TreeData = {
      ...split,
      people: [...split.people, person("mom", "Mom"), person("dad", "Dad")],
      childLinks: [
        { id: "c-mom", childId: "mom", parentIds: ["jay", "andreia"], unionId: "u-ja" },
        { id: "c-dad", childId: "dad", parentIds: ["craig"] },
        { id: "c-jean2", childId: "jean", parentIds: ["mom", "dad"] },
        { id: "c-leah", childId: "leah", parentIds: ["pat"] },
      ],
    };
    const gps = buildGenerationLanes(twoGp, "jean").find((l) => l.id === "grandparents")!.groups!;
    const momGp = gps.find((g) => g.parentId === "mom")!;
    const dadGp = gps.find((g) => g.parentId === "dad")!;
    assert.deepEqual(momGp.people.map((p) => p.id).sort(), ["andreia", "jay"]);
    assert.deepEqual(dadGp.people.map((p) => p.id), ["craig"]);
    assert.ok(!momGp.people.some((p) => p.id === "craig"));
    assert.ok(!dadGp.people.some((p) => p.id === "jay"));
    assert.equal(momGp.coupleBar, true);
    assert.equal(dadGp.coupleBar, false);
    assert.equal(momGp.label, "Mom's parents");
  });

  it("shows both partners' grandparents when looking at the household", () => {
    const family: TreeData = {
      focusPersonId: "jean",
      people: [
        person("jean", "Jean"),
        person("leah", "Leah"),
        person("edson", "Edson"),
        person("eunice", "Eunice"),
        person("jacyron", "Jacyron"),
        person("bob", "Bob"),
        person("sue", "Sue"),
        person("lgp1", "Lgp1"),
        person("lgp2", "Lgp2"),
      ],
      unions: [
        { id: "u-home", partnerIds: ["jean", "leah"], kind: "partnered" },
        { id: "u-gp", partnerIds: ["eunice", "jacyron"], kind: "married" },
        { id: "u-l", partnerIds: ["bob", "sue"], kind: "married" },
        { id: "u-lgp", partnerIds: ["lgp1", "lgp2"], kind: "married" },
      ],
      childLinks: [
        { id: "c-j", childId: "jean", parentIds: ["edson"] },
        { id: "c-e", childId: "edson", parentIds: ["eunice", "jacyron"], unionId: "u-gp" },
        { id: "c-l", childId: "leah", parentIds: ["bob", "sue"], unionId: "u-l" },
        { id: "c-b", childId: "bob", parentIds: ["lgp1", "lgp2"], unionId: "u-lgp" },
      ],
    };
    const lanes = buildGenerationLanes(family, "jean");
    assert.deepEqual(lanes.map((l) => l.id), ["grandparents", "parents", "focus"]);
    const gps = lanes.find((l) => l.id === "grandparents")!.people.map((p) => p.id).sort();
    assert.deepEqual(gps, ["eunice", "jacyron", "lgp1", "lgp2"]);
    const parents = lanes.find((l) => l.id === "parents")!.people.map((p) => p.id).sort();
    assert.deepEqual(parents, ["bob", "edson", "sue"]);
  });

  it("shows siblings of the focus on the focus generation, not among kids", () => {
    let tree = startWithName("Sam");
    const sam = tree.people[0].id;
    tree = addParent(tree, sam, "Alex");
    tree = addSibling(tree, sam, "Riley");
    const riley = tree.people.find((p) => p.givenName === "Riley")!;
    const lanes = buildGenerationLanes(tree, sam);
    const focusLane = lanes.find((l) => l.id === "focus")!;
    assert.ok(focusLane.people.some((p) => p.id === riley.id));
    assert.ok(focusLane.groups?.some((g) => g.people.some((p) => p.id === riley.id)));
    const kids = lanes.find((l) => l.id === "children");
    assert.ok(!kids?.people.some((p) => p.id === riley.id));
  });

  it("puts a sibling of a focused child in the children row when viewing a parent", () => {
    let tree = startWithName("Alex");
    const alex = tree.people[0].id;
    tree = addChild(tree, [alex], "Sam");
    const sam = tree.people.find((p) => p.givenName === "Sam")!.id;
    tree = setFocus(tree, sam);
    tree = addSibling(tree, sam, "Riley");
    const riley = tree.people.find((p) => p.givenName === "Riley")!;
    const asChild = buildGenerationLanes(tree, sam);
    assert.ok(asChild.find((l) => l.id === "focus")?.people.some((p) => p.id === riley.id));
    const asParent = buildGenerationLanes(tree, alex);
    assert.ok(asParent.find((l) => l.id === "children")?.people.some((p) => p.id === sam));
    assert.ok(asParent.find((l) => l.id === "children")?.people.some((p) => p.id === riley.id));
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
    const gens = new Map<number, typeof layout.cards>();
    for (const card of layout.cards) {
      const list = gens.get(card.gen) ?? [];
      list.push(card);
      gens.set(card.gen, list);
    }
    for (const [, cards] of gens) {
      const sorted = [...cards].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(
          sorted[i].x - sorted[i - 1].x >= CARD.w + CARD.coupleGap - 0.01,
          `${sorted[i - 1].id} overlaps ${sorted[i].id} (dx=${sorted[i].x - sorted[i - 1].x})`,
        );
      }
    }
    assert.equal(layout.cards.find((c) => c.id === "gm")?.gen, 2);
    assert.equal(layout.cards.find((c) => c.id === "mom")?.gen, 1);
    assert.equal(layout.cards.find((c) => c.id === "focus")?.gen, 0);
    assert.equal(layout.cards.find((c) => c.id === "kid")?.gen, -1);
    assert.equal(layout.cards.find((c) => c.id === "gk")?.gen, -2);
  });
});
