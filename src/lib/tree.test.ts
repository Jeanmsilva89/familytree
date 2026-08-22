import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addChild,
  addParent,
  addPartner,
  getPerson,
  parentsOf,
  removePerson,
  startWithName,
  updatePerson,
  addSibling,
  addUnlinkedPerson,
  linkExisting,
  parseTreeJson,
  serializeTreeJson,
  setFocus,
  setUnionKind,
} from "./tree";

describe("tree mutations", () => {
  it("starts with one name", () => {
    const tree = startWithName("Alex");
    assert.equal(tree.people.length, 1);
    assert.equal(tree.people[0].givenName, "Alex");
    assert.equal(tree.focusPersonId, tree.people[0].id);
    assert.equal(tree.unions.length, 0);
  });

  it("rejects a blank name", () => {
    assert.throws(() => startWithName("   "), /required/);
  });

  it("adds a partner as a couple unit", () => {
    let tree = startWithName("Alex");
    tree = addPartner(tree, tree.people[0].id, "Jordan");
    assert.equal(tree.people.length, 2);
    assert.equal(tree.unions.length, 1);
    assert.deepEqual(tree.unions[0].partnerIds.slice().sort(), tree.people.map((p) => p.id).sort());
  });

  it("adds a child under a couple", () => {
    let tree = startWithName("Alex");
    const alex = tree.people[0].id;
    tree = addPartner(tree, alex, "Jordan");
    const jordan = tree.people.find((p) => p.givenName === "Jordan")!.id;
    tree = addChild(tree, [alex, jordan], "Sam");
    assert.equal(tree.people.length, 3);
    assert.equal(tree.childLinks.length, 1);
    assert.equal(tree.childLinks[0].childId, tree.people.find((p) => p.givenName === "Sam")!.id);
    assert.equal(tree.childLinks[0].unionId, tree.unions[0].id);
  });

  it("adds a child to a single parent", () => {
    let tree = startWithName("Alex");
    tree = addChild(tree, [tree.people[0].id], "Riley");
    assert.equal(tree.childLinks[0].parentIds.length, 1);
    assert.equal(parentsOf(tree, tree.people.find((p) => p.givenName === "Riley")!.id)[0].givenName, "Alex");
  });

  it("adds a parent and pairs them when one already exists", () => {
    let tree = startWithName("Sam");
    const sam = tree.people[0].id;
    tree = addParent(tree, sam, "Alex");
    tree = addParent(tree, sam, "Jordan");
    const parents = parentsOf(tree, sam).map((p) => p.givenName).sort();
    assert.deepEqual(parents, ["Alex", "Jordan"]);
    assert.equal(tree.unions.length, 1);
  });

  it("updates optional bio and dates", () => {
    let tree = startWithName("Alex");
    const id = tree.people[0].id;
    tree = updatePerson(tree, id, { bio: "Loves pancakes", birthDate: "1990-05-01" });
    const person = getPerson(tree, id)!;
    assert.equal(person.bio, "Loves pancakes");
    assert.equal(person.birthDate, "1990-05-01");
  });

  it("removes a person and dangling links", () => {
    let tree = startWithName("Alex");
    tree = addPartner(tree, tree.people[0].id, "Jordan");
    const jordan = tree.people.find((p) => p.givenName === "Jordan")!.id;
    tree = removePerson(tree, jordan);
    assert.equal(tree.people.length, 1);
    assert.equal(tree.unions.length, 1);
    assert.equal(tree.unions[0].partnerIds.length, 1);
  });
});

describe("self-serve mutations", () => {
  it("adds a sibling under existing parents", () => {
    let tree = startWithName("Sam");
    const sam = tree.people[0].id;
    tree = addParent(tree, sam, "Alex");
    tree = addSibling(tree, sam, "Riley");
    const riley = tree.people.find((p) => p.givenName === "Riley")!;
    assert.equal(parentsOf(tree, riley.id)[0].givenName, "Alex");
    assert.equal(tree.childLinks.length, 2);
  });

  it("refuses a sibling when there are no parents", () => {
    const tree = startWithName("Sam");
    assert.throws(() => addSibling(tree, tree.people[0].id, "Riley"), /Add a parent first/);
  });

  it("adds an unlinked person", () => {
    let tree = startWithName("Alex");
    tree = addUnlinkedPerson(tree, "Casey");
    assert.equal(tree.people.length, 2);
    assert.equal(tree.unions.length, 0);
    assert.equal(tree.childLinks.length, 0);
  });

  it("links an existing person as partner, parent, and child", () => {
    let tree = startWithName("Alex");
    const alex = tree.people[0].id;
    tree = addUnlinkedPerson(tree, "Jordan");
    const jordan = tree.people.find((p) => p.givenName === "Jordan")!.id;
    tree = linkExisting(tree, alex, jordan, "partner", "married");
    assert.equal(tree.unions.length, 1);
    assert.equal(tree.unions[0].kind, "married");

    tree = addUnlinkedPerson(tree, "Pat");
    const pat = tree.people.find((p) => p.givenName === "Pat")!.id;
    tree = linkExisting(tree, alex, pat, "parent");
    assert.equal(parentsOf(tree, alex)[0].givenName, "Pat");

    tree = addUnlinkedPerson(tree, "Sam");
    const sam = tree.people.find((p) => p.givenName === "Sam")!.id;
    tree = linkExisting(tree, alex, sam, "child");
    assert.equal(tree.childLinks.some((l) => l.childId === sam), true);
  });

  it("round-trips JSON backup", () => {
    let tree = startWithName("Alex");
    tree = addPartner(tree, tree.people[0].id, "Jordan");
    const text = serializeTreeJson(tree);
    const restored = parseTreeJson(text);
    assert.equal(restored.people.length, 2);
    assert.equal(restored.unions.length, 1);
    assert.equal(restored.focusPersonId, tree.focusPersonId);
    assert.throws(() => parseTreeJson("{not json"), /backup/);
    assert.throws(() => parseTreeJson("{}"), /backup/);
  });

  it("sets union kind and persists focus", () => {
    let tree = startWithName("Alex");
    tree = addPartner(tree, tree.people[0].id, "Jordan");
    tree = setUnionKind(tree, tree.unions[0].id, "married");
    assert.equal(tree.unions[0].kind, "married");
    const jordan = tree.people.find((p) => p.givenName === "Jordan")!.id;
    tree = setFocus(tree, jordan);
    assert.equal(tree.focusPersonId, jordan);
  });
});
