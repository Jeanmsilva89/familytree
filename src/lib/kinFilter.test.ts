import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LINE_FILTER,
  genealogyOnlyFilter,
  lineFilterAllows,
  lineFilterAllowsCouples,
  toggleLineKind,
} from "./kinFilter";
import { kinOf, strongestKin } from "./types";

describe("kin filters", () => {
  it("shows every line by default", () => {
    assert.equal(lineFilterAllows(DEFAULT_LINE_FILTER, "blood"), true);
    assert.equal(lineFilterAllows(DEFAULT_LINE_FILTER, "adopted"), true);
    assert.equal(lineFilterAllows(DEFAULT_LINE_FILTER, "step"), true);
    assert.equal(lineFilterAllows(DEFAULT_LINE_FILTER, "foster"), true);
    assert.equal(lineFilterAllowsCouples(DEFAULT_LINE_FILTER), true);
  });

  it("hides non-blood lines when genealogy only is on", () => {
    const filter = genealogyOnlyFilter(true, DEFAULT_LINE_FILTER);
    assert.equal(lineFilterAllows(filter, "blood"), true);
    assert.equal(lineFilterAllows(filter, "adopted"), false);
    assert.equal(lineFilterAllows(filter, "step"), false);
    assert.equal(lineFilterAllowsCouples(filter), false);
  });

  it("can hide just step lines", () => {
    const filter = toggleLineKind(DEFAULT_LINE_FILTER, "step");
    assert.equal(filter.step, false);
    assert.equal(lineFilterAllows(filter, "step"), false);
    assert.equal(lineFilterAllows(filter, "blood"), true);
  });

  it("treats missing kin as blood", () => {
    assert.equal(kinOf({ kin: { dad: "step" } }, "dad"), "step");
    assert.equal(kinOf({ kin: { dad: "step" } }, "mom"), "blood");
    assert.equal(strongestKin(["step", "blood", "adopted"]), "blood");
    assert.equal(strongestKin(["step", "adopted"]), "adopted");
  });
});
