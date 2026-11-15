import { NODE_GAP } from "./familySkyEnds";
import { CARD } from "./layout";

/**
 * Peak distance from the straight chord, as a fraction of the chord length.
 * A link may bend to leave its own cards or to miss another family's
 * background, and the bend stays inside this share of the distance.
 */
export const LINK_BOW_LIMIT = 0.16;

const PORT_GAP = 7;
const CLEARANCE = 12;
/** Stay this far off a family background so a trimmed stroke cannot graze it. */
const BUCKET_PAD = 2;

export type RoutePoint = { x: number; y: number };
export type RouteBucket = { cx: number; cy: number; rx: number; ry: number; n: number };
export type RouteCurve = { x1: number; y1: number; cx: number; cy: number; x2: number; y2: number };

export function quadAt(q: RouteCurve, t: number): RoutePoint {
  const u = 1 - t;
  return {
    x: u * u * q.x1 + 2 * u * t * q.cx + t * t * q.x2,
    y: u * u * q.y1 + 2 * u * t * q.cy + t * t * q.y2,
  };
}

/** Inside a family's soft superellipse. `pad` grows the shape by that many pixels. */
export function pointInBucket(bucket: RouteBucket, p: RoutePoint, pad = 0): boolean {
  const rx = bucket.rx + pad;
  const ry = bucket.ry + pad;
  if (!(rx > 0) || !(ry > 0)) return false;
  return (Math.abs(p.x - bucket.cx) / rx) ** bucket.n + (Math.abs(p.y - bucket.cy) / ry) ** bucket.n <= 1;
}

/** How far the curve leaves its chord, divided by the chord length. */
export function curveBowRatio(q: RouteCurve, samples = 32): number {
  const dx = q.x2 - q.x1;
  const dy = q.y2 - q.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return 0;
  let max = 0;
  for (let i = 1; i < samples; i++) {
    const p = quadAt(q, i / samples);
    const dist = Math.abs(dx * (q.y1 - p.y) - dy * (q.x1 - p.x)) / len;
    if (dist > max) max = dist;
  }
  return max / len;
}

export function curveEntersBucket(q: RouteCurve, bucket: RouteBucket, samples = 64): boolean {
  for (let i = 0; i <= samples; i++) {
    if (pointInBucket(bucket, quadAt(q, i / samples))) return true;
  }
  return false;
}

type Rect = { x0: number; y0: number; x1: number; y1: number };

function cardRect(card: RoutePoint, pad: number): Rect {
  return {
    x0: card.x - CARD.w / 2 - pad,
    y0: card.y - pad,
    x1: card.x + CARD.w / 2 + pad,
    y1: card.y + CARD.h + pad,
  };
}

function inRect(r: Rect, p: RoutePoint) {
  return p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;
}

/** Points just outside a card, on the sides that face `toward`, nearest first. */
function ports(card: RoutePoint, toward: RoutePoint): RoutePoint[] {
  const r = cardRect(card, PORT_GAP);
  const mid = { x: card.x, y: card.y + CARD.h / 2 };
  const dx = toward.x - mid.x;
  const dy = toward.y - mid.y;
  const pts: RoutePoint[] = [];
  for (const t of [0.5, 0.22, 0.78]) {
    const x = r.x0 + (r.x1 - r.x0) * t;
    const y = r.y0 + (r.y1 - r.y0) * t;
    pts.push({ x, y: r.y0 }, { x, y: r.y1 }, { x: r.x0, y }, { x: r.x1, y });
  }
  const facing = pts.filter((p) => (p.x - mid.x) * dx + (p.y - mid.y) * dy > 0);
  const chosen = facing.length ? facing : pts;
  chosen.sort((a, b) => (a.x - toward.x) ** 2 + (a.y - toward.y) ** 2 - ((b.x - toward.x) ** 2 + (b.y - toward.y) ** 2));
  return chosen;
}

