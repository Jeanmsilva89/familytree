import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveFamilyUnits } from "./familyUnits";
import { deriveHouseholds } from "./households";
import { layoutFamilySky } from "./familySky";
import { buildGraph } from "./layoutGraph";
import { curveUnlinkMark, unlinkRequest } from "./skyUnlink";
import { parseGedcom, serializeGedcom } from "./gedcom";
import { loadTree, resetTreeStoreForTests, type TreeBackend } from "./db";
import { parseTreeJson, serializeTreeJson } from "./tree";
import {
  partnerStatus,
  partnerStatusLabel,
  type Person,
  type TreeData,
  type Union,
} from "./types";

/**
 * FIXTURE people only. These are not relatives. Family name is always FIXTURE.
 */
const T = "2024-01-01T00:00:00.000Z";

function fx(id: string, givenName: string): Person {
  return {
    id,
    givenName,
    familyName: "FIXTURE",
    createdAt: T,
    updatedAt: T,
  };
}

function treeOf(people: Person[], unions: Union[], childLinks: TreeData["childLinks"] = []): TreeData {
  return { people, unions, childLinks, focusPersonId: people[0]?.id };
}

describe("partner status (FIXTURE)", () => {
  it("keeps a first marriage married, and does not store remarried", () => {
    const ada = fx("ada", "Ada");
    const ben = fx("ben", "Ben");
    const union: Union = { id: "u-ab", partnerIds: [ada.id, ben.id], kind: "married" };
    const tree = treeOf([ada, ben], [union]);
    assert.equal(partnerStatus(tree, union), "married");
    assert.equal(partnerStatusLabel("married"), "Married");
    assert.equal(serializeTreeJson(tree).includes("remarried"), false);
  });

  it("derives remarried from a later marriage after a divorce, without writing that word", () => {
    const ada = fx("ada", "Ada");
    const ben = fx("ben", "Ben");
    const cora = fx("cora", "Cora");
    const ended: Union = { id: "u-old", partnerIds: [ada.id, ben.id], kind: "divorced" };
    const next: Union = { id: "u-new", partnerIds: [ada.id, cora.id], kind: "married" };
    const tree = treeOf([ada, ben, cora], [ended, next]);
    assert.equal(partnerStatus(tree, ended), "divorced");
    assert.equal(partnerStatus(tree, next), "remarried");
    assert.equal(partnerStatusLabel("remarried"), "Remarried");
    assert.equal(partnerStatusLabel("divorced"), "Divorced");
    const saved = serializeTreeJson(tree);
    assert.equal(saved.includes("remarried"), false);
    const restored = parseTreeJson(saved);
    const restoredNext = restored.unions.find((union) => union.id === "u-new")!;
    assert.equal(restoredNext.kind, "married");
    assert.equal(partnerStatus(restored, restoredNext), "remarried");
  });

  it("does not call a marriage remarried just because an earlier union is separated", () => {
    const ada = fx("ada", "Ada");
    const ben = fx("ben", "Ben");
    const cora = fx("cora", "Cora");
    const separated: Union = { id: "u-sep", partnerIds: [ada.id, ben.id], kind: "separated" };
    const next: Union = { id: "u-new", partnerIds: [ada.id, cora.id], kind: "married" };
    const tree = treeOf([ada, ben, cora], [separated, next]);
    assert.equal(partnerStatus(tree, separated), "separated");
    assert.equal(partnerStatus(tree, next), "married");
  });

  it("treats two mothers the same as any other pair", () => {
    const ada = fx("ada", "Ada");
    const bea = fx("bea", "Bea");
    const cora = fx("cora", "Cora");
    const kit = fx("kit", "Kit");
    const ended: Union = { id: "u-old", partnerIds: [ada.id, bea.id], kind: "divorced" };
    const next: Union = { id: "u-new", partnerIds: [ada.id, cora.id], kind: "married" };
    const tree = treeOf(
      [ada, bea, cora, kit],
      [ended, next],
      [
        {
          id: "c-kit",
          childId: kit.id,
          parentIds: [ada.id, bea.id],
          roles: { [ada.id]: "mother", [bea.id]: "mother" },
        },
      ],
    );
    assert.equal(partnerStatus(tree, next), "remarried");
    const units = deriveFamilyUnits(tree);
    assert.notEqual(units.unitOf[ada.id], units.unitOf[bea.id]);
    // Kit is Ada and Bea's child, not Cora's, so Ada does not carry Kit into Cora's bucket.
    assert.notEqual(units.unitOf[ada.id], units.unitOf[cora.id]);
    assert.equal(units.unitOf[kit.id], units.unitOf[ada.id]);
    assert.notEqual(units.unitOf[kit.id], units.unitOf[cora.id]);
    const divorced = units.links.find((link) => link.kind === "divorced");
    assert.ok(divorced, "a divorce is a quiet link, not a missing fact");
    assert.deepEqual([divorced!.fromPersonId, divorced!.toPersonId].sort(), [ada.id, bea.id].sort());
    const homes = deriveHouseholds(tree);
    assert.notEqual(homes.homeOf[ada.id], homes.homeOf[bea.id]);
    const sky = layoutFamilySky(tree);
    assert.ok(sky.links.some((link) => link.kind === "divorced"));
    assert.ok(
      sky.links.some(
        (link) =>
          link.kind === "partner" &&
          [link.fromPersonId, link.toPersonId].sort().join() === [ada.id, cora.id].sort().join(),
      ),
    );
    const graph = buildGraph(tree, ada.id);
    const bar = graph.couples.find((couple) => couple.id === "u-new");
    assert.equal(bar?.status, "remarried");
    assert.equal(bar?.bar, true);
    assert.equal(graph.couples.some((couple) => couple.id === "u-old" && couple.bar), false);
  });

  it("keeps a partnered union after a divorce from being called a remarriage", () => {
    const ada = fx("ada", "Ada");
    const ben = fx("ben", "Ben");
    const cora = fx("cora", "Cora");
    const tree = treeOf(
      [ada, ben, cora],
      [
        { id: "u-old", partnerIds: [ada.id, ben.id], kind: "divorced" },
        { id: "u-new", partnerIds: [ada.id, cora.id], kind: "partnered" },
      ],
    );
    assert.equal(partnerStatus(tree, tree.unions[1]), "partnered");
  });

  it("unlinks a divorced sky curve as partners, not as a parent", () => {
    const mark = curveUnlinkMark({ kind: "divorced", fromPersonId: "ada", toPersonId: "ben" });
    assert.equal(mark?.mark, "curve");
    if (!mark || mark.mark !== "curve") return;
    assert.equal(mark.kind, "partner");
    assert.equal(unlinkRequest(mark).role, "partner");
  });
});

