import type { Person, TreeData } from "./types";
import { CARD, householdCouple, lineageIds, showsCoupleBar, type GraphLayout, type LaidCard } from "./layout";
import { connectLaidCards } from "./layoutGraph";
import { childrenOfPerson, kinBetween, parentsOf, unionsFor } from "./tree";

/**
 * Ego-centric map for one person.
 *
 * Center is that person and their couple. The near ring is children, parents,
 * and siblings (a full sibling inside a half-sibling, a half-sibling inside a
 * step-sibling). Grandparents and other relatives already in the highlight
 * walk sit further out. Everyone else is dimmed, far enough that the map
 * around the person stays readable.
 *
 * Positions are a pure function of the tree and the focused person, so a
 * reload draws the same map. Manual card drags (`graphX`) belong to the
 * generation layout and are ignored here.
 */
export type PersonalRing = "center" | "near" | "outer" | "dim";

export type PersonalSeat = {
  id: string;
  x: number;
  y: number;
  ring: PersonalRing;
};

export type PersonalMap = {
  focusId: string;
  seats: PersonalSeat[];
};

/** How long cards take to glide between the tree and this map. */
export const PERSONAL_MAP_MS = 480;

const COL = CARD.w + CARD.gap;
const PAIR = CARD.w + CARD.coupleGap;
const NEAR = CARD.h + CARD.laneGap;
const FAR = NEAR + 88;

type Draft = { id: string; x: number; y: number; ring: PersonalRing };

function birthKey(person: Person | undefined) {
  if (!person) return "~";
  return `${person.birthDate ?? "9999-99-99"}|${person.givenName}|${person.id}`;
}

function rowSpan(count: number, paired: boolean) {
  if (count <= 1) return CARD.w;
  const gap = paired ? CARD.coupleGap : CARD.gap;
  return count * CARD.w + (count - 1) * gap;
}

/**
 * 0 full sibling, 1 half (or adopted), 2 foster, 3 step.
 * Null when the two people are not siblings.
 */
function siblingRank(tree: TreeData, focusId: string, otherId: string): number | null {
  if (otherId === focusId) return null;
  const mine = parentsOf(tree, focusId);
  const theirs = parentsOf(tree, otherId);
  const myIds = new Set(mine.map((parent) => parent.id));
  const shared = theirs.filter((parent) => myIds.has(parent.id));
  if (shared.length) {
    const theirKinds = shared.map((parent) => kinBetween(tree, otherId, parent.id));
    if (theirKinds.every((kind) => kind === "blood" || kind === "adopted")) {
      return shared.length >= 2 ? 0 : 1;
    }
    if (theirKinds.includes("foster") && !theirKinds.includes("step")) return 2;
    return 3;
  }
  const theirIds = new Set(theirs.map((parent) => parent.id));
  for (const union of tree.unions) {
    const hitMine = union.partnerIds.some((id) => myIds.has(id));
    const hitTheirs = union.partnerIds.some((id) => theirIds.has(id));
    if (hitMine && hitTheirs) return 3;
  }
  return null;
}

