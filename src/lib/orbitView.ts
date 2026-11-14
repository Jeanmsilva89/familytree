import { CARD, showsCoupleBar } from "./layout";
import { visibleChildLinks } from "./visibleTree";
import { childrenOfPerson, kinBetween, parentsOf, unionsFor } from "./tree";
import { lineFilterAllows, lineFilterAllowsCouples, type LineFilter, DEFAULT_LINE_FILTER } from "./kinFilter";
import type { KinKind, TreeData } from "./types";

/**
 * Opt-in orbit focus.
 *
 * The resting view is the generation layout. A press-and-hold, and only a
 * press-and-hold, may bring one person to the center. A tap never does.
 * Lines leave before the cards move and return after they settle. Clear
 * plays that same sequence backwards.
 *
 * Seats are a pure function of who the viewer is allowed to see. A hidden
 * person is absent. A dimmed person stays on the outer ring. Withheld
 * details do not move anyone.
 */

export type OrbitRing = "center" | "partner" | "near" | "outer";

/** Kin seat, before the rings are drawn. Dimmed relatives collapse to `outer`. */
export type OrbitRole = "center" | "partner" | "parent" | "child" | "sibling" | "outer";

export type SeenPerson = {
  id: string;
  presence: "shown" | "dimmed";
  details: "open" | "withheld";
};

export type OrbitPick = {
  id: string;
  role: OrbitRole;
  presence: "shown" | "dimmed";
  details: "open" | "withheld";
};

export type OrbitSeat = {
  id: string;
  ring: OrbitRing;
  /** Card center, in the same space as a generation card. */
  x: number;
  /** Card top. */
  y: number;
  scale: number;
  opacity: number;
};

