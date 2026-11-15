import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARD } from "./layout";
import type { TreeData } from "./types";
import { layoutFamilySky } from "./familySky";
import {
  AVATAR_NODE_R,
  AVATAR_ROOM,
  NODE_GAP,
  gapOutsideNode,
  nodeVisibility,
  personLinkEnd,
  type PersonNode,
} from "./familySkyEnds";

/**
 * FIXTURE geometry only. These points are not people.
 */

const verifyTree = JSON.parse(readFileSync(new URL("../../scripts/fixtures/verify-family-sky.json", import.meta.url), "utf8")) as TreeData;

const person: PersonNode = { x: 100, y: 40, starX: 400, starY: 260 };
const other = { x: 100, y: 40 + CARD.h / 2 + 300 };

describe("personLinkEnd (FIXTURE geometry)", () => {
  it("stops a family-zoom link a few pixels outside the avatar, on the facing side", () => {
    const end = personLinkEnd(person, other, "mid");
    assert.ok(end);
    const center = { x: person.x, y: person.y + CARD.h / 2 };
    const dist = Math.hypot(end.x - center.x, end.y - center.y);
    assert.ok(Math.abs(dist - AVATAR_ROOM) < 1e-6, `distance ${dist}`);
    assert.ok(Math.abs(gapOutsideNode(end, person, "mid") - NODE_GAP) < 1e-6);
    assert.ok(end.y > center.y, "the end faces the other person");
    assert.ok(Math.abs(end.x - center.x) < 1e-6);
    const away = personLinkEnd(person, { x: center.x, y: center.y - 300 }, "mid");
    assert.ok(away && away.y < center.y);
  });

  it("stops a close-up link a few pixels outside the portrait", () => {
    const end = personLinkEnd(person, other, "near");
    assert.ok(end);
    const gap = gapOutsideNode(end, person, "near");
    assert.ok(Math.abs(gap - NODE_GAP) < 1e-6, `gap ${gap}`);
    const center = { x: person.x, y: person.y + CARD.h / 2 };
    assert.ok(end.y > center.y + CARD.h / 2);
  });

  it("ends a collapsed star-zoom link on the family star", () => {
    const end = personLinkEnd(person, other, "far");
    assert.deepEqual(end, { x: person.starX, y: person.starY });
    assert.equal(gapOutsideNode(end!, person, "far"), 0);
    const avatar = { x: person.x, y: person.y + CARD.h / 2 };
    assert.ok(Math.hypot(end!.x - avatar.x, end!.y - avatar.y) > AVATAR_NODE_R);
  });

  it("does not draw a link to someone a lens has hidden, and does draw one to someone dimmed", () => {
    assert.equal(personLinkEnd(person, other, "mid", "hidden"), null);
    assert.equal(personLinkEnd(person, other, "near", "hidden"), null);
    assert.equal(personLinkEnd(person, other, "far", "hidden"), null);
    const dimmed = personLinkEnd(person, other, "mid", "dimmed");
    assert.deepEqual(dimmed, personLinkEnd(person, other, "mid", "shown"));
  });

  it("reads a lens mark the way the sky draws it", () => {
    assert.equal(nodeVisibility(undefined, false), "shown");
    assert.equal(nodeVisibility(undefined, true), "hidden");
    assert.equal(nodeVisibility({ draw: "ghost", presence: "shown" }, true), "hidden");
    assert.equal(nodeVisibility({ draw: "shown", presence: "dimmed" }, true), "dimmed");
    assert.equal(nodeVisibility({ draw: "shown", presence: "shown" }, true), "shown");
  });

  it("returns the same point for the same person", () => {
    assert.deepEqual(personLinkEnd(person, other, "mid"), personLinkEnd(person, other, "mid"));
    assert.deepEqual(personLinkEnd(person, other, "near"), personLinkEnd(person, other, "near"));
  });
});

describe("family sky link ends on the verify fixture", () => {
  const sky = layoutFamilySky(verifyTree);

  it("keeps every family-zoom endpoint a few pixels outside its avatar", () => {
    assert.ok(sky.links.length >= 3);
    for (const link of sky.links) {
      const from = sky.cards.find((card) => card.id === link.fromPersonId);
      const to = sky.cards.find((card) => card.id === link.toPersonId);
      assert.ok(from && to, link.id);
      const start = link.midPieces[0];
      const finish = link.midPieces[link.midPieces.length - 1];
      assert.ok(start && finish, link.id);
      const fromNode: PersonNode = { x: from.x, y: from.y, starX: 0, starY: 0 };
      const toNode: PersonNode = { x: to.x, y: to.y, starX: 0, starY: 0 };
      const startGap = gapOutsideNode({ x: start.x1, y: start.y1 }, fromNode, "mid");
      const endGap = gapOutsideNode({ x: finish.x2, y: finish.y2 }, toNode, "mid");
      assert.ok(Math.abs(startGap - NODE_GAP) < 1.5, `${link.id} start gap ${startGap.toFixed(1)}`);
      assert.ok(Math.abs(endGap - NODE_GAP) < 1.5, `${link.id} end gap ${endGap.toFixed(1)}`);
    }
  });

  it("keeps every close-up endpoint a few pixels outside its portrait", () => {
    for (const link of sky.links) {
      const from = sky.cards.find((card) => card.id === link.fromPersonId);
      const to = sky.cards.find((card) => card.id === link.toPersonId);
      assert.ok(from && to, link.id);
      const start = link.pieces[0];
      const finish = link.pieces[link.pieces.length - 1];
      assert.ok(start && finish, link.id);
      const fromNode: PersonNode = { x: from.x, y: from.y, starX: 0, starY: 0 };
      const toNode: PersonNode = { x: to.x, y: to.y, starX: 0, starY: 0 };
      const startGap = gapOutsideNode({ x: start.x1, y: start.y1 }, fromNode, "near");
      const endGap = gapOutsideNode({ x: finish.x2, y: finish.y2 }, toNode, "near");
      assert.ok(startGap > 0 && startGap < 16, `${link.id} start gap ${startGap.toFixed(1)}`);
      assert.ok(endGap > 0 && endGap < 16, `${link.id} end gap ${endGap.toFixed(1)}`);
    }
  });

  it("ends the collapsed star lines on the family stars", () => {
    assert.ok(sky.unitEdges.length >= 1);
    for (const edge of sky.unitEdges) {
      const a = sky.buckets.find((bucket) => bucket.id === edge.aId);
      const b = sky.buckets.find((bucket) => bucket.id === edge.bId);
      assert.ok(a && b);
      assert.equal(edge.x1, a.cx);
      assert.equal(edge.y1, a.cy);
      assert.equal(edge.x2, b.cx);
      assert.equal(edge.y2, b.cy);
    }
  });
});
