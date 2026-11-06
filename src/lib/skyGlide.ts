import { CARD } from "./layout";
import type { Curve, FamilySky, SkyBucket, SkyFork, SkyLink } from "./familySky";

/**
 * One glide, planned once.
 *
 * `morphSky` walks the whole sky on every call. A frame only needs the
 * distance each person (and each bucket) still has to travel: at progress
 * `k`, a point sits at `end + travel * (1 - k)`. The sky view multiplies
 * that travel in CSS (`--dx * --glide-u`) or writes the few attributes that
 * are not a plain move, instead of rebuilding the sky.
 */

export type Span = { dx: number; dy: number };

export type BucketMotion =
  | { kind: "match"; cx0: number; cy0: number; rx0: number; ry0: number }
  | { kind: "fresh"; memberIds: string[] };

export type GlideMotion = {
  width: number;
  height: number;
  /** Travel from the previous place to the destination: start minus end. */
  cards: Map<string, Span>;
  buckets: Map<string, BucketMotion>;
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Share of the travel still ahead. `1` at the first frame, `0` when the glide lands. */
export function glideRemain(k: number) {
  return 1 - k;
}

export function glideMotion(from: FamilySky, to: FamilySky): GlideMotion {
  const { x: sx, y: sy } = to.shift;
  const was = new Map(from.cards.map((c) => [c.id, { x: c.x + sx, y: c.y + sy }]));
  const cards = new Map<string, Span>();
  for (const card of to.cards) {
    const old = was.get(card.id);
    cards.set(card.id, old ? { dx: old.x - card.x, dy: old.y - card.y } : { dx: 0, dy: 0 });
  }
  const oldBucket = new Map(from.buckets.map((b) => [b.id, { ...b, cx: b.cx + sx, cy: b.cy + sy }]));
  const buckets = new Map<string, BucketMotion>();
  for (const bucket of to.buckets) {
    const old = oldBucket.get(bucket.id);
    buckets.set(
      bucket.id,
      old
        ? { kind: "match", cx0: old.cx, cy0: old.cy, rx0: old.rx, ry0: old.ry }
        : { kind: "fresh", memberIds: bucket.memberIds },
    );
  }
  return {
    width: Math.max(from.width, to.width),
    height: Math.max(from.height, to.height),
    cards,
    buckets,
  };
}

function moved(span: Span | undefined, remain: number): Span {
  if (!span || remain === 0) return { dx: 0, dy: 0 };
  return { dx: span.dx * remain, dy: span.dy * remain };
}

export function placeCard(end: { x: number; y: number }, span: Span | undefined, k: number) {
  const delta = moved(span, glideRemain(k));
  return { x: end.x + delta.dx, y: end.y + delta.dy };
}

export function placeBucket(bucket: SkyBucket, motion: BucketMotion | undefined, cards: Map<string, Span>, k: number) {
  if (!motion || motion.kind === "match") {
    const start = motion?.kind === "match" ? motion : { cx0: bucket.cx, cy0: bucket.cy, rx0: bucket.rx, ry0: bucket.ry };
    return {
      cx: lerp(start.cx0, bucket.cx, k),
      cy: lerp(start.cy0, bucket.cy, k),
      rx: lerp(start.rx0, bucket.rx, k),
      ry: lerp(start.ry0, bucket.ry, k),
    };
  }
  const remain = glideRemain(k);
  const shifts = motion.memberIds.map((id) => moved(cards.get(id), remain));
  const dx = shifts.reduce((sum, shift) => sum + shift.dx, 0) / Math.max(1, shifts.length);
  const dy = shifts.reduce((sum, shift) => sum + shift.dy, 0) / Math.max(1, shifts.length);
  return {
    cx: bucket.cx + dx,
    cy: bucket.cy + dy,
    rx: bucket.rx * lerp(0.6, 1, k),
    ry: bucket.ry * lerp(0.6, 1, k),
  };
}

/**
 * Map a point on the destination bucket outline onto the bucket at progress `k`.
 * Scaling around the destination centre, then moving to the current centre,
 * matches a superellipse whose centre and radii are lerped.
 */
export function mapBucketPoint(
  dest: { cx: number; cy: number; rx: number; ry: number },
  at: { cx: number; cy: number; rx: number; ry: number },
  x: number,
  y: number,
) {
  const sx = dest.rx === 0 ? 1 : at.rx / dest.rx;
  const sy = dest.ry === 0 ? 1 : at.ry / dest.ry;
  return { x: at.cx + (x - dest.cx) * sx, y: at.cy + (y - dest.cy) * sy };
}

export function bucketTransform(
  dest: { cx: number; cy: number; rx: number; ry: number },
  at: { cx: number; cy: number; rx: number; ry: number },
) {
  if (at.cx === dest.cx && at.cy === dest.cy && at.rx === dest.rx && at.ry === dest.ry) return "";
  const sx = dest.rx === 0 ? 1 : at.rx / dest.rx;
  const sy = dest.ry === 0 ? 1 : at.ry / dest.ry;
  return `translate(${at.cx} ${at.cy}) scale(${sx} ${sy}) translate(${-dest.cx} ${-dest.cy})`;
}

function shiftCurve(q: Curve, a: Span, b: Span): Curve {
  return {
    x1: q.x1 + a.dx,
    y1: q.y1 + a.dy,
    cx: q.cx + (a.dx + b.dx) / 2,
    cy: q.cy + (a.dy + b.dy) / 2,
    x2: q.x2 + b.dx,
    y2: q.y2 + b.dy,
  };
}

export function curvesPath(pieces: Curve[]) {
  return pieces.map((q) => `M ${q.x1} ${q.y1} Q ${q.cx} ${q.cy} ${q.x2} ${q.y2}`).join(" ");
}

export function placedLink(link: SkyLink, motion: GlideMotion, k: number): SkyLink {
  const remain = glideRemain(k);
  const a = moved(motion.cards.get(link.fromPersonId), remain);
  const b = moved(motion.cards.get(link.toPersonId), remain);
  const shift = (q: Curve) => shiftCurve(q, a, b);
  return {
    ...link,
    ...shift(link),
    mid: shift(link.mid),
    pieces: link.pieces.map(shift),
    midPieces: link.midPieces.map(shift),
  };
}

export function placedFork(fork: SkyFork, motion: GlideMotion, k: number): SkyFork {
  const remain = glideRemain(k);
  const anchorId = fork.childDrops[0]?.childId ?? fork.parentDrops[0]?.parentId ?? "";
  const anchor = moved(motion.cards.get(anchorId), remain);
  const shift = (id: string) => moved(motion.cards.get(id), remain);
  return {
    ...fork,
    joinY: fork.joinY + anchor.dy,
    railY: fork.railY + anchor.dy,
    joinLeft: fork.joinLeft + anchor.dx,
    joinRight: fork.joinRight + anchor.dx,
    railLeft: fork.railLeft + anchor.dx,
    railRight: fork.railRight + anchor.dx,
    stemX: fork.stemX + anchor.dx,
    parentDrops: fork.parentDrops.map((drop) => {
      const delta = shift(drop.parentId);
      return { ...drop, x: drop.x + delta.dx, y0: drop.y0 + delta.dy };
    }),
    childDrops: fork.childDrops.map((drop) => {
      const delta = shift(drop.childId);
      return { ...drop, x: drop.x + delta.dx, y1: drop.y1 + delta.dy };
    }),
  };
}

export type ForkGuides = {
  stemX: number;
  joinL: number;
  joinR: number;
  railL: number;
  railR: number;
  joinY: number;
  railY: number;
  joinWide: boolean;
  railWide: boolean;
};

/** The bars drawn between parent and child drops. Matches the sky's fork markup. */
export function forkGuides(
  parents: { x: number }[],
  kids: { x: number }[],
  joinY: number,
  railY: number,
): ForkGuides {
  const stemX = parents.reduce((sum, drop) => sum + drop.x, 0) / Math.max(parents.length, 1);
  const joinL = parents.length ? Math.min(...parents.map((drop) => drop.x)) : stemX;
  const joinR = parents.length ? Math.max(...parents.map((drop) => drop.x)) : stemX;
  const railL = kids.length ? Math.min(...kids.map((drop) => drop.x), stemX) : stemX;
  const railR = kids.length ? Math.max(...kids.map((drop) => drop.x), stemX) : stemX;
  return {
    stemX,
    joinL,
    joinR,
    railL,
    railR,
    joinY,
    railY,
    joinWide: joinR - joinL > 6,
    railWide: railR - railL > 6,
  };
}

export type CoupleGeom = {
  x1: number;
  x2: number;
  y: number;
  showBar: boolean;
  tint: { left: number; top: number; width: number; height: number };
  unlink: { left: number; top: number };
};

/** Couple bar, tint, and unlink target for two placed cards. `null` when a partner is missing. */
export function coupleBarGeometry(
  cards: { id: string; x: number; y: number }[],
  partnerIds: string[],
  cy: number,
): CoupleGeom | null {
  const pair = partnerIds
    .map((id) => cards.find((card) => card.id === id))
    .filter((card): card is { id: string; x: number; y: number } => Boolean(card));
  if (pair.length < 2) return null;
  const [left, right] = pair[0].x < pair[1].x ? [pair[0], pair[1]] : [pair[1], pair[0]];
  const x1 = left.x + CARD.w / 2 + 1;
  const x2 = right.x - CARD.w / 2 - 1;
  const minX = Math.min(...pair.map((card) => card.x)) - CARD.w / 2 - 10;
  const maxX = Math.max(...pair.map((card) => card.x)) + CARD.w / 2 + 10;
  const top = Math.min(...pair.map((card) => card.y)) - 10;
  return {
    x1,
    x2,
    y: cy,
    showBar: x2 > x1,
    tint: { left: minX, top, width: maxX - minX, height: CARD.h + 20 },
    unlink: { left: (x1 + x2) / 2 - 22, top: cy - 22 },
  };
}

export function placedCoupleCy(partnerIds: string[], cy: number, motion: GlideMotion, k: number) {
  const delta = moved(motion.cards.get(partnerIds[0] ?? ""), glideRemain(k));
  return cy + delta.dy;
}

/** The sky `morphSky` would build, from a plan computed once. */
export function glideFrame(to: FamilySky, motion: GlideMotion, k: number): FamilySky {
  const remain = glideRemain(k);
  const cards = to.cards.map((card) => {
    const place = placeCard(card, motion.cards.get(card.id), k);
    return { ...card, x: place.x, y: place.y };
  });
  const buckets = to.buckets.map((bucket) => ({
    ...bucket,
    ...placeBucket(bucket, motion.buckets.get(bucket.id), motion.cards, k),
  }));
  const couples = to.couples.map((couple) => {
    const delta = moved(motion.cards.get(couple.partnerIds[0] ?? ""), remain);
    return { ...couple, cx: couple.cx + delta.dx, cy: couple.cy + delta.dy };
  });
  const forks = to.forks.map((fork) => placedFork(fork, motion, k));
  const links = to.links.map((link) => placedLink(link, motion, k));
  const at = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  const unitEdges = to.unitEdges.map((edge) => ({
    ...edge,
    x1: at.get(edge.aId)!.cx,
    y1: at.get(edge.aId)!.cy,
    x2: at.get(edge.bId)!.cx,
    y2: at.get(edge.bId)!.cy,
  }));
  return {
    ...to,
    width: motion.width,
    height: motion.height,
    buckets,
    cards,
    couples,
    forks,
    links,
    unitEdges,
  };
}
