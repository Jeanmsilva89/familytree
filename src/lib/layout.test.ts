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
      focusPersonId: "jean",
      people: [
        person("jean", "Jean"),
        person("leah", "Leah"),
        person("craig", "Craig"),
        person("jake", "Jake"),
        person("amy", "Amy"),
      ],
      unions: [
        { id: "u-home", partnerIds: ["jean", "leah"], kind: "partnered" },
        { id: "u-jake", partnerIds: ["jake", "amy"], kind: "married" },
      ],
      childLinks: [
        { id: "c-jean", childId: "jean", parentIds: ["craig"] },
        { id: "c-jake", childId: "jake", parentIds: ["craig"] },
      ],
    };
    const layout = buildGraph(split, "jean");
    const jean = layout.cards.find((c) => c.id === "jean")!;
    const leah = layout.cards.find((c) => c.id === "leah")!;
    const jake = layout.cards.find((c) => c.id === "jake")!;
    const amy = layout.cards.find((c) => c.id === "amy")!;
    const mid = (jean.x + leah.x) / 2;
    assert.equal(jake.gen, jean.gen);
    assert.ok(Math.abs(jake.x - mid) < Math.abs(amy.x - mid));
  });

  it("keeps each partner's parents on that partner's side so lines do not cross", () => {
    const family: TreeData = {
      focusPersonId: "jean",
      people: [
        person("jean", "Jean"),
        person("leah", "Leah"),
        person("craig", "Craig"),
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
        { id: "u-home", partnerIds: ["jean", "leah"], kind: "partnered" },
        { id: "u-j", partnerIds: ["craig", "mom"], kind: "married" },
        { id: "u-l", partnerIds: ["bob", "sue"], kind: "married" },
        { id: "u-gp", partnerIds: ["gp1", "gp2"], kind: "married" },
        { id: "u-lgp", partnerIds: ["lgp1", "lgp2"], kind: "married" },
      ],
      childLinks: [
        { id: "c-k", childId: "kid", parentIds: ["jean", "leah"], unionId: "u-home" },
        { id: "c-j", childId: "jean", parentIds: ["craig", "mom"], unionId: "u-j" },
        { id: "c-l", childId: "leah", parentIds: ["bob", "sue"], unionId: "u-l" },
        { id: "c-m", childId: "mom", parentIds: ["gp1", "gp2"], unionId: "u-gp" },
        { id: "c-b", childId: "bob", parentIds: ["lgp1", "lgp2"], unionId: "u-lgp" },
      ],
    };
    const layout = buildGraph(family, "jean");
    const x = (id: string) => layout.cards.find((c) => c.id === id)!.x;
    assert.ok(x("leah") > x("jean"));
    const jeanParents = (x("craig") + x("mom")) / 2;
    const leahParents = (x("bob") + x("sue")) / 2;
    assert.ok(leahParents > x("jean"), `Leah's parents (${leahParents}) should sit right of Jean (${x("jean")})`);
    assert.ok(jeanParents < x("leah"), `Jean's parents (${jeanParents}) should sit left of Leah (${x("leah")})`);
    assert.ok(leahParents > jeanParents);
    const jeanGps = [x("gp1"), x("gp2")].sort((a, b) => a - b);
    const leahGps = [x("lgp1"), x("lgp2")].sort((a, b) => a - b);
    assert.ok(jeanGps[1] < leahGps[0] + 0.01, "grandparent couples should not interleave");
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
    const gens = computeGenerations(family, ["jean", "leah"]);
    assert.equal(gens.get("jean"), 0);
    assert.equal(gens.get("leah"), 0);
    assert.equal(gens.get("edson"), 1);
    assert.equal(gens.get("eunice"), 2);
    assert.equal(gens.get("jacyron"), 2);
    assert.equal(gens.get("bob"), 1);
    assert.equal(gens.get("lgp1"), 2);

    const layout = buildGraph(family, "jean");
    const card = (id: string) => layout.cards.find((c) => c.id === id)!;
    assert.equal(card("edson").gen, 1);
    assert.equal(card("eunice").gen, 2);
    assert.equal(card("jacyron").gen, 2);
    assert.ok(card("eunice").y < card("edson").y, "grandparents sit above the father");
    assert.ok(card("edson").y < card("jean").y, "father sits above Jean");
    const jeanSide = [card("edson").x, card("eunice").x, card("jacyron").x];
    const leahSide = [card("bob").x, card("sue").x, card("lgp1").x, card("lgp2").x];
    assert.ok(Math.max(...jeanSide) < Math.min(...leahSide), "Jean's family stays left of Leah's family");
    assert.ok(card("edson").x < card("leah").x);
    assert.ok((card("bob").x + card("sue").x) / 2 > card("jean").x);
  });

  it("sits a childless married couple together with a visible marriage bar", () => {
    const family: TreeData = {
      focusPersonId: "jean",
      people: [
        person("jean", "Jean"),
        person("leah", "Leah"),
        person("jay", "Jay"),
        person("rosana", "Rosana"),
      ],
      unions: [
        { id: "u-home", partnerIds: ["jean", "leah"], kind: "partnered" },
        { id: "u-jr", partnerIds: ["jay", "rosana"], kind: "married" },
      ],
      childLinks: [],
    };
    const layout = buildGraph(family, "jean");
    const jay = layout.cards.find((c) => c.id === "jay")!;
    const rosana = layout.cards.find((c) => c.id === "rosana")!;
    assert.equal(jay.gen, rosana.gen);
    assert.ok(
      Math.abs(jay.x - rosana.x) <= CARD.w + CARD.coupleGap + 0.51,
      `Jay and Rosana should sit together (dx=${Math.abs(jay.x - rosana.x)})`,
    );
    const couple = layout.couples.find((c) => c.id === "u-jr");
    assert.ok(couple, "childless marriage should still be a couple unit");
    assert.equal(couple?.bar, true);
    assert.equal(couple?.kind, "married");
  });
});

