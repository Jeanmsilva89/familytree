import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyFamilyUnitOverride,
  deriveFamilyUnits,
  movesWith,
  unitOfPerson,
  type FamilyUnits,
} from "./familyUnits";
import {
  ALL_FAMILY_UNIT_FIXTURES,
  FIXTURE_COPARENTS,
  FIXTURE_CYCLE,
  FIXTURE_MATERNAL_FAMILY,
  FIXTURE_NO_DAUGHTERS,
  FIXTURE_REMARRIAGE,
  FIXTURE_SAME_SEX,
  FIXTURE_SINGLE_PARENTS,
  FIXTURE_STEP_FAMILY,
  FIXTURE_UNKNOWN,
  fuId,
} from "./familyUnits.fixtures";
import type { TreeData } from "./types";

const ids = (names: string[]) => names.map(fuId).sort();

function membersWith(result: FamilyUnits, name: string): string[] {
  const unit = unitOfPerson(result, fuId(name));
  assert.ok(unit, `${name} should belong to a unit`);
  return [...unit!.memberIds].sort();
}

function sameUnit(result: FamilyUnits, ...names: string[]) {
  assert.deepEqual(membersWith(result, names[0]), ids(names));
}

describe("deriveFamilyUnits invariants (FIXTURE trees)", () => {
  for (const [name, tree] of Object.entries(ALL_FAMILY_UNIT_FIXTURES)) {
    it(`${name}: everyone is in exactly one unit`, () => {
      const result = deriveFamilyUnits(tree);
      const seen = result.units.flatMap((u) => u.memberIds);
      assert.equal(seen.length, tree.people.length);
      assert.deepEqual([...seen].sort(), tree.people.map((p) => p.id).sort());
      for (const person of tree.people) {
        const unit = result.units.find((u) => u.id === result.unitOf[person.id]);
        assert.ok(unit?.memberIds.includes(person.id));
      }
    });

    it(`${name}: pure and deterministic`, () => {
      const before = JSON.stringify(tree);
      const a = deriveFamilyUnits(tree);
      const b = deriveFamilyUnits(structuredClone(tree));
      assert.deepEqual(a, b);
      assert.equal(JSON.stringify(tree), before);
    });

    it(`${name}: links only join people in different units`, () => {
      const result = deriveFamilyUnits(tree);
      for (const link of result.links) {
        assert.notEqual(link.fromUnitId, link.toUnitId);
        assert.equal(result.unitOf[link.fromPersonId], link.fromUnitId);
        assert.equal(result.unitOf[link.toPersonId], link.toUnitId);
      }
    });
  }
});

describe("maternal rule (FIXTURE_MATERNAL_FAMILY)", () => {
  const result = deriveFamilyUnits(FIXTURE_MATERNAL_FAMILY);

  it("daughters stay home; their husbands and children join the mother's family", () => {
    sameUnit(
      result,
      "cora",
      "carl",
      "lena",
      "jon",
      "gk1",
      "gk2",
      "gk3",
      "gk4",
      "hana",
      "kit",
      "cz1",
      "cz2",
      "cz3",
    );
    assert.equal(unitOfPerson(result, fuId("lena"))!.label, "Cora & Carl");
    assert.deepEqual(unitOfPerson(result, fuId("lena"))!.headIds, [fuId("cora"), fuId("carl")]);
  });

  it("a son who marries out joins his wife's unit, even when her parents are not on the tree", () => {
    sameUnit(result, "tess", "joe", "lt1", "lt2");
    assert.equal(unitOfPerson(result, fuId("joe"))!.label, "Tess & Joe");
    assert.deepEqual(result.via[fuId("joe")], { kind: "partner", personId: fuId("tess") });
  });

  it("a son who is not in a couple stays with his own parents", () => {
    sameUnit(result, "grandma", "grandpa", "dad");
    sameUnit(result, "mom");
  });

  it("links run person to person between units, typed by relationship", () => {
    const find = (from: string, to: string) =>
      result.links.find((l) => l.fromPersonId === fuId(from) && l.toPersonId === fuId(to));
    const toDad = find("dad", "jon");
    assert.ok(toDad, "Jon links up to Dad");
    assert.equal(toDad!.kind, "blood");
    assert.equal(toDad!.fromUnitId, result.unitOf[fuId("grandma")]);
    assert.equal(toDad!.toUnitId, result.unitOf[fuId("cora")]);
    assert.equal(find("mom", "jon")?.kind, "blood");
    assert.equal(find("carl", "joe")?.kind, "blood");
    assert.equal(find("cora", "joe")?.kind, "blood");
    // Separated partners are connected through their child, not a partner line.
    assert.ok(!result.links.some((l) => l.kind === "partner"));
    assert.equal(result.links.length, 4);
  });
});