const ALONGS = [0.5, 0.35, 0.65, 0.22, 0.78, 0.12, 0.88];
const SAMPLE_N = 40;

type HitScore = {
  buckets: number;
  ends: number;
  cards: number;
  crosses: number;
  bow: number;
  near: number;
  len: number;
};

function betterScore(a: HitScore, b: HitScore) {
  if (a.buckets !== b.buckets) return a.buckets < b.buckets;
  if (a.ends !== b.ends) return a.ends < b.ends;
  if (a.cards !== b.cards) return a.cards < b.cards;
  if (a.crosses !== b.crosses) return a.crosses < b.crosses;
  if (a.bow < b.bow - 1e-4) return true;
  if (a.bow > b.bow + 1e-4) return false;
  if (a.near !== b.near) return a.near < b.near;
  return a.len < b.len - 0.01;
}

function clearScore(score: HitScore) {
  return score.buckets === 0 && score.ends === 0 && score.cards === 0 && score.crosses === 0;
}

/** Bend amounts up to `limit`, finest first so a gentle curve is considered before a wide one. */
function bendSteps(limit: number) {
  const steps = [0];
  const count = 8;
  for (let i = 1; i <= count; i++) {
    const bend = (limit * i) / count;
    if (bend > 1e-8) steps.push(bend, -bend);
  }
  return steps;
}

function curveBetween(a: RoutePoint, b: RoutePoint, along: number, bend: number): RouteCurve | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return undefined;
  const nx = -dy / len;
  const ny = dx / len;
  return {
    x1: a.x,
    y1: a.y,
    cx: a.x + dx * along + nx * len * bend * 2,
    cy: a.y + dy * along + ny * len * bend * 2,
    x2: b.x,
    y2: b.y,
  };
}

function sampleCurve(q: RouteCurve, samples = SAMPLE_N): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let i = 0; i <= samples; i++) points.push(quadAt(q, i / samples));
  return points;
}

function segmentsCross(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t > 0.04 && t < 0.96 && u > 0.04 && u < 0.96;
}

function polylinesCross(a: RoutePoint[], b: RoutePoint[]) {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsCross(a[i], a[i + 1], b[j], b[j + 1])) return true;
    }
  }
  return false;
}

/**
 * Slide the bend along the chord so the curve passes just beside `blocker`
 * instead of bulging from the midpoint. Returns nothing when that would
 * exceed the bow limit.
 */
function skirtBlocker(
  a: RoutePoint,
  b: RoutePoint,
  along: number,
  perpMin: number,
  perpMax: number,
  limit: number,
): RouteCurve[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [];
  const t = Math.min(0.9, Math.max(0.1, along / len));
  const weight = 2 * (1 - t) * t;
  if (weight < 1e-3) return [];
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const curves: RouteCurve[] = [];
  for (const need of [perpMax + CLEARANCE, perpMin - CLEARANCE]) {
    const height = need / weight;
    const bow = Math.abs(height) / (2 * len);
    if (bow > limit + 1e-9) continue;
    const station = Math.min(0.95, Math.max(0.05, along / len));
    const slide = Math.min(0.95, Math.max(0.05, (station - t * t) / weight));
    curves.push({
      x1: a.x,
      y1: a.y,
      cx: a.x + ux * slide * len + nx * height,
      cy: a.y + uy * slide * len + ny * height,
      x2: b.x,
      y2: b.y,
    });
  }
  return curves;
}

function bucketPerp(bucket: RouteBucket, origin: RoutePoint, nx: number, ny: number, ux: number, uy: number) {
  const e = 2 / bucket.n;
  let min = Infinity;
  let max = -Infinity;
  let along = 0;
  const steps = 36;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = bucket.cx + bucket.rx * Math.sign(c) * Math.abs(c) ** e;
    const y = bucket.cy + bucket.ry * Math.sign(s) * Math.abs(s) ** e;
    const perp = (x - origin.x) * nx + (y - origin.y) * ny;
    if (perp < min) min = perp;
    if (perp > max) max = perp;
  }
  along = (bucket.cx - origin.x) * ux + (bucket.cy - origin.y) * uy;
  return { min, max, along };
}

