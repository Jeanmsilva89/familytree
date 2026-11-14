import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARD } from "./layout";
import { type Curve } from "./familySky";
import type { TreeData } from "./types";
import { layoutFamilySky, skyLinksOnScreen } from "./familySky";
import {
  LINK_BOW_LIMIT,
  curveBowRatio,
  curveEntersBucket,
  pointInBucket,
  routePersonLink,
  type RouteBucket,
} from "./familySkyRoute";

/**
 * FIXTURE geometry only. These points and buckets are not people. They exist
 * so the link router can be tested without any real family.
 */

const verifyTree = JSON.parse(readFileSync(new URL("../../scripts/fixtures/verify-family-sky.json", import.meta.url), "utf8")) as TreeData;

function midY(cardY: number) {
  return cardY + CARD.h / 2;
}

describe("routePersonLink (FIXTURE geometry)", () => {
  it("keeps an open link almost straight, with the bow proportional to the distance", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 640, y: 30 };
    const curve = routePersonLink({ from, to });
    const ratio = curveBowRatio(curve);
    assert.ok(ratio <= LINK_BOW_LIMIT, `bow ${(ratio * 100).toFixed(1)}%`);
    assert.ok(ratio < 0.04, `an open link should not loop, bow ${(ratio * 100).toFixed(1)}%`);
    const chord = Math.hypot(curve.x2 - curve.x1, curve.y2 - curve.y1);
    assert.ok(curveBowRatio(curve) * chord <= LINK_BOW_LIMIT * chord + 1e-6);
  });

  it("does not cross an unrelated bucket when a gentle path avoids it", () => {
    // Two cards on one row. A bucket covers every straight port-to-port line
    // between them. A second bucket sits above, where a wide loop would travel.
    // A short bow downward misses both; the limit forbids the wide loop.
    const from = { x: 0, y: 0 };
    const to = { x: 900, y: 0 };
    const centerY = midY(0);
    const blocker: RouteBucket = { cx: 450, cy: centerY, rx: 170, ry: 96, n: 4 };
    const wideLoop: RouteBucket = { cx: 450, cy: centerY - 280, rx: 120, ry: 70, n: 4 };
    const straight = routePersonLink({ from, to, foreign: [], bowLimit: 0 });
    assert.ok(curveBowRatio(straight) < 1e-6, "bowLimit 0 stays on the chord");
    assert.ok(
      curveEntersBucket(straight, blocker),
      "the straight line is blocked, so avoiding it is a real choice",
    );
    const curve = routePersonLink({ from, to, foreign: [blocker, wideLoop] });
    const ratio = curveBowRatio(curve);
    assert.ok(ratio <= LINK_BOW_LIMIT + 1e-9, `bow ${(ratio * 100).toFixed(1)}% exceeds the limit`);
    assert.equal(curveEntersBucket(curve, blocker), false);
    assert.equal(curveEntersBucket(curve, wideLoop), false);
    assert.equal(pointInBucket(blocker, { x: blocker.cx, y: blocker.cy }), true);
  });

  it("still caps the bow when every gentle path has to touch a bucket", () => {
    // FIXTURE: the unrelated bucket is wider than the bow budget, so no gentle
    // curve can leave it. The route must stay inside the bow limit anyway.
    const from = { x: 0, y: 0 };
    const to = { x: 520, y: 0 };
    const wall: RouteBucket = { cx: 260, cy: midY(0), rx: 200, ry: 420, n: 4 };
    const curve = routePersonLink({ from, to, foreign: [wall] });
    assert.ok(curveBowRatio(curve) <= LINK_BOW_LIMIT + 1e-9);
  });

  it("routes the labeled verify fixture inside the bow limit and outside other families", () => {
    const sky = layoutFamilySky(verifyTree);
    assert.ok(sky.links.length >= 3);
    for (const link of sky.links) {
      assert.ok(curveBowRatio(link) <= LINK_BOW_LIMIT + 1e-6, link.id);
      const foreign = sky.buckets.filter((b) => b.id !== link.fromUnitId && b.id !== link.toUnitId);
      const curves: Curve[] = [link, ...link.pieces];
      for (const curve of curves) {
        for (const bucket of foreign) {
          assert.equal(curveEntersBucket(curve, bucket), false, `${link.id} crosses ${bucket.label}`);
        }
      }
    }
  });

  it("routes around a third family near one end when a midpoint bow still cuts it", () => {
    // FIXTURE geometry. The third circle sits on the chord, close to one
    // person. Bulging from the midpoint, even at the bow limit, still enters
    // that circle. A bend slid toward that end goes around it.
    const from = { x: 0, y: 0 };
    const to = { x: 1100, y: 0 };
    const third: RouteBucket = { cx: 900, cy: midY(0) - 10, rx: 100, ry: 170, n: 4 };
    const straight = routePersonLink({ from, to, foreign: [], bowLimit: 0 });
    assert.equal(curveEntersBucket(straight, third), true);
    const routed = routePersonLink({ from, to, foreign: [third] });
    const again = routePersonLink({ from, to, foreign: [third] });
    assert.deepEqual(routed, again);
    assert.equal(curveEntersBucket(routed, third), false);
    const ratio = curveBowRatio(routed);
    assert.ok(ratio <= LINK_BOW_LIMIT + 1e-9, `bow ${(ratio * 100).toFixed(1)}%`);
    const dx = routed.x2 - routed.x1;
    const dy = routed.y2 - routed.y1;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;
    const midpointClears = [0, 0.04, -0.04, 0.08, -0.08, 0.12, -0.12, 0.16, -0.16].some((bend) => {
      const q = {
        x1: routed.x1,
        y1: routed.y1,
        cx: (routed.x1 + routed.x2) / 2 + nx * len * bend * 2,
        cy: (routed.y1 + routed.y2) / 2 + ny * len * bend * 2,
        x2: routed.x2,
        y2: routed.y2,
      };
      return !curveEntersBucket(q, third);
    });
    assert.equal(midpointClears, false);
  });

  it("returns the same curve for the same cards and families", () => {
    const from = { x: 40, y: 10 };
    const to = { x: 520, y: 80 };
    const foreign: RouteBucket[] = [{ cx: 280, cy: midY(40), rx: 70, ry: 48, n: 4 }];
    assert.deepEqual(routePersonLink({ from, to, foreign }), routePersonLink({ from, to, foreign }));
  });

  it("does not draw a link to someone a lens has hidden", () => {
    const hidden = new Set(verifyTree.people.map((person) => person.id).filter((id) => id !== "fx-eli"));
    const sky = layoutFamilySky(verifyTree, routePersonLink, hidden);
    assert.equal(sky.cards.some((card) => card.id === "fx-eli"), false);
    assert.equal(
      sky.links.some((link) => link.fromPersonId === "fx-eli" || link.toPersonId === "fx-eli"),
      false,
    );
    assert.ok(sky.links.length >= 1);
  });

  it("keeps the verify fixture's drawn links within the measured bow and crossing bounds", () => {
    const sky = layoutFamilySky(verifyTree);
    for (const [name, vw, vh] of [
      ["phone", 390, 844],
      ["desktop", 1280, 800],
    ] as const) {
      const shown = skyLinksOnScreen(vw, vh, sky);
      assert.notEqual(shown.level, "far", name);
      assert.equal(shown.measure.foreignCrossings, 0, name);
      assert.equal(shown.measure.pairwiseCrossings, 0, name);
      assert.ok(shown.measure.maxBow <= 0.115, `${name} bow ${shown.measure.maxBow}`);
      assert.ok(shown.measure.linkCount >= 3, name);
    }
  });
});
