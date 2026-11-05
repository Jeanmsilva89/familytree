import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARD } from "./layout";
import { layoutFamilySky, type Curve } from "./familySky";
import type { TreeData } from "./types";
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
});