function straightHits(start: RoutePoint, end: RoutePoint, foreign: RouteBucket[]) {
  const curve = curveBetween(start, end, 0.5, 0);
  if (!curve) return 99;
  let hits = 0;
  for (let i = 1; i < 16; i++) {
    const point = quadAt(curve, i / 16);
    for (const bucket of foreign) if (pointInBucket(bucket, point, BUCKET_PAD)) hits++;
  }
  return hits;
}

/** Points on the circle around `center`, facing `toward`, nearest first. */
function ringPorts(center: RoutePoint, toward: RoutePoint, radius: number): RoutePoint[] {
  const base = Math.atan2(toward.y - center.y, toward.x - center.x);
  return [-1.35, 1.35, -0.7, 0.7, 0].map((offset) => ({
    x: center.x + Math.cos(base + offset) * radius,
    y: center.y + Math.sin(base + offset) * radius,
  }));
}

function rectPerp(rect: Rect, origin: RoutePoint, nx: number, ny: number, ux: number, uy: number) {
  const corners = [
    [rect.x0, rect.y0],
    [rect.x1, rect.y0],
    [rect.x0, rect.y1],
    [rect.x1, rect.y1],
  ];
  let min = Infinity;
  let max = -Infinity;
  let along = 0;
  for (const [x, y] of corners) {
    const perp = (x - origin.x) * nx + (y - origin.y) * ny;
    if (perp < min) min = perp;
    if (perp > max) max = perp;
    along += (x - origin.x) * ux + (y - origin.y) * uy;
  }
  return { min, max, along: along / corners.length };
}

/**
 * A short quadratic from one person to another.
 * The bow stays within `bowLimit` times the chord. The bend slides along
 * the chord so it passes beside an unrelated family or another card, instead
 * of always bulging from the midpoint. `terminals`, when set, are the points
 * on the two people the stroke must start and end on; the line may cross
 * those two cards on the way out and does not count that as a miss.
 * `nodeRadius`, when set, tries ports on that circle around each person
 * and keeps the stroke off the face. The same inputs always return the
 * same curve.
 */