describe("saved trees migrate without inventing a divorce (FIXTURE)", () => {
  const ada = fx("ada", "Ada");
  const ben = fx("ben", "Ben");

  it("leaves a separated backup separated", () => {
    const legacy = {
      people: [ada, ben],
      unions: [{ id: "u-ab", partnerIds: [ada.id, ben.id], kind: "separated" as const }],
      childLinks: [] as TreeData["childLinks"],
      focusPersonId: ada.id,
    };
    const parsed = parseTreeJson(JSON.stringify(legacy));
    assert.equal(parsed.unions[0].kind, "separated");
    assert.deepEqual(parsed.unions[0], legacy.unions[0]);
    assert.equal(JSON.stringify(parsed).includes("divorced"), false);
    assert.equal(JSON.stringify(parsed).includes("remarried"), false);
  });

  it("fills a missing couple kind with unspecified and keeps the people", () => {
    const legacy = {
      people: [ada],
      unions: [{ id: "u-ab", partnerIds: [ada.id, ben.id] }],
      childLinks: [],
      focusPersonId: ada.id,
    };
    const parsed = parseTreeJson(JSON.stringify(legacy));
    assert.equal(parsed.people[0].givenName, "Ada");
    assert.equal(parsed.unions[0].kind, "unspecified");
    assert.equal(partnerStatus(parsed, parsed.unions[0]), "unspecified");
    assert.equal(parsed.focusPersonId, ada.id);
  });

  it("folds a stored remarried kind back to married so the status can be derived", () => {
    const legacy = {
      people: [ada, ben, fx("cora", "Cora")],
      unions: [
        { id: "u-old", partnerIds: [ada.id, ben.id], kind: "divorced" },
        { id: "u-new", partnerIds: [ada.id, "cora"], kind: "remarried" },
      ],
      childLinks: [],
    };
    const parsed = parseTreeJson(JSON.stringify(legacy));
    assert.equal(parsed.unions.find((union) => union.id === "u-new")?.kind, "married");
    assert.equal(parsed.unions.find((union) => union.id === "u-old")?.kind, "divorced");
    const next = parsed.unions.find((union) => union.id === "u-new")!;
    assert.equal(partnerStatus(parsed, next), "remarried");
    assert.equal(serializeTreeJson(parsed).includes("remarried"), false);
  });

  it("loads an old saved tree from the device store without adding a divorce", async () => {
    const legacy: TreeData = {
      people: [ada, ben],
      unions: [{ id: "u-ab", partnerIds: [ada.id, ben.id], kind: "separated" }],
      childLinks: [],
      focusPersonId: ada.id,
    };
    const backend: TreeBackend = {
      async get() {
        return structuredClone(legacy);
      },
      async put() {
        throw new Error("load must not write");
      },
      async del() {
        throw new Error("load must not delete");
      },
    };
    resetTreeStoreForTests();
    const loaded = await loadTree(backend);
    assert.equal(loaded.unions[0].kind, "separated");
    assert.deepEqual(loaded.people, legacy.people);
    assert.equal(JSON.stringify(loaded).includes("divorced"), false);
  });
});