export function layoutPersonalMap(tree: TreeData, focusId: string): PersonalMap | null {
  const focus = tree.people.find((person) => person.id === focusId);
  if (!focus) return null;
  const byId = new Map(tree.people.map((person) => [person.id, person]));
  const order = (a: string, b: string) => birthKey(byId.get(a)).localeCompare(birthKey(byId.get(b)));
  const placed = new Map<string, Draft>();

  const put = (id: string, x: number, y: number, ring: PersonalRing) => {
    if (!byId.has(id) || placed.has(id)) return;
    placed.set(id, { id, x, y, ring });
  };

  const layRow = (ids: string[], centerX: number, y: number, paired: boolean, ring: PersonalRing) => {
    const step = paired && ids.length > 1 ? PAIR : COL;
    const start = centerX - ((Math.max(ids.length, 1) - 1) * step) / 2;
    ids.forEach((id, index) => put(id, start + index * step, y, ring));
  };

  const placeBand = (ids: string[], ring: PersonalRing) => {
    if (!ids.length) return;
    const onRow = [...placed.values()].filter((seat) => seat.y === 0);
    let leftEdge = Math.min(...onRow.map((seat) => seat.x - CARD.w / 2));
    let rightEdge = Math.max(...onRow.map((seat) => seat.x + CARD.w / 2));
    const leftCount = Math.ceil(ids.length / 2);
    ids.slice(0, leftCount).forEach((id, index) => {
      put(id, leftEdge - CARD.gap - CARD.w / 2 - index * COL, 0, ring);
    });
    ids.slice(leftCount).forEach((id, index) => {
      put(id, rightEdge + CARD.gap + CARD.w / 2 + index * COL, 0, ring);
    });
  };

  const coupleGroups = (ids: string[]) => {
    const remaining = new Set(ids);
    const groups: { ids: string[]; paired: boolean }[] = [];
    const unions = [...tree.unions].sort((a, b) => a.id.localeCompare(b.id));
    for (const union of unions) {
      if (!showsCoupleBar(union.kind, union.partnerIds.length)) continue;
      const members = union.partnerIds.filter((id) => remaining.has(id)).sort(order);
      if (members.length < 2) continue;
      members.forEach((id) => remaining.delete(id));
      groups.push({ ids: members, paired: true });
    }
    for (const id of [...remaining].sort(order)) groups.push({ ids: [id], paired: false });
    return groups;
  };

  const placePacked = (groups: { ids: string[]; paired: boolean }[], y: number, ring: PersonalRing, anchor = 0) => {
    if (!groups.length) return;
    const widths = groups.map((group) => rowSpan(group.ids.length, group.paired));
    const total = widths.reduce((sum, width) => sum + width, 0) + CARD.gap * Math.max(0, groups.length - 1);
    let left = anchor - total / 2;
    groups.forEach((group, index) => {
      layRow(group.ids, left + widths[index] / 2, y, group.paired, ring);
      left += widths[index] + CARD.gap;
    });
  };

  const placeAnchored = (
    groups: { ids: string[]; paired: boolean; anchor: number }[],
    y: number,
    ring: PersonalRing,
  ) => {
    if (!groups.length) return;
    const sorted = [...groups].sort((a, b) => a.anchor - b.anchor || a.ids[0].localeCompare(b.ids[0]));
    const widths = sorted.map((group) => rowSpan(group.ids.length, group.paired));
    const centers = sorted.map((group) => group.anchor);
    for (let i = 1; i < sorted.length; i++) {
      const min = centers[i - 1] + widths[i - 1] / 2 + CARD.gap + widths[i] / 2;
      if (centers[i] < min) centers[i] = min;
    }
    const ideal = sorted.reduce((sum, group) => sum + group.anchor, 0) / sorted.length;
    const actual = centers.reduce((sum, center) => sum + center, 0) / centers.length;
    const delta = ideal - actual;
    sorted.forEach((group, index) => layRow(group.ids, centers[index] + delta, y, group.paired, ring));
  };

  const home = householdCouple(tree, focus.id);
  const centerIds = home.length ? home : [focus.id];
  layRow(centerIds, 0, 0, centerIds.length > 1, "center");

  const extraPartners = [
    ...new Set(unionsFor(tree, focus.id).flatMap((union) => union.partnerIds)),
  ]
    .filter((id) => !placed.has(id))
    .sort(order);
  placeBand(extraPartners, "near");

  for (const rank of [0, 1, 2, 3]) {
    const siblings = tree.people
      .map((person) => person.id)
      .filter((id) => !placed.has(id) && siblingRank(tree, focus.id, id) === rank)
      .sort(order);
    placeBand(siblings, "near");
  }

  const parentIds = parentsOf(tree, focus.id)
    .map((parent) => parent.id)
    .filter((id) => !placed.has(id));
  placePacked(coupleGroups(parentIds), -NEAR, "near", 0);

  const kidIds = childrenOfPerson(tree, focus.id)
    .map((kid) => kid.id)
    .filter((id) => !placed.has(id))
    .sort(order);
  if (kidIds.length) layRow(kidIds, 0, NEAR, false, "near");

  const ancestorIds = (childIds: string[], y: number) => {
    const groups: { ids: string[]; paired: boolean; anchor: number }[] = [];
    const seen = new Set<string>();
    for (const childId of childIds) {
      const child = placed.get(childId);
      if (!child) continue;
      const pending = parentsOf(tree, childId)
        .map((parent) => parent.id)
        .filter((id) => !placed.has(id) && !seen.has(id));
      for (const group of coupleGroups(pending)) {
        group.ids.forEach((id) => seen.add(id));
        groups.push({ ...group, anchor: child.x });
      }
    }
    placeAnchored(groups, y, "outer");
    return groups.flatMap((group) => group.ids);
  };

  let generation = [...placed.values()].filter((seat) => seat.ring === "near" && seat.y < 0).map((seat) => seat.id);
  let up = -(NEAR + FAR);
  for (let guard = 0; generation.length && guard < 8; guard++) {
    generation = ancestorIds(generation, up);
    up -= FAR;
  }

  const descendantIds = (parentIdsIn: string[], y: number) => {
    const groups: { ids: string[]; paired: boolean; anchor: number }[] = [];
    const seen = new Set<string>();
    for (const parentId of parentIdsIn) {
      const parent = placed.get(parentId);
      if (!parent) continue;
      const kids = childrenOfPerson(tree, parentId)
        .map((kid) => kid.id)
        .filter((id) => !placed.has(id) && !seen.has(id))
        .sort(order);
      if (!kids.length) continue;
      kids.forEach((id) => seen.add(id));
      groups.push({ ids: kids, paired: false, anchor: parent.x });
    }
    placeAnchored(groups, y, "outer");
    return groups.flatMap((group) => group.ids);
  };

  let downIds = [...placed.values()].filter((seat) => seat.ring === "near" && seat.y > 0).map((seat) => seat.id);
  let down = NEAR + FAR;
  for (let guard = 0; downIds.length && guard < 8; guard++) {
    downIds = descendantIds(downIds, down);
    down += FAR;
  }

  const lineage = lineageIds(tree, focus.id);
  const stillClose = [...lineage].filter((id) => !placed.has(id)).sort(order);
  if (stillClose.length) {
    const lowest = Math.max(...[...placed.values()].map((seat) => seat.y));
    layRow(stillClose, 0, lowest + FAR, false, "outer");
  }

  const focusSeat = placed.get(focus.id)!;
  const lit = [...placed.values()];
  const farLit = Math.max(...lit.map((seat) => Math.hypot(seat.x - focusSeat.x, seat.y - focusSeat.y)), 0);
  const dimIds = tree.people.map((person) => person.id).filter((id) => !placed.has(id)).sort(order);
  // Far enough that a camera framed on the lit family does not leave these cards
  // clipped against the edge of a wide desktop viewport.
  const originX = focusSeat.x + farLit + CARD.w + 640;
  dimIds.forEach((id, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    put(id, originX + col * COL, focusSeat.y + row * NEAR, "dim");
  });

  const drafts = [...placed.values()];
  const minX = Math.min(...drafts.map((seat) => seat.x)) - CARD.w / 2;
  const minY = Math.min(...drafts.map((seat) => seat.y));
  const dx = CARD.pad - minX;
  const dy = CARD.pad - minY;
  const seats = drafts
    .map((seat) => ({ ...seat, x: seat.x + dx, y: seat.y + dy }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { focusId: focus.id, seats };
}

export function graphFromPersonalMap(tree: TreeData, map: PersonalMap): GraphLayout {
  const people = new Map(tree.people.map((person) => [person.id, person]));
  const cards: LaidCard[] = map.seats.flatMap((seat) => {
    const person = people.get(seat.id);
    if (!person) return [];
    return [{ id: seat.id, person, x: seat.x, y: seat.y, gen: Math.round(seat.y) }];
  });
  const links = connectLaidCards(tree, cards);
  const right = Math.max(...cards.map((card) => card.x + CARD.w / 2), 0);
  const bottom = Math.max(...cards.map((card) => card.y + CARD.h), 0);
  return {
    width: Math.max(320, right + CARD.pad / 2),
    height: Math.max(280, bottom + CARD.pad / 2),
    cards,
    ...links,
    focusId: map.focusId,
    householdIds: map.seats.filter((seat) => seat.ring === "center").map((seat) => seat.id),
    areas: [],
    bridges: [],
  };
}

export function placesMatch(a: GraphLayout, b: GraphLayout): boolean {
  if (a.cards.length !== b.cards.length) return false;
  const byId = new Map(a.cards.map((card) => [card.id, card]));
  return b.cards.every((card) => {
    const prev = byId.get(card.id);
    return prev != null && Math.abs(prev.x - card.x) < 0.5 && Math.abs(prev.y - card.y) < 0.5;
  });
}

/** Layout part-way from `from` to `to`. `k` is 0 at the start and 1 at the end. */
export function morphGraph(from: GraphLayout, to: GraphLayout, k: number, tree: TreeData): GraphLayout {
  if (k >= 1) return to;
  if (k <= 0) return from;
  const was = new Map(from.cards.map((card) => [card.id, card]));
  const cards = to.cards.map((card) => {
    const prev = was.get(card.id);
    if (!prev) return card;
    return { ...card, x: prev.x + (card.x - prev.x) * k, y: prev.y + (card.y - prev.y) * k };
  });
  return {
    ...to,
    cards,
    ...connectLaidCards(tree, cards),
    width: Math.max(from.width, to.width),
    height: Math.max(from.height, to.height),
    areas: [],
    bridges: [],
  };
}
