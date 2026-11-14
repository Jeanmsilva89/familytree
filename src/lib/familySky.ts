import type { TreeData } from "./types";
import { partnerStatus } from "./types";
import { CARD, showsCoupleBar, type GraphLayout, type LaidCard, type LaidCouple, type LaidFork } from "./layout";
import { buildGraph } from "./layoutGraph";
import { deriveFamilyUnits, type FamilyUnit, type FamilyUnits, type JoinReason, type UnitLinkKind } from "./familyUnits";
import { placeFamilySkySeed, seedFromUnits, treeForLens } from "./layoutSeed";
import type { Camera } from "./graphView";
import { measureCrossBucketLinks, routePersonLink, type RouteBucket, type RouteCurve } from "./familySkyRoute";

/**
 * The family sky: every family unit is a soft bucket holding today's
 * generation-row layout of its own people, buckets float apart in one big
 * world, and links run person to person between buckets.
 */

export type SkyCard = LaidCard & { unitId: string };
export type SkyCouple = LaidCouple & { unitId: string };
export type SkyFork = LaidFork & { unitId: string };

export type SkyBucket = {
  id: string;
  label: string;
  headIds: string[];
  memberIds: string[];
  /** Superellipse centre, radii and exponent: |x/rx|^n + |y/ry|^n = 1. */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  n: number;
  /** Radius of the glowing node drawn at far zoom. */
  glow: number;
};

export type SkyLink = {
  id: string;
  kind: UnitLinkKind;
  fromPersonId: string;
  toPersonId: string;
  fromUnitId: string;
  toUnitId: string;
  /** Close up: a quadratic curve from card edge to card edge, bent around other cards. */
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  x2: number;
  y2: number;
  /** The same curve trimmed to the small avatars shown at mid zoom. */
  mid: Curve;
  /** What is drawn: the curve with a gap wherever it would pass under another card (or avatar, at mid zoom). */
  pieces: Curve[];
  midPieces: Curve[];
};

export type Curve = { x1: number; y1: number; cx: number; cy: number; x2: number; y2: number };