describe("GEDCOM divorce (FIXTURE)", () => {
  it("reads a standard DIV as divorced and does not rewrite a separated _KIND", () => {
    const divorced = parseGedcom(
      [
        "0 HEAD",
        "1 CHAR UTF-8",
        "0 @I1@ INDI",
        "1 NAME Ada /FIXTURE/",
        "0 @I2@ INDI",
        "1 NAME Ben /FIXTURE/",
        "0 @F1@ FAM",
        "1 HUSB @I1@",
        "1 WIFE @I2@",
        "1 DIV",
        "0 TRLR",
        "",
      ].join("\n"),
    );
    assert.equal(divorced.unions[0].kind, "divorced");
    assert.equal(divorced.people.every((person) => person.familyName === "FIXTURE"), true);

    const separated = parseGedcom(
      [
        "0 HEAD",
        "1 CHAR UTF-8",
        "0 @I1@ INDI",
        "1 NAME Ada /FIXTURE/",
        "0 @I2@ INDI",
        "1 NAME Ben /FIXTURE/",
        "0 @F1@ FAM",
        "1 HUSB @I1@",
        "1 WIFE @I2@",
        "1 _KIND separated",
        "1 DIV",
        "0 TRLR",
        "",
      ].join("\n"),
    );
    assert.equal(separated.unions[0].kind, "separated");
  });

  it("writes divorced as DIV and does not write remarried or a DIV for a separation", () => {
    const ada = fx("ada", "Ada");
    const ben = fx("ben", "Ben");
    const cora = fx("cora", "Cora");
    const tree = treeOf(
      [ada, ben, cora],
      [
        { id: "u-old", partnerIds: [ada.id, ben.id], kind: "divorced" },
        { id: "u-new", partnerIds: [ada.id, cora.id], kind: "married" },
        { id: "u-sep", partnerIds: [ben.id, cora.id], kind: "separated" },
      ],
    );
    const text = serializeGedcom(tree);
    assert.match(text, /1 _KIND divorced/);
    assert.match(text, /1 DIV/);
    assert.equal(text.includes("remarried"), false);
    const sep = text.split("0 ").find((block) => block.includes("1 _KIND separated"));
    assert.ok(sep);
    assert.equal(sep!.includes("1 DIV"), false);
    const round = parseGedcom(text);
    assert.equal(round.unions.find((union) => union.partnerIds.length === 2 && union.kind === "divorced")?.kind, "divorced");
    assert.ok(round.unions.some((union) => union.kind === "married"));
    assert.ok(round.unions.some((union) => union.kind === "separated"));
  });
});
