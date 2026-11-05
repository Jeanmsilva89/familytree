import { CARD } from "./layout";

/**
 * Peak distance from the straight chord, as a fraction of the chord length.
 * A link may bend to leave its own cards or to miss another family's
 * background, and the bend stays inside this share of the distance.
 */
export const LINK_BOW_LIMIT = 0.16;

const PORT_GAP = 7;
const CLEARANCE = 12;

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

/**
 * A short quadratic from one person's card to another's.
 * The bow stays within `bowLimit` times the chord. Among those curves, the
 * one that misses every unrelated family background wins when any such curve
 * exists; otherwise the gentlest curve with the fewest crossings.
 */
export function routePersonLink(input: {
  from: RoutePoint;
  to: RoutePoint;
  /** Other people's cards, same coordinates as `from` and `to` (center x, top y). */
  cards?: RoutePoint[];
  /** Family backgrounds neither endpoint belongs to. */
  foreign?: RouteBucket[];
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
  const starts = fromPorts.length ? fromPorts : ports(from, to);
  const ends = toPorts.length ? toPorts : ports(to, from);
  const bends = [0, 0.04, -0.04, 0.08, -0.08, 0.12, -0.12, 0.16, -0.16].filter((bend) => Math.abs(bend) <= limit + 1e-9);

  let best: { q: RouteCurve; score: number } | undefined;
  const consider = (bend: number) => {
    for (const A of starts) {
      for (const B of ends) {
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const len = Math.hypot(dx, dy);
        if (len < 1) continue;
        const nx = -dy / len;
        const ny = dx / len;
        const mx = (A.x + B.x) / 2;
        const my = (A.y + B.y) / 2;
        const q: RouteCurve = {
          x1: A.x,
          y1: A.y,
          cx: mx + nx * len * bend * 2,
          cy: my + ny * len * bend * 2,
          x2: B.x,
          y2: B.y,
        };
        let score = Math.abs(bend) + len * 1e-6;
        for (let i = 1; i < 24; i++) {
          if (best && score >= best.score) break;
          const p = quadAt(q, i / 24);
          if (inRect(fromRect, p) || inRect(toRect, p)) {
            score += 200;
            continue;
          }
          if (obstacles.some((r) => inRect(r, p))) score += 20;
          for (const bucket of foreign) {
            if (pointInBucket(bucket, p)) score += 1_000_000;
            else if (pointInBucket(bucket, p, CLEARANCE)) score += 1_000;
          }
        }
        if (!best || score < best.score) best = { q, score };
      }
    }
  };
  consider(0);
  // A clear straight run needs no bend. Keep looking when it would cross a card or a family.
  if (!best || best.score >= 20) {
    for (const bend of bends) if (bend !== 0) consider(bend);
  }
  if (best) return best.q;
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
