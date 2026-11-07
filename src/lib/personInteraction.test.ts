import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOLD_SLOP_PX,
  gatheredPersonId,
  initialInteraction,
  reducePersonInteraction,
  type InteractionEvent,
  type PersonInteraction,
} from "./personInteraction";

function run(events: InteractionEvent[], start: PersonInteraction = initialInteraction()) {
  let state = start;
  const effects = [];
  for (const event of events) {
    const decision = reducePersonInteraction(state, event);
    state = decision.state;
    effects.push(decision.effect);
  }
  return { state, effects };
}

const down = { type: "pointer-down", personId: "eli", pointerId: 1, x: 40, y: 50, editDrag: false } as const;

describe("person interaction", () => {
  it("selects on a tap and leaves the generation layout in place", () => {
    const { state, effects } = run([{ type: "tap", personId: "eli" }]);
    assert.equal(state.selectedId, "eli");
    assert.deepEqual(state.focus, { kind: "generation" });
    assert.equal(state.menu, null);
    assert.deepEqual(effects[0], { type: "select", personId: "eli" });
    assert.equal(gatheredPersonId(state.focus, false), null);
  });

  it("opens the editor on a second tap and still does not gather", () => {
    const { state, effects } = run([
      { type: "tap", personId: "eli" },
      { type: "tap", personId: "eli" },
    ]);
    assert.equal(state.selectedId, "eli");
    assert.deepEqual(state.focus, { kind: "generation" });
    assert.deepEqual(effects[1], { type: "open-editor", personId: "eli" });
  });

  it("opens a menu when a hold completes and does not gather", () => {
    const { state, effects } = run([down, { type: "hold-elapsed" }]);
    assert.equal(state.menu?.personId, "eli");
    assert.equal(state.menu?.interactive, false);
    assert.equal(state.hold, null);
    assert.equal(state.swallowTap, true);
    assert.deepEqual(state.focus, { kind: "generation" });
    assert.deepEqual(effects.at(-1), { type: "select", personId: "eli" });
    assert.equal(gatheredPersonId(state.focus, false), null);
  });

  it("swallows the click that follows a hold, and dismissing the menu leaves the layout", () => {
    const { state } = run([
      down,
      { type: "hold-elapsed" },
      { type: "tap", personId: "eli" },
      { type: "dismiss-menu" },
    ]);
    assert.equal(state.menu, null);
    assert.equal(state.selectedId, "eli");
    assert.deepEqual(state.focus, { kind: "generation" });
    assert.equal(state.swallowTap, false);
  });

  it("gathers only after the menu can take a click", () => {
    const closed = run([down, { type: "hold-elapsed" }, { type: "gather" }]);
    assert.deepEqual(closed.state.focus, { kind: "generation" });

    const { state, effects } = run([down, { type: "hold-elapsed" }, { type: "drop-swallow" }, { type: "gather" }]);
    assert.deepEqual(state.focus, { kind: "personal", personId: "eli" });
    assert.equal(state.menu, null);
    assert.equal(state.selectedId, "eli");
    assert.deepEqual(effects.at(-1), { type: "gather", personId: "eli" });
    assert.equal(gatheredPersonId(state.focus, false), "eli");
    assert.equal(gatheredPersonId(state.focus, true), null);
  });

  it("keeps an existing personal map when a later tap selects someone else", () => {
    const gathered = run([down, { type: "hold-elapsed" }, { type: "drop-swallow" }, { type: "gather" }]).state;
    const { state, effects } = run([{ type: "tap", personId: "cora" }], gathered);
    assert.equal(state.selectedId, "cora");
    assert.deepEqual(state.focus, { kind: "personal", personId: "eli" });
    assert.deepEqual(effects[0], { type: "select", personId: "cora" });
  });

  it("cancels a hold when the pointer drags, and the following tap does nothing", () => {
    const { state } = run([
      down,
      { type: "pointer-move", pointerId: 1, x: 40 + HOLD_SLOP_PX + 1, y: 50 },
      { type: "hold-elapsed" },
      { type: "tap", personId: "eli" },
    ]);
    assert.equal(state.menu, null);
    assert.equal(state.selectedId, undefined);
    assert.deepEqual(state.focus, { kind: "generation" });
    assert.equal(state.swallowTap, false);
  });

  it("still selects when the pointer stays inside the slop", () => {
    const { state, effects } = run([
      down,
      { type: "pointer-move", pointerId: 1, x: 40 + HOLD_SLOP_PX, y: 50 },
      { type: "pointer-up", pointerId: 1 },
      { type: "tap", personId: "eli" },
    ]);
    assert.equal(state.menu, null);
    assert.equal(state.selectedId, "eli");
    assert.deepEqual(effects.at(-1), { type: "select", personId: "eli" });
  });

  it("cancels a hold for a second pointer or a cancelled pointer", () => {
    const pinch = run([down, { type: "extra-pointer" }, { type: "hold-elapsed" }]);
    assert.equal(pinch.state.menu, null);
    assert.equal(pinch.state.swallowTap, true);
    const lost = run([down, { type: "pointer-cancel", pointerId: 1 }, { type: "hold-elapsed" }]);
    assert.equal(lost.state.menu, null);
    assert.equal(lost.state.swallowTap, true);
  });

  it("does not arm a hold when the press is an edit drag", () => {
    const { state } = run([
      { ...down, editDrag: true },
      { type: "hold-elapsed" },
    ]);
    assert.equal(state.hold, null);
    assert.equal(state.menu, null);
    assert.deepEqual(state.focus, { kind: "generation" });
  });

  it("opens the same menu from the context-menu path without gathering", () => {
    const { state } = run([{ type: "context-menu", personId: "eli", x: 12, y: 18 }]);
    assert.equal(state.menu?.personId, "eli");
    assert.equal(state.menu?.interactive, false);
    assert.deepEqual(state.focus, { kind: "generation" });
    assert.equal(state.selectedId, "eli");
  });

  it("restores the generation layout from clear and leaves a dismissed menu ungathered", () => {
    const gathered = run([down, { type: "hold-elapsed" }, { type: "drop-swallow" }, { type: "gather" }]).state;
    const cleared = run([{ type: "clear" }], gathered);
    assert.deepEqual(cleared.state, initialInteraction());
    assert.deepEqual(cleared.effects[0], { type: "clear" });

    const dismissed = run([down, { type: "hold-elapsed" }, { type: "dismiss-menu" }]);
    assert.equal(dismissed.state.menu, null);
    assert.deepEqual(dismissed.state.focus, { kind: "generation" });
  });

  it("edits from the menu only after the menu is interactive", () => {
    const early = run([down, { type: "hold-elapsed" }, { type: "edit-from-menu" }]);
    assert.deepEqual(early.effects.at(-1), { type: "none" });
    const { state, effects } = run([down, { type: "hold-elapsed" }, { type: "drop-swallow" }, { type: "edit-from-menu" }]);
    assert.equal(state.menu, null);
    assert.deepEqual(state.focus, { kind: "generation" });
    assert.deepEqual(effects.at(-1), { type: "open-editor", personId: "eli" });
  });
});
