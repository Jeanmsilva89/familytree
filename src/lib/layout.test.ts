import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CARD,
  ageLabel,
  buildGraph,
  computeGenerations,
  householdCouple,
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
    assert.equal(linked.has("half"), false);
    assert.equal(linked.has("step"), false);
  });

  it("reads a small age from a birth date", () => {
    assert.equal(ageLabel("2000-01-01", new Date("2026-08-22")), "26");
  });

  it("returns a finite empty graph when there are no people", () => {
    const layout = buildGraph({ people: [], unions: [], childLinks: [] });
    assert.equal(layout.cards.length, 0);
    assert.ok(Number.isFinite(layout.width));
    assert.ok(Number.isFinite(layout.height));
  });

  it("does not overlap cards in the same generation", () => {
    const layout = buildGraph(tree, "focus");
    const byGen = new Map<number, typeof layout.cards>();
    for (const card of layout.cards) {
      const list = byGen.get(card.gen) ?? [];
      list.push(card);
      byGen.set(card.gen, list);
    }
    for (const [gen, row] of byGen) {
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) {
        const dx = row[i].x - row[i - 1].x;
        assert.ok(
          dx + 0.01 >= CARD.w + CARD.coupleGap,
          `${row[i - 1].id} overlaps ${row[i].id} at gen ${gen} (dx=${dx})`,
        );
      }
    }
  });

  it("hangs a sibling's child under that sibling, not on the focus couple", () => {
    const layout = buildGraph(tree, "focus");
    const aunt = layout.cards.find((c) => c.id === "aunt")!;
    const uncleKid = layout.cards.find((c) => c.id === "uncleKid")!;
    const focus = layout.cards.find((c) => c.id === "focus")!;
    assert.equal(uncleKid.gen, aunt.gen - 1);
    assert.ok(Math.abs(uncleKid.x - aunt.x) < Math.abs(uncleKid.x - focus.x));
  });

  it("picks the household couple with the most children", () => {
    const ids = householdCouple(tree, "focus");
    assert.deepEqual(ids, ["focus", "partner"]);
    assert.deepEqual(buildGraph(tree, "focus").householdIds, ["focus", "partner"]);
  });

  it("sits an in-law outside and the blood relative toward the household", () => {
    const split: TreeData = {
      focusPersonId: "jon",
      people: [
        person("jon", "Jon"),
        person("lena", "Lena"),
        person("carl", "Carl"),
        person("joe", "Joe"),
        person("amy", "Amy"),
      ],
      unions: [
        { id: "u-home", partnerIds: ["jon", "lena"], kind: "partnered" },
        { id: "u-joe", partnerIds: ["joe", "amy"], kind: "married" },
      ],
      childLinks: [
        { id: "c-jon", childId: "jon", parentIds: ["carl"] },
        { id: "c-joe", childId: "joe", parentIds: ["carl"] },
      ],
    };
    const layout = buildGraph(split, "jon");
    const jon = layout.cards.find((c) => c.id === "jon")!;
    const lena = layout.cards.find((c) => c.id === "lena")!;
    const joe = layout.cards.find((c) => c.id === "joe")!;
    const amy = layout.cards.find((c) => c.id === "amy")!;
    const mid = (jon.x + lena.x) / 2;
    assert.equal(joe.gen, jon.gen);
    assert.ok(Math.abs(joe.x - mid) < Math.abs(amy.x - mid));
  });

  it("keeps each partner's parents on that partner's side so lines do not cross", () => {
    const family: TreeData = {
      focusPersonId: "jon",
      people: [
        person("jon", "Jon"),
        person("lena", "Lena"),
        person("carl", "Carl"),
        person("mom", "Mom"),
        person("bob", "Bob"),
        person("sue", "Sue"),
        person("kid", "Kid"),
        person("gp1", "Gp1"),
        person("gp2", "Gp2"),
        person("lgp1", "Lgp1"),
        person("lgp2", "Lgp2"),
      ],
      unions: [
        { id: "u-home", partnerIds: ["jon", "lena"], kind: "partnered" },
        { id: "u-j", partnerIds: ["carl", "mom"], kind: "married" },
        { id: "u-l", partnerIds: ["bob", "sue"], kind: "married" },
        { id: "u-gp", partnerIds: ["gp1", "gp2"], kind: "married" },
        { id: "u-lgp", partnerIds: ["lgp1", "lgp2"], kind: "married" },
      ],
      childLinks: [
        { id: "c-k", childId: "kid", parentIds: ["jon", "lena"], unionId: "u-home" },
        { id: "c-j", childId: "jon", parentIds: ["carl", "mom"], unionId: "u-j" },
        { id: "c-l", childId: "lena", parentIds: ["bob", "sue"], unionId: "u-l" },
        { id: "c-m", childId: "mom", parentIds: ["gp1", "gp2"], unionId: "u-gp" },
        { id: "c-b", childId: "bob", parentIds: ["lgp1", "lgp2"], unionId: "u-lgp" },
      ],
    };
    const layout = buildGraph(family, "jon");
    const x = (id: string) => layout.cards.find((c) => c.id === id)!.x;
    assert.ok(x("lena") > x("jon"));
    const jonParents = (x("carl") + x("mom")) / 2;
    const lenaParents = (x("bob") + x("sue")) / 2;
    assert.ok(lenaParents > x("jon"), `Lena's parents (${lenaParents}) should sit right of Jon (${x("jon")})`);
    assert.ok(jonParents < x("lena"), `Jon's parents (${jonParents}) should sit left of Lena (${x("lena")})`);
    assert.ok(lenaParents > jonParents);
    const jonGps = [x("gp1"), x("gp2")].sort((a, b) => a - b);
    const lenaGps = [x("lgp1"), x("lgp2")].sort((a, b) => a - b);
    assert.ok(jonGps[1] < lenaGps[0] + 0.01, "grandparent couples should not interleave");
    for (let i = 0; i < layout.edges.length; i++) {
      for (let j = i + 1; j < layout.edges.length; j++) {
        const a = layout.edges[i];
        const b = layout.edges[j];
        const parentOrder = Math.sign(a.fromX - b.fromX);
        const childOrder = Math.sign(a.toX - b.toX);
        assert.ok(
          parentOrder * childOrder >= 0,
          `${a.childId} and ${b.childId} lines cross (${a.fromX}->${a.toX} vs ${b.fromX}->${b.toX})`,
        );
      }
    }
  });

  it("puts a father above the couple and grandparents above him, families on opposite sides", () => {
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
    const gens = computeGenerations(family, ["jon", "lena"]);
    assert.equal(gens.get("jon"), 0);
    assert.equal(gens.get("lena"), 0);
    assert.equal(gens.get("eli"), 1);
    assert.equal(gens.get("una"), 2);
    assert.equal(gens.get("hal"), 2);
    assert.equal(gens.get("bob"), 1);
    assert.equal(gens.get("lgp1"), 2);

    const layout = buildGraph(family, "jon");
    const card = (id: string) => layout.cards.find((c) => c.id === id)!;
    assert.equal(card("eli").gen, 1);
    assert.equal(card("una").gen, 2);
    assert.equal(card("hal").gen, 2);
    assert.ok(card("una").y < card("eli").y, "grandparents sit above the father");
    assert.ok(card("eli").y < card("jon").y, "father sits above Jon");
    const jonSide = [card("eli").x, card("una").x, card("hal").x];
    const lenaSide = [card("bob").x, card("sue").x, card("lgp1").x, card("lgp2").x];
    assert.ok(Math.max(...jonSide) < Math.min(...lenaSide), "Jon's family stays left of Lena's family");
    assert.ok(card("eli").x < card("lena").x);
    assert.ok((card("bob").x + card("sue").x) / 2 > card("jon").x);
  });

  it("sits a childless married couple together with a visible marriage bar", () => {
    const family: TreeData = {
      focusPersonId: "jon",
      people: [
        person("jon", "Jon"),
        person("lena", "Lena"),
        person("dan", "Dan"),
        person("rae", "Rae"),
      ],
      unions: [
        { id: "u-home", partnerIds: ["jon", "lena"], kind: "partnered" },
        { id: "u-jr", partnerIds: ["dan", "rae"], kind: "married" },
      ],
      childLinks: [],
    };
    const layout = buildGraph(family, "jon");
    const dan = layout.cards.find((c) => c.id === "dan")!;
    const rae = layout.cards.find((c) => c.id === "rae")!;
    assert.equal(dan.gen, rae.gen);
    assert.ok(
      Math.abs(dan.x - rae.x) <= CARD.w + CARD.coupleGap + 0.51,
      `Dan and Rae should sit together (dx=${Math.abs(dan.x - rae.x)})`,
    );
    const couple = layout.couples.find((c) => c.id === "u-jr");
    assert.ok(couple, "childless marriage should still be a couple unit");
    assert.equal(couple?.bar, true);
    assert.equal(couple?.kind, "married");
  });

  it("draws a dotted parent bar when two households share children", () => {
    const family: TreeData = {
      focusPersonId: "tara",
      people: [
        person("ada", "Ada"),
        person("eli", "Eli"),
        person("tara", "Tara"),
        person("iris", "Iris"),
        person("leo", "Leo"),
      ],
      unions: [{ id: "u-split", partnerIds: ["ada", "eli"], kind: "separated" }],
      childLinks: [
        { id: "c-a", childId: "tara", parentIds: ["ada", "eli"], unionId: "u-split" },
        { id: "c-i", childId: "iris", parentIds: ["ada", "eli"], unionId: "u-split" },
        { id: "c-l", childId: "leo", parentIds: ["ada", "eli"], unionId: "u-split" },
      ],
    };
    const layout = buildGraph(family, "tara");
    const fork = layout.forks.find(
      (item) => item.parentIds.includes("ada") && item.parentIds.includes("eli"),
    );
    assert.ok(fork, "shared children should get a parent fork");
    assert.equal(fork?.dotted, true);
    assert.ok((fork?.childIds.length ?? 0) >= 3);
    assert.ok((fork?.joinRight ?? 0) - (fork?.joinLeft ?? 0) > CARD.w);
  });

  it("keeps one couple's kids together instead of mixing them into another sibling row", () => {
    const family: TreeData = {
      focusPersonId: "tara",
      people: [
        person("ada", "Ada"),
        person("eli", "Eli"),
        person("dan", "Dan"),
        person("rae", "Rae"),
        person("tara", "Tara"),
        person("milo", "Milo"),
        person("june", "June"),
        person("iris", "Iris"),
        person("nell", "Nell"),
        person("leo", "Leo"),
      ],
      unions: [
        { id: "u-ae", partnerIds: ["ada", "eli"], kind: "separated" },
        { id: "u-jr", partnerIds: ["dan", "rae"], kind: "married" },
      ],
      childLinks: [
        { id: "c-a", childId: "tara", parentIds: ["ada", "eli"], unionId: "u-ae" },
        { id: "c-j", childId: "milo", parentIds: ["ada", "eli"], unionId: "u-ae" },
        { id: "c-q", childId: "june", parentIds: ["ada", "eli"], unionId: "u-ae" },
        { id: "c-i", childId: "iris", parentIds: ["dan", "rae"], unionId: "u-jr" },
        { id: "c-n", childId: "nell", parentIds: ["dan", "rae"], unionId: "u-jr" },
        { id: "c-l", childId: "leo", parentIds: ["dan", "rae"], unionId: "u-jr" },
      ],
    };
    const layout = buildGraph(family, "tara");
    const x = (id: string) => layout.cards.find((c) => c.id === id)!.x;
    const sibs = ["tara", "milo", "june"].map(x).sort((a, b) => a - b);
    const ros = ["iris", "nell", "leo"].map(x).sort((a, b) => a - b);
    assert.ok(
      ros[2] < sibs[0] - 1 || sibs[2] < ros[0] - 1,
      `Rae's kids (${ros.join(",")}) should not sit inside Ada's siblings (${sibs.join(",")})`,
    );
  });
});

