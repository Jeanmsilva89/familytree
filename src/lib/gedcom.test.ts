import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGedcom, serializeGedcom } from "./gedcom";
import { addChild, addPartner, addUnlinkedPerson, linkExisting, startWithName, unlinkExisting, updatePerson, updateUnion } from "./tree";

describe("gedcom", () => {
  it("roundtrips people, partners, and children", () => {
    let tree = startWithName("Alex");
    const alex = tree.people[0].id;
    tree = updatePerson(tree, alex, { familyName: "River", birthDate: "1988-03-12", bio: "Example bio" });
    tree = addPartner(tree, alex, "Jordan");
    const jordan = tree.people.find((p) => p.givenName === "Jordan")!.id;
    tree = updatePerson(tree, jordan, { familyName: "River" });
    tree = addChild(tree, [alex, jordan], "Sam");
    tree = addChild(tree, [alex, jordan], "Riley");

    const text = serializeGedcom(tree);
    assert.match(text, /0 HEAD/);
    assert.match(text, /1 NAME Alex \/River\//);
    assert.match(text, /1 CHIL /);
    assert.match(text, /1 _KIN 1\.0/);
    assert.match(text, /1 _PID /);

    const imported = parseGedcom(text);
    const names = imported.people.map((p) => p.givenName).sort();
    assert.deepEqual(names, ["Alex", "Jordan", "Riley", "Sam"]);
    assert.equal(imported.unions.length, 1);
    assert.equal(imported.childLinks.length, 2);
    const alexIn = imported.people.find((p) => p.givenName === "Alex")!;
    assert.equal(alexIn.familyName, "River");
    assert.equal(alexIn.birthDate, "1988-03-12");
    assert.equal(alexIn.bio, "Example bio");
  });

  it("parses a small GEDCOM with one parent", () => {
    const ged = [
      "0 HEAD",
      "1 CHAR UTF-8",
      "0 @I1@ INDI",
      "1 NAME Casey //",
      "0 @I2@ INDI",
      "1 NAME Quinn //",
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 CHIL @I2@",
      "0 TRLR",
      "",
    ].join("\n");
    const tree = parseGedcom(ged);
    assert.equal(tree.people.length, 2);
    assert.equal(tree.childLinks.length, 1);
    assert.equal(tree.childLinks[0].parentIds.length, 1);
  });

  it("roundtrips marriage kind, date, and extra key/value facts", () => {
    let tree = startWithName("Dan");
    const dan = tree.people[0].id;
    tree = updatePerson(tree, dan, {
      familyName: "Example",
      extras: [{ key: "occupation", value: "builder" }, { key: "nickname", value: "Jaybird" }],
    });
    tree = addPartner(tree, dan, "Rae", "married");
    const rae = tree.people.find((p) => p.givenName === "Rae")!.id;
    const unionId = tree.unions[0].id;
    tree = updateUnion(tree, unionId, {
      marriedOn: "2015-06-12",
      extras: [{ key: "met_in", value: "Austin" }],
    });
    tree = updatePerson(tree, rae, { familyName: "Example" });

    const text = serializeGedcom(tree);
    assert.match(text, /1 NAME Dan \/Example\//);
    assert.match(text, /1 NAME Rae \/Example\//);
    assert.match(text, /1 MARR/);
    assert.match(text, /1 _KIND married/);
    assert.match(text, /1 _KV occupation/);
    assert.match(text, /2 _VAL builder/);
    assert.match(text, /1 _KV met_in/);
    assert.match(text, /2 DATE 12 JUN 2015/);

    const imported = parseGedcom(text);
    assert.equal(imported.people.find((p) => p.givenName === "Dan")?.id, dan);
    assert.equal(imported.unions[0].kind, "married");
    assert.equal(imported.unions[0].marriedOn, "2015-06-12");
    assert.deepEqual(imported.people.find((p) => p.givenName === "Dan")?.extras, [
      { key: "occupation", value: "builder" },
      { key: "nickname", value: "Jaybird" },
    ]);
    assert.deepEqual(imported.unions[0].extras, [{ key: "met_in", value: "Austin" }]);
  });

  it("unlinks a partner without dropping their children", () => {
    let tree = startWithName("Dan");
    const dan = tree.people[0].id;
    tree = addPartner(tree, dan, "Rae", "married");
    const rae = tree.people.find((p) => p.givenName === "Rae")!.id;
    tree = addChild(tree, [dan, rae], "Sam");
    tree = unlinkExisting(tree, dan, rae, "partner");
    assert.equal(tree.unions.length, 0);
    assert.equal(tree.childLinks.length, 1);
    assert.ok(tree.people.some((p) => p.givenName === "Rae"));
  });

  it("roundtrips adopted and step parent links", () => {
    let tree = startWithName("Tara");
    const tara = tree.people[0].id;
    tree = addUnlinkedPerson(tree, "Eli");
    const eli = tree.people.find((p) => p.givenName === "Eli")!.id;
    tree = linkExisting(tree, tara, eli, "parent", undefined, "father", "step");
    const text = serializeGedcom(tree);
    assert.match(text, /2 _KIN step/);
    const imported = parseGedcom(text);
    const link = imported.childLinks.find((item) => item.childId === tara);
    const dad = imported.people.find((p) => p.givenName === "Eli")!;
    assert.equal(link?.kin?.[dad.id], "step");
  });
});
