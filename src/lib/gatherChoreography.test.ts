import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "./layout";
import { graphFromPersonalMap, layoutPersonalMap } from "./personalMap";
import type { Person, TreeData } from "./types";
import {
  GATHER_LINES_OUT_MS,
  GATHER_REDUCED_MS,
  GATHER_TOTAL_MS,
  frameAt,
  gatherCameraAt,
  gatherEase,
  gatherRole,
  trackPose,
  interruptGather,
  planGather,
  type GatherPoint,
} from "./gatherChoreography";

/**
 * FIXTURE people only. The clock has to hide lines, stagger by closeness,
 * finish on the seats, and survive a gesture that interrupts it.
 */

function person(id: string, givenName: string, extras: Partial<Person> = {}): Person {
  return {
    id,
    givenName,
    familyName: "Fixture",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...extras,
  };
}

const fixture: TreeData = {
  focusPersonId: "focus",
  people: [
    person("focus", "Focus"),
    person("partner", "Partner"),
    person("kid", "Kid", { birthDate: "2018-01-01" }),
    person("mom", "Mom"),
    person("dad", "Dad"),
    person("gran", "Gran"),
    person("sib", "Sib"),
    person("stranger", "Stranger"),
  ],
  unions: [
    { id: "u-focus", partnerIds: ["focus", "partner"], kind: "partnered" },
    { id: "u-parents", partnerIds: ["mom", "dad"], kind: "married" },
  ],
  childLinks: [
    { id: "c-focus", childId: "focus", parentIds: ["mom", "dad"], unionId: "u-parents" },
    { id: "c-sib", childId: "sib", parentIds: ["mom", "dad"], unionId: "u-parents" },
    { id: "c-kid", childId: "kid", parentIds: ["focus", "partner"], unionId: "u-focus" },
    { id: "c-mom", childId: "mom", parentIds: ["gran"] },
  ],
};

function points(cards: { id: string; x: number; y: number }[], rings: Map<string, string>): GatherPoint[] {
  return cards.map((card) => ({
    id: card.id,
    x: card.x,
    y: card.y,
    role: gatherRole(fixture, "focus", card.id, rings.get(card.id) as "dim" | undefined),
  }));
}

function setup() {
  const map = layoutPersonalMap(fixture, "focus");
  assert.ok(map);
  const fromLayout = buildGraph(fixture, "focus");
  const toLayout = graphFromPersonalMap(fixture, map);
  const rings = new Map(map.seats.map((seat) => [seat.id, seat.ring]));
  const from = points(fromLayout.cards, rings);
  const to = points(toLayout.cards, rings);
  return { from, to, plan: planGather({ from, to, direction: "gather" }) };
}

function pose(frame: ReturnType<typeof frameAt>, id: string) {
  const found = frame.people.find((person) => person.id === id);
  assert.ok(found, id);
  return found;
}

