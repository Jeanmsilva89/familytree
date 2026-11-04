import type { TreeData } from "./types";
import { CARD, computeGenerations, type LaidCard, type LaidCouple, type LaidFork } from "./layout";
import { buildGraph } from "./layoutGraph";
import { deriveFamilyUnits, type FamilyUnit, type FamilyUnits, type UnitLinkKind } from "./familyUnits";
import type { Camera } from "./graphView";

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
  /**
   * When laid out from a previous sky: how far that sky's world was shifted
   * to keep everything on the page (add it to an old position to compare).
   */
  shift: { x: number; y: number };
};

export const KIND_ORDER: UnitLinkKind[] = ["blood", "adopted", "foster", "step", "partner"];

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
const GRAVITY = 0.25;
const GEN_PULL = 0.3;

function bucketShape(halfW: number, halfH: number) {
  const n = BUCKET.n;
  const rx0 = halfW + BUCKET.padX;
  const ry0 = halfH + BUCKET.padBottom;
  const fill = Math.pow(halfW / rx0, n) + Math.pow(halfH / ry0, n);
  const k = Math.max(1, Math.pow(fill / 0.94, 1 / n));
  return { rx: rx0 * k, ry: ry0 * k, n };
}

/** The part of the tree inside one unit: its people and the ties among them. */
function unitTree(tree: TreeData, unit: FamilyUnit): TreeData {
  const inside = new Set(unit.memberIds);
  const people = tree.people
    .filter((p) => inside.has(p.id))
    .map((p) => ({ ...p, graphX: undefined }));
  const unions = tree.unions
    .map((u) => ({ ...u, partnerIds: u.partnerIds.filter((id) => inside.has(id)) }))
    .filter((u) => u.partnerIds.length >= 2);
  const childLinks = tree.childLinks
    .filter((l) => inside.has(l.childId))
    .map((l) => ({ ...l, parentIds: l.parentIds.filter((id) => inside.has(id)) }))
    .filter((l) => l.parentIds.length > 0)
    .map((l) => (l.unionId && !unions.some((u) => u.id === l.unionId) ? { ...l, unionId: undefined } : l));
  return { people, unions, childLinks, focusPersonId: unit.rootId };
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

/** Generation of every person, for people in any connected part of the tree. */
function generations(tree: TreeData, focusId?: string): Map<string, number> {
  const gen = focusId ? computeGenerations(tree, [focusId]) : new Map<string, number>();
  for (const person of tree.people) {
    if (gen.has(person.id)) continue;
    for (const [id, g] of computeGenerations(tree, [person.id])) if (!gen.has(id)) gen.set(id, g);
  }
  return gen;
}

type Node = { w: number; h: number; r: number; level: number; x: number; y: number };

/**
 * Deterministic force layout: linked buckets attract, all buckets repel,
 * older generations float up. A final pass removes any overlap.
 */
function placeBuckets(nodes: Node[], edges: { a: number; b: number; weight: number }[], start: number) {
  const n = nodes.length;
  if (!n) return;
  const avgR = nodes.reduce((s, b) => s + b.r, 0) / n;
  const levelStep = avgR * 1.1;

  // Seed on a golden-angle spiral in breadth-first order from the start bucket.
  const adj = nodes.map(() => [] as number[]);
  for (const e of edges) {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }
  const orderList: number[] = [];
  const seen = new Set<number>();
  const visit = (root: number) => {
    const queue = [root];
    seen.add(root);
    while (queue.length) {
      const i = queue.shift()!;
      orderList.push(i);
      for (const j of adj[i]) if (!seen.has(j)) { seen.add(j); queue.push(j); }
    }
  };
  visit(start);
  for (let i = 0; i < n; i++) if (!seen.has(i)) visit(i);
  orderList.forEach((i, k) => {
    const angle = k * 2.399963;
    const radius = avgR * 1.7 * Math.sqrt(k);
    nodes[i].x = Math.cos(angle) * radius;
    nodes[i].y = Math.sin(angle) * radius * 0.8 - nodes[i].level * levelStep;
  });

  const iterations = n > 150 ? 160 : 280;
  const dispX = new Float64Array(n);
  const dispY = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    const temp = avgR * 1.2 * (1 - it / iterations) + 1;
    dispX.fill(0);
    dispY.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = Math.cos(i * 7 + j);
          dy = Math.sin(i * 7 + j);
          d = 1;
        }
        const k = nodes[i].r + nodes[j].r + BUCKET.gap;
        // Short-range repulsion only, so the sky packs into a cloud.
        if (d > k * 1.8) continue;
        const f = (k * k) / d;
        dispX[i] += (dx / d) * f;
        dispY[i] += (dy / d) * f;
        dispX[j] -= (dx / d) * f;
        dispY[j] -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const a = nodes[e.a];
      const b = nodes[e.b];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const k = a.r + b.r + BUCKET.gap;
      const f = ((d * d) / k) * Math.min(2, Math.sqrt(e.weight));
      dispX[e.a] -= (dx / d) * f;
      dispY[e.a] -= (dy / d) * f;
      dispX[e.b] += (dx / d) * f;
      dispY[e.b] += (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      // Pull toward the centre, and gently toward the generation's height.
      dispX[i] -= node.x * GRAVITY;
      dispY[i] += (-node.level * levelStep - node.y) * GEN_PULL - node.y * GRAVITY * 0.5;
      const len = Math.hypot(dispX[i], dispY[i]);
      if (len > 0) {
        const step = Math.min(len, temp);
        node.x += (dispX[i] / len) * step;
        node.y += (dispY[i] / len) * step;
      }
    }
  }

  removeOverlaps(nodes);
}

