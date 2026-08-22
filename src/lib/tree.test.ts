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
