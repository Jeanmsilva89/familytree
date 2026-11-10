import type { PersonalRing } from "./personalMap";
import { childrenOfPerson, parentsOf, unionsFor } from "./tree";
import type { TreeData } from "./types";

/**
 * Personal-map choreography.
 *
 * Lines leave first, then people travel in order of closeness, then the
 * destination lines draw back in. The clock is a pure function of the plan
 * and an elapsed time, so a frame can be sampled, interrupted, and retargeted
 * without touching the DOM.
 */

export type GatherRole = "focus" | "partner" | "child" | "parent" | "other" | "dim";

export type GatherDirection = "gather" | "release";

/** Lines retract before anyone moves. */
export const GATHER_LINES_OUT_MS = 150;
/** How long one person travels once their delay has elapsed. */
export const GATHER_TRAVEL_MS = 420;
/** Destination lines draw in after the last person has settled. */
export const GATHER_LINES_IN_MS = 160;
/** Quick crossfade when the person prefers reduced motion. */
export const GATHER_REDUCED_MS = 180;

/** Partner first, then children and parents together, then everyone else. */
export const GATHER_STAGGER_MS: Record<GatherRole, number> = {
  focus: 0,
  partner: 0,
  child: 46,
  parent: 46,
  dim: 72,
  other: 96,
};

export const GATHER_TOTAL_MS =
  GATHER_LINES_OUT_MS +
  Math.max(...Object.values(GATHER_STAGGER_MS)) +
  GATHER_TRAVEL_MS +
  GATHER_LINES_IN_MS;

/** Camera eases with the travel, after the lines have left. */
export function gatherCameraMs(reduced: boolean) {
  return reduced ? GATHER_REDUCED_MS : GATHER_TOTAL_MS - GATHER_LINES_OUT_MS;
}

export type GatherPoint = {
  id: string;
  x: number;
  y: number;
  role: GatherRole;
};

export type GatherTrack = {
  id: string;
  role: GatherRole;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  delay: number;
  duration: number;
};

export type GatherChoreography = {
  direction: GatherDirection;
  reduced: boolean;
  duration: number;
  linesOutMs: number;
  linesInMs: number;
  travelStart: number;
  travelEnd: number;
  /** How hidden the lines already are at elapsed 0. 1 skips the retract. */
  lineHide0: number;
  tracks: GatherTrack[];
};

export type GatherPhase = "lines-out" | "travel" | "lines-in" | "crossfade" | "settled";

export type GatherPose = {
  id: string;
  role: GatherRole;
  x: number;
  y: number;
  toX: number;
  toY: number;
  /** 0 at the start of this person's travel, 1 when they have arrived. Linear in time. */
  travel: number;
  scale: number;
  opacity: number;
};

export type GatherFrame = {
  elapsed: number;
  phase: GatherPhase;
  /** 0 lines visible, 1 lines fully hidden. */
  lineHide: number;
  /** 0 undrawn, 1 fully drawn. Meaningful while lines are coming back. */
  lineDraw: number;
  glow: number;
  ripple: number;
  people: GatherPose[];
  done: boolean;
};

/** Ease-out quint. 0 at 0, 1 at 1, and it never steps backward. */
export function gatherEase(t: number) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = 1 - t;
  return 1 - u * u * u * u * u;
}

