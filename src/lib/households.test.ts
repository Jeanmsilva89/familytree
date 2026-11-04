import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveHouseholds, householdOfPerson, siblingHouseholds, type Households } from "./households";
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

const ids = (names: string[]) => names.map(fxId).sort();

function homeOf(result: Households, name: string) {
  const household = householdOfPerson(result, fxId(name));
  assert.ok(household, `${name} should belong to a household`);
  return household!;
}

function headedBy(result: Households, ...names: string[]) {
  const want = ids(names).join("|");
  const household = result.households.find((h) => [...h.headIds].sort().join("|") === want);
  assert.ok(household, `expected a household headed by ${names.join(" & ")}`);
  return household!;
}

function assertWellFormed(tree: TreeData, result: Households) {
  const seen = new Map<string, string>();
  for (const household of result.households) {
    assert.ok(household.headIds.length >= 1, `${household.id} needs a head`);
    for (const id of [...household.headIds, ...household.childIds]) {
      assert.ok(tree.people.some((p) => p.id === id), `${id} is not a real person on the tree`);
      assert.ok(!seen.has(id), `${id} is in both ${seen.get(id)} and ${household.id}`);
      seen.set(id, household.id);
    }
  }
  for (const id of result.loose) {
    assert.ok(!seen.has(id), `${id} is loose and housed`);
    seen.set(id, "loose");
  }
  assert.equal(seen.size, tree.people.length, "every person is housed or loose exactly once");
}