export function routePersonLink(input: {
  from: RoutePoint;
  to: RoutePoint;
  /**
   * Points on the two people. The stroke starts at `from` and ends at `to`.
   * Without this, the stroke uses a port on each card edge.
   */
  terminals?: { from: RoutePoint; to: RoutePoint };
  /**
   * Radius of the round node around each card's center. Ports sit on that
   * circle, on the side facing the other person, and the stroke may not
   * cross the face.
   */
  nodeRadius?: number;
  /** Other people's cards, same coordinates as `from` and `to` (center x, top y). */
  cards?: RoutePoint[];
  /** Family backgrounds neither endpoint belongs to. */
  foreign?: RouteBucket[];
  /** Curves already chosen for other links, so this one can stay beside them. */
  avoid?: RouteCurve[];
  bowLimit?: number;
}): RouteCurve {
  const limit = input.bowLimit ?? LINK_BOW_LIMIT;
  const from = input.from;
  const to = input.to;
  const span = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const reach = limit * span + CLEARANCE + CARD.h;
  const x0 = Math.min(from.x, to.x) - CARD.w - reach;
  const x1 = Math.max(from.x, to.x) + CARD.w + reach;
  const y0 = Math.min(from.y, to.y) - reach;
  const y1 = Math.max(from.y, to.y) + CARD.h + reach;
  const foreign = (input.foreign ?? []).filter(
    (bucket) => bucket.cx + bucket.rx >= x0 && bucket.cx - bucket.rx <= x1 && bucket.cy + bucket.ry >= y0 && bucket.cy - bucket.ry <= y1,
  );
  const fromRect = cardRect(from, 0);
  const toRect = cardRect(to, 0);
  const obstacles = (input.cards ?? [])
    .filter((card) => card.x >= x0 && card.x <= x1 && card.y >= y0 && card.y <= y1)
    .map((card) => cardRect(card, 11));
  const open = (p: RoutePoint) => !inRect(fromRect, p) && !inRect(toRect, p) && !obstacles.some((r) => inRect(r, p));
  const fromPorts = ports(from, to).filter(open);
  const toPorts = ports(to, from).filter(open);
  const terminals = input.terminals;
  const nodeRadius = input.nodeRadius;
  const centerFrom = { x: from.x, y: from.y + CARD.h / 2 };
  const centerTo = { x: to.x, y: to.y + CARD.h / 2 };
  const ring = nodeRadius && nodeRadius > 0 ? ringPorts(centerFrom, centerTo, nodeRadius) : undefined;
  const otherRing = nodeRadius && nodeRadius > 0 ? ringPorts(centerTo, centerFrom, nodeRadius) : undefined;
  const starts = ring ? ring : terminals ? [terminals.from] : (fromPorts.length ? fromPorts : ports(from, to)).slice(0, 6);
  const ends = otherRing ? otherRing : terminals ? [terminals.to] : (toPorts.length ? toPorts : ports(to, from)).slice(0, 6);
  const soften = Boolean(terminals) && !ring;
  const avoid = (input.avoid ?? []).map((curve) => sampleCurve(curve, 24));
  const bends = bendSteps(limit);

  let bestQ: RouteCurve | undefined;
  let bestS: HitScore | undefined;
  // A ring link may clip another card if that keeps the bow gentle. The drawn
  // stroke gaps around that card. A wide bow that misses the card is harder
  // to follow than a short one that breaks and resumes.
  let gentleQ: RouteCurve | undefined;
  let gentleBow = Infinity;
  let gentleCards = Infinity;
  const fineClear = (q: RouteCurve) => {
    for (let i = 1; i < 96; i++) {
      const p = quadAt(q, i / 96);
      if (foreign.some((bucket) => pointInBucket(bucket, p, BUCKET_PAD))) return false;
    }
    return true;
  };
  const consider = (q: RouteCurve | undefined) => {
    if (!q) return;
    const bow = curveBowRatio(q);
    if (bow > limit + 1e-6) return;
    let buckets = 0;
    let endsHit = 0;
    let cards = 0;
    let near = 0;
    // With terminals the stroke is allowed to leave each person's own card.
    // A return to a card after that is a miss. Without terminals, any step
    // inside an end card is a miss, and the rest of that step is not scored.
    let leftEnd = false;
    let pendingEnd = 0;
    for (let i = 1; i < SAMPLE_N; i++) {
      if (bestS && buckets > bestS.buckets) return;
      const p = quadAt(q, i / SAMPLE_N);
      const inEnd = ring
        ? Math.hypot(p.x - centerFrom.x, p.y - centerFrom.y) < nodeRadius! - NODE_GAP ||
          Math.hypot(p.x - centerTo.x, p.y - centerTo.y) < nodeRadius! - NODE_GAP
        : inRect(fromRect, p) || inRect(toRect, p);
      if (!soften) {
        if (inEnd) {
          endsHit++;
          continue;
        }
      } else if (!leftEnd) {
        if (!inEnd) leftEnd = true;
      } else if (inEnd) {
        pendingEnd++;
      } else if (pendingEnd) {
        endsHit += pendingEnd;
        pendingEnd = 0;
      }
      if (obstacles.some((rect) => inRect(rect, p))) cards++;
      for (const bucket of foreign) {
        if (pointInBucket(bucket, p, BUCKET_PAD)) buckets++;
        else if (pointInBucket(bucket, p, CLEARANCE)) near++;
      }
    }
    let crosses = 0;
    if (avoid.length && buckets === 0) {
      const mine = sampleCurve(q, 24);
      for (const other of avoid) if (polylinesCross(mine, other)) crosses++;
    }
    const score: HitScore = {
      buckets,
      ends: endsHit,
      cards,
      crosses,
      bow,
      near,
      len: Math.hypot(q.x2 - q.x1, q.y2 - q.y1),
    };
    if (!bestS || betterScore(score, bestS)) {
      bestQ = q;
      bestS = score;
    }
    if (ring && buckets === 0 && endsHit === 0 && bow <= 0.115 && (cards < gentleCards || (cards === gentleCards && bow < gentleBow)) && fineClear(q)) {
      gentleQ = q;
      gentleBow = bow;
      gentleCards = cards;
    }
  };

  const ranked: { start: RoutePoint; end: RoutePoint; hits: number }[] = [];
  for (const start of starts) {
    for (const end of ends) {
      consider(curveBetween(start, end, 0.5, 0));
      if (ring) ranked.push({ start, end, hits: straightHits(start, end, foreign) });
    }
  }
  if (bestQ && bestS && clearScore(bestS)) return bestQ;

  const skirtPairs = ring
    ? ranked.sort((a, b) => a.hits - b.hits).slice(0, 8)
    : starts.slice(0, 4).flatMap((start) => ends.slice(0, 4).map((end) => ({ start, end })));
  for (const { start, end } of skirtPairs) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    for (const bucket of foreign) {
      const perp = bucketPerp(bucket, start, nx, ny, ux, uy);
      if (perp.along < -bucket.rx || perp.along > len + bucket.rx) continue;
      for (const curve of skirtBlocker(start, end, perp.along, perp.min, perp.max, limit)) consider(curve);
    }
    for (const rect of obstacles) {
      const perp = rectPerp(rect, start, nx, ny, ux, uy);
      if (perp.along < -CARD.w || perp.along > len + CARD.w) continue;
      for (const curve of skirtBlocker(start, end, perp.along, perp.min, perp.max, limit)) consider(curve);
    }
  }
  if (!(bestQ && bestS && clearScore(bestS))) {
    for (const bend of bends) {
      if (bend === 0) continue;
      for (const along of ALONGS) {
        for (const { start, end } of skirtPairs) consider(curveBetween(start, end, along, bend));
      }
      if (bestS && clearScore(bestS) && bestS.bow <= Math.abs(bend) + 1e-6) break;
    }
  }
  if (bestQ && bestS && clearScore(bestS) && bestS.bow > 0.02) {
    const kept = bestQ;
    const dx = kept.x2 - kept.x1;
    const dy = kept.y2 - kept.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const perp = (kept.cx - kept.x1) * nx + (kept.cy - kept.y1) * ny;
    const baseX = kept.cx - nx * perp;
    const baseY = kept.cy - ny * perp;
    const tight = obstacles.map((rect) => ({
      x0: rect.x0 - 3,
      y0: rect.y0 - 3,
      x1: rect.x1 + 3,
      y1: rect.y1 + 3,
    }));
    const stillClear = (q: RouteCurve) => {
      if (curveBowRatio(q) > limit + 1e-6) return false;
      let leftEnd = false;
      let pendingEnd = 0;
      for (let i = 1; i < 96; i++) {
        const p = quadAt(q, i / 96);
        const inEnd = ring
          ? Math.hypot(p.x - centerFrom.x, p.y - centerFrom.y) < nodeRadius! - NODE_GAP ||
            Math.hypot(p.x - centerTo.x, p.y - centerTo.y) < nodeRadius! - NODE_GAP
          : inRect(fromRect, p) || inRect(toRect, p);
        if (!soften) {
          if (inEnd) return false;
        } else if (!leftEnd) {
          if (!inEnd) leftEnd = true;
        } else if (inEnd) pendingEnd++;
        else if (pendingEnd) return false;
        if (tight.some((rect) => inRect(rect, p))) return false;
        if (foreign.some((bucket) => pointInBucket(bucket, p, BUCKET_PAD))) return false;
      }
      return true;
    };
    let lo = 0;
    let hi = 1;
    let chosen = kept;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      const trial: RouteCurve = { ...kept, cx: baseX + nx * perp * mid, cy: baseY + ny * perp * mid };
      if (stillClear(trial)) {
        chosen = trial;
        hi = mid;
      } else lo = mid;
    }
    bestQ = chosen;
  }
  if (ring && gentleQ && gentleBow <= 0.115 && !(bestS && clearScore(bestS) && bestS.bow <= 0.115)) return gentleQ;
  if (bestQ) return bestQ;
  if (ring && otherRing) {
    const a = ring[0];
    const b = otherRing[0];
    return { x1: a.x, y1: a.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x2: b.x, y2: b.y };
  }
  if (terminals) {
    return {
      x1: terminals.from.x,
      y1: terminals.from.y,
      cx: (terminals.from.x + terminals.to.x) / 2,
      cy: (terminals.from.y + terminals.to.y) / 2,
      x2: terminals.to.x,
      y2: terminals.to.y,
    };
  }
  const y = CARD.h / 2;
  return {
    x1: from.x,
    y1: from.y + y,
    cx: (from.x + to.x) / 2,
    cy: (from.y + to.y) / 2 + y,
    x2: to.x,
    y2: to.y + y,
  };
}