/**
 * Push overlapping bucket boxes (plus a gap) apart along the shorter axis.
 * Each pair splits the push by weight, so light buckets move and heavy ones
 * (buckets that were already settled) mostly stay put.
 */
function removeOverlaps(nodes: Node[], weight: (i: number) => number = () => 1) {
  const n = nodes.length;
  for (let pass = 0; pass < 600; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = (a.w + b.w) / 2 + BUCKET.gap * 0.5 - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + BUCKET.gap * 0.5 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const wa = weight(i);
        const wb = weight(j);
        const ka = wa / (wa + wb);
        const kb = wb / (wa + wb);
        if (ox < oy) {
          const sg = dx === 0 ? (i < j ? 1 : -1) : Math.sign(dx);
          a.x -= sg * ox * ka;
          b.x += sg * ox * kb;
        } else {
          const sg = dy === 0 ? 1 : Math.sign(dy);
          a.y -= sg * oy * ka;
          b.y += sg * oy * kb;
        }
      }
    }
    if (!moved) break;
  }
}

/**
 * Seed buckets where they were in `previous`: a bucket that already existed
 * keeps its centre; a new one starts where most of its people were (or next
 * to a linked bucket). Returns false when too little carries over to be worth
 * keeping, so the caller lays the sky out from scratch.
 */