describe("deriveHouseholds", () => {
  it("splits Carl & Cora's grown children into their own households, joined by their parents", () => {
    const tree = FIXTURE_SIBLING_HOUSEHOLDS;
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    assert.equal(result.households.length, 4);

    const parents = headedBy(result, "carl", "cora");
    assert.deepEqual(parents.childIds, [], "every child of Carl & Cora has a household of their own");

    const jonLena = headedBy(result, "jon", "lena");
    assert.deepEqual([...jonLena.childIds].sort(), ids(["gus", "ivy", "ned", "otto"]));
    const hanaKit = headedBy(result, "hana", "kit");
    assert.deepEqual([...hanaKit.childIds].sort(), ids(["opal", "wren", "finn"]));
    const joeTess = headedBy(result, "joe", "tess");
    assert.deepEqual([...joeTess.childIds].sort(), ids(["lou", "abe"]));

    const bridge = (person: string) =>
      result.links.find((l) => l.kind === "child" && l.personId === fxId(person));
    assert.equal(bridge("lena")?.fromId, parents.id);
    assert.equal(bridge("lena")?.toId, jonLena.id);
    assert.equal(bridge("hana")?.toId, hanaKit.id);
    assert.equal(bridge("joe")?.toId, joeTess.id);
    assert.equal(bridge("jon"), undefined, "Jon's parents are not on this tree");

    const siblings = siblingHouseholds(result, jonLena.id).map((h) => h.id).sort();
    assert.deepEqual(siblings, [hanaKit.id, joeTess.id].sort());
  });

  it("labels a household by its heads", () => {
    const result = deriveHouseholds(FIXTURE_SIBLING_HOUSEHOLDS);
    assert.equal(headedBy(result, "jon", "lena").label, "Jon & Lena");
    assert.equal(headedBy(result, "carl", "cora").label, "Carl & Cora");
  });

  it("is pure and deterministic", () => {
    const tree = structuredClone(FIXTURE_REMARRIAGE);
    const before = JSON.stringify(tree);
    const a = deriveHouseholds(tree);
    const b = deriveHouseholds(tree);
    assert.equal(JSON.stringify(tree), before, "input tree is not mutated");
    assert.deepEqual(a, b);
  });

  it("remarriage: only the current marriage is a household, the shared child lives there, the ex is linked", () => {
    const tree = FIXTURE_REMARRIAGE;
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const home = headedBy(result, "dad", "stepmom");
    assert.deepEqual([...home.childIds].sort(), ids(["kid", "stepkid", "baby"]));
    assert.equal(result.households.length, 1, "a separated couple is not a household");
    assert.deepEqual(result.loose, [fxId("mom")]);
    const coparent = result.links.find((l) => l.kind === "coparent" && l.personId === fxId("mom"));
    assert.ok(coparent, "Mom stays connected to the household where her child lives");
    assert.equal(coparent?.toId, home.id);
  });

  it("remarriage on both sides: the child has exactly one home and a link from the other", () => {
    const tree = FIXTURE_BOTH_REMARRIED;
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const dads = headedBy(result, "dad", "stepmom");
    const moms = headedBy(result, "mom", "stepdad");
    const home = homeOf(result, "kid");
    assert.ok(home.id === dads.id || home.id === moms.id);
    const other = home.id === dads.id ? moms : dads;
    const link = result.links.find((l) => l.kind === "child" && l.personId === fxId("kid"));
    assert.equal(link?.fromId, other.id);
    assert.equal(link?.toId, home.id);
  });

  it("adopted child with one parent: a single-parent household that still connects when she grows up", () => {
    const tree = FIXTURE_ADOPTED_SINGLE_PARENT;
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const mother = headedBy(result, "mother");
    assert.equal(mother.unionId, undefined);
    assert.equal(mother.label, "Mother");
    assert.deepEqual(mother.childIds, ids(["son"]));
    const grown = headedBy(result, "adoptee", "spouse");
    assert.deepEqual(grown.childIds, ids(["grandkid"]));
    const link = result.links.find((l) => l.personId === fxId("adoptee"));
    assert.equal(link?.fromId, mother.id);
    assert.equal(link?.kin, "adopted");
  });

  it("step-parent: a partner's child from before lives in the couple's household", () => {
    const tree = FIXTURE_STEP_PARENT;
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const home = headedBy(result, "mom", "stepdad");
    assert.deepEqual([...home.childIds].sort(), ids(["child", "stepchild"]));
    assert.equal(result.households.length, 1);
  });

  it("unmarried co-parents: one parent heads the household, the other stays linked", () => {
    const tree = FIXTURE_COPARENTS;
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const home = headedBy(result, "ada");
    assert.deepEqual([...home.childIds].sort(), ids(["milo", "june"]));
    assert.ok(!result.households.some((h) => h.headIds.includes(fxId("eli"))));
    assert.deepEqual(result.loose, [fxId("eli")]);
    assert.ok(result.links.some((l) => l.kind === "coparent" && l.personId === fxId("eli") && l.toId === home.id));
    const grandparents = headedBy(result, "grandma", "grandpa");
    assert.ok(result.links.some((l) => l.kind === "child" && l.personId === fxId("ada") && l.fromId === grandparents.id));
  });

  it("an unmarried co-parent whose parents are on the tree still lives in their parents' household", () => {
    const tree: TreeData = structuredClone(FIXTURE_COPARENTS);
    tree.people.push(
      { id: "fx-elimom", givenName: "Elimom", createdAt: "t", updatedAt: "t" },
    );
    tree.childLinks.push({ id: "fx-c-eli", childId: "fx-eli", parentIds: ["fx-elimom"] });
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    assert.deepEqual(headedBy(result, "elimom").childIds, ids(["eli"]));
    assert.deepEqual(result.loose, []);
  });

  it("unknown parent: a missing parent id is ignored and a person with no relatives is loose", () => {
    const tree = FIXTURE_UNKNOWN_PARENT;
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const home = headedBy(result, "parent");
    assert.deepEqual(home.childIds, ids(["kid"]));
    assert.deepEqual(result.loose, [fxId("loner")]);
    assert.ok(!JSON.stringify(result).includes("fx-missing"));
  });

  it("heads each person in at most one household even with two recorded marriages", () => {
    const tree: TreeData = {
      people: ["a", "b", "c", "k1", "k2"].map((id) => ({ id: `fx-${id}`, givenName: id, createdAt: "t", updatedAt: "t" })),
      unions: [
        { id: "fx-u-ab", partnerIds: ["fx-a", "fx-b"], kind: "married" },
        { id: "fx-u-ac", partnerIds: ["fx-a", "fx-c"], kind: "married" },
      ],
      childLinks: [
        { id: "fx-c1", childId: "fx-k1", parentIds: ["fx-a", "fx-c"] },
        { id: "fx-c2", childId: "fx-k2", parentIds: ["fx-a", "fx-c"] },
      ],
    };
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    assert.deepEqual(headedBy(result, "a", "c").childIds.slice().sort(), ["fx-k1", "fx-k2"]);
    assert.ok(result.links.some((l) => l.kind === "partner" && l.personId === "fx-b"));
  });

  it("returns nothing for an empty tree", () => {
    const result = deriveHouseholds({ people: [], unions: [], childLinks: [] });
    assert.deepEqual(result.households, []);
    assert.deepEqual(result.links, []);
    assert.deepEqual(result.loose, []);
  });
});
