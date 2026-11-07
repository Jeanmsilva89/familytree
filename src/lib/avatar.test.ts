import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initialsOf, swatchHue } from "./layout";
import { avatarMarkup, avatarSpec, avatarSvg } from "./avatar";
import type { Person } from "./types";

function named(id: string, givenName: string, familyName?: string): Person {
  return {
    id,
    givenName,
    familyName,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function geometry(id: string, givenName = "Ada", familyName = "Fixture") {
  const spec = avatarSpec({ id, givenName, familyName });
  return { light: spec.light, arc: spec.arc };
}

describe("generated avatar", () => {
  it("returns the same mark every time for the same person", () => {
    const person = { id: "fx-ada", givenName: "Ada", familyName: "Fixture" };
    assert.deepEqual(avatarSpec(person), avatarSpec({ ...person }));
    assert.equal(avatarSvg(person), avatarSvg({ ...person }));
    assert.equal(avatarMarkup(avatarSpec(person)), avatarSvg(person));
  });

  it("keeps the geometry when the id stays and the name changes", () => {
    const ada = avatarSpec({ id: "fx-ada", givenName: "Ada", familyName: "Fixture" });
    const renamed = avatarSpec({ id: "fx-ada", givenName: "Adele" });
    assert.deepEqual(ada.light, renamed.light);
    assert.equal(ada.arc, renamed.arc);
    assert.notEqual(ada.initials, renamed.initials);
    assert.notEqual(ada.hue, renamed.hue);
  });

  it("gives different ids different geometry, even with the same name", () => {
    const ids = ["fx-ada", "fx-ben", "fx-cora", "fx-eli", "fx-dee", "fx-fay", "fx-gran", "fx-mae", "fx-stu", "fx-nia", "fx-pal", "fx-rex"];
    const marks = ids.map((id) => JSON.stringify(geometry(id)));
    assert.equal(new Set(marks).size, ids.length);
  });

  it("uses the existing swatch hue and the same initials as the cards", () => {
    const person = named("fx-ada", "Ada", "Fixture");
    const spec = avatarSpec(person);
    assert.equal(spec.hue, swatchHue(person));
    assert.equal(spec.initials, initialsOf(person));
    assert.equal(spec.initials, "AF");
    assert.match(avatarSvg(person), />AF</);
  });

  it("works from a given name alone", () => {
    const spec = avatarSpec({ id: "solo", givenName: "Cora" });
    assert.equal(spec.initials, "C");
    assert.equal(spec.hue, swatchHue(named("solo", "Cora")));
    assert.match(avatarSvg({ id: "solo", givenName: "Cora" }), />C</);
    assert.ok(spec.light.r >= 30);
    assert.match(spec.arc, /^M/);
  });

  it("falls back to a question mark when the name is blank", () => {
    const spec = avatarSpec({ id: "blank", givenName: "  ", familyName: " " });
    assert.equal(spec.initials, "?");
    assert.match(avatarSvg({ id: "blank", givenName: "  ", familyName: " " }), />\?</);
  });

  it("keeps one person's mark fixed", () => {
    const spec = avatarSpec({ id: "fx-ada", givenName: "Ada", familyName: "Fixture" });
    assert.equal(spec.hue, 204);
    assert.equal(spec.initials, "AF");
    assert.deepEqual(spec.light, { x: 32, y: 48, r: 33 });
    assert.equal(spec.arc, "M72 27A35 35 0 0 1 15 65");
  });

  it("escapes initials and stays local", () => {
    const svg = avatarSvg({ id: "mark", givenName: "<", familyName: "&" });
    assert.match(svg, /&lt;&amp;/);
    assert.equal(svg.includes("<&"), false);
    assert.equal(svg.includes("http"), false);
    assert.equal(svg.includes("url("), false);
  });
});