function placeFromPrevious(
  nodes: Node[],
  ids: string[],
  memberIds: string[][],
  edges: { a: number; b: number }[],
  previous: FamilySky,
): boolean {
  const prevBucket = new Map(previous.buckets.map((b) => [b.id, b]));
  const prevCard = new Map(previous.cards.map((c) => [c.id, c]));
  const kept = ids.filter((id) => prevBucket.has(id)).length;
  if (!nodes.length || kept < Math.ceil(nodes.length / 2)) return false;
  const heavy = new Set<number>();
  const placed = new Set<number>();
  nodes.forEach((node, i) => {
    const b = prevBucket.get(ids[i]);
    if (b) {
      node.x = b.cx;
      node.y = b.cy;
      placed.add(i);
      // Unchanged buckets are heavy; ones that grew or shrank give way.
      const same = b.memberIds.length === memberIds[i].length && memberIds[i].every((id) => b.memberIds.includes(id));
      if (same) heavy.add(i);
      return;
    }
    const was = memberIds[i].map((id) => prevCard.get(id)).filter((c) => c !== undefined);
    if (was.length) {
      node.x = was.reduce((sum, c) => sum + c.x, 0) / was.length;
      node.y = was.reduce((sum, c) => sum + c.y + CARD.h / 2, 0) / was.length;
      placed.add(i);
    }
  });
  // Anything still unplaced goes beside a placed neighbour, or below the sky.
  const bottom = Math.max(...previous.buckets.map((b) => b.cy + b.ry), 0);
  nodes.forEach((node, i) => {
    if (placed.has(i)) return;
    const e = edges.find((e) => (e.a === i && placed.has(e.b)) || (e.b === i && placed.has(e.a)));
    const other = e ? nodes[e.a === i ? e.b : e.a] : undefined;
    node.x = other ? other.x + other.w / 2 + node.w / 2 + BUCKET.gap : i * (node.w + BUCKET.gap);
    node.y = other ? other.y : bottom + node.h / 2 + BUCKET.gap;
    placed.add(i);
  });
  removeOverlaps(nodes, (i) => (heavy.has(i) ? 0.02 : 1));
  return true;
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
 * Route a link between two card centres as one gentle curve that bends
 * around the other cards in its way (the fewest sample points inside a card,
 * then the least bend), then trim it to the cards' edges.
 */
function routeLink(
  a: { x: number; y: number },
  b: { x: number; y: number },
  obstacles: Rect[],
  avatars: { x: number; y: number }[],
): { near: Curve; mid: Curve; nearPieces: Curve[]; midPieces: Curve[] } {
  const A = { x: a.x, y: a.y + CARD.h / 2 };
  const B = { x: b.x, y: b.y + CARD.h / 2 };
  const len = Math.max(1, Math.hypot(B.x - A.x, B.y - A.y));
  const nx = -(B.y - A.y) / len;
  const ny = (B.x - A.x) / len;
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  const box: Rect = {
    x0: Math.min(A.x, B.x) - len * 0.7,
    y0: Math.min(A.y, B.y) - len * 0.7,
    x1: Math.max(A.x, B.x) + len * 0.7,
    y1: Math.max(A.y, B.y) + len * 0.7,
  };
  const near = obstacles.filter((r) => r.x1 > box.x0 && r.x0 < box.x1 && r.y1 > box.y0 && r.y0 < box.y1);
  const ra = cardRect(a, LINK_GAP);
  const rb = cardRect(b, LINK_GAP);
  let best: { q: Curve; score: number } | undefined;
  for (const bend of [0.12, -0.12, 0, 0.24, -0.24, 0.36, -0.36, 0.5, -0.5]) {
    // A quadratic peaks at half its control offset, so double it.
    const q = { x1: A.x, y1: A.y, cx: mx + nx * len * bend * 2, cy: my + ny * len * bend * 2, x2: B.x, y2: B.y };
    let hits = 0;
    for (let i = 1; i < 48; i++) {
      const p = quadAt(q, i / 48);
      if (inRect(ra, p) || inRect(rb, p)) continue;
      if (near.some((r) => inRect(r, p))) hits++;
    }
    const score = hits * 10 + Math.abs(bend);
    if (!best || score < best.score) best = { q, score };
  }
  const q = best!.q;
  const nearCurve = trim(q, (p) => inRect(ra, p), (p) => inRect(rb, p));
  const inA = (p: { x: number; y: number }) => Math.hypot(p.x - A.x, p.y - A.y) < AVATAR_ROOM;
  const inB = (p: { x: number; y: number }) => Math.hypot(p.x - B.x, p.y - B.y) < AVATAR_ROOM;
  const midCurve = trim(q, inA, inB);
  const nearPieces = gapped(
    nearCurve,
    near.map((r) => (p: { x: number; y: number }) => inRect({ x0: r.x0 - LINK_GAP, y0: r.y0 - LINK_GAP, x1: r.x1 + LINK_GAP, y1: r.y1 + LINK_GAP }, p)),
  );
  const midPieces = gapped(
    midCurve,
    avatars
      .filter((c) => c.x > box.x0 && c.x < box.x1 && c.y > box.y0 && c.y < box.y1)
      .map((c) => (p: { x: number; y: number }) => Math.hypot(p.x - c.x, p.y - c.y - CARD.h / 2) < AVATAR_ROOM),
  );
  return { near: nearCurve, mid: midCurve, nearPieces, midPieces };
}

/** How many points along a curve fall inside any of the given cards (for tests and checks). */
export function curveHitsCards(q: Curve, cards: { x: number; y: number }[], samples = 48): number {
  const rects = cards.map((c) => cardRect(c));
  let hits = 0;
  for (let i = 0; i <= samples; i++) if (rects.some((r) => inRect(r, quadAt(q, i / samples)))) hits++;
  return hits;
}

/**
 * Lay out the sky. Pass the `previous` layout of the same tree (for example
 * just before a family-unit reassignment) to keep every bucket where it was
 * as far as possible instead of laying the whole sky out again.
 */
export function layoutFamilySky(tree: TreeData, focusHint?: string, previous?: FamilySky): FamilySky {
  const units = deriveFamilyUnits(tree);
  const focusId = focusHint ?? tree.focusPersonId ?? tree.people[0]?.id;
  const gen = generations(tree, focusId && tree.people.some((p) => p.id === focusId) ? focusId : undefined);

  // 1. Each unit's own generation-row layout, in local coordinates.
  const local = units.units.map((unit) => {
    const graph = buildGraph(unitTree(tree, unit), unit.rootId);
    const cards = graph.cards;
    const minX = Math.min(...cards.map((c) => c.x - CARD.w / 2));
    const maxX = Math.max(...cards.map((c) => c.x + CARD.w / 2));
    const minY = Math.min(...cards.map((c) => c.y));
    const maxY = Math.max(...cards.map((c) => c.y + CARD.h));
    // Room for the label on top: the shape wraps the content plus a strip above it.
    const shape = bucketShape((maxX - minX) / 2, (maxY - minY) / 2 + LABEL_ROOM / 2);
    const level = Math.max(...unit.memberIds.map((id) => gen.get(id) ?? 0));
    return { unit, graph, minX, maxX, minY, maxY, shape, level };
  });

  // 2. Place the buckets.
  const indexOf = new Map(units.units.map((u, i) => [u.id, i]));
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edgeMap = new Map<string, { a: number; b: number; weight: number }>();
  for (const link of units.links) {
    const key = pairKey(link.fromUnitId, link.toUnitId);
    const e = edgeMap.get(key) ?? { a: indexOf.get(link.fromUnitId)!, b: indexOf.get(link.toUnitId)!, weight: 0 };
    e.weight += 1;
    edgeMap.set(key, e);
  }
  const nodes: Node[] = local.map((l) => ({
    w: 2 * l.shape.rx,
    h: 2 * l.shape.ry,
    r: Math.hypot(l.shape.rx, l.shape.ry) * 0.85,
    level: l.level,
    x: 0,
    y: 0,
  }));
  const startUnit = focusId ? indexOf.get(units.unitOf[focusId] ?? "") ?? 0 : 0;
  const edgeList = [...edgeMap.values()];
  const kept =
    previous !== undefined &&
    placeFromPrevious(
      nodes,
      units.units.map((u) => u.id),
      units.units.map((u) => u.memberIds),
      edgeList,
      previous,
    );
  if (!kept) placeBuckets(nodes, edgeList, startUnit);

  // 3. Shift into positive world coordinates. A kept layout only shifts when
  // something would fall off the top or left, so nothing else appears to move.
  const pad = 80;
  const minWX = Math.min(...nodes.map((b) => b.x - b.w / 2 - pad), kept ? 0 : Infinity);
  const minWY = Math.min(...nodes.map((b) => b.y - b.h / 2 - pad), kept ? 0 : Infinity);
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
    const dx = node.x - localCx;
    // Content sits below centre, leaving the label strip on top.
    const dy = node.y - localCy + LABEL_ROOM / 2;
    for (const card of l.graph.cards) cards.push({ ...card, x: card.x + dx, y: card.y + dy, unitId: l.unit.id });
    for (const couple of l.graph.couples) couples.push({ ...couple, cx: couple.cx + dx, cy: couple.cy + dy, unitId: l.unit.id });
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
  const order = new Map(tree.people.map((p, i) => [p.id, i]));
  cards.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const cardOf = new Map(cards.map((c) => [c.id, c]));

  // 5. Links between buckets: person to person, and one edge per bucket pair.
  const obstacles = new Map(cards.map((c) => [c.id, cardRect(c, 4)]));
  const links: SkyLink[] = units.links.map((link) => {
    const a = cardOf.get(link.fromPersonId)!;
    const b = cardOf.get(link.toPersonId)!;
    const others = [...obstacles.entries()].filter(([id]) => id !== a.id && id !== b.id).map(([, r]) => r);
    const otherCards = cards.filter((c) => c.id !== a.id && c.id !== b.id);
    const { near, mid, nearPieces, midPieces } = routeLink(a, b, others, otherCards);
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

  const width = Math.max(320, ...buckets.map((b) => b.cx + b.rx + pad));
  const height = Math.max(280, ...buckets.map((b) => b.cy + b.ry + pad));
  const shift = kept ? { x: -minWX, y: -minWY } : { x: 0, y: 0 };
  return { width, height, cards, couples, forks, buckets, links, unitEdges: [...edges.values()], units, shift };
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
