import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ChildLink, Person, TreeData, Union } from "./types";
import {
  canOrbitFocus,
  fitGeneration,
  initialOrbit,
  isFixtureTree,
  previewSeen,
  layoutOrbit,
  orbitSegments,
  reduceOrbit,
  type OrbitEvent,
  type OrbitState,
  type SeenPerson,
} from "./orbitView";

const stamp = { createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z" };

function person(id: string, givenName: string, extras: Partial<Person> = {}): Person {
  return { id, givenName, familyName: "Fixture", ...stamp, ...extras };
}

function tree(people: Person[], unions: Union[] = [], childLinks: ChildLink[] = []): TreeData {
  return { people, unions, childLinks };
}

function seen(ids: string[], patch: Partial<SeenPerson> = {}): Map<string, SeenPerson> {
  return new Map(ids.map((id) => [id, { id, presence: "shown", details: "open", ...patch }]));
}

function run(events: OrbitEvent[], start: OrbitState = initialOrbit()) {
  let state = start;
  const effects = [];
  for (const event of events) {
    const decision = reduceOrbit(state, event);
    state = decision.state;
    effects.push(decision.effect);
  }
  return { state, effects };
}

const fixture = JSON.parse(readFileSync("scripts/fixtures/verify-family-sky.json", "utf8")) as TreeData & { note?: string };

describe("orbit seats", () => {
  it("uses the fixture family and labels it as fixture data", () => {
    assert.equal(isFixtureTree(fixture), true);
    assert.match(fixture.note ?? "", /FIXTURE/);
    for (const person of fixture.people) assert.equal(person.familyName, "Fixture");
    const stranger = tree([person("a", "Ada", { familyName: "Stone" })]);
    assert.equal(isFixtureTree(stranger), false);
  });

  it("seats the partner beside, parents and children nearby, and everyone else back", () => {
    const seats = layoutOrbit(fixture, "fx-eli");
    assert.ok(seats);
    const at = new Map(seats.map((seat) => [seat.id, seat]));
    const eli = at.get("fx-eli")!;
    const dee = at.get("fx-dee")!;
    const fay = at.get("fx-fay")!;
    const ada = at.get("fx-ada")!;
    const ben = at.get("fx-ben")!;
    const rex = at.get("fx-rex")!;
    const cora = at.get("fx-cora")!;
    const wynn = at.get("fx-wynn")!;
    assert.equal(eli.ring, "center");
    assert.equal(dee.ring, "partner");
    assert.ok(dee.x > eli.x + 40 && Math.abs(dee.y - eli.y) < 2);
    assert.equal(fay.ring, "near");
    assert.ok(fay.y > eli.y + 40);
    assert.equal(ada.ring, "near");
    assert.equal(ben.ring, "near");
    assert.equal(rex.ring, "near");
    assert.ok(ada.y < eli.y - 40);
    assert.equal(cora.ring, "near");
    assert.equal(wynn.ring, "outer");
    assert.ok(wynn.opacity < 0.5);
    assert.equal(eli.opacity, 1);
    assert.ok(Math.hypot(wynn.x - eli.x, wynn.y - eli.y) > Math.hypot(ada.x - eli.x, ada.y - eli.y));
  });

  it("keeps a step-parent nearby and does not seat a divorced partner beside", () => {
    const nia = layoutOrbit(fixture, "fx-nia");
    assert.ok(nia);
    const at = new Map(nia.map((seat) => [seat.id, seat]));
    assert.equal(at.get("fx-pal")!.ring, "partner");
    assert.equal(at.get("fx-stu")!.ring, "near");
    assert.equal(at.get("fx-eli")!.ring, "outer");

    const divorced = tree(
      [person("eli", "Eli"), person("dee", "Dee"), person("rema", "Rema"), person("fay", "Fay")],
      [
        { id: "old", partnerIds: ["eli", "dee"], kind: "divorced" },
        { id: "now", partnerIds: ["eli", "rema"], kind: "married" },
      ],
      [{ id: "kid", childId: "fay", parentIds: ["eli", "dee"] }],
    );
    const seats = layoutOrbit(divorced, "eli");
    assert.ok(seats);
    const placed = new Map(seats.map((seat) => [seat.id, seat]));
    assert.equal(placed.get("rema")!.ring, "partner");
    assert.equal(placed.get("dee")!.ring, "outer");
    assert.equal(placed.get("fay")!.ring, "near");
  });

  it("omits a hidden person, dials a dimmed relative back, and ignores withheld details", () => {
    const hidden = seen(fixture.people.map((item) => item.id));
    hidden.delete("fx-rex");
    const withoutRex = layoutOrbit(fixture, "fx-eli", hidden);
    assert.ok(withoutRex);
    assert.equal(withoutRex.some((seat) => seat.id === "fx-rex"), false);
    assert.equal(canOrbitFocus("fx-rex", { seen: hidden }), false);

    const dimmed = seen(fixture.people.map((item) => item.id));
    dimmed.set("fx-fay", { id: "fx-fay", presence: "dimmed", details: "withheld" });
    const dialed = layoutOrbit(fixture, "fx-eli", dimmed);
    assert.ok(dialed);
    const fay = dialed.find((seat) => seat.id === "fx-fay")!;
    assert.equal(fay.ring, "outer");
    assert.ok(fay.opacity < 0.45);
    assert.equal(canOrbitFocus("fx-fay", { seen: dimmed }), false);

    const withheld = seen(["fx-eli", "fx-dee"]);
    withheld.set("fx-dee", { id: "fx-dee", presence: "shown", details: "withheld" });
    const open = layoutOrbit(fixture, "fx-eli", seen(["fx-eli", "fx-dee"]));
    const closed = layoutOrbit(fixture, "fx-eli", withheld);
    assert.deepEqual(
      open?.map(({ id, ring, x, y }) => ({ id, ring, x, y })),
      closed?.map(({ id, ring, x, y }) => ({ id, ring, x, y })),
    );
  });

  it("builds a preview from shown marks only", () => {
    const seen = previewSeen([
      { personId: "fx-eli", draw: "shown", presence: "shown", details: "open" },
      { personId: "fx-dee", draw: "shown", presence: "shown", details: "withheld" },
      { personId: "fx-fay", draw: "shown", presence: "dimmed", details: "withheld" },
      { personId: "fx-rex", draw: "ghost", presence: "shown", details: "open" },
    ]);
    assert.equal(seen.has("fx-rex"), false);
    assert.equal(seen.get("fx-fay")?.presence, "dimmed");
    assert.equal(seen.get("fx-dee")?.details, "withheld");
    assert.equal(canOrbitFocus("fx-eli", { seen }), true);
    assert.equal(canOrbitFocus("fx-rex", { seen }), false);
  });

  it("refuses a focus while editing or arranging a lens", () => {
    assert.equal(canOrbitFocus("fx-eli", { tree: fixture }), true);
    assert.equal(canOrbitFocus("fx-eli", { tree: fixture, editMode: true }), false);
    assert.equal(canOrbitFocus("fx-eli", { tree: fixture, arranging: true }), false);
    assert.equal(canOrbitFocus("missing", { tree: fixture }), false);
  });

  it("fits generation rows into the view without reordering them", () => {
    const framed = fitGeneration(
      [
        { id: "ada", x: 0, y: 0 },
        { id: "eli", x: 400, y: 280 },
        { id: "fay", x: 400, y: 560 },
      ],
      { w: 390, h: 700 },
      { top: 100, right: 16, bottom: 24, left: 16 },
    );
    const at = new Map(framed.cards.map((card) => [card.id, card]));
    assert.ok(at.get("ada")!.y < at.get("eli")!.y);
    assert.ok(at.get("eli")!.y < at.get("fay")!.y);
    assert.ok(framed.scale <= 1);
    for (const card of framed.cards) {
      assert.ok(card.x >= 16 - 1 && card.x <= 390 - 16 + 1);
      assert.ok(card.y >= 100 - 1 && card.y <= 700 - 24 + 1);
    }
  });
});

describe("orbit gesture", () => {
  const hold = { type: "hold", personId: "fx-eli", allowed: true } as const;

  it("does not orbit on a tap, and the second tap opens the editor", () => {
    const once = run([{ type: "tap", personId: "fx-eli" }]);
    assert.equal(once.state.layout, "rows");
    assert.equal(once.state.lines, "shown");
    assert.equal(once.state.focusId, null);
    assert.deepEqual(once.effects[0], { type: "select", personId: "fx-eli" });

    const twice = run([
      { type: "tap", personId: "fx-eli" },
      { type: "tap", personId: "fx-eli" },
    ]);
    assert.equal(twice.state.layout, "rows");
    assert.deepEqual(twice.effects[1], { type: "open-editor", personId: "fx-eli" });
  });

  it("hides the lines before anyone moves, then draws them after the cards settle", () => {
    const started = run([hold]);
    assert.equal(started.state.layout, "rows");
    assert.equal(started.state.lines, "out");
    assert.equal(started.state.focusId, "fx-eli");
    assert.equal(started.state.motion, "idle");

    const gliding = run([{ type: "lines-gone" }], started.state);
    assert.equal(gliding.state.layout, "orbit");
    assert.equal(gliding.state.lines, "hidden");
    assert.equal(gliding.state.motion, "glide");

    const drawing = run([{ type: "cards-settled" }], gliding.state);
    assert.equal(drawing.state.motion, "idle");
    assert.equal(drawing.state.lines, "in");
    assert.equal(drawing.state.layout, "orbit");

    const shown = run([{ type: "lines-back" }], drawing.state);
    assert.equal(shown.state.lines, "shown");
    assert.equal(shown.state.layout, "orbit");
  });

  it("ignores a hold that permission refuses, and a tap never starts the glide", () => {
    const refused = run([{ type: "hold", personId: "fx-eli", allowed: false }]);
    assert.equal(refused.state.layout, "rows");
    assert.equal(refused.state.lines, "shown");
    assert.equal(refused.state.focusId, null);

    const tapped = run([{ type: "tap", personId: "fx-dee" }, { type: "lines-gone" }, { type: "cards-settled" }]);
    assert.equal(tapped.state.layout, "rows");
    assert.equal(tapped.state.motion, "idle");
  });

  it("reverses to the generation rows when cleared", () => {
    const focused = run([hold, { type: "lines-gone" }, { type: "cards-settled" }, { type: "lines-back" }]);
    assert.equal(focused.state.layout, "orbit");
    const leaving = run([{ type: "clear" }], focused.state);
    assert.equal(leaving.state.layout, "orbit");
    assert.equal(leaving.state.lines, "out");
    const gliding = run([{ type: "lines-gone" }], leaving.state);
    assert.equal(gliding.state.layout, "rows");
    assert.equal(gliding.state.lines, "hidden");
    assert.equal(gliding.state.motion, "glide");
    const home = run([{ type: "cards-settled" }, { type: "lines-back" }], gliding.state);
    assert.equal(home.state.layout, "rows");
    assert.equal(home.state.lines, "shown");
    assert.equal(home.state.focusId, null);
    assert.equal(home.state.motion, "idle");
  });

  it("draws relationship lines from the settled seats and drops a hidden endpoint", () => {
    const seats = layoutOrbit(fixture, "fx-eli");
    assert.ok(seats);
    const lines = orbitSegments(fixture, seats);
    assert.ok(lines.some((line) => line.fromId === "fx-dee" && line.toId === "fx-eli" && line.kind === "partner"));
    assert.ok(lines.some((line) => line.fromId === "fx-eli" && line.toId === "fx-fay"));
    const hidden = seats.filter((seat) => seat.id !== "fx-fay");
    const remaining = orbitSegments(fixture, hidden);
    assert.equal(remaining.some((line) => line.toId === "fx-fay" || line.fromId === "fx-fay"), false);
  });
});
