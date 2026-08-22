import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { personToVCard, vcardFilename } from "./vcard";
import { createPerson } from "./tree";

describe("vcard", () => {
  it("writes a vCard with name, date, and note", () => {
    const person = createPerson("Alex", {
      familyName: "River",
      birthDate: "1988-03-12",
      bio: "Loves pancakes",
      emails: ["alex@example.test"],
      phones: ["555-0100"],
    });
    const card = personToVCard(person);
    assert.match(card, /BEGIN:VCARD/);
    assert.match(card, /FN:Alex River/);
    assert.match(card, /BDAY:19880312/);
    assert.match(card, /EMAIL:alex@example.test/);
    assert.match(card, /TEL:555-0100/);
    assert.match(card, /NOTE:Loves pancakes/);
    assert.equal(vcardFilename(person), "Alex-River.vcf");
  });
});
