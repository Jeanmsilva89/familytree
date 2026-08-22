import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { highlightedCoupleIds, centerTransform } from "./graphView";
import { showsCoupleBar } from "./layout";
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
});