function clamp01(n: number) {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

/**
 * Closeness for the stagger. Dim seats are the people left outside the map.
 * A divorced partner is not pulled in with the current couple.
 */
export function gatherRole(tree: TreeData, focusId: string, personId: string, ring?: PersonalRing): GatherRole {
  if (personId === focusId) return "focus";
  if (ring === "dim") return "dim";
  const partner = unionsFor(tree, focusId).some(
    (union) => union.kind !== "divorced" && union.partnerIds.includes(personId),
  );
  if (partner) return "partner";
  if (childrenOfPerson(tree, focusId).some((child) => child.id === personId)) return "child";
  if (parentsOf(tree, focusId).some((parent) => parent.id === personId)) return "parent";
  return "other";
}

export function gatherPoints(
  cards: { id: string; x: number; y: number }[],
  tree: TreeData,
  focusId: string,
  rings?: ReadonlyMap<string, PersonalRing | undefined>,
): GatherPoint[] {
  return cards.map((card) => ({
    id: card.id,
    x: card.x,
    y: card.y,
    role: gatherRole(tree, focusId, card.id, rings?.get(card.id)),
  }));
}

export function planGather(input: {
  from: GatherPoint[];
  to: GatherPoint[];
  direction: GatherDirection;
  reducedMotion?: boolean;
  lineHide0?: number;
}): GatherChoreography {
  const reduced = Boolean(input.reducedMotion);
  const lineHide0 = clamp01(input.lineHide0 ?? 0);
  const byFrom = new Map(input.from.map((seat) => [seat.id, seat]));
  const linesOutMs = reduced ? 0 : GATHER_LINES_OUT_MS * (1 - lineHide0);
  const travelMs = reduced ? GATHER_REDUCED_MS : GATHER_TRAVEL_MS;
  const linesInMs = reduced ? 0 : GATHER_LINES_IN_MS;
  const seen = new Set<string>();
  const tracks: GatherTrack[] = [];
  const add = (seat: GatherPoint, origin: GatherPoint | undefined) => {
    if (seen.has(seat.id)) return;
    seen.add(seat.id);
    tracks.push({
      id: seat.id,
      role: seat.role,
      fromX: origin?.x ?? seat.x,
      fromY: origin?.y ?? seat.y,
      toX: seat.x,
      toY: seat.y,
      delay: reduced ? 0 : GATHER_STAGGER_MS[seat.role],
      duration: travelMs,
    });
  };
  for (const seat of input.to) add(seat, byFrom.get(seat.id));
  for (const seat of input.from) add({ ...seat, x: seat.x, y: seat.y }, seat);
  const stagger = tracks.reduce((max, track) => Math.max(max, track.delay), 0);
  const travelStart = linesOutMs;
  const travelEnd = reduced ? GATHER_REDUCED_MS : travelStart + stagger + travelMs;
  const duration = reduced ? GATHER_REDUCED_MS : travelEnd + linesInMs;
  return {
    direction: input.direction,
    reduced,
    duration,
    linesOutMs,
    linesInMs,
    travelStart,
    travelEnd,
    lineHide0,
    tracks,
  };
}

function trackTravel(track: GatherTrack, elapsed: number, travelStart: number) {
  const local = elapsed - travelStart - track.delay;
  if (local <= 0) return 0;
  if (local >= track.duration) return 1;
  return local / track.duration;
}

/** A short bow so paths don't cut straight through the couple. Endpoints stay put. */
function place(track: GatherTrack, travel: number) {
  const eased = gatherEase(travel);
  const x = track.fromX + (track.toX - track.fromX) * eased;
  const y = track.fromY + (track.toY - track.fromY) * eased;
  if (track.role === "focus" || track.role === "partner" || travel <= 0 || travel >= 1) return { x, y };
  const dx = track.toX - track.fromX;
  const dy = track.toY - track.fromY;
  const len = Math.hypot(dx, dy);
  if (len < 24) return { x, y };
  const bow = Math.sin(travel * Math.PI) * Math.min(28, len * 0.1);
  const sign = track.role === "parent" || track.role === "dim" ? -1 : 1;
  return { x: x + (-dy / len) * bow * sign, y: y + (dx / len) * bow * sign };
}

/** One sample of a person's travel. The compositor plays these as keyframes. */
export function trackPose(track: GatherTrack, travel: number, direction: GatherDirection) {
  const at = place(track, travel);
  return {
    x: at.x,
    y: at.y,
    scale: scaleFor(track.role, travel, direction),
    opacity: opacityFor(track.role, travel, direction),
  };
}

export type GatherCamera = { x: number; y: number; s: number };

/**
 * Camera sample for the gather glide. `t` is 0 at the first frame and 1 at
 * the last. The world point under the view centre and the log of the scale
 * ease out together, so a zoom does not drift sideways.
 */
export function gatherCameraAt(
  from: GatherCamera,
  to: GatherCamera,
  view: { cx: number; cy: number },
  t: number,
): GatherCamera {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 3;
  const fromS = from.s || 1;
  const toS = to.s || 1;
  const s = Math.exp(Math.log(fromS) + (Math.log(toS) - Math.log(fromS)) * k);
  const wx = (view.cx - from.x) / fromS + ((view.cx - to.x) / toS - (view.cx - from.x) / fromS) * k;
  const wy = (view.cy - from.y) / fromS + ((view.cy - to.y) / toS - (view.cy - from.y) / fromS) * k;
  return { x: view.cx - wx * s, y: view.cy - wy * s, s };
}

function scaleFor(role: GatherRole, travel: number, direction: GatherDirection) {
  if (role === "dim") {
    const far = 0.92;
    return direction === "gather" ? 1 - (1 - far) * travel : far + (1 - far) * travel;
  }
  const bell = Math.sin(Math.pow(clamp01(travel), 1.35) * Math.PI);
  return 1 + 0.045 * bell;
}

function opacityFor(role: GatherRole, travel: number, direction: GatherDirection) {
  if (role !== "dim") return 1;
  const dimmed = 0.5;
  return direction === "gather" ? 1 - (1 - dimmed) * travel : dimmed + (1 - dimmed) * travel;
}

function lineState(plan: GatherChoreography, elapsed: number) {
  if (elapsed <= 0) return { hide: plan.lineHide0, draw: 0 };
  if (elapsed >= plan.duration) return { hide: 0, draw: 1 };
  if (plan.reduced) {
    const t = elapsed / plan.duration;
    return { hide: Math.sin(t * Math.PI), draw: t };
  }
  if (elapsed < plan.travelStart) {
    const u = plan.linesOutMs === 0 ? 1 : elapsed / plan.linesOutMs;
    return { hide: plan.lineHide0 + (1 - plan.lineHide0) * gatherEase(u), draw: 0 };
  }
  if (elapsed < plan.travelEnd) return { hide: 1, draw: 0 };
  const u = plan.linesInMs === 0 ? 1 : (elapsed - plan.travelEnd) / plan.linesInMs;
  const eased = gatherEase(Math.min(1, Math.max(0, u)));
  return { hide: 1 - eased, draw: eased };
}

function phaseOf(plan: GatherChoreography, elapsed: number): GatherPhase {
  if (elapsed >= plan.duration) return "settled";
  if (plan.reduced) return "crossfade";
  if (elapsed < plan.travelStart) return "lines-out";
  if (elapsed < plan.travelEnd) return "travel";
  return "lines-in";
}

function glowFor(plan: GatherChoreography, elapsed: number) {
  if (plan.reduced || elapsed <= 0 || elapsed >= plan.duration) return { glow: 0, ripple: 0 };
  const rise = Math.min(1, elapsed / 160);
  const fall = elapsed > plan.duration - 180 ? Math.max(0, (plan.duration - elapsed) / 180) : 1;
  return { glow: Math.min(rise, fall), ripple: Math.min(1, elapsed / 480) };
}

export function frameAt(plan: GatherChoreography, elapsed: number): GatherFrame {
  const t = Math.max(0, elapsed);
  const done = t >= plan.duration;
  const phase = phaseOf(plan, t);
  const lines = lineState(plan, t);
  const glow = glowFor(plan, t);
  const people = plan.tracks.map((track) => {
    const travel = done ? 1 : trackTravel(track, t, plan.travelStart);
    const at = trackPose(track, travel, plan.direction);
    return {
      id: track.id,
      role: track.role,
      x: at.x,
      y: at.y,
      toX: track.toX,
      toY: track.toY,
      travel,
      scale: at.scale,
      opacity: at.opacity,
    };
  });
  return {
    elapsed: t,
    phase,
    lineHide: lines.hide,
    lineDraw: lines.draw,
    glow: glow.glow,
    ripple: glow.ripple,
    people,
    done,
  };
}

/**
 * A gesture that lands mid-choreography. The new plan starts where this
 * frame is, including how hidden the lines already are, so nothing snaps.
 */
export function interruptGather(
  plan: GatherChoreography,
  elapsed: number,
  next: { to: GatherPoint[]; direction: GatherDirection; reducedMotion?: boolean },
): GatherChoreography {
  const frame = frameAt(plan, Math.max(0, elapsed));
  const at = new Map(frame.people.map((person) => [person.id, person]));
  const from = next.to.map((seat) => {
    const seen = at.get(seat.id);
    return seen ? { id: seat.id, x: seen.x, y: seen.y, role: seat.role } : seat;
  });
  return planGather({
    from,
    to: next.to,
    direction: next.direction,
    reducedMotion: next.reducedMotion,
    lineHide0: frame.lineHide,
  });
}
