import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyFamilyUnitOverride,
  deriveFamilyUnits,
  movesWith,
  parentsAreUnknown,
  unitOfPerson,
  type FamilyUnits,
} from "./familyUnits";
import {
  ALL_FAMILY_UNIT_FIXTURES,
  FIXTURE_BLENDED,
  FIXTURE_BUCKET_RULE,
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
import { parseTreeJson } from "./tree";
import type { KinKind, ParentRole, TreeData } from "./types";

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

describe("blended placement (FIXTURE_BLENDED)", () => {
  const result = deriveFamilyUnits(FIXTURE_BLENDED);

  it("Kip sits with Dale, and Step is a separate family", () => {
    sameUnit(result, "gran", "dale", "kip");
    sameUnit(result, "step");
    sameUnit(result, "pip");
    assert.equal(parentsAreUnknown(FIXTURE_BLENDED, fuId("pip")), true);
    assert.equal(parentsAreUnknown(FIXTURE_BLENDED, fuId("kip")), false);
    assert.equal(parentsAreUnknown(FIXTURE_BLENDED, fuId("gran")), false);
  });

  it("hiding Step does not put Kip in Step's bucket or name Step", () => {
    const visible = new Set(FIXTURE_BLENDED.people.map((person) => person.id).filter((id) => id !== fuId("step")));
    const hidden = {
      ...FIXTURE_BLENDED,
      people: FIXTURE_BLENDED.people.filter((person) => visible.has(person.id)),
      unions: FIXTURE_BLENDED.unions
        .map((union) => ({ ...union, partnerIds: union.partnerIds.filter((id) => visible.has(id)) }))
        .filter((union) => union.partnerIds.length >= 2),
      childLinks: FIXTURE_BLENDED.childLinks.flatMap((link) => {
        if (!visible.has(link.childId)) return [];
        const parentIds = link.parentIds.filter((id) => visible.has(id));
        if (!parentIds.length && !link.unknownParents?.length) return [];
        return [{ ...link, parentIds }];
      }),
    };
    const placed = deriveFamilyUnits(hidden);
    assert.equal(JSON.stringify(placed).includes(fuId("step")), false);
    sameUnit(placed, "gran", "dale", "kip");
    sameUnit(placed, "pip");
  });
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
    sameUnit(result, "stepmom", "baby", "stepkid");
    sameUnit(result, "dad");
    const link = result.links.find((l) => l.toPersonId === fuId("kid"));
    assert.equal(link?.fromPersonId, fuId("dad"));
    assert.equal(link?.kind, "blood");
    assert.equal(result.unitOf[fuId("dad")] === result.unitOf[fuId("stepkid")], false);
  });

  it("step and foster: a child follows a blood parent over a step-parent, else the only parent", () => {
    const result = deriveFamilyUnits(FIXTURE_STEP_FAMILY);
    sameUnit(result, "gran", "mom", "child");
    sameUnit(result, "stepdad", "hisson", "fosterkid");
    assert.deepEqual(result.via[fuId("child")], { kind: "parent", personId: fuId("mom") });
    assert.deepEqual(result.via[fuId("hisson")], { kind: "parent", personId: fuId("stepdad") });
    assert.equal(result.unitOf[fuId("child")] === result.unitOf[fuId("stepdad")], false);
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

describe("bucket rule (FIXTURE_BUCKET_RULE)", () => {
  const result = deriveFamilyUnits(FIXTURE_BUCKET_RULE);

  it("biological: a blood child follows the mother, and a step boundary keeps the father in his own bucket", () => {
    sameUnit(result, "gran", "mae", "bio", "half", "foster", "adopted");
    sameUnit(result, "stu");
    assert.deepEqual(result.via[fuId("bio")], { kind: "parent", personId: fuId("mae") });
    const toBio = result.links.find((link) => link.fromPersonId === fuId("stu") && link.toPersonId === fuId("bio"));
    assert.equal(toBio?.kind, "blood");
  });

  it("adopted and foster follow that parent; a step parent does not outrank them", () => {
    assert.deepEqual(result.via[fuId("adopted")], { kind: "parent", personId: fuId("mae") });
    assert.deepEqual(result.via[fuId("foster")], { kind: "parent", personId: fuId("mae") });
    assert.deepEqual(result.via[fuId("half")], { kind: "parent", personId: fuId("mae") });
  });

  it("step alone never pulls someone into a bucket", () => {
    sameUnit(result, "orphan");
    assert.notEqual(result.unitOf[fuId("orphan")], result.unitOf[fuId("stu")]);
    const step = result.links.find((l) => l.fromPersonId === fuId("stu") && l.toPersonId === fuId("orphan"));
    assert.equal(step?.kind, "step");
    assert.notEqual(step?.fromUnitId, step?.toUnitId);
  });

  it("a person with no parents on the tree stays with their partner, not a step-parent", () => {
    sameUnit(result, "nia", "pal");
    assert.notEqual(result.unitOf[fuId("pal")], result.unitOf[fuId("stu")]);
    assert.notEqual(result.unitOf[fuId("nia")], result.unitOf[fuId("stu")]);
    assert.equal(unitOfPerson(result, fuId("nia"))!.label, "Nia & Pal");
  });

  it("someone with no parents and no partner is a unit of one", () => {
    sameUnit(result, "lone");
  });

  it("divorce: each parent stays with their own parents; the child follows the mother", () => {
    sameUnit(result, "annmom", "anndad", "ann", "cy");
    sameUnit(result, "benmom", "bendad", "ben");
  });

  it("same-sex parents: the partner with family on the tree anchors", () => {
    sameUnit(result, "miamom", "mia", "noa", "tot");
  });

  it("an unknown parent id is ignored", () => {
    sameUnit(result, "kipparent", "kip");
    assert.ok(!JSON.stringify(result).includes("fu-fx-missing"));
  });

  it("an explicit override wins over a step link and over the maternal default", () => {
    const intoGran = deriveFamilyUnits(FIXTURE_BUCKET_RULE, [{ personId: fuId("orphan"), unitOf: fuId("gran") }]);
    assert.equal(intoGran.unitOf[fuId("orphan")], intoGran.unitOf[fuId("gran")]);
    const aside = deriveFamilyUnits(FIXTURE_BUCKET_RULE, [{ personId: fuId("orphan"), unitOf: fuId("lone") }]);
    assert.equal(aside.unitOf[fuId("orphan")], aside.unitOf[fuId("lone")]);
    assert.notEqual(aside.unitOf[fuId("orphan")], aside.unitOf[fuId("stu")]);
    assert.deepEqual(aside.via[fuId("orphan")], { kind: "override", personId: fuId("lone") });
  });
});

/**
 * FIXTURE people only. Ids are `kin-fx-` and every family name is FIXTURE.
 * Each case is one invented shape, so the bucket a person lands in is the
 * thing under test.
 */
function kinTree(
  people: string[],
  kids: { child: string; parents: [string, ParentRole | "", KinKind?][] }[],
  unions: [string, string][] = [],
): TreeData {
  return {
    people: people.map((id) => ({
      id: `kin-fx-${id}`,
      givenName: id,
      familyName: "FIXTURE",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    })),
    unions: unions.map(([a, b], i) => ({
      id: `kin-fx-u-${i}`,
      partnerIds: [`kin-fx-${a}`, `kin-fx-${b}`],
      kind: "married" as const,
    })),
    childLinks: kids.map((kid, i) => {
      const roles: Partial<Record<string, ParentRole>> = {};
      const kin: Partial<Record<string, KinKind>> = {};
      for (const [id, role, kind] of kid.parents) {
        if (role) roles[`kin-fx-${id}`] = role;
        if (kind && kind !== "blood") kin[`kin-fx-${id}`] = kind;
      }
      return {
        id: `kin-fx-c-${i}`,
        childId: `kin-fx-${kid.child}`,
        parentIds: kid.parents.map(([id]) => (id.startsWith("missing") ? id : `kin-fx-${id}`)),
        ...(Object.keys(roles).length ? { roles } : {}),
        ...(Object.keys(kin).length ? { kin } : {}),
      };
    }),
  };
}

function bucketOf(tree: TreeData, name: string, overrides?: { personId: string; unitOf: string | null }[]) {
  const result = deriveFamilyUnits(
    tree,
    overrides?.map((row) => ({
      personId: row.personId.startsWith("kin-fx-") ? row.personId : `kin-fx-${row.personId}`,
      unitOf: row.unitOf === null ? null : row.unitOf.startsWith("kin-fx-") ? row.unitOf : `kin-fx-${row.unitOf}`,
    })),
  );
  const id = `kin-fx-${name}`;
  const unit = unitOfPerson(result, id);
  assert.ok(unit, `${name} should belong to a unit`);
  return {
    members: [...unit!.memberIds].sort(),
    label: unit!.label,
    via: result.via[id],
    links: result.links.filter((link) => link.fromPersonId === id || link.toPersonId === id),
  };
}

const kinId = (name: string) => `kin-fx-${name}`;

describe("parent-link kinds decide the bucket (FIXTURE)", () => {
  it("step-only: a child with no partner stays out of the step-parent's bucket", () => {
    const placed = kinTree(
      ["Gran", "Mae", "Stu", "Wynn"],
      [
        { child: "Mae", parents: [["Gran", "mother"]] },
        { child: "Wynn", parents: [["Stu", "father", "step"]] },
      ],
      [["Mae", "Stu"]],
    );
    const wynn = bucketOf(placed, "Wynn");
    assert.deepEqual(wynn.members, [kinId("Wynn")]);
    assert.equal(wynn.label, "Wynn");
    assert.deepEqual(wynn.via, { kind: "root" });
    assert.equal(wynn.links.length, 1);
    assert.equal(wynn.links[0].kind, "step");
    assert.equal(wynn.links[0].fromPersonId, kinId("Stu"));
    assert.ok(!bucketOf(placed, "Stu").members.includes(kinId("Wynn")));
  });

  it("step-only with a partner: the couple stays together, not in the step-parent's bucket", () => {
    const tree = kinTree(
      ["Stu", "Nia", "Pal"],
      [{ child: "Nia", parents: [["Stu", "father", "step"]] }],
      [["Nia", "Pal"]],
    );
    const nia = bucketOf(tree, "Nia");
    assert.deepEqual(nia.members, [kinId("Nia"), kinId("Pal")].sort());
    assert.ok(!nia.members.includes(kinId("Stu")));
    assert.equal(nia.links.find((link) => link.fromPersonId === kinId("Stu"))?.kind, "step");
  });

  it("foster-only: the child sits with the foster parent, and that is not a blood claim", () => {
    const tree = kinTree(["Vic", "Kit"], [{ child: "Kit", parents: [["Vic", "mother", "foster"]] }]);
    const kit = bucketOf(tree, "Kit");
    assert.deepEqual(kit.members, [kinId("Kit"), kinId("Vic")].sort());
    assert.deepEqual(kit.via, { kind: "parent", personId: kinId("Vic") });
    assert.equal(kit.links.length, 0, "same bucket, so the foster line is inside the family, not a blood link across");
  });

  it("adopted: the child sits with the adoptive parent", () => {
    const tree = kinTree(["Ada", "Kit"], [{ child: "Kit", parents: [["Ada", "mother", "adopted"]] }]);
    const kit = bucketOf(tree, "Kit");
    assert.deepEqual(kit.members, [kinId("Ada"), kinId("Kit")].sort());
    assert.deepEqual(kit.via, { kind: "parent", personId: kinId("Ada") });
  });

  it("mixed blood and step in different families: the child follows the blood parent", () => {
    const fixed = kinTree(
      ["Dad", "Step", "Kid"],
      [{ child: "Kid", parents: [["Step", "mother", "step"], ["Dad", "father"]] }],
    );
    const kid = bucketOf(fixed, "Kid");
    assert.deepEqual(kid.members, [kinId("Dad"), kinId("Kid")].sort());
    assert.deepEqual(kid.via, { kind: "parent", personId: kinId("Dad") });
    assert.equal(kid.links.find((link) => link.fromPersonId === kinId("Step"))?.kind, "step");
    assert.ok(!bucketOf(fixed, "Step").members.includes(kinId("Kid")));
  });

  it("mixed blood and step in one couple: the child follows the blood parent into that household", () => {
    const tree = kinTree(
      ["Gran", "Dad", "Step", "Kid", "Wynn"],
      [
        { child: "Dad", parents: [["Gran", "mother"]] },
        { child: "Kid", parents: [["Dad", "father"], ["Step", "mother", "step"]] },
        { child: "Wynn", parents: [["Step", "father", "step"]] },
      ],
      [["Dad", "Step"]],
    );
    const kid = bucketOf(tree, "Kid");
    const step = bucketOf(tree, "Step");
    assert.equal(kid.members.includes(kinId("Dad")), true);
    assert.equal(kid.members.includes(kinId("Step")), false);
    assert.deepEqual(kid.via, { kind: "parent", personId: kinId("Dad") });
    assert.equal(kid.links.find((link) => link.fromPersonId === kinId("Step"))?.kind, "step");
    const wynn = bucketOf(tree, "Wynn");
    assert.deepEqual(wynn.members, [kinId("Wynn")]);
    assert.ok(!step.members.includes(kinId("Wynn")));
    assert.equal(wynn.links.find((link) => link.fromPersonId === kinId("Step"))?.kind, "step");
  });

  it("blood beats foster, and foster beats a step parent who is listed first", () => {
    const blood = kinTree(
      ["Bio", "Fos", "Kid"],
      [{ child: "Kid", parents: [["Fos", "mother", "foster"], ["Bio", "father"]] }],
    );
    assert.deepEqual(bucketOf(blood, "Kid").via, { kind: "parent", personId: kinId("Bio") });
    assert.equal(bucketOf(blood, "Kid").links.find((link) => link.fromPersonId === kinId("Fos"))?.kind, "foster");

    const foster = kinTree(
      ["Fos", "Step", "Kid"],
      [{ child: "Kid", parents: [["Step", "mother", "step"], ["Fos", "father", "foster"]] }],
    );
    assert.deepEqual(bucketOf(foster, "Kid").via, { kind: "parent", personId: kinId("Fos") });
  });

  it("adopted and blood are equal, so the mother role still decides", () => {
    const tree = kinTree(
      ["AdoptMom", "BloodDad", "Kid"],
      [{ child: "Kid", parents: [["AdoptMom", "mother", "adopted"], ["BloodDad", "father"]] }],
    );
    assert.deepEqual(bucketOf(tree, "Kid").via, { kind: "parent", personId: kinId("AdoptMom") });
    assert.equal(bucketOf(tree, "Kid").links.find((link) => link.fromPersonId === kinId("BloodDad"))?.kind, "blood");
  });

  it("unknown parents are ignored, including when the only real parent is a step-parent", () => {
    const tree = kinTree(
      ["Step", "Kid", "Lone"],
      [{ child: "Kid", parents: [["missing-a", "mother"], ["missing-b", "father"], ["Step", "father", "step"]] }],
    );
    const kid = bucketOf(tree, "Kid");
    assert.deepEqual(kid.members, [kinId("Kid")]);
    assert.equal(kid.links.find((link) => link.fromPersonId === kinId("Step"))?.kind, "step");
    assert.deepEqual(bucketOf(tree, "Lone").members, [kinId("Lone")]);
    assert.equal(JSON.stringify(deriveFamilyUnits(tree)).includes("missing"), false);
  });

  it("two mothers: the partner with family on the tree anchors, and the child is in that bucket", () => {
    const tree = kinTree(
      ["Miamom", "Mia", "Noa", "Tot"],
      [
        { child: "Mia", parents: [["Miamom", "mother"]] },
        { child: "Tot", parents: [["Noa", "mother"], ["Mia", "mother"]] },
      ],
      [["Noa", "Mia"]],
    );
    const tot = bucketOf(tree, "Tot");
    assert.deepEqual(tot.members, [kinId("Mia"), kinId("Miamom"), kinId("Noa"), kinId("Tot")].sort());
    assert.equal(tot.via.kind, "parent");
  });

  it("two fathers: the same rule, with no gender to break the tie", () => {
    const tree = kinTree(
      ["Leomom", "Leo", "Max", "Tot"],
      [
        { child: "Leo", parents: [["Leomom", "mother"]] },
        { child: "Tot", parents: [["Max", "father"], ["Leo", "father"]] },
      ],
      [["Max", "Leo"]],
    );
    const tot = bucketOf(tree, "Tot");
    assert.deepEqual(tot.members, [kinId("Leo"), kinId("Leomom"), kinId("Max"), kinId("Tot")].sort());
    const listedFirst = kinTree(
      ["Leomom", "Leo", "Max", "Tot"],
      [
        { child: "Leo", parents: [["Leomom", "mother"]] },
        { child: "Tot", parents: [["Leo", "father"], ["Max", "father"]] },
      ],
      [["Leo", "Max"]],
    );
    assert.deepEqual(bucketOf(listedFirst, "Tot").members, bucketOf(tree, "Tot").members);
  });

  it("a missing kin kind is blood, so an old tree without kin still places the child", () => {
    const legacy = {
      people: [
        { id: "old-mom", givenName: "Mom", familyName: "FIXTURE", createdAt: "t", updatedAt: "t" },
        { id: "old-kid", givenName: "Kid", familyName: "FIXTURE", createdAt: "t", updatedAt: "t" },
      ],
      unions: [],
      childLinks: [{ id: "old-c", childId: "old-kid", parentIds: ["old-mom"] }],
    };
    const text = JSON.stringify(legacy);
    const loaded = parseTreeJson(text);
    assert.equal(loaded.childLinks[0].kin, undefined);
    assert.equal(loaded.familyUnitOverrides, undefined);
    assert.equal(JSON.stringify(loaded), text);
    const result = deriveFamilyUnits(loaded);
    assert.equal(result.unitOf["old-kid"], result.unitOf["old-mom"]);
    assert.deepEqual(result.via["old-kid"], { kind: "parent", personId: "old-mom" });
  });

  it("a couple with only shared children still shares one bucket", () => {
    const tree = kinTree(
      ["Ann", "Ben", "Cy"],
      [{ child: "Cy", parents: [["Ann", "mother"], ["Ben", "father"]] }],
      [["Ann", "Ben"]],
    );
    const cy = bucketOf(tree, "Cy");
    assert.ok(cy.members.includes(kinId("Ann")));
    assert.ok(cy.members.includes(kinId("Ben")));
    assert.ok(cy.members.includes(kinId("Cy")));
  });

  it("does not follow a parent across a partner edge into a step-parent's bucket", () => {
    // Hypothesis: membership walks child → parent → that parent's partner.
    // Kip's only placing parent is Dale. Step is Dale's spouse, not Kip's parent.
    const tree = kinTree(
      ["Gran", "Dale", "Step", "Kip"],
      [
        { child: "Dale", parents: [["Gran", "mother"]] },
        { child: "Kip", parents: [["Dale", "father"]] },
      ],
      [["Dale", "Step"]],
    );
    const kipLink = tree.childLinks.find((link) => link.childId === kinId("Kip"));
    assert.ok(kipLink);
    kipLink.unknownParents = [{}];
    const kip = bucketOf(tree, "Kip");
    const step = bucketOf(tree, "Step");
    assert.ok(kip.members.includes(kinId("Dale")), "Kip sits with the known parent");
    assert.ok(kip.members.includes(kinId("Gran")), "that family is Dale's, with Gran");
    assert.equal(kip.members.includes(kinId("Step")), false);
    assert.equal(step.members.includes(kinId("Kip")), false);
    assert.equal(kip.via.kind === "partner", false);
  });

  it("a child with no recorded parents does not land in the step-parent's bucket", () => {
    // Pip's parents are not people. Stu is only a step-parent, and Stu's
    // partner Mae is not a parent. The union must not supply a parent.
    const tree = kinTree(
      ["Mae", "Stu", "Pip"],
      [{ child: "Pip", parents: [["missing-parent", "mother"], ["Stu", "father", "step"]] }],
      [["Mae", "Stu"]],
    );
    tree.unions.push({
      id: "kin-fx-u-absent",
      partnerIds: ["missing-parent", kinId("Stu")],
      kind: "married",
    });
    const pipLink = tree.childLinks.find((link) => link.childId === kinId("Pip"));
    assert.ok(pipLink);
    pipLink.unknownParents = [{ role: "mother" }, { role: "father" }];
    const pip = bucketOf(tree, "Pip");
    assert.deepEqual(pip.members, [kinId("Pip")]);
    assert.deepEqual(pip.via, { kind: "root" });
    assert.equal(pip.links.find((link) => link.fromPersonId === kinId("Stu"))?.kind, "step");
    assert.equal(bucketOf(tree, "Stu").members.includes(kinId("Pip")), false);
    assert.equal(bucketOf(tree, "Mae").members.includes(kinId("Pip")), false);
    assert.equal(JSON.stringify(deriveFamilyUnits(tree)).includes("missing-parent"), false);
  });

  it("adoptive counts as a parent; a later spouse does not share that bucket", () => {
    const tree = kinTree(
      ["Ada", "Kit", "Spouse"],
      [{ child: "Kit", parents: [["Ada", "mother", "adopted"]] }],
      [["Ada", "Spouse"]],
    );
    const kit = bucketOf(tree, "Kit");
    assert.deepEqual(kit.via, { kind: "parent", personId: kinId("Ada") });
    assert.ok(kit.members.includes(kinId("Ada")));
    assert.equal(kit.members.includes(kinId("Spouse")), false);
  });

  it("foster places the child with the foster parent, not that parent's spouse", () => {
    // Foster is a placing parent, after blood and adopted, and ahead of step.
    // It is not blood. A spouse who is not a foster, blood, or adoptive parent
    // does not share the child's bucket.
    const tree = kinTree(
      ["Vic", "Kit", "Spouse"],
      [{ child: "Kit", parents: [["Vic", "mother", "foster"]] }],
      [["Vic", "Spouse"]],
    );
    const kit = bucketOf(tree, "Kit");
    assert.deepEqual(kit.via, { kind: "parent", personId: kinId("Vic") });
    assert.ok(kit.members.includes(kinId("Vic")));
    assert.equal(kit.members.includes(kinId("Spouse")), false);
    const blood = kinTree(
      ["Bio", "Fos", "Kid"],
      [{ child: "Kid", parents: [["Fos", "mother", "foster"], ["Bio", "father"]] }],
    );
    assert.deepEqual(bucketOf(blood, "Kid").via, { kind: "parent", personId: kinId("Bio") });
  });

  it("same-sex parents share a bucket when both are parents of the child", () => {
    const mothers = kinTree(
      ["Miamom", "Mia", "Noa", "Tot"],
      [
        { child: "Mia", parents: [["Miamom", "mother"]] },
        { child: "Tot", parents: [["Noa", "mother"], ["Mia", "mother"]] },
      ],
      [["Noa", "Mia"]],
    );
    const tot = bucketOf(mothers, "Tot");
    assert.ok(tot.members.includes(kinId("Mia")));
    assert.ok(tot.members.includes(kinId("Noa")));
    assert.ok(tot.members.includes(kinId("Tot")));
    const fathers = kinTree(
      ["Leomom", "Leo", "Max", "Tot"],
      [
        { child: "Leo", parents: [["Leomom", "mother"]] },
        { child: "Tot", parents: [["Max", "father"], ["Leo", "father"]] },
      ],
      [["Max", "Leo"]],
    );
    const boy = bucketOf(fathers, "Tot");
    assert.ok(boy.members.includes(kinId("Leo")));
    assert.ok(boy.members.includes(kinId("Max")));
    assert.ok(boy.members.includes(kinId("Tot")));
  });

  it("divorced parents keep each marriage's children out of the new spouse's bucket", () => {
    const person = (id: string) => ({
      id: kinId(id),
      givenName: id,
      familyName: "FIXTURE",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    const tree: TreeData = {
      people: ["Ann", "Ben", "Rema", "Sue", "Kid1", "Kid2", "Kid3"].map(person),
      unions: [
        { id: "kin-fx-u-divorce", partnerIds: [kinId("Ann"), kinId("Ben")], kind: "divorced" },
        { id: "kin-fx-u-ann", partnerIds: [kinId("Ann"), kinId("Rema")], kind: "married" },
        { id: "kin-fx-u-ben", partnerIds: [kinId("Ben"), kinId("Sue")], kind: "married" },
      ],
      childLinks: [
        {
          id: "kin-fx-c-1",
          childId: kinId("Kid1"),
          parentIds: [kinId("Ann"), kinId("Ben")],
          roles: { [kinId("Ann")]: "mother", [kinId("Ben")]: "father" },
        },
        {
          id: "kin-fx-c-2",
          childId: kinId("Kid2"),
          parentIds: [kinId("Ann"), kinId("Rema")],
          roles: { [kinId("Ann")]: "mother", [kinId("Rema")]: "father" },
        },
        {
          id: "kin-fx-c-3",
          childId: kinId("Kid3"),
          parentIds: [kinId("Sue"), kinId("Ben")],
          roles: { [kinId("Sue")]: "mother", [kinId("Ben")]: "father" },
        },
      ],
    };
    const kid1 = bucketOf(tree, "Kid1");
    const kid2 = bucketOf(tree, "Kid2");
    const kid3 = bucketOf(tree, "Kid3");
    assert.ok(kid1.members.includes(kinId("Ann")));
    assert.equal(kid1.members.includes(kinId("Rema")), false);
    assert.equal(kid1.members.includes(kinId("Sue")), false);
    assert.ok(kid2.members.includes(kinId("Ann")));
    assert.equal(kid2.members.includes(kinId("Sue")), false);
    assert.notEqual(kid1.members.join(), kid3.members.join());
    assert.ok(kid3.members.includes(kinId("Sue")));
    assert.equal(kid3.members.includes(kinId("Ann")), false);
    assert.equal(kid1.members.includes(kinId("Kid3")), false);
  });

  it("an explicit family-unit override still puts the child with the step-parent", () => {
    const tree = kinTree(
      ["Gran", "Dale", "Step", "Kip"],
      [
        { child: "Dale", parents: [["Gran", "mother"]] },
        { child: "Kip", parents: [["Dale", "father"]] },
      ],
      [["Dale", "Step"]],
    );
    const into = bucketOf(tree, "Kip", [{ personId: "Kip", unitOf: "Step" }]);
    assert.ok(into.members.includes(kinId("Step")));
    assert.ok(into.members.includes(kinId("Kip")));
    assert.deepEqual(into.via, { kind: "override", personId: kinId("Step") });
    assert.equal(bucketOf(tree, "Kip").members.includes(kinId("Step")), false);
  });

  it("a manual override wins over a step link and over the maternal default", () => {
    const tree = kinTree(
      ["Gran", "Mae", "Stu", "Wynn"],
      [
        { child: "Mae", parents: [["Gran", "mother"]] },
        { child: "Wynn", parents: [["Stu", "father", "step"]] },
      ],
      [["Mae", "Stu"]],
    );
    const intoStep = bucketOf(tree, "Wynn", [{ personId: "Wynn", unitOf: "Stu" }]);
    assert.ok(intoStep.members.includes(kinId("Stu")));
    assert.deepEqual(intoStep.via, { kind: "override", personId: kinId("Stu") });
    const aside = bucketOf(tree, "Mae", [{ personId: "Mae", unitOf: null }]);
    assert.deepEqual(aside.members, [kinId("Mae"), kinId("Stu")].sort());
    assert.ok(!aside.members.includes(kinId("Gran")));
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
