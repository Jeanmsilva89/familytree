import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addChild, addParent, addPartner, addSibling, addUnlinkedPerson,
  parseTreeJson, serializeTreeJson, startWithName,
} from "./tree";

describe("add paths survive a JSON reload", () => {
  it("keeps parent, partner, child, sibling, and unlinked people", () => {
    let tree = startWithName("Alex");
    const alex = tree.people[0].id;
    tree = addParent(tree, alex, "Pat");
    tree = addPartner(tree, alex, "Jordan");
    const jordan = tree.people.find((p) => p.givenName === "Jordan")!.id;
    tree = addChild(tree, [alex, jordan], "Sam");
    tree = addSibling(tree, alex, "Riley");
    tree = addUnlinkedPerson(tree, "Casey");
    const restored = parseTreeJson(serializeTreeJson(tree));
    const names = restored.people.map((p) => p.givenName).sort();
    assert.deepEqual(names, ["Alex", "Casey", "Jordan", "Pat", "Riley", "Sam"]);
  });
});
