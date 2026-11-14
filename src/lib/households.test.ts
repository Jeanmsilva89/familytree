import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveFamilyUnits, unitOfPerson } from "./familyUnits";
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
import { treeForLens } from "./layoutSeed";
import type { KinKind, ParentRole, TreeData, UnionKind } from "./types";
import blendedFixture from "../../scripts/fixtures/verify-blended-family.json";

const BLENDED = blendedFixture as TreeData;

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

  it("remarriage: each child follows a line parent, and the ex keeps her own household", () => {
    const tree = FIXTURE_REMARRIAGE;
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const dad = headedBy(result, "dad");
    assert.deepEqual([...dad.childIds].sort(), ids(["baby", "kid"]));
    const stepmom = headedBy(result, "stepmom");
    assert.deepEqual(stepmom.childIds, ids(["stepkid"]));
    const mom = headedBy(result, "mom");
    assert.deepEqual(mom.childIds, []);
    assert.equal(dad.childIds.includes(fxId("stepkid")), false);
    assert.notEqual(dad.id, mom.id);
    assert.notEqual(dad.id, stepmom.id);
    const fromMom = result.links.find((l) => l.kind === "child" && l.personId === fxId("kid") && l.fromId === mom.id);
    assert.equal(fromMom?.toId, dad.id);
  });

  it("remarriage on both sides: the child has exactly one home and a link from the other", () => {
    const tree = FIXTURE_BOTH_REMARRIED;
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const dad = headedBy(result, "dad");
    const mom = headedBy(result, "mom");
    assert.deepEqual(dad.childIds, ids(["kid"]));
    assert.equal(headedBy(result, "stepmom").childIds.includes(fxId("kid")), false);
    assert.equal(headedBy(result, "stepdad").childIds.includes(fxId("kid")), false);
    const link = result.links.find((l) => l.kind === "child" && l.personId === fxId("kid"));
    assert.equal(link?.fromId, mom.id);
    assert.equal(link?.toId, dad.id);
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

  it("step-parent: a partner's child from before lives with that parent, not in the step-parent's household", () => {
    const tree = FIXTURE_STEP_PARENT;
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const home = headedBy(result, "mom");
    assert.deepEqual([...home.childIds].sort(), ids(["child", "stepchild"]));
    const stepdad = headedBy(result, "stepdad");
    assert.deepEqual(stepdad.childIds, []);
    const step = result.links.find((link) => link.kind === "step" && link.personId === fxId("stepchild"));
    assert.equal(step?.fromId, stepdad.id);
    assert.equal(step?.toId, home.id);
  });

  it("step alone does not put the child in the step-parent's household", () => {
    const tree: TreeData = {
      people: ["stu", "mae", "wynn"].map((id) => ({
        id: `fx-${id}`,
        givenName: id,
        familyName: "FIXTURE",
        createdAt: "t",
        updatedAt: "t",
      })),
      unions: [{ id: "fx-u", partnerIds: ["fx-mae", "fx-stu"], kind: "married" }],
      childLinks: [{ id: "fx-c", childId: "fx-wynn", parentIds: ["fx-stu"], kin: { "fx-stu": "step" } }],
    };
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const home = headedBy(result, "mae", "stu");
    assert.deepEqual(home.childIds, []);
    const wynn = homeOf(result, "wynn");
    assert.deepEqual(wynn.headIds, ["fx-wynn"]);
    assert.deepEqual(wynn.childIds, []);
    assert.equal(wynn.label, "Parents unknown");
    assert.equal(wynn.parentsUnknown, true);
    const step = result.links.find((item) => item.kind === "step" && item.personId === "fx-wynn");
    assert.equal(step?.kin, "step");
    assert.equal(step?.toId, wynn.id);
    assert.notEqual(step?.fromId, wynn.id);
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

/**
 * FIXTURE people only. The classic household area and the Families bucket
 * have to place these the same way: blood, adopted, and foster count, and a
 * step link never does.
 */
function honestTree(
  people: string[],
  kids: {
    child: string;
    parents: [string, ParentRole | "", KinKind?][];
    unknownParents?: { role?: ParentRole }[];
  }[],
  unions: [string, string, UnionKind][] = [],
): TreeData {
  return {
    people: people.map((id) => ({
      id: fxId(id),
      givenName: id,
      familyName: "FIXTURE",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    })),
    unions: unions.map(([a, b, kind], index) => ({
      id: `fx-u-${index}-${a}-${b}`,
      partnerIds: [fxId(a), fxId(b)],
      kind,
    })),
    childLinks: kids.map((kid, index) => {
      const roles: Partial<Record<string, ParentRole>> = {};
      const kin: Partial<Record<string, KinKind>> = {};
      for (const [id, role, kind] of kid.parents) {
        if (role) roles[fxId(id)] = role;
        if (kind && kind !== "blood") kin[fxId(id)] = kind;
      }
      return {
        id: `fx-c-${index}-${kid.child}`,
        childId: fxId(kid.child),
        parentIds: kid.parents.map(([id]) => fxId(id)),
        ...(Object.keys(roles).length ? { roles } : {}),
        ...(Object.keys(kin).length ? { kin } : {}),
        ...(kid.unknownParents?.length ? { unknownParents: kid.unknownParents } : {}),
      };
    }),
  };
}

function housed(result: Households, name: string) {
  const household = homeOf(result, name);
  return {
    household,
    ids: [...household.headIds, ...household.childIds],
  };
}

describe("honest household membership (FIXTURE)", () => {
  it("keeps a step-child in their own parent's household, joined by a step link", () => {
    const tree = honestTree(
      ["Mom", "Stepdad", "Earlier"],
      [{ child: "Earlier", parents: [["Mom", "mother"], ["Stepdad", "father", "step"]] }],
      [["Mom", "Stepdad", "partnered"]],
    );
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const earlier = housed(result, "Earlier");
    assert.ok(earlier.ids.includes(fxId("Mom")));
    assert.equal(earlier.ids.includes(fxId("Stepdad")), false);
    const stepdad = housed(result, "Stepdad");
    assert.equal(stepdad.ids.includes(fxId("Earlier")), false);
    assert.notEqual(earlier.household.id, stepdad.household.id);
    const step = result.links.find((link) => link.kind === "step" && link.personId === fxId("Earlier"));
    assert.equal(step?.kin, "step");
    assert.equal(step?.toId, earlier.household.id);
    assert.notEqual(step?.fromId, earlier.household.id);
    const units = deriveFamilyUnits(tree);
    const bucket = unitOfPerson(units, fxId("Earlier"));
    assert.ok(bucket?.memberIds.includes(fxId("Mom")));
    assert.equal(bucket?.memberIds.includes(fxId("Stepdad")), false);
  });

  it("puts half-siblings in their own mother's household", () => {
    const tree = honestTree(
      ["Dad", "Mom", "Stepmom", "Kid", "Baby"],
      [
        { child: "Kid", parents: [["Dad", "father"], ["Mom", "mother"]] },
        { child: "Baby", parents: [["Dad", "father"], ["Stepmom", "mother"]] },
      ],
      [["Dad", "Mom", "divorced"], ["Dad", "Stepmom", "married"]],
    );
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const kid = housed(result, "Kid");
    const baby = housed(result, "Baby");
    assert.ok(kid.ids.includes(fxId("Mom")));
    assert.equal(kid.ids.includes(fxId("Baby")), false);
    assert.equal(kid.ids.includes(fxId("Stepmom")), false);
    assert.ok(baby.ids.includes(fxId("Stepmom")));
    assert.equal(baby.ids.includes(fxId("Kid")), false);
    assert.notEqual(kid.household.id, baby.household.id);
    assert.notEqual(householdOfPerson(result, fxId("Mom"))?.id, householdOfPerson(result, fxId("Stepmom"))?.id);
  });

  it("includes adopted and foster children with that parent, not a later spouse", () => {
    const tree = honestTree(
      ["Ada", "Kit", "Spouse", "Vic", "Foster"],
      [
        { child: "Kit", parents: [["Ada", "mother", "adopted"]] },
        { child: "Foster", parents: [["Vic", "mother", "foster"]] },
      ],
      [["Ada", "Spouse", "married"]],
    );
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const kit = housed(result, "Kit");
    const foster = housed(result, "Foster");
    assert.ok(kit.ids.includes(fxId("Ada")));
    assert.equal(kit.ids.includes(fxId("Spouse")), false);
    assert.ok(foster.ids.includes(fxId("Vic")));
    assert.equal(foster.household.label.includes("Spouse"), false);
  });

  it("keeps a child of two mothers, or two fathers, in that couple's household", () => {
    const mothers = honestTree(
      ["Mia", "Noa", "Tot"],
      [{ child: "Tot", parents: [["Mia", "mother"], ["Noa", "mother"]] }],
      [["Mia", "Noa", "married"]],
    );
    const motherHome = housed(deriveHouseholds(mothers), "Tot");
    assert.deepEqual([...motherHome.household.headIds].sort(), ids(["Mia", "Noa"]));
    assert.deepEqual(motherHome.household.childIds, [fxId("Tot")]);

    const fathers = honestTree(
      ["Leo", "Max", "Tot"],
      [{ child: "Tot", parents: [["Leo", "father"], ["Max", "father"]] }],
      [["Leo", "Max", "married"]],
    );
    const fatherHome = housed(deriveHouseholds(fathers), "Tot");
    assert.deepEqual([...fatherHome.household.headIds].sort(), ids(["Leo", "Max"]));
    assert.deepEqual(fatherHome.household.childIds, [fxId("Tot")]);
  });

  it("keeps a child with one known parent in that parent's household", () => {
    const tree = honestTree(
      ["Dale", "Step", "Kip"],
      [{ child: "Kip", parents: [["Dale", "father"]], unknownParents: [{}] }],
      [["Dale", "Step", "married"]],
    );
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const kip = housed(result, "Kip");
    assert.ok(kip.ids.includes(fxId("Dale")));
    assert.equal(kip.ids.includes(fxId("Step")), false);
    assert.equal(kip.household.label, "Dale");
  });

  it("makes a child with no known parents a household of one, Parents unknown", () => {
    const tree = honestTree(
      ["Mae", "Step", "Pip"],
      [{
        child: "Pip",
        parents: [["Step", "father", "step"]],
        unknownParents: [{ role: "mother" }, { role: "father" }],
      }],
      [["Mae", "Step", "married"]],
    );
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const pip = housed(result, "Pip");
    assert.deepEqual(pip.ids, [fxId("Pip")]);
    assert.equal(pip.household.label, "Parents unknown");
    assert.equal(pip.household.parentsUnknown, true);
    const step = housed(result, "Step");
    assert.equal(step.ids.includes(fxId("Pip")), false);
    const link = result.links.find((item) => item.kind === "step" && item.personId === fxId("Pip"));
    assert.equal(link?.kin, "step");
    assert.equal(link?.toId, pip.household.id);
  });

  it("keeps an ex-partner's household separate after divorce and remarriage", () => {
    const tree = honestTree(
      ["Ada", "Bea", "Cora", "Kit"],
      [{ child: "Kit", parents: [["Ada", "mother"], ["Bea", "mother"]] }],
      [["Ada", "Bea", "divorced"], ["Ada", "Cora", "married"]],
    );
    const result = deriveHouseholds(tree);
    assertWellFormed(tree, result);
    const kit = housed(result, "Kit");
    const bea = housed(result, "Bea");
    assert.equal(kit.ids.includes(fxId("Cora")), false);
    assert.equal(kit.ids.includes(fxId("Bea")), false);
    assert.equal(bea.ids.includes(fxId("Kit")), false);
    assert.equal(bea.ids.includes(fxId("Cora")), false);
    assert.notEqual(bea.household.id, kit.household.id);
    assert.notEqual(bea.household.id, householdOfPerson(result, fxId("Cora"))?.id);
    const units = deriveFamilyUnits(tree);
    assert.notEqual(units.unitOf[fxId("Ada")], units.unitOf[fxId("Bea")]);
    assert.equal(units.unitOf[fxId("Kit")], units.unitOf[fxId("Ada")]);
    assert.notEqual(units.unitOf[fxId("Kit")], units.unitOf[fxId("Cora")]);
  });

  it("places the blended fixture the same way the Families bucket does", () => {
    const result = deriveHouseholds(BLENDED);
    assertWellFormed(BLENDED, result);
    const kip = housed(result, "kip");
    const pip = housed(result, "pip");
    assert.ok(kip.ids.includes(fxId("dale")));
    assert.equal(kip.ids.includes(fxId("step")), false);
    assert.deepEqual(pip.ids, [fxId("pip")]);
    assert.equal(pip.household.label, "Parents unknown");
    const step = result.links.find((link) => link.kind === "step" && link.personId === fxId("pip"));
    assert.equal(step?.kin, "step");
    const units = deriveFamilyUnits(BLENDED);
    assert.equal(units.unitOf[fxId("kip")], units.unitOf[fxId("dale")]);
    assert.notEqual(units.unitOf[fxId("kip")], units.unitOf[fxId("step")]);
    assert.deepEqual(unitOfPerson(units, fxId("pip"))?.memberIds, [fxId("pip")]);
  });

  it("does not change when the people array is reversed", () => {
    const tree = honestTree(
      ["Mom", "Stepdad", "Earlier", "Baby"],
      [
        { child: "Earlier", parents: [["Mom", "mother"], ["Stepdad", "father", "step"]] },
        { child: "Baby", parents: [["Mom", "mother"], ["Stepdad", "father"]] },
      ],
      [["Mom", "Stepdad", "married"]],
    );
    const forward = deriveHouseholds(tree);
    const backward = deriveHouseholds({ ...tree, people: [...tree.people].reverse() });
    assert.deepEqual(forward, backward);
    const again = deriveHouseholds(structuredClone(tree));
    assert.deepEqual(forward, again);
  });

  it("drops a person a visibility lens has hidden, and does not let them shape the rest", () => {
    const visible = new Set(BLENDED.people.map((person) => person.id).filter((id) => id !== fxId("step")));
    const hidden = deriveHouseholds(BLENDED, visible);
    const filtered = deriveHouseholds(treeForLens(BLENDED, visible));
    assert.deepEqual(hidden, filtered);
    const dumped = JSON.stringify(hidden);
    assert.equal(dumped.includes(fxId("step")), false);
    assert.equal(dumped.includes("Step"), false);
    const kip = housed(hidden, "kip");
    assert.ok(kip.ids.includes(fxId("dale")));
    assert.equal(kip.ids.includes(fxId("step")), false);
    const pip = housed(hidden, "pip");
    assert.deepEqual(pip.ids, [fxId("pip")]);
    assert.equal(pip.household.label, "Parents unknown");
    assert.equal(pip.household.parentsUnknown, true);
  });
});
