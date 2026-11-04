import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARD, buildGraph, type GraphLayout, type LaidArea } from "./layout";
import { bridgePath, superellipsePath } from "./graphView";
import {
  FIXTURE_ADOPTED_SINGLE_PARENT,
  FIXTURE_BOTH_REMARRIED,
  FIXTURE_COPARENTS,
  FIXTURE_REMARRIAGE,
  FIXTURE_SIBLING_HOUSEHOLDS,
  FIXTURE_STEP_PARENT,
  FIXTURE_UNKNOWN_PARENT,
  fxId,
} from "./households.fixtures";
import type { TreeData } from "./types";

const ALL: [string, TreeData][] = [
  ["sibling households", FIXTURE_SIBLING_HOUSEHOLDS],
  ["remarriage", FIXTURE_REMARRIAGE],
  ["both remarried", FIXTURE_BOTH_REMARRIED],
  ["adopted single parent", FIXTURE_ADOPTED_SINGLE_PARENT],
  ["step-parent", FIXTURE_STEP_PARENT],
  ["co-parents", FIXTURE_COPARENTS],
  ["unknown parent", FIXTURE_UNKNOWN_PARENT],
];

function insideArea(area: LaidArea, x: number, y: number): boolean {
  const u = Math.abs((x - area.cx) / area.rx);
  const v = Math.abs((y - area.cy) / area.ry);
  return Math.pow(u, area.n) + Math.pow(v, area.n) <= 1 + 1e-9;
}

function cardCorners(layout: GraphLayout, id: string): [number, number][] {
  const card = layout.cards.find((c) => c.id === id)!;
  const l = card.x - CARD.w / 2;
  const r = card.x + CARD.w / 2;
  return [
    [l, card.y],
    [r, card.y],
    [l, card.y + CARD.h],
    [r, card.y + CARD.h],
  ];
}

function areaFor(layout: GraphLayout, ...names: string[]) {
  const want = names.map(fxId).sort().join("|");
  const area = layout.areas.find((a) => [...a.headIds].sort().join("|") === want);
  assert.ok(area, `no area for ${names.join(" & ")}`);
  return area!;
}

const box = (a: LaidArea) => ({ l: a.cx - a.rx, r: a.cx + a.rx, t: a.cy - a.ry, b: a.cy + a.ry });

describe("household areas in the graph", () => {
  for (const [name, tree] of ALL) {
    it(`${name}: every member sits inside its area and no two areas overlap`, () => {
      const layout = buildGraph(tree, tree.focusPersonId);
      for (const area of layout.areas) {
        for (const id of area.memberIds) {
          for (const [x, y] of cardCorners(layout, id)) {
            assert.ok(insideArea(area, x, y), `${id} pokes out of ${area.label}`);
          }
        }
      }
      for (let i = 0; i < layout.areas.length; i++) {
        for (let j = i + 1; j < layout.areas.length; j++) {
          const a = box(layout.areas[i]);
          const b = box(layout.areas[j]);
          const apart = a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
          assert.ok(apart, `${layout.areas[i].label} overlaps ${layout.areas[j].label}`);
        }
      }
      for (const card of layout.cards) {
        const holders = layout.areas.filter((a) => a.memberIds.includes(card.id));
        assert.ok(holders.length <= 1, `${card.id} is drawn in two areas`);
        for (const other of layout.areas) {
          if (other.memberIds.includes(card.id)) continue;
          assert.ok(!insideArea(other, card.x, card.y + CARD.h / 2), `${card.id} sits inside ${other.label}`);
        }
      }
    });
  }

  it("joins Jon & Lena and Hana & Kit to Carl & Cora with one connector each", () => {
    const tree = FIXTURE_SIBLING_HOUSEHOLDS;
    const layout = buildGraph(tree, tree.focusPersonId);
    const parents = areaFor(layout, "carl", "cora");
    const jonLena = areaFor(layout, "jon", "lena");
    const hanaKit = areaFor(layout, "hana", "kit");
    assert.equal(jonLena.label, "Jon & Lena");
    assert.equal(hanaKit.label, "Hana & Kit", "Hana, the blood sister, sits toward Lena");
    assert.ok(jonLena.isHome);
    const into = (area: LaidArea) => layout.bridges.filter((b) => b.fromAreaId === parents.id && b.toAreaId === area.id);
    assert.equal(into(jonLena).length, 1);
    assert.equal(into(jonLena)[0].personId, fxId("lena"));
    assert.equal(into(hanaKit).length, 1);
    assert.equal(into(hanaKit)[0].personId, fxId("hana"));
    assert.ok(parents.cy < jonLena.cy && parents.cy < hanaKit.cy, "parents' household sits above both");
    assert.ok(box(jonLena).r <= box(hanaKit).l, "sibling households sit side by side");
    const x = (id: string) => layout.cards.find((c) => c.id === fxId(id))!.x;
    assert.ok(x("carl") > x("jon") && x("cora") > x("jon"), "Lena's parents are on Lena's side");
  });

  it("keeps the household couple centred over their children", () => {
    const layout = buildGraph(FIXTURE_SIBLING_HOUSEHOLDS, fxId("jon"));
    const x = (id: string) => layout.cards.find((c) => c.id === fxId(id))!.x;
    const coupleMid = (x("jon") + x("lena")) / 2;
    const kids = ["gus", "ivy", "ned", "otto"].map(x);
    assert.ok(x("jon") < x("lena"));
    assert.ok(Math.abs(coupleMid - (Math.min(...kids) + Math.max(...kids)) / 2) < 1);
    assert.deepEqual(
      ["gus", "ivy", "ned", "otto"].map(x),
      [...kids].sort((a, b) => a - b),
      "children oldest to youngest",
    );
  });

  it("draws no area for a person with no household", () => {
    const layout = buildGraph(FIXTURE_UNKNOWN_PARENT, fxId("parent"));
    assert.ok(!layout.areas.some((a) => a.memberIds.includes(fxId("loner"))));
    assert.ok(layout.cards.some((c) => c.id === fxId("loner")));
  });

  it("runs a cross-household rail in the open lane between areas", () => {
    const layout = buildGraph(FIXTURE_SIBLING_HOUSEHOLDS, fxId("jon"));
    const fork = layout.forks.find((f) => f.childIds.includes(fxId("lena")))!;
    const parents = areaFor(layout, "carl", "cora");
    const jonLena = areaFor(layout, "jon", "lena");
    assert.ok(fork.railY > parents.cy + parents.ry, "rail is below the parents' area");
    assert.ok(fork.railY < jonLena.cy - jonLena.ry, "rail is above the children's areas");
  });
});

