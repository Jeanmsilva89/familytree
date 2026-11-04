import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGedcom, serializeGedcom } from "./gedcom";
import { parseTreeJson, removePerson, serializeTreeJson } from "./tree";
import { deriveFamilyUnits, applyFamilyUnitOverride } from "./familyUnits";
import { FIXTURE_MATERNAL_FAMILY, fuId } from "./familyUnits.fixtures";

const byName = (tree: { people: { id: string; givenName: string }[] }, name: string) =>
  tree.people.find((p) => p.givenName === name)!.id;

/** FIXTURE GEDCOM: HUSB/WIFE tell us who is the mother, as GEDCOM 5.5.1 does. */
const FIXTURE_GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Mother /FIXTURE/
0 @I2@ INDI
1 NAME Father /FIXTURE/
0 @I3@ INDI
1 NAME Daughter /FIXTURE/
0 @I4@ INDI
1 NAME Husband /FIXTURE/
0 @I5@ INDI
1 NAME Solo /FIXTURE/
0 @I6@ INDI
1 NAME Adoptee /FIXTURE/
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 CHIL @I3@
1 MARR
0 @F2@ FAM
1 HUSB @I4@
1 WIFE @I3@
1 MARR
0 @F3@ FAM
1 WIFE @I5@
1 CHIL @I6@
2 PEDI adopted
0 TRLR
`;

describe("family units survive import and export", () => {
  it("GEDCOM HUSB/WIFE become father/mother roles, so the maternal rule applies", () => {
    const tree = parseGedcom(FIXTURE_GED);
    const link = tree.childLinks.find((l) => l.childId === byName(tree, "Daughter"))!;
    assert.equal(link.roles?.[byName(tree, "Mother")], "mother");
    assert.equal(link.roles?.[byName(tree, "Father")], "father");
    const solo = tree.childLinks.find((l) => l.childId === byName(tree, "Adoptee"))!;
    assert.equal(solo.roles?.[byName(tree, "Solo")], "mother");
    const units = deriveFamilyUnits(tree);
    const home = units.unitOf[byName(tree, "Mother")];
    assert.equal(units.unitOf[byName(tree, "Husband")], home);
    assert.equal(units.units.find((u) => u.id === home)!.label, "Mother & Father");
  });

  it("GEDCOM export writes the mother as WIFE and round-trips roles", () => {
    const text = serializeGedcom(FIXTURE_MATERNAL_FAMILY);
    const back = parseGedcom(text);
    const a = deriveFamilyUnits(FIXTURE_MATERNAL_FAMILY);
    const b = deriveFamilyUnits(back);
    const shape = (r: typeof a, names: { id: string; givenName: string }[]) =>
      r.units.map((u) => u.memberIds.map((id) => names.find((p) => p.id === id)!.givenName).sort().join(",")).sort();
    assert.deepEqual(shape(b, back.people), shape(a, FIXTURE_MATERNAL_FAMILY.people));
  });

  it("GEDCOM export and import keep family-unit overrides", () => {
    let tree = applyFamilyUnitOverride(FIXTURE_MATERNAL_FAMILY, fuId("joe"), { unitOf: fuId("cora") });
    tree = applyFamilyUnitOverride(tree, fuId("hana"), { unitOf: null });
    const back = parseGedcom(serializeGedcom(tree));
    const units = deriveFamilyUnits(back);
    assert.equal(units.unitOf[byName(back, "Joe")], units.unitOf[byName(back, "Cora")]);
    assert.equal(units.units.find((u) => u.id === units.unitOf[byName(back, "Hana")])!.label, "Hana & Kit");
  });

  it("the JSON backup keeps overrides", () => {
    const tree = applyFamilyUnitOverride(FIXTURE_MATERNAL_FAMILY, fuId("joe"), { unitOf: fuId("cora") });
    const back = parseTreeJson(serializeTreeJson(tree));
    assert.deepEqual(back.familyUnitOverrides, [{ personId: fuId("joe"), unitOf: fuId("cora") }]);
  });

  it("removing a person drops overrides about them and keeps the rest", () => {
    let tree = applyFamilyUnitOverride(FIXTURE_MATERNAL_FAMILY, fuId("joe"), { unitOf: fuId("cora") });
    tree = applyFamilyUnitOverride(tree, fuId("cz2"), { unitOf: fuId("tess") });
    tree = applyFamilyUnitOverride(tree, fuId("hana"), { unitOf: null });
    const next = removePerson(tree, fuId("tess"));
    assert.deepEqual(next.familyUnitOverrides, [
      { personId: fuId("joe"), unitOf: fuId("cora") },
      { personId: fuId("hana"), unitOf: null },
    ]);
  });
});