export type MeasuredLink = {
  id: string;
  fromUnitId: string;
  toUnitId: string;
  curves: RouteCurve[];
};

export type LinkRouteMeasure = {
  linkCount: number;
  /** Sum, over links, of how many unrelated family backgrounds that link enters. */
  foreignCrossings: number;
  /** Largest bow on a drawn link: max distance from its chord, divided by the chord length. */
  maxBow: number;
  /** Pairs of drawn links whose strokes cross. */
  pairwiseCrossings: number;
};

/** Bow of the drawn strokes against the chord from the first point to the last. */
export function drawnBow(curves: RouteCurve[]): number {
  if (!curves.length) return 0;
  const origin = { x: curves[0].x1, y: curves[0].y1 };
  const end = curves[curves.length - 1];
  const dx = end.x2 - origin.x;
  const dy = end.y2 - origin.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return 0;
  let max = 0;
  for (const curve of curves) {
    for (let i = 0; i <= 32; i++) {
      const point = quadAt(curve, i / 32);
      const dist = Math.abs(dx * (origin.y - point.y) - dy * (origin.x - point.x)) / len;
      if (dist > max) max = dist;
    }
  }
  return max / len;
}

/**
 * Crossings and bow for the curves a sky actually draws. `curves` is the
 * visible stroke (one quadratic, or the pieces left after a gap).
 */
export function measureCrossBucketLinks(
  links: MeasuredLink[],
  buckets: (RouteBucket & { id: string })[],
): LinkRouteMeasure {
  const drawn = links.map((link) => {
    const foreign = buckets.filter((bucket) => bucket.id !== link.fromUnitId && bucket.id !== link.toUnitId);
    const seen = new Set<string>();
    const points = link.curves.flatMap((curve) => sampleCurve(curve, 48));
    for (const point of points) {
      for (const bucket of foreign) {
        if (!seen.has(bucket.id) && pointInBucket(bucket, point)) seen.add(bucket.id);
      }
    }
    return { points, foreignBuckets: seen.size, bow: drawnBow(link.curves) };
  });
  let pairwise = 0;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      if (polylinesCross(drawn[i].points, drawn[j].points)) pairwise++;
    }
  }
  return {
    linkCount: links.length,
    foreignCrossings: drawn.reduce((sum, link) => sum + link.foreignBuckets, 0),
    maxBow: drawn.reduce((max, link) => Math.max(max, link.bow), 0),
    pairwiseCrossings: pairwise,
  };
}