describe("area and connector paths", () => {
  it("draws a closed superellipse through its four extremes", () => {
    const d = superellipsePath({ cx: 100, cy: 50, rx: 80, ry: 40, n: 5 });
    assert.match(d, /^M /);
    assert.match(d, /Z$/);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    assert.ok(Math.abs(Math.max(...xs) - 180) < 0.01 && Math.abs(Math.min(...xs) - 20) < 0.01);
    assert.ok(Math.abs(Math.max(...ys) - 90) < 0.01 && Math.abs(Math.min(...ys) - 10) < 0.01);
  });

  it("routes a connector down, across the lane, and down into the person", () => {
    const d = bridgePath({ fromX: 0, fromY: 0, toX: 200, toY: 100 });
    assert.match(d, /^M 0 0/);
    assert.match(d, /200 100$/);
    assert.equal(bridgePath({ fromX: 10, fromY: 0, toX: 10, toY: 80 }), "M 10 0 L 10 80");
  });
});

describe("household sides when a child is in focus", () => {
  it("keeps Lena's parents on Lena's side when looking at one of the children", () => {
    // Jon's parents live in two households (Dan remarried; Ada raises Milo).
    const tree: TreeData = structuredClone(FIXTURE_SIBLING_HOUSEHOLDS);
    const add = (id: string, givenName: string) => tree.people.push({ id: fxId(id), givenName, createdAt: "t", updatedAt: "t" });
    add("dan", "Dan");
    add("rae", "Rae");
    add("ada", "Ada");
    add("milo", "Milo");
    tree.unions.push({ id: "fx-u-jr", partnerIds: ["fx-dan", "fx-rae"], kind: "married" });
    tree.childLinks.push(
      { id: "fx-c-jon", childId: "fx-jon", parentIds: ["fx-dan", "fx-ada"] },
      { id: "fx-c-milo", childId: "fx-milo", parentIds: ["fx-ada"] },
    );
    const layout = buildGraph(tree, fxId("ned"));
    const x = (id: string) => layout.cards.find((c) => c.id === fxId(id))!.x;
    assert.ok(x("jon") < x("lena"));
    const jonSide = Math.max(x("dan"), x("rae"), x("ada"), x("milo"));
    assert.ok(jonSide < Math.min(x("carl"), x("cora")), "Jon's parents left, Lena's parents right");
  });
});
