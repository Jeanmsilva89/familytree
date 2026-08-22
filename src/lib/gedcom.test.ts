import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGedcom, serializeGedcom } from "./gedcom";
import { addChild, addPartner, startWithName, updatePerson } from "./tree";

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
});