describe("edge cases (FIXTURE trees)", () => {
  it("remarriage: half-siblings follow their own mothers; the step-child stays with hers", () => {
    const result = deriveFamilyUnits(FIXTURE_REMARRIAGE);
    sameUnit(result, "mom", "kid");
    sameUnit(result, "stepmom", "dad", "baby", "stepkid");
    const link = result.links.find((l) => l.toPersonId === fuId("kid"));
    assert.equal(link?.fromPersonId, fuId("dad"));
    assert.equal(link?.kind, "blood");
  });

  it("step and foster: a child follows a blood parent over a step-parent, else the only parent", () => {
    const result = deriveFamilyUnits(FIXTURE_STEP_FAMILY);
    sameUnit(result, "gran", "mom", "stepdad", "child", "hisson", "fosterkid");
    assert.deepEqual(result.via[fuId("child")], { kind: "parent", personId: fuId("mom") });
    assert.deepEqual(result.via[fuId("hisson")], { kind: "parent", personId: fuId("stepdad") });
  });

  it("step links across units keep their kind", () => {
    const tree: TreeData = structuredClone(FIXTURE_REMARRIAGE);
    // FIXTURE edit: move Stepkid to her own unit to expose the step link.
    const result = deriveFamilyUnits(tree, [{ personId: fuId("stepkid"), unitOf: null }]);
    const link = result.links.find((l) => l.toPersonId === fuId("stepkid") && l.fromPersonId === fuId("dad"));
    assert.equal(link?.kind, "step");
  });

  it("divorced co-parents each stay with their own parents; the child goes with the mother", () => {
    const result = deriveFamilyUnits(FIXTURE_COPARENTS);
    sameUnit(result, "anamom", "anadad", "ana", "cy");
    sameUnit(result, "benmom", "bendad", "ben");
  });

  it("unmarried co-parents (unspecified union) are not a couple; each keeps their own unit", () => {
    const result = deriveFamilyUnits(FIXTURE_COPARENTS);
    sameUnit(result, "dee", "fay");
    sameUnit(result, "eli");
    const partner = result.links.find((l) => l.kind === "partner");
    assert.ok(partner, "the recorded union still shows as a partner link");
    assert.deepEqual([partner!.fromPersonId, partner!.toPersonId].sort(), ids(["dee", "eli"]));
  });

  it("single parents: a single father stays with his parents with his child; a single mother roots her own", () => {
    const result = deriveFamilyUnits(FIXTURE_SINGLE_PARENTS);
    sameUnit(result, "solmom", "soldad", "sol", "ray");
    sameUnit(result, "uma", "vic");
    assert.equal(unitOfPerson(result, fuId("uma"))!.label, "Uma");
  });

  it("unknown parents are ignored; a loner gets a unit of one", () => {
    const result = deriveFamilyUnits(FIXTURE_UNKNOWN);
    sameUnit(result, "parent", "kid");
    sameUnit(result, "lone");
  });

  it("unknown sex: the partner whose parents are on the tree anchors the couple", () => {
    const result = deriveFamilyUnits(FIXTURE_UNKNOWN);
    sameUnit(result, "quinnparent", "quinn", "pat");
  });

  it("same-sex couples: the partner with family on the tree anchors; if both do, the first listed", () => {
    const result = deriveFamilyUnits(FIXTURE_SAME_SEX);
    sameUnit(result, "miamom", "mia", "noa", "tot");
    sameUnit(result, "noamom");
    sameUnit(result, "piamom", "pia", "ola", "lil");
  });

  it("no daughter line: sons marry out, the single son stays, a father-only child follows the father", () => {
    const result = deriveFamilyUnits(FIXTURE_NO_DAUGHTERS);
    sameUnit(result, "bea", "al", "dan");
    sameUnit(result, "eve", "cal", "kit");
    sameUnit(result, "hal", "gus");
    assert.equal(unitOfPerson(result, fuId("al"))!.label, "Bea & Al");
  });

  it("broken data with a parent cycle still gives one unit per person", () => {
    const result = deriveFamilyUnits(FIXTURE_CYCLE);
    sameUnit(result, "ouro", "boros");
  });
});