describe("gather choreography", () => {
  it("fits the phone-length window and retracts lines before anyone moves", () => {
    const { plan } = setup();
    assert.ok(plan.duration >= 600 && plan.duration <= 900, `duration ${plan.duration}`);
    assert.equal(plan.duration, GATHER_TOTAL_MS);
    assert.ok(plan.linesOutMs >= 120 && plan.linesOutMs <= 180);
    assert.equal(plan.linesOutMs, GATHER_LINES_OUT_MS);
    const midway = frameAt(plan, plan.linesOutMs / 2);
    assert.equal(midway.phase, "lines-out");
    assert.ok(midway.lineHide > 0 && midway.lineHide < 1);
    assert.equal(midway.lineDraw, 0);
    assert.ok(midway.people.every((person) => person.travel === 0));
    assert.ok(midway.glow > 0);
  });

  it("orders the travel partner, then children and parents, then everyone else", () => {
    const { plan } = setup();
    const delay = (role: string) => plan.tracks.find((track) => track.role === role)!.delay;
    assert.equal(delay("focus"), delay("partner"));
    assert.ok(delay("partner") < delay("child"));
    assert.equal(delay("child"), delay("parent"));
    assert.ok(delay("parent") < delay("other"));
    assert.ok(delay("dim") >= delay("parent") && delay("dim") <= delay("other"));
    const early = frameAt(plan, plan.travelStart + delay("child"));
    assert.equal(early.phase, "travel");
    assert.equal(early.lineHide, 1);
    assert.equal(early.lineDraw, 0);
    assert.ok(pose(early, "partner").travel > pose(early, "kid").travel);
    assert.equal(pose(early, "sib").travel, 0);
    assert.equal(pose(early, "gran").travel, 0);
  });

  it("hides lines while people travel and draws them once everyone has settled", () => {
    const { plan, to } = setup();
    const during = frameAt(plan, plan.travelStart + (plan.travelEnd - plan.travelStart) / 2);
    assert.equal(during.phase, "travel");
    assert.equal(during.lineHide, 1);
    assert.equal(during.lineDraw, 0);
    const dim = pose(during, "stranger");
    const focus = pose(during, "focus");
    assert.ok(dim.opacity < focus.opacity);
    assert.ok(dim.scale < 1);
    assert.equal(focus.opacity, 1);
    const end = frameAt(plan, plan.duration);
    assert.equal(end.phase, "settled");
    assert.equal(end.done, true);
    assert.equal(end.lineHide, 0);
    assert.equal(end.lineDraw, 1);
    assert.equal(end.glow, 0);
    for (const seat of to) {
      const at = pose(end, seat.id);
      assert.equal(at.travel, 1);
      assert.ok(Math.abs(at.x - seat.x) < 1e-6, seat.id);
      assert.ok(Math.abs(at.y - seat.y) < 1e-6, seat.id);
    }
    const start = frameAt(plan, 0);
    assert.equal(start.lineHide, 0);
    for (const person of start.people) {
      const track = plan.tracks.find((item) => item.id === person.id)!;
      assert.ok(Math.abs(person.x - track.fromX) < 1e-6);
      assert.ok(Math.abs(person.y - track.fromY) < 1e-6);
    }
  });

  it("eases out without stepping backward", () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const value = gatherEase(i / 20);
      assert.ok(value >= prev);
      prev = value;
    }
    assert.equal(gatherEase(0), 0);
    assert.equal(gatherEase(1), 1);
  });

  it("crossfades quickly when motion is reduced, with no stagger", () => {
    const { from, to } = setup();
    const plan = planGather({ from, to, direction: "gather", reducedMotion: true });
    assert.equal(plan.reduced, true);
    assert.equal(plan.duration, GATHER_REDUCED_MS);
    assert.ok(plan.duration < 250);
    assert.ok(plan.tracks.every((track) => track.delay === 0));
    const mid = frameAt(plan, plan.duration / 2);
    assert.equal(mid.phase, "crossfade");
    assert.ok(Math.abs(mid.lineHide - 1) < 1e-9);
    assert.ok(pose(mid, "partner").travel > 0 && pose(mid, "partner").travel < 1);
    assert.equal(pose(mid, "partner").travel, pose(mid, "sib").travel);
    const end = frameAt(plan, plan.duration);
    assert.equal(end.done, true);
    assert.equal(end.lineHide, 0);
    assert.equal(end.lineDraw, 1);
    assert.equal(pose(end, "focus").x, to.find((seat) => seat.id === "focus")!.x);
  });

  it("interrupts mid-travel without a jump and keeps the lines hidden", () => {
    const { from, to, plan } = setup();
    const at = plan.travelStart + 200;
    const frame = frameAt(plan, at);
    assert.equal(frame.lineHide, 1);
    assert.ok(pose(frame, "partner").travel > 0 && pose(frame, "partner").travel < 1);
    const back = interruptGather(plan, at, { to: from, direction: "release" });
    const joined = frameAt(back, 0);
    assert.equal(back.linesOutMs, 0);
    assert.equal(joined.lineHide, 1);
    assert.equal(joined.phase, "travel");
    for (const person of frame.people) {
      const next = pose(joined, person.id);
      assert.ok(Math.abs(next.x - person.x) < 1e-6, person.id);
      assert.ok(Math.abs(next.y - person.y) < 1e-6, person.id);
    }
    const end = frameAt(back, back.duration);
    assert.equal(end.done, true);
    assert.equal(end.lineHide, 0);
    assert.equal(end.lineDraw, 1);
    for (const seat of from) {
      const landed = pose(end, seat.id);
      assert.ok(Math.abs(landed.x - seat.x) < 1e-6, seat.id);
      assert.ok(Math.abs(landed.y - seat.y) < 1e-6, seat.id);
    }
    const child = plan.tracks.find((track) => track.role === "child");
    assert.ok(child);
    const startPose = trackPose(child, 0, "gather");
    const endPose = trackPose(child, 1, "gather");
    assert.equal(startPose.x, child.fromX);
    assert.equal(startPose.y, child.fromY);
    assert.equal(endPose.x, child.toX);
    assert.equal(endPose.y, child.toY);
    assert.ok(trackPose(child, 0.5, "gather").scale > 1);
    const cam = { x: 12, y: 40, s: 0.4 };
    const next = { x: 80, y: -10, s: 1.2 };
    const view = { cx: 195, cy: 360 };
    const opened = gatherCameraAt(cam, next, view, 0);
    const closed = gatherCameraAt(cam, next, view, 1);
    assert.ok(Math.abs(opened.x - cam.x) < 1e-6 && Math.abs(opened.y - cam.y) < 1e-6 && Math.abs(opened.s - cam.s) < 1e-6);
    assert.ok(Math.abs(closed.x - next.x) < 1e-6 && Math.abs(closed.y - next.y) < 1e-6 && Math.abs(closed.s - next.s) < 1e-6);

    const again = interruptGather(back, 40, { to, direction: "gather" });
    const retarget = frameAt(again, 0);
    const mid = frameAt(back, 40);
    assert.equal(retarget.lineHide, mid.lineHide);
    assert.ok(Math.abs(pose(retarget, "kid").x - pose(mid, "kid").x) < 1e-6);
  });
});