export type OrbitSegment = {
  id: string;
  fromId: string;
  toId: string;
  kind: KinKind | "partner" | "divorced";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type OrbitLayout = "rows" | "orbit";
export type OrbitLines = "shown" | "out" | "hidden" | "in";
export type OrbitMotion = "idle" | "glide";

export type OrbitState = {
  layout: OrbitLayout;
  lines: OrbitLines;
  motion: OrbitMotion;
  focusId: string | null;
  selectedId?: string;
  swallowTap: boolean;
  /** Where the glide that follows a line fade will land. */
  intent: OrbitLayout;
};

export type OrbitEvent =
  | { type: "tap"; personId: string }
  | { type: "hold"; personId: string; allowed: boolean }
  | { type: "lines-gone" }
  | { type: "cards-settled" }
  | { type: "lines-back" }
  | { type: "clear" }
  | { type: "drop-swallow" };

export type OrbitEffect =
  | { type: "none" }
  | { type: "select"; personId: string }
  | { type: "open-editor"; personId: string }
  | { type: "clear" };

export type OrbitDecision = {
  state: OrbitState;
  effect: OrbitEffect;
};

const NEAR_R = 200;
const OUTER_R = 300;
const DIM_OPACITY = 0.28;
const OUTER_OPACITY = 0.36;

/** Lines fade out before the cards move, and back in after they settle. */
export const ORBIT_LINES_MS = 160;
/** How long the cards take to glide. The compositor interpolates transform and opacity. */
export const ORBIT_GLIDE_MS = 640;

export function initialOrbit(): OrbitState {
  return {
    layout: "rows",
    lines: "shown",
    motion: "idle",
    focusId: null,
    swallowTap: false,
    intent: "rows",
  };
}

export function isFixtureTree(tree: TreeData): boolean {
  return tree.people.length > 0 && tree.people.every((person) => person.familyName === "Fixture");
}

/** People a preview is allowed to draw. Hidden marks stay out. Details do not change the seat. */
export function previewSeen(
  marks: readonly { personId: string; draw: "shown" | "ghost"; presence: "shown" | "dimmed"; details: "open" | "withheld" }[],
): Map<string, SeenPerson> {
  const seen = new Map<string, SeenPerson>();
  for (const mark of marks) {
    if (mark.draw !== "shown") continue;
    seen.set(mark.personId, { id: mark.personId, presence: mark.presence, details: mark.details });
  }
  return seen;
}

export function canOrbitFocus(
  personId: string,
  gate: { tree?: TreeData; seen?: ReadonlyMap<string, SeenPerson>; editMode?: boolean; arranging?: boolean } = {},
): boolean {
  if (!personId || gate.editMode || gate.arranging) return false;
  if (gate.tree && !gate.tree.people.some((person) => person.id === personId)) return false;
  if (gate.seen) {
    const row = gate.seen.get(personId);
    if (!row || row.presence !== "shown") return false;
  }
  return true;
}

/**
 * Who Orbit seats around a focus person.
 *
 * `seen` is the resolved visibility. A person who is not in it is absent:
 * no card, no line end, and no empty seat. A dimmed relative stays in the
 * result, on the outer ring. Withheld details do not change the seat.
 * Blood, step, adopted, and foster children are all children. Two parents
 * of any role are both parents. A parent who is not on the tree is nobody.
 * A divorced or separated partner does not sit beside the focus. The
 * current spouse does, including after a remarriage.
 */
export function selectOrbit(
  tree: TreeData,
  focusId: string,
  seen?: ReadonlyMap<string, SeenPerson>,
): OrbitPick[] | null {
  if (!canOrbitFocus(focusId, { tree, seen })) return null;
  const visible = shownIds(tree, seen);
  const focus = visible.get(focusId);
  if (!focus || focus.presence !== "shown") return null;
  const shown = new Set([...visible.values()].filter((row) => row.presence === "shown").map((row) => row.id));

  const partners = new Set<string>();
  for (const union of unionsFor(tree, focusId)) {
    if (union.kind === "divorced" || union.kind === "separated") continue;
    for (const id of union.partnerIds) {
      if (id !== focusId && shown.has(id)) partners.add(id);
    }
  }
  const parents = parentsOf(tree, focusId)
    .map((parent) => parent.id)
    .filter((id) => shown.has(id) && !partners.has(id));
  const children = childrenOfPerson(tree, focusId)
    .map((child) => child.id)
    .filter((id) => shown.has(id) && !partners.has(id));
  const siblings = new Set<string>();
  for (const parent of parentsOf(tree, focusId)) {
    for (const child of childrenOfPerson(tree, parent.id)) {
      if (child.id !== focusId && shown.has(child.id) && !partners.has(child.id)) siblings.add(child.id);
    }
  }
  for (const id of parents) siblings.delete(id);
  for (const id of children) siblings.delete(id);

  const role = new Map<string, OrbitRole>();
  role.set(focusId, "center");
  for (const id of partners) role.set(id, "partner");
  for (const id of parents) role.set(id, "parent");
  for (const id of children) role.set(id, "child");
  for (const id of siblings) if (!role.has(id)) role.set(id, "sibling");

  return [...visible.values()].map((row) => ({
    id: row.id,
    role: row.presence === "dimmed" ? "outer" : (role.get(row.id) ?? "outer"),
    presence: row.presence,
    details: row.details,
  }));
}

/**
 * The tree Orbit may draw. Hidden people are removed, and a link that named
 * one of them keeps only the people who remain. An unknown parent is not added.
 */
export function sceneTree(tree: TreeData, seen?: ReadonlyMap<string, SeenPerson>): TreeData {
  if (!seen) return tree;
  const ids = new Set(seen.keys());
  const people = tree.people.filter((person) => ids.has(person.id));
  const unions = tree.unions.flatMap((union) => {
    const partnerIds = union.partnerIds.filter((id) => ids.has(id));
    if (partnerIds.length < 2) return [];
    return [{ ...union, partnerIds }];
  });
  return { ...tree, people, unions, childLinks: visibleChildLinks(tree, ids) };
}

/** Guest edit, owner edit, and a shared family. A shared person is never editable. */
export function orbitMayEdit(
  personId: string,
  gate: { editing: boolean; edit?: (id: string) => boolean; sharedIds?: readonly string[] },
): boolean {
  if (!gate.editing || !personId) return false;
  if (gate.sharedIds?.includes(personId)) return false;
  if (gate.edit) return gate.edit(personId);
  return true;
}

function shownIds(tree: TreeData, seen?: ReadonlyMap<string, SeenPerson>): Map<string, SeenPerson> {
  const out = new Map<string, SeenPerson>();
  for (const person of tree.people) {
    if (!seen) {
      out.set(person.id, { id: person.id, presence: "shown", details: "open" });
      continue;
    }
    const row = seen.get(person.id);
    if (row) out.set(person.id, row);
  }
  return out;
}

function arc(ids: string[], radius: number, center: number, spread: number) {
  const sorted = [...ids].sort();
  const placed = new Map<string, { x: number; y: number }>();
  sorted.forEach((id, index) => {
    const angle = sorted.length === 1 ? center : center - spread / 2 + (spread * index) / Math.max(1, sorted.length - 1);
    placed.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  return placed;
}

/**
 * Focus at the origin, partner to the right, parents above, children below,
 * siblings to the left. Dimmed relatives are forced onto the outer ring.
 * Returns null when that person cannot be the center.
 */
export function layoutOrbit(
  tree: TreeData,
  focusId: string,
  seen?: ReadonlyMap<string, SeenPerson>,
): OrbitSeat[] | null {
  const picks = selectOrbit(tree, focusId, seen);
  if (!picks) return null;
  const idsFor = (role: OrbitRole) => picks.filter((pick) => pick.role === role).map((pick) => pick.id);
  const dimmed = new Set(picks.filter((pick) => pick.presence === "dimmed").map((pick) => pick.id));
  const partners = idsFor("partner").sort();
  const parents = idsFor("parent");
  const children = idsFor("child");
  const siblings = idsFor("sibling");
  const outer = idsFor("outer");

  const at = new Map<string, { x: number; y: number; ring: OrbitRing; scale: number; opacity: number }>();
  const focusCy = CARD.h / 2;
  at.set(focusId, { x: 0, y: focusCy, ring: "center", scale: 1, opacity: 1 });
  partners.forEach((id, index) => {
    at.set(id, { x: CARD.w + CARD.coupleGap + index * (CARD.w + CARD.gap), y: focusCy, ring: "partner", scale: 1, opacity: 1 });
  });
  for (const [id, pos] of arc(parents, NEAR_R, -Math.PI / 2, Math.PI / 2)) {
    at.set(id, { x: pos.x, y: focusCy + pos.y, ring: "near", scale: 0.96, opacity: 1 });
  }
  for (const [id, pos] of arc(children, NEAR_R, Math.PI / 2, Math.PI / 2)) {
    at.set(id, { x: pos.x, y: focusCy + pos.y, ring: "near", scale: 0.96, opacity: 1 });
  }
  for (const [id, pos] of arc([...siblings], NEAR_R * 0.92, Math.PI, Math.PI / 3)) {
    at.set(id, { x: pos.x, y: focusCy + pos.y, ring: "near", scale: 0.96, opacity: 1 });
  }
  for (const [id, pos] of arc(outer, OUTER_R, 0.4, Math.PI * 1.7)) {
    const faded = dimmed.has(id);
    at.set(id, {
      x: pos.x,
      y: focusCy + pos.y,
      ring: "outer",
      scale: faded ? 0.78 : 0.84,
      opacity: faded ? DIM_OPACITY : OUTER_OPACITY,
    });
  }

  return [...at.entries()].map(([id, pose]) => ({
    id,
    ring: pose.ring,
    x: pose.x,
    y: pose.y - CARD.h / 2,
    scale: pose.scale,
    opacity: pose.opacity,
  }));
}

export function orbitSegments(
  tree: TreeData,
  seats: readonly OrbitSeat[],
  filter: LineFilter = DEFAULT_LINE_FILTER,
): OrbitSegment[] {
  const at = new Map(seats.map((seat) => [seat.id, seat]));
  const center = (id: string) => {
    const seat = at.get(id);
    if (!seat) return null;
    return { x: seat.x, y: seat.y + CARD.h / 2 };
  };
  const lines: OrbitSegment[] = [];
  for (const link of tree.childLinks) {
    for (const parentId of link.parentIds) {
      if (parentId === link.childId) continue;
      const kind = kinBetween(tree, link.childId, parentId);
      if (!lineFilterAllows(filter, kind)) continue;
      const from = center(parentId);
      const to = center(link.childId);
      if (!from || !to) continue;
      lines.push({ id: `${link.id}:${parentId}`, fromId: parentId, toId: link.childId, kind, x1: from.x, y1: from.y, x2: to.x, y2: to.y });
    }
  }
  if (lineFilterAllowsCouples(filter)) {
    for (const union of tree.unions) {
      const ids = union.partnerIds.filter((id) => at.has(id));
      if (ids.length < 2) continue;
      const divorced = union.kind === "divorced";
      if (!divorced && !showsCoupleBar(union.kind, ids.length)) continue;
      const from = center(ids[0]);
      const to = center(ids[1]);
      if (!from || !to) continue;
      lines.push({
        id: union.id,
        fromId: ids[0],
        toId: ids[1],
        kind: divorced ? "divorced" : "partner",
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
      });
    }
  }
  return lines;
}

export type FitBox = { top: number; right: number; bottom: number; left: number };

/** Map layout points into the padded view. Order is unchanged. Scale never enlarges. */
export function fitGeneration(
  cards: { id: string; x: number; y: number }[],
  view: { w: number; h: number },
  pad: FitBox,
): { scale: number; ox: number; oy: number; cards: { id: string; x: number; y: number }[] } {
  const innerW = Math.max(1, view.w - pad.left - pad.right);
  const innerH = Math.max(1, view.h - pad.top - pad.bottom);
  if (!cards.length) return { scale: 1, ox: pad.left, oy: pad.top, cards: [] };
  const minX = Math.min(...cards.map((card) => card.x));
  const maxX = Math.max(...cards.map((card) => card.x));
  const minY = Math.min(...cards.map((card) => card.y));
  const maxY = Math.max(...cards.map((card) => card.y));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scale =
    spanX === 0 && spanY === 0
      ? 1
      : Math.min(1, spanX === 0 ? 1 : innerW / spanX, spanY === 0 ? 1 : innerH / spanY);
  const ox = spanX === 0 ? pad.left + innerW / 2 - minX * scale : pad.left - minX * scale;
  const oy = spanY === 0 ? pad.top + innerH / 2 - minY * scale : pad.top - minY * scale;
  return {
    scale,
    ox,
    oy,
    cards: cards.map((card) => ({ id: card.id, x: ox + card.x * scale, y: oy + card.y * scale })),
  };
}

function none(state: OrbitState): OrbitDecision {
  return { state, effect: { type: "none" } };
}

function settled(state: OrbitState) {
  return state.motion === "idle" && state.lines === "shown";
}

export function reduceOrbit(state: OrbitState, event: OrbitEvent): OrbitDecision {
  switch (event.type) {
    case "tap": {
      if (state.swallowTap) return { state: { ...state, swallowTap: false }, effect: { type: "none" } };
      if (!settled(state)) {
        return { state: { ...state, selectedId: event.personId }, effect: { type: "select", personId: event.personId } };
      }
      if (state.selectedId === event.personId) {
        return { state, effect: { type: "open-editor", personId: event.personId } };
      }
      return {
        state: { ...state, selectedId: event.personId },
        effect: { type: "select", personId: event.personId },
      };
    }
    case "hold": {
      if (!event.allowed || !settled(state)) return none(state);
      if (state.layout === "orbit" && state.focusId === event.personId) {
        return {
          state: { ...state, selectedId: event.personId, swallowTap: true },
          effect: { type: "select", personId: event.personId },
        };
      }
      return {
        state: {
          ...state,
          lines: "out",
          intent: "orbit",
          focusId: event.personId,
          selectedId: event.personId,
          swallowTap: true,
        },
        effect: { type: "select", personId: event.personId },
      };
    }
    case "lines-gone": {
      if (state.lines !== "out") return none(state);
      return {
        state: {
          ...state,
          layout: state.intent,
          lines: "hidden",
          motion: "glide",
          focusId: state.intent === "rows" ? null : state.focusId,
        },
        effect: { type: "none" },
      };
    }
    case "cards-settled": {
      if (state.motion !== "glide") return none(state);
      return { state: { ...state, motion: "idle", lines: "in" }, effect: { type: "none" } };
    }
    case "lines-back": {
      if (state.lines !== "in") return none(state);
      return { state: { ...state, lines: "shown" }, effect: { type: "none" } };
    }
    case "clear": {
      if (state.layout === "orbit" && settled(state)) {
        return { state: { ...state, lines: "out", intent: "rows", swallowTap: true }, effect: { type: "none" } };
      }
      if (state.layout === "rows" && settled(state) && state.selectedId) {
        return { state: { ...state, selectedId: undefined }, effect: { type: "clear" } };
      }
      return none(state);
    }
    case "drop-swallow": {
      if (!state.swallowTap) return none(state);
      return { state: { ...state, swallowTap: false }, effect: { type: "none" } };
    }
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