describe("family unit overrides (FIXTURE_MATERNAL_FAMILY)", () => {
  const tree = FIXTURE_MATERNAL_FAMILY;
  const coraUnit = (r: FamilyUnits) => r.unitOf[fuId("cora")];

  it("moving someone who joined their partner's unit brings that household along", () => {
    const result = deriveFamilyUnits(tree, [{ personId: fuId("joe"), unitOf: fuId("cora") }]);
    for (const name of ["joe", "tess", "lt1", "lt2"]) assert.equal(result.unitOf[fuId(name)], coraUnit(result), name);
    assert.equal(unitOfPerson(result, fuId("cora"))!.memberIds.length, 17);
    assert.deepEqual(result.via[fuId("joe")], { kind: "partner", personId: fuId("tess") });
    assert.deepEqual(result.via[fuId("tess")], { kind: "override", personId: fuId("cora"), by: fuId("joe") });
    assert.ok(!result.units.some((u) => u.rootId === fuId("tess")), "the old Tess & Joe unit is gone");
    assert.equal(result.units.flatMap((u) => u.memberIds).length, tree.people.length);
  });

  it("movesWith names the household that would come along", () => {
    assert.deepEqual(movesWith(tree, fuId("joe")).sort(), ids(["tess", "lt1", "lt2"]));
    assert.deepEqual(movesWith(tree, fuId("lt1")).sort(), []);
    assert.deepEqual(movesWith(tree, fuId("hana")).sort(), ids(["kit", "cz1", "cz2", "cz3"]));
  });

  it("the partner's own override wins, so a person can still move alone", () => {
    const result = deriveFamilyUnits(tree, [
      { personId: fuId("tess"), unitOf: null },
      { personId: fuId("joe"), unitOf: fuId("cora") },
    ]);
    assert.equal(result.unitOf[fuId("joe")], coraUnit(result));
    sameUnit(result, "tess", "lt1", "lt2");
    assert.deepEqual(result.via[fuId("joe")], { kind: "override", personId: fuId("cora") });
  });

  it("an own-unit override splits just that person (and those who belong through them)", () => {
    const result = deriveFamilyUnits(tree, [{ personId: fuId("joe"), unitOf: null }]);
    assert.equal(unitOfPerson(result, fuId("joe"))!.label, "Joe");
    sameUnit(result, "tess", "lt1", "lt2");
  });

  it("a household move that would loop through the partner is ignored", () => {
    const bad = { personId: fuId("joe"), unitOf: fuId("lt1") };
    const result = deriveFamilyUnits(tree, [bad]);
    assert.deepEqual(result.ignoredOverrides, [bad]);
  });

  it("an own-unit override takes the people who belong through that person along", () => {
    const result = deriveFamilyUnits(tree, [{ personId: fuId("hana"), unitOf: null }]);
    sameUnit(result, "hana", "kit", "cz1", "cz2", "cz3");
    assert.equal(unitOfPerson(result, fuId("hana"))!.label, "Hana & Kit");
    assert.equal(unitOfPerson(result, fuId("cora"))!.memberIds.length, 8);
  });

  it("an override that would make a loop is ignored and reported", () => {
    const bad = { personId: fuId("cora"), unitOf: fuId("jon") };
    const result = deriveFamilyUnits(tree, [bad]);
    assert.deepEqual(result.ignoredOverrides, [bad]);
    assert.deepEqual(result, { ...deriveFamilyUnits(tree), ignoredOverrides: [bad] });
  });

  it("overrides naming people who are not on the tree are ignored", () => {
    const ghosts = [
      { personId: "fu-fx-ghost", unitOf: fuId("cora") },
      { personId: fuId("joe"), unitOf: "fu-fx-ghost" },
    ];
    const result = deriveFamilyUnits(tree, ghosts);
    assert.deepEqual(result.ignoredOverrides, ghosts);
    sameUnit(result, "tess", "joe", "lt1", "lt2");
  });

  it("reads overrides stored on the tree, and the last one for a person wins", () => {
    const stored: TreeData = {
      ...tree,
      familyUnitOverrides: [
        { personId: fuId("joe"), unitOf: fuId("grandma") },
        { personId: fuId("joe"), unitOf: fuId("cora") },
      ],
    };
    const result = deriveFamilyUnits(stored);
    assert.equal(result.unitOf[fuId("joe")], coraUnit(result));
  });

  it("links follow the redrawn units", () => {
    const result = deriveFamilyUnits(tree, [{ personId: fuId("joe"), unitOf: fuId("cora") }]);
    assert.ok(!result.links.some((l) => [l.toPersonId, l.fromPersonId].includes(fuId("joe"))));
    const alone = deriveFamilyUnits(tree, [
      { personId: fuId("tess"), unitOf: null },
      { personId: fuId("joe"), unitOf: fuId("cora") },
    ]);
    assert.ok(alone.links.some((l) => l.fromPersonId === fuId("joe") && l.toPersonId === fuId("lt1")));
  });

  it("applyFamilyUnitOverride sets, replaces and clears a person's override as pure data", () => {
    const once = applyFamilyUnitOverride(tree, fuId("joe"), { unitOf: fuId("cora") });
    assert.deepEqual(once.familyUnitOverrides, [{ personId: fuId("joe"), unitOf: fuId("cora") }]);
    const twice = applyFamilyUnitOverride(once, fuId("joe"), { unitOf: null });
    assert.deepEqual(twice.familyUnitOverrides, [{ personId: fuId("joe"), unitOf: null }]);
    const cleared = applyFamilyUnitOverride(twice, fuId("joe"), "auto");
    assert.equal(cleared.familyUnitOverrides, undefined);
    assert.equal(tree.familyUnitOverrides, undefined);
  });
});
