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
      focusPersonId: "jon",
      people: [
        person("dan", "Dan"),
        person("ada", "Ada"),
        person("carl", "Carl"),
        person("jon", "Jon"),
        person("lena", "Lena"),
        person("pat", "Pat"),
      ],
      unions: [
        { id: "u-ja", partnerIds: ["dan", "ada"], kind: "married" },
        { id: "u-jl", partnerIds: ["jon", "lena"], kind: "partnered" },
      ],
      childLinks: [
        { id: "c-jon", childId: "jon", parentIds: ["dan", "ada"], unionId: "u-ja" },
        { id: "c-lena", childId: "lena", parentIds: ["carl"] },
        { id: "c-carl", childId: "carl", parentIds: ["pat"] },
      ],
    };
    const lanes = buildGenerationLanes(split, "jon");
    const parents = lanes.find((l) => l.id === "parents");
    const jonSide = parents!.groups!.find((g) => g.parentId === "jon");
    const lenaSide = parents!.groups!.find((g) => g.parentId === "lena");
    assert.deepEqual(jonSide?.people.map((p) => p.id).sort(), ["ada", "dan"]);
    assert.equal(jonSide?.label, "Jon's parents");
    assert.equal(jonSide?.coupleBar, true);
    assert.deepEqual(lenaSide?.people.map((p) => p.id), ["carl"]);
    assert.equal(lenaSide?.label, "Lena's parents");
    assert.equal(lenaSide?.coupleBar, false);
    assert.ok(!jonSide?.people.some((p) => p.id === "carl"));
    assert.ok(!lenaSide?.people.some((p) => p.id === "dan" || p.id === "ada"));

    const twoGp: TreeData = {
      ...split,
      people: [...split.people, person("mom", "Mom"), person("dad", "Dad")],
      childLinks: [
        { id: "c-mom", childId: "mom", parentIds: ["dan", "ada"], unionId: "u-ja" },
        { id: "c-dad", childId: "dad", parentIds: ["carl"] },
        { id: "c-jon2", childId: "jon", parentIds: ["mom", "dad"] },
        { id: "c-lena", childId: "lena", parentIds: ["pat"] },
      ],
    };
    const gps = buildGenerationLanes(twoGp, "jon").find((l) => l.id === "grandparents")!.groups!;
    const momGp = gps.find((g) => g.parentId === "mom")!;
    const dadGp = gps.find((g) => g.parentId === "dad")!;
    assert.deepEqual(momGp.people.map((p) => p.id).sort(), ["ada", "dan"]);
    assert.deepEqual(dadGp.people.map((p) => p.id), ["carl"]);
    assert.ok(!momGp.people.some((p) => p.id === "carl"));
    assert.ok(!dadGp.people.some((p) => p.id === "dan"));
    assert.equal(momGp.coupleBar, true);
    assert.equal(dadGp.coupleBar, false);
    assert.equal(momGp.label, "Mom's parents");
  });

  it("shows both partners' grandparents when looking at the household", () => {
    const family: TreeData = {
      focusPersonId: "jon",
      people: [
        person("jon", "Jon"),
        person("lena", "Lena"),
        person("eli", "Eli"),
        person("una", "Una"),
        person("hal", "Hal"),
        person("bob", "Bob"),
        person("sue", "Sue"),
        person("lgp1", "Lgp1"),
        person("lgp2", "Lgp2"),
      ],
      unions: [
        { id: "u-home", partnerIds: ["jon", "lena"], kind: "partnered" },
        { id: "u-gp", partnerIds: ["una", "hal"], kind: "married" },
        { id: "u-l", partnerIds: ["bob", "sue"], kind: "married" },
        { id: "u-lgp", partnerIds: ["lgp1", "lgp2"], kind: "married" },
      ],
      childLinks: [
        { id: "c-j", childId: "jon", parentIds: ["eli"] },
        { id: "c-e", childId: "eli", parentIds: ["una", "hal"], unionId: "u-gp" },
        { id: "c-l", childId: "lena", parentIds: ["bob", "sue"], unionId: "u-l" },
        { id: "c-b", childId: "bob", parentIds: ["lgp1", "lgp2"], unionId: "u-lgp" },
      ],
    };
    const lanes = buildGenerationLanes(family, "jon");
    assert.deepEqual(lanes.map((l) => l.id), ["grandparents", "parents", "focus"]);
    const gps = lanes.find((l) => l.id === "grandparents")!.people.map((p) => p.id).sort();
    assert.deepEqual(gps, ["hal", "lgp1", "lgp2", "una"]);
    const parents = lanes.find((l) => l.id === "parents")!.people.map((p) => p.id).sort();
    assert.deepEqual(parents, ["bob", "eli", "sue"]);
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

  it("does not box two partners of the focus as one family", () => {
    const tree: TreeData = {
      focusPersonId: "ada",
      people: [
        person("una", "Una"),
        person("hal", "Hal"),
        person("ada", "Ada"),
        person("dan", "Dan"),
        person("eli", "Eli"),
        person("jon", "Jon"),
        person("milo", "Milo"),
      ],
      unions: [
        { id: "u-gp", partnerIds: ["una", "hal"], kind: "married" },
        { id: "u-aj", partnerIds: ["ada", "dan"], kind: "married" },
        { id: "u-ae", partnerIds: ["ada", "eli"], kind: "unspecified" },
      ],
      childLinks: [
        { id: "c-a", childId: "ada", parentIds: ["una", "hal"], unionId: "u-gp" },
        { id: "c-jon", childId: "jon", parentIds: ["ada", "eli"], unionId: "u-ae" },
        { id: "c-milo", childId: "milo", parentIds: ["ada", "eli"], unionId: "u-ae" },
      ],
    };
    const lanes = buildGenerationLanes(tree, "ada");
    const family = lanes.find((l) => l.id === "focus")!;
    const boxed = family.groups!.filter((g) => g.coupleBar);
    assert.equal(boxed.length, 1);
    assert.deepEqual(boxed[0].people.map((p) => p.id).sort(), ["ada", "dan"]);
    assert.ok(!boxed[0].people.some((p) => p.id === "eli"));
    const extra = family.groups!.find((g) => g.people.some((p) => p.id === "eli"));
    assert.ok(extra);
    assert.equal(extra!.coupleBar, false);
    assert.deepEqual(extra!.people.map((p) => p.id), ["eli"]);
    const kids = lanes.find((l) => l.id === "children")!;
    assert.ok(kids.groups);
    const withEli = kids.groups!.find((g) => g.label === "With Eli");
    assert.ok(withEli);
    assert.deepEqual(withEli!.people.map((p) => p.givenName).sort(), ["Jon", "Milo"]);
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
