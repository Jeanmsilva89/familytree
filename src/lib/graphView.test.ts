import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  highlightedCoupleIds,
  centerTransform,
  scaleAround,
  pinchCamera,
  coupleTintBox,
  clampScale,
} from "./graphView";
import { CARD, showsCoupleBar } from "./layout";
import type { TreeData } from "./types";

function person(id: string, givenName: string) {
  return {
    id,
    givenName,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

const tree: TreeData = {
  focusPersonId: "focus",
  people: [person("focus", "Focus"), person("partner", "Partner"), person("aunt", "Aunt"), person("dad", "Dad")],
  unions: [
    { id: "u-focus", partnerIds: ["focus", "partner"], kind: "partnered" },
    { id: "u-aunt", partnerIds: ["aunt", "dad"], kind: "unspecified" },
  ],
  childLinks: [],
};

describe("couple highlight and centering", () => {
  it("highlights both partners of a married or partnered unit only", () => {
    const lit = highlightedCoupleIds(tree, "focus");
    assert.ok(lit.has("focus"));
    assert.ok(lit.has("partner"));
    const none = highlightedCoupleIds(tree, "aunt");
    assert.ok(none.has("aunt"));
    assert.equal(none.has("dad"), false);
    assert.equal(showsCoupleBar("unspecified", 2), false);
  });

  it("centers a card in the viewport", () => {
    const view = centerTransform(360, 640, 180, 200, 1);
    assert.equal(view.x, 0);
    assert.equal(view.y, 120);
    assert.equal(view.s, 1);
  });

  it("keeps the point under the pinch still when scaling", () => {
    const view = { x: 40, y: 24, s: 1 };
    const next = scaleAround(view, 180, 320, 2);
    assert.equal(next.s, 2);
    assert.equal(180, next.x + ((180 - 40) / 1) * next.s);
    assert.equal(320, next.y + ((320 - 24) / 1) * next.s);
  });

  it("follows the pinch midpoint if the fingers pan while zooming", () => {
    const start = { x: 40, y: 24, s: 1, dist: 100, midX: 180, midY: 320 };
    const next = pinchCamera(start, 200, 200, 340);
    const worldX = (180 - 40) / 1;
    const worldY = (320 - 24) / 1;
    assert.equal(next.s, 2);
    assert.equal(next.x, 200 - worldX * 2);
    assert.equal(next.y, 340 - worldY * 2);
  });

  it("clamps pinch scale", () => {
    assert.equal(clampScale(8), 2.2);
    assert.equal(clampScale(0.1), 0.45);
  });

  it("boxes a couple around both cards", () => {
    const box = coupleTintBox([
      { x: 100, y: 80 },
      { x: 100 + CARD.w + CARD.coupleGap, y: 80 },
    ]);
    assert.ok(box);
    assert.ok(box.width > CARD.w * 2);
    assert.equal(box.height, CARD.h + 20);
    assert.equal(box.top, 70);
  });
});