/** All links between two buckets, drawn as one thin line at far zoom. */
export type SkyUnitEdge = {
  id: string;
  aId: string;
  bId: string;
  /** Kinds present, closest first: blood, adopted, foster, step, partner. */
  kinds: UnitLinkKind[];
  count: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type FamilySky = {
  width: number;
  height: number;
  cards: SkyCard[];
  couples: SkyCouple[];
  forks: SkyFork[];
  buckets: SkyBucket[];
  links: SkyLink[];
  unitEdges: SkyUnitEdge[];
  units: FamilyUnits;
  /** Kept for morphing. A fresh layout is already in page coordinates, so this is zero. */
  shift: { x: number; y: number };
};

export const KIND_ORDER: UnitLinkKind[] = ["blood", "adopted", "foster", "step", "partner", "divorced"];

/** Below `far` buckets become glowing nodes; from `near` up, full cards. */
export const SKY_ZOOM = { far: 0.13, near: 0.45, max: 2.2, hysteresis: 0.05 };

export type ZoomLevel = "far" | "mid" | "near";

/**
 * Zoom level for a scale. `farAt` moves the star-sky threshold up so the
 * whole-sky overview always shows stars, even when it fits at a larger scale.
 */
export function zoomLevel(s: number, previous?: ZoomLevel, farAt: number = SKY_ZOOM.far): ZoomLevel {
  const h = SKY_ZOOM.hysteresis;
  const far = Math.min(SKY_ZOOM.near * 0.85, Math.max(SKY_ZOOM.far, farAt));
  const nearAt = previous === "near" ? SKY_ZOOM.near * (1 - h) : SKY_ZOOM.near * (1 + (previous ? h : 0));
  const farBelow = previous === "far" ? far * (1 + h) : far * (1 - (previous ? h : 0));
  if (s >= nearAt) return "near";
  if (s < farBelow) return "far";
  return "mid";
}

const BUCKET = { padX: 34, padTop: 52, padBottom: 30, n: 4, gap: 70 };
const LABEL_ROOM = BUCKET.padTop - BUCKET.padBottom;

function bucketShape(halfW: number, halfH: number) {
  const n = BUCKET.n;
  const rx0 = halfW + BUCKET.padX;
  const ry0 = halfH + BUCKET.padBottom;
  const fill = Math.pow(halfW / rx0, n) + Math.pow(halfH / ry0, n);
  const k = Math.max(1, Math.pow(fill / 0.94, 1 / n));
  return { rx: rx0 * k, ry: ry0 * k, n };
}

/**
 * People who are in this unit because of an override (themselves, or anyone
 * whose membership runs through that person). Row placement ignores a parent
 * link from one of them to someone who is in the unit for another reason, so
 * a partnerless person moved onto a descendant's family sits on that family's
 * row instead of staying a generation above them.
 */
function broughtByOverride(unit: FamilyUnit, via: Record<string, JoinReason>): Set<string> {
  const members = new Set(unit.memberIds);
  const brought = new Set<string>();
  for (const id of unit.memberIds) {
    const seen = new Set<string>();
    let cur: string | undefined = id;
    while (cur && members.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const reason: JoinReason | undefined = via[cur];
      if (!reason || reason.kind === "root") break;
      if (reason.kind === "override" || reason.kind === "own") {
        brought.add(id);
        break;
      }
      if (!("personId" in reason)) break;
      cur = reason.personId;
    }
  }
  return brought;
}

/** The part of the tree inside one unit: its people and the ties among them. */
function unitTree(tree: TreeData, unit: FamilyUnit, via: Record<string, JoinReason>): TreeData {
  const inside = new Set(unit.memberIds);
  const brought = broughtByOverride(unit, via);
  const people = tree.people
    .filter((p) => inside.has(p.id))
    // graphX is the classic graph's absolute place. It must not size or move a bucket.
    .map((p) => ({ ...p, graphX: undefined }))
    // The saved array order is not part of the graph.
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const unions = tree.unions
    .map((u) => ({ ...u, partnerIds: u.partnerIds.filter((id) => inside.has(id)) }))
    .filter((u) => u.partnerIds.length >= 2);
  const childLinks = tree.childLinks
    .filter((l) => inside.has(l.childId))
    .map((l) => ({
      ...l,
      parentIds: l.parentIds.filter((id) => inside.has(id) && !(brought.has(id) && !brought.has(l.childId))),
    }))
    .filter((l) => l.parentIds.length > 0)
    .map((l) => (l.unionId && !unions.some((u) => u.id === l.unionId) ? { ...l, unionId: undefined } : l))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { people, unions, childLinks, focusPersonId: unit.rootId };
}

type BucketFrame = { cx: number; cy: number; rx: number; ry: number; n: number };

function finiteNudge(person: { rowNudge?: number }) {
  const nudge = person.rowNudge;
  return typeof nudge === "number" && Number.isFinite(nudge) ? nudge : 0;
}

function cardFits(frame: BucketFrame, x: number, y: number) {
  const corners = [
    [x - CARD.w / 2, y],
    [x + CARD.w / 2, y],
    [x - CARD.w / 2, y + CARD.h],
    [x + CARD.w / 2, y + CARD.h],
  ];
  return corners.every(
    ([px, py]) =>
      Math.pow(Math.abs(px - frame.cx) / frame.rx, frame.n) + Math.pow(Math.abs(py - frame.cy) / frame.ry, frame.n) <= 1,
  );
}

/** The furthest x from `fromX` toward `wantX` that still sits inside the family. */
function clampToFrame(frame: BucketFrame, y: number, fromX: number, wantX: number) {
  if (cardFits(frame, wantX, y)) return wantX;
  let lo = fromX;
  let hi = wantX;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (cardFits(frame, mid, y)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Apply saved row nudges after the buckets are placed.
 * A nudge slides someone along their own row. Passing the person beside
 * them exchanges those two automatic places. It does not change the row,
 * the family, or where the family sits.
 */
function applyRowNudges(graph: GraphLayout, frame: BucketFrame) {
  const rows = new Map<number, LaidCard[]>();
  for (const card of graph.cards) {
    const row = rows.get(card.y);
    if (row) row.push(card);
    else rows.set(card.y, [card]);
  }
  let moved = false;
  for (const row of rows.values()) {
    if (!row.some((card) => finiteNudge(card.person))) continue;
    const auto = new Map(row.map((card) => [card.id, card.x]));
    const desired = (card: LaidCard) => auto.get(card.id)! + finiteNudge(card.person);
    const byId = (a: LaidCard, b: LaidCard) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const byDesired = [...row].sort((a, b) => desired(a) - desired(b) || auto.get(a.id)! - auto.get(b.id)! || byId(a, b));
    const byAuto = [...row].sort((a, b) => auto.get(a.id)! - auto.get(b.id)! || byId(a, b));
    const reordered = byDesired.some((card, index) => card.id !== byAuto[index].id);
    const next = new Map<string, number>();
    if (reordered) {
      const slots = byAuto.map((card) => auto.get(card.id)!);
      byDesired.forEach((card, index) => next.set(card.id, slots[index]));
    } else {
      for (const card of row) {
        const origin = auto.get(card.id)!;
        let x = origin + finiteNudge(card.person);
        const left = byAuto.filter((other) => auto.get(other.id)! < origin).at(-1);
        const right = byAuto.find((other) => auto.get(other.id)! > origin);
        if (left) x = Math.max(x, auto.get(left.id)! + (origin - auto.get(left.id)!));
        if (right) x = Math.min(x, auto.get(right.id)! - (auto.get(right.id)! - origin));
        next.set(card.id, clampToFrame(frame, card.y, origin, x));
      }
    }
    for (const card of row) {
      const x = next.get(card.id)!;
      if (x !== card.x) {
        card.x = x;
        moved = true;
      }
    }
  }
  if (moved) retieUnit(graph);
}

/** Parent lines and couple bars follow cards that slid along the row. */
function retieUnit(graph: GraphLayout) {
  const byId = new Map(graph.cards.map((card) => [card.id, card]));
  for (const couple of graph.couples) {
    const partners = couple.partnerIds.map((id) => byId.get(id)).filter((card): card is LaidCard => Boolean(card));
    if (partners.length < 2) continue;
    const left = partners.reduce((a, b) => (a.x < b.x ? a : b));
    const right = partners.reduce((a, b) => (a.x > b.x ? a : b));
    const together = right.x - left.x <= CARD.w + CARD.coupleGap + 0.51;
    couple.cx = (left.x + right.x) / 2;
    couple.cy = left.y + CARD.h * 0.5;
    couple.bar = together && showsCoupleBar(couple.kind, partners.length);
  }
  for (const fork of graph.forks) {
    for (const drop of fork.parentDrops) {
      const card = byId.get(drop.parentId);
      if (card) drop.x = card.x;
    }
    for (const drop of fork.childDrops) {
      const card = byId.get(drop.childId);
      if (card) drop.x = card.x;
    }
    const parentXs = fork.parentDrops.map((drop) => drop.x);
    const childXs = fork.childDrops.map((drop) => drop.x);
    if (!parentXs.length) continue;
    const stemX = parentXs.reduce((sum, x) => sum + x, 0) / parentXs.length;
    fork.joinLeft = Math.min(...parentXs);
    fork.joinRight = Math.max(...parentXs);
    fork.stemX = stemX;
    fork.railLeft = Math.min(...childXs, stemX);
    fork.railRight = Math.max(...childXs, stemX);
  }
}

export type RowGesture = "pending" | "place" | "carry";

/**
 * What an edit drag on a sky card is doing.
 * Along the row it places. Into another family, or mostly up and down, it carries.
 */
export function rowGesture(
  mode: RowGesture,
  movement: { dx: number; dy: number },
  overForeignBucket: boolean,
): RowGesture {
  if (mode === "carry") return "carry";
  const travel = Math.abs(movement.dx) + Math.abs(movement.dy);
  if (overForeignBucket && (mode === "place" || travel > 4)) return "carry";
  if (mode === "place") return "place";
  if (travel <= 4) return "pending";
  if (Math.abs(movement.dx) >= Math.abs(movement.dy)) return "place";
  return "carry";
}

function shiftFork(fork: LaidFork, dx: number, dy: number, unitId: string): SkyFork {
  return {
    ...fork,
    unitId,
    id: `${unitId}-${fork.id}`,
    joinY: fork.joinY + dy,
    railY: fork.railY + dy,
    joinLeft: fork.joinLeft + dx,
    joinRight: fork.joinRight + dx,
    railLeft: fork.railLeft + dx,
    railRight: fork.railRight + dx,
    stemX: fork.stemX + dx,
    parentDrops: fork.parentDrops.map((d) => ({ ...d, x: d.x + dx, y0: d.y0 + dy })),
    childDrops: fork.childDrops.map((d) => ({ ...d, x: d.x + dx, y1: d.y1 + dy })),
  };
}

type Rect = { x0: number; y0: number; x1: number; y1: number };

const LINK_GAP = 7;
const AVATAR_ROOM = 50;

function cardRect(c: { x: number; y: number }, pad = 0): Rect {
  return { x0: c.x - CARD.w / 2 - pad, y0: c.y - pad, x1: c.x + CARD.w / 2 + pad, y1: c.y + CARD.h + pad };
}

function quadAt(q: Curve, t: number) {
  const u = 1 - t;
  return {
    x: u * u * q.x1 + 2 * u * t * q.cx + t * t * q.x2,
    y: u * u * q.y1 + 2 * u * t * q.cy + t * t * q.y2,
  };
}

/** The piece of a quadratic between t0 and t1, as a quadratic. */
function subCurve(q: Curve, t0: number, t1: number): Curve {
  const a = quadAt(q, t0);
  const b = quadAt(q, t1);
  // Control point: the tangent lines at t0 and t1 meet there.
  const lerpPt = (p: { x: number; y: number }, r: { x: number; y: number }, t: number) => ({
    x: p.x + (r.x - p.x) * t,
    y: p.y + (r.y - p.y) * t,
  });
  const p0 = { x: q.x1, y: q.y1 };
  const p1 = { x: q.cx, y: q.cy };
  const p2 = { x: q.x2, y: q.y2 };
  // Control of [t0, t1] = blossom(t0, t1).
  const c = lerpPt(lerpPt(p0, p1, t0), lerpPt(p1, p2, t0), t1);
  return { x1: a.x, y1: a.y, cx: c.x, cy: c.y, x2: b.x, y2: b.y };
}

const inRect = (r: Rect, p: { x: number; y: number }) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;

/** First t (searching from `from` toward `to`) where `inside` stops holding, refined by bisection. */
function exitT(q: Curve, inside: (p: { x: number; y: number }) => boolean, from: number, to: number): number {
  const STEPS = 96;
  let prev = from;
  for (let i = 1; i <= STEPS; i++) {
    const t = from + ((to - from) * i) / STEPS;
    if (!inside(quadAt(q, t))) {
      let lo = prev;
      let hi = t;
      for (let k = 0; k < 18; k++) {
        const m = (lo + hi) / 2;
        if (inside(quadAt(q, m))) lo = m;
        else hi = m;
      }
      return hi;
    }
    prev = t;
  }
  return to;
}

/** Trim a curve so it starts and ends just outside the shapes around its two ends. */
function trim(q: Curve, insideStart: (p: { x: number; y: number }) => boolean, insideEnd: (p: { x: number; y: number }) => boolean): Curve {
  const t0 = exitT(q, insideStart, 0, 1);
  const t1 = exitT(q, insideEnd, 1, 0);
  return t1 > t0 ? subCurve(q, t0, t1) : q;
}

/**
 * The visible pieces of a curve: wherever it would pass under one of the
 * `blocked` shapes, it stops short of the shape and resumes after it.
 */
function gapped(q: Curve, blocked: ((p: { x: number; y: number }) => boolean)[]): Curve[] {
  if (!blocked.length) return [q];
  const hidden = (t: number) => {
    const p = quadAt(q, t);
    return blocked.some((f) => f(p));
  };
  // Bisect between a visible t and a hidden t for the edge (on the visible side).
  const edge = (visible: number, covered: number) => {
    for (let k = 0; k < 18; k++) {
      const m = (visible + covered) / 2;
      if (hidden(m)) covered = m;
      else visible = m;
    }
    return visible;
  };
  const STEPS = 96;
  const pieces: Curve[] = [];
  let start: number | null = hidden(0) ? null : 0;
  for (let i = 1; i <= STEPS; i++) {
    const t0 = (i - 1) / STEPS;
    const t = i / STEPS;
    const h = hidden(t);
    if (start !== null && h) {
      const end = edge(t0, t);
      if (end - start > 1e-3) pieces.push(subCurve(q, start, end));
      start = null;
    } else if (start === null && !h) {
      start = edge(t, t0);
    }
  }
  if (start !== null && 1 - start > 1e-3) pieces.push(subCurve(q, start, 1));
  return pieces;
}

/**
 * Trim and gap the short curve from `route`. The bow and the choice to miss
 * an unrelated family live in that function; this only keeps the stroke off
 * the cards it still has to pass.
 */
function routeLink(
  a: { x: number; y: number },
  b: { x: number; y: number },
  otherCards: { x: number; y: number }[],
  foreign: RouteBucket[],
  route: typeof routePersonLink,
  avoid: RouteCurve[],
): { raw: RouteCurve; near: Curve; mid: Curve; nearPieces: Curve[]; midPieces: Curve[] } {
  const q: RouteCurve = route({ from: a, to: b, cards: otherCards, foreign, avoid });
  const ra = cardRect(a, LINK_GAP);
  const rb = cardRect(b, LINK_GAP);
  const nearCurve = trim(q, (p) => inRect(ra, p), (p) => inRect(rb, p));
  const A = { x: a.x, y: a.y + CARD.h / 2 };
  const B = { x: b.x, y: b.y + CARD.h / 2 };
  const inA = (p: { x: number; y: number }) => Math.hypot(p.x - A.x, p.y - A.y) < AVATAR_ROOM;
  const inB = (p: { x: number; y: number }) => Math.hypot(p.x - B.x, p.y - B.y) < AVATAR_ROOM;
  const midCurve = trim(q, inA, inB);
  const minX = Math.min(q.x1, q.x2, q.cx);
  const maxX = Math.max(q.x1, q.x2, q.cx);
  const minY = Math.min(q.y1, q.y2, q.cy);
  const maxY = Math.max(q.y1, q.y2, q.cy);
  const obstacles = otherCards
    .map((card) => cardRect(card, 4))
    .filter((r) => r.x1 > minX && r.x0 < maxX && r.y1 > minY && r.y0 < maxY);
  const nearPieces = gapped(
    nearCurve,
    obstacles.map((r) => (p: { x: number; y: number }) => inRect({ x0: r.x0 - LINK_GAP, y0: r.y0 - LINK_GAP, x1: r.x1 + LINK_GAP, y1: r.y1 + LINK_GAP }, p)),
  );
  const midPieces = gapped(
    midCurve,
    otherCards
      .filter((c) => c.x > minX && c.x < maxX && c.y > minY && c.y < maxY)
      .map((c) => (p: { x: number; y: number }) => Math.hypot(p.x - c.x, p.y - c.y - CARD.h / 2) < AVATAR_ROOM),
  );
  return { raw: q, near: nearCurve, mid: midCurve, nearPieces, midPieces };
}

/** How many points along a curve fall inside any of the given cards (for tests and checks). */
export function curveHitsCards(q: Curve, cards: { x: number; y: number }[], samples = 48): number {
  const rects = cards.map((c) => cardRect(c));
  let hits = 0;
  for (let i = 0; i <= samples; i++) if (rects.some((r) => inRect(r, quadAt(q, i / samples)))) hits++;
  return hits;
}

/**
 * Lay out the sky. The result is a pure function of the kinship graph, the
 * saved row nudges, and the saved family-unit overrides. Focus, any earlier
 * sky, and the order of the saved arrays are not inputs. `visibleIds` drops
 * everyone a lens has hidden before buckets are placed, so their saved places
 * cannot appear in that view.
 */
export function layoutFamilySky(
  tree: TreeData,
  route: typeof routePersonLink = routePersonLink,
  visibleIds?: ReadonlySet<string>,
): FamilySky {
  const source = visibleIds ? treeForLens(tree, visibleIds) : tree;
  const units = deriveFamilyUnits(source);

  // 1. Each unit's own generation-row layout, in local coordinates.
  const local = units.units.map((unit) => {
    const graph = buildGraph(unitTree(source, unit, units.via), unit.rootId);
    const cards = graph.cards;
    const minX = Math.min(...cards.map((c) => c.x - CARD.w / 2));
    const maxX = Math.max(...cards.map((c) => c.x + CARD.w / 2));
    const minY = Math.min(...cards.map((c) => c.y));
    const maxY = Math.max(...cards.map((c) => c.y + CARD.h));
    // Room for the label on top: the shape wraps the content plus a strip above it.
    const shape = bucketShape((maxX - minX) / 2, (maxY - minY) / 2 + LABEL_ROOM / 2);
    return { unit, graph, minX, maxX, minY, maxY, shape };
  });

  // 2. Hang each family from its parent family. The seed ignores array order,
  // and a change inside one family does not recompute the families above it.
  const seed = seedFromUnits(units);
  const sizeOf = new Map(local.map((item) => [item.unit.id, { w: 2 * item.shape.rx, h: 2 * item.shape.ry }]));
  const placed = new Map(placeFamilySkySeed(seed, (id) => sizeOf.get(id) ?? { w: 0, h: 0 }, BUCKET.gap).map((item) => [item.id, item]));
  const nodes = local.map((item) => {
    const at = placed.get(item.unit.id) ?? { x: item.shape.rx, y: item.shape.ry };
    const size = sizeOf.get(item.unit.id) ?? { w: 2 * item.shape.rx, h: 2 * item.shape.ry };
    return { x: at.x, y: at.y, w: size.w, h: size.h };
  });

  // 3. Shift into positive world coordinates.
  const pad = 80;
  const minWX = nodes.length ? Math.min(...nodes.map((b) => b.x - b.w / 2 - pad)) : 0;
  const minWY = nodes.length ? Math.min(...nodes.map((b) => b.y - b.h / 2 - pad)) : 0;
  for (const node of nodes) {
    node.x -= minWX;
    node.y -= minWY;
  }

  // 4. Cards, couples and forks in world coordinates.
  const cards: SkyCard[] = [];
  const couples: SkyCouple[] = [];
  const forks: SkyFork[] = [];
  const buckets: SkyBucket[] = [];
  local.forEach((l, i) => {
    const node = nodes[i];
    const localCx = (l.minX + l.maxX) / 2;
    const localCy = (l.minY + l.maxY) / 2;
    applyRowNudges(l.graph, {
      cx: localCx,
      cy: localCy - LABEL_ROOM / 2,
      rx: l.shape.rx,
      ry: l.shape.ry,
      n: l.shape.n,
    });
    const dx = node.x - localCx;
    // Content sits below centre, leaving the label strip on top.
    const dy = node.y - localCy + LABEL_ROOM / 2;
    for (const card of l.graph.cards) cards.push({ ...card, x: card.x + dx, y: card.y + dy, unitId: l.unit.id });
    for (const couple of l.graph.couples) {
      const union = source.unions.find((item) => item.id === couple.id);
      couples.push({
        ...couple,
        cx: couple.cx + dx,
        cy: couple.cy + dy,
        unitId: l.unit.id,
        status: union ? partnerStatus(source, union) : couple.status,
      });
    }
    for (const fork of l.graph.forks) forks.push(shiftFork(fork, dx, dy, l.unit.id));
    buckets.push({
      id: l.unit.id,
      label: l.unit.label,
      headIds: l.unit.headIds,
      memberIds: l.unit.memberIds,
      cx: node.x,
      cy: node.y,
      ...l.shape,
      glow: 110 + 46 * Math.sqrt(l.unit.memberIds.length),
    });
  });
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  cards.sort(byId);
  buckets.sort(byId);
  couples.sort(byId);
  forks.sort(byId);
  const cardOf = new Map(cards.map((c) => [c.id, c]));

  // 5. Links between buckets: person to person, and one edge per bucket pair.
  // Routed in id order so a later link can stay beside an earlier one. The
  // route runs once per layout, never while the sky is panning or gliding.
  const avoid: RouteCurve[] = [];
  const links: SkyLink[] = [...units.links]
    .sort(byId)
    .map((link) => {
      const a = cardOf.get(link.fromPersonId)!;
      const b = cardOf.get(link.toPersonId)!;
      const otherCards = cards.filter((c) => c.id !== a.id && c.id !== b.id);
      const foreign = buckets.filter((bucket) => bucket.id !== link.fromUnitId && bucket.id !== link.toUnitId);
      const { raw, near, mid, nearPieces, midPieces } = routeLink(a, b, otherCards, foreign, route, avoid);
      avoid.push(raw);
      return { ...link, ...near, mid, pieces: nearPieces, midPieces };
    });
  const bucketOf = new Map(buckets.map((b) => [b.id, b]));
  const edges = new Map<string, SkyUnitEdge>();
  for (const link of units.links) {
    const [aId, bId] = link.fromUnitId < link.toUnitId ? [link.fromUnitId, link.toUnitId] : [link.toUnitId, link.fromUnitId];
    const key = `${aId}|${bId}`;
    const a = bucketOf.get(aId)!;
    const b = bucketOf.get(bId)!;
    const edge = edges.get(key) ?? { id: key, aId, bId, kinds: [], count: 0, x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy };
    edge.count += 1;
    if (!edge.kinds.includes(link.kind)) edge.kinds.push(link.kind);
    edge.kinds.sort((p, q) => KIND_ORDER.indexOf(p) - KIND_ORDER.indexOf(q));
    edges.set(key, edge);
  }

  links.sort(byId);
  const unitEdges = [...edges.values()].sort(byId);
  const width = Math.max(320, ...buckets.map((b) => b.cx + b.rx + pad));
  const height = Math.max(280, ...buckets.map((b) => b.cy + b.ry + pad));
  return { width, height, cards, couples, forks, buckets, links, unitEdges, units, shift: { x: 0, y: 0 } };
}

export type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function skyBounds(sky: FamilySky): Box {
  if (!sky.buckets.length) return { minX: 0, minY: 0, maxX: sky.width, maxY: sky.height };
  return {
    minX: Math.min(...sky.buckets.map((b) => b.cx - b.rx)),
    minY: Math.min(...sky.buckets.map((b) => b.cy - b.ry)),
    maxX: Math.max(...sky.buckets.map((b) => b.cx + b.rx)),
    maxY: Math.max(...sky.buckets.map((b) => b.cy + b.ry)),
  };
}

export function bucketBox(b: SkyBucket): Box {
  return { minX: b.cx - b.rx, minY: b.cy - b.ry, maxX: b.cx + b.rx, maxY: b.cy + b.ry };
}

/** Camera that fits `box` inside a viewport, centred, with padding. */
export function cameraToFit(vw: number, vh: number, box: Box, pad = 20, maxScale = SKY_ZOOM.max): Camera {
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const s = Math.min(maxScale, Math.max(1e-4, Math.min((vw - pad * 2) / w, (vh - pad * 2) / h)));
  return { x: vw / 2 - ((box.minX + box.maxX) / 2) * s, y: vh / 2 - ((box.minY + box.maxY) / 2) * s, s };
}

/**
 * The zoom a Families check lands on: fit the whole sky, then step in by
 * 1.4 until the view is no longer the star field. That is the scale at
 * which family backgrounds and person-to-person links are on screen.
 */
export function skyLinksOnScreen(vw: number, vh: number, sky: FamilySky, zoomClicks = 8) {
  const overview = overviewZoom(vw, vh, sky);
  let scale = overview.s;
  let level = zoomLevel(scale, undefined, overview.farAt);
  for (let i = 0; i < zoomClicks && level === "far"; i++) {
    scale *= 1.4;
    level = zoomLevel(scale, level, overview.farAt);
  }
  const drawn = level === "near" ? "pieces" : "midPieces";
  return {
    level,
    scale,
    measure: measureCrossBucketLinks(
      sky.links.map((link) => ({
        id: link.id,
        fromUnitId: link.fromUnitId,
        toUnitId: link.toUnitId,
        curves: link[drawn],
      })),
      sky.buckets,
    ),
  };
}

/** Scale for the star-sky overview, and the far threshold that keeps it starry. */
export function overviewZoom(vw: number, vh: number, sky: FamilySky): { s: number; farAt: number } {
  const fit = cameraToFit(vw, vh, skyBounds(sky)).s;
  const farAt = Math.min(SKY_ZOOM.near * 0.85, Math.max(SKY_ZOOM.far, fit * 1.1));
  return { s: Math.min(fit, farAt * 0.85), farAt };
}

/** Zoom floor: half the whole-sky fit, so every family fits with room to spare. */
export function skyMinScale(vw: number, vh: number, sky: FamilySky): number {
  return Math.min(SKY_ZOOM.far * 0.5, cameraToFit(vw, vh, skyBounds(sky)).s * 0.5);
}

/** Buckets that touch the world rectangle seen by a camera, plus a margin. */
export function visibleBuckets(sky: FamilySky, cam: Camera, vw: number, vh: number, margin = 0.35): string[] {
  const s = Math.max(cam.s, 1e-4);
  const mx = (vw * margin) / s;
  const my = (vh * margin) / s;
  const x0 = -cam.x / s - mx;
  const y0 = -cam.y / s - my;
  const x1 = (vw - cam.x) / s + mx;
  const y1 = (vh - cam.y) / s + my;
  return sky.buckets
    .filter((b) => b.cx + b.rx >= x0 && b.cx - b.rx <= x1 && b.cy + b.ry >= y0 && b.cy - b.ry <= y1)
    .map((b) => b.id);
}

/** Where a bucket's label sits in world space, by zoom level. */
export function labelAnchor(b: SkyBucket, level: ZoomLevel): { x: number; y: number } {
  return level === "far" ? { x: b.cx, y: b.cy + b.glow * 0.42 } : { x: b.cx, y: b.cy - b.ry + 26 };
}

/**
 * Labels that fit without overlapping on screen at scale `s`: bigger families
 * (and `firstId`, the selected person's) claim space first.
 */
export function legibleLabels(sky: FamilySky, s: number, level: ZoomLevel, firstId?: string): string[] {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const chosen: string[] = [];
  const ranked = [...sky.buckets].sort(
    (a, b) =>
      (b.id === firstId ? 1 : 0) - (a.id === firstId ? 1 : 0) ||
      b.memberIds.length - a.memberIds.length ||
      sky.buckets.indexOf(a) - sky.buckets.indexOf(b),
  );
  for (const b of ranked) {
    const { x, y } = labelAnchor(b, level);
    const w = (b.label.length + (level === "far" ? 3 : 0)) * 7.4 + 22;
    const h = 22;
    const sx = x * s;
    const sy = level === "far" ? y * s : y * s - h / 2;
    const box = { x0: sx - w / 2, y0: sy, x1: sx + w / 2, y1: sy + h };
    if (placed.some((p) => box.x0 < p.x1 + 4 && box.x1 > p.x0 - 4 && box.y0 < p.y1 + 2 && box.y1 > p.y0 - 2)) continue;
    placed.push(box);
    chosen.push(b.id);
  }
  return chosen;
}

/** Bucket under a world point. At far zoom the glow (at least 22px on screen) counts too. */
export function bucketAt(sky: FamilySky, wx: number, wy: number, s: number) {
  const minR = 22 / Math.max(s, 1e-4);
  return sky.buckets.find((b) => {
    const r = Math.max(b.glow, minR);
    if (Math.hypot(wx - b.cx, wy - b.cy) <= r) return true;
    return Math.pow(Math.abs(wx - b.cx) / b.rx, b.n) + Math.pow(Math.abs(wy - b.cy) / b.ry, b.n) <= 1;
  });
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * The sky part-way (`k` from 0 to 1) between two layouts of the same tree,
 * for animating a change: every person glides from where they were, and
 * every bucket from where it (or most of its people) used to be. People and
 * buckets new to `to` start where they end. Links and forks move with the
 * people at their ends.
 */
export function morphSky(from: FamilySky, to: FamilySky, k: number): FamilySky {
  if (k >= 1) return to;
  const { x: sx, y: sy } = to.shift;
  const was = new Map(from.cards.map((c) => [c.id, { ...c, x: c.x + sx, y: c.y + sy }]));
  const delta = new Map(
    to.cards.map((c) => {
      const old = was.get(c.id);
      return [c.id, old ? { dx: (old.x - c.x) * (1 - k), dy: (old.y - c.y) * (1 - k) } : { dx: 0, dy: 0 }];
    }),
  );
  const d = (id: string) => delta.get(id) ?? { dx: 0, dy: 0 };
  const oldBucket = new Map(from.buckets.map((b) => [b.id, { ...b, cx: b.cx + sx, cy: b.cy + sy }]));
  const buckets = to.buckets.map((b) => {
    const old = oldBucket.get(b.id);
    if (old) return { ...b, cx: lerp(old.cx, b.cx, k), cy: lerp(old.cy, b.cy, k), rx: lerp(old.rx, b.rx, k), ry: lerp(old.ry, b.ry, k) };
    const moves = b.memberIds.map(d);
    const dx = moves.reduce((s, m) => s + m.dx, 0) / Math.max(1, moves.length);
    const dy = moves.reduce((s, m) => s + m.dy, 0) / Math.max(1, moves.length);
    return { ...b, cx: b.cx + dx, cy: b.cy + dy, rx: b.rx * lerp(0.6, 1, k), ry: b.ry * lerp(0.6, 1, k) };
  });
  const cards = to.cards.map((c) => ({ ...c, x: c.x + d(c.id).dx, y: c.y + d(c.id).dy }));
  const couples = to.couples.map((c) => {
    const m = d(c.partnerIds[0]);
    return { ...c, cx: c.cx + m.dx, cy: c.cy + m.dy };
  });
  const forks = to.forks.map((f) => {
    const m = d(f.childDrops[0]?.childId ?? f.parentDrops[0]?.parentId ?? "");
    return {
      ...f,
      joinY: f.joinY + m.dy,
      railY: f.railY + m.dy,
      joinLeft: f.joinLeft + m.dx,
      joinRight: f.joinRight + m.dx,
      railLeft: f.railLeft + m.dx,
      railRight: f.railRight + m.dx,
      stemX: f.stemX + m.dx,
      parentDrops: f.parentDrops.map((p) => ({ ...p, x: p.x + d(p.parentId).dx, y0: p.y0 + d(p.parentId).dy })),
      childDrops: f.childDrops.map((c) => ({ ...c, x: c.x + d(c.childId).dx, y1: c.y1 + d(c.childId).dy })),
    };
  });
  const links = to.links.map((l) => {
    const a = d(l.fromPersonId);
    const b = d(l.toPersonId);
    const shiftCurve = (q: Curve): Curve => ({
      x1: q.x1 + a.dx,
      y1: q.y1 + a.dy,
      cx: q.cx + (a.dx + b.dx) / 2,
      cy: q.cy + (a.dy + b.dy) / 2,
      x2: q.x2 + b.dx,
      y2: q.y2 + b.dy,
    });
    return {
      ...l,
      ...shiftCurve(l),
      mid: shiftCurve(l.mid),
      pieces: l.pieces.map(shiftCurve),
      midPieces: l.midPieces.map(shiftCurve),
    };
  });
  const at = new Map(buckets.map((b) => [b.id, b]));
  const unitEdges = to.unitEdges.map((e) => ({ ...e, x1: at.get(e.aId)!.cx, y1: at.get(e.aId)!.cy, x2: at.get(e.bId)!.cx, y2: at.get(e.bId)!.cy }));
  return {
    ...to,
    width: Math.max(from.width, to.width),
    height: Math.max(from.height, to.height),
    buckets,
    cards,
    couples,
    forks,
    links,
    unitEdges,
  };
}
