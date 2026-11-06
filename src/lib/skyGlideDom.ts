import { labelAnchor, type FamilySky, type ZoomLevel } from "./familySky";
import {
  bucketTransform,
  coupleBarGeometry,
  curvesPath,
  forkGuides,
  glideRemain,
  placeBucket,
  placeCard,
  placedCoupleCy,
  placedFork,
  placedLink,
  type GlideMotion,
} from "./skyGlide";

/**
 * Paint one frame of a planned glide onto the sky that React already rendered
 * at its destination. Cards, avatars, and ports inherit `--glide-u` and move
 * by a travel set once (`--dx`, `--dy`). Lines and tints are not a single
 * move, so their attributes are written here.
 */

const ACTORS = ".portrait-card[data-person-id], .sky-avatar[data-person-id], .graph-port[data-person-id]";

export function bindSkyGlide(world: HTMLElement, motion: GlideMotion) {
  for (const el of world.querySelectorAll<HTMLElement>(ACTORS)) {
    if (el.classList.contains("is-carried")) {
      el.style.removeProperty("--dx");
      el.style.removeProperty("--dy");
      continue;
    }
    const span = motion.cards.get(el.dataset.personId ?? "") ?? { dx: 0, dy: 0 };
    el.style.setProperty("--dx", `${span.dx}px`);
    el.style.setProperty("--dy", `${span.dy}px`);
  }
}

export function clearSkyGlide(world: HTMLElement) {
  world.style.removeProperty("--glide-u");
  for (const el of world.querySelectorAll<HTMLElement>(ACTORS)) {
    el.style.removeProperty("--dx");
    el.style.removeProperty("--dy");
  }
  for (const el of world.querySelectorAll(".sky-bucket, .sky-star")) el.removeAttribute("transform");
}

function writeLine(line: SVGLineElement, x1: number, y1: number, x2: number, y2: number) {
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
}

export function stepSkyGlide(world: HTMLElement, to: FamilySky, motion: GlideMotion, k: number, level: ZoomLevel) {
  const remain = glideRemain(k);
  world.style.setProperty("--glide-u", String(remain));
  const width = k >= 1 ? to.width : motion.width;
  const height = k >= 1 ? to.height : motion.height;
  world.style.width = `${width}px`;
  world.style.height = `${height}px`;
  const svg = world.querySelector("svg.graph-lines");
  if (svg) {
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
  }

  const buckets = new Map(to.buckets.map((bucket) => [bucket.id, bucket]));
  const placedBuckets = new Map(
    to.buckets.map((bucket) => [bucket.id, { ...bucket, ...placeBucket(bucket, motion.buckets.get(bucket.id), motion.cards, k) }]),
  );
  for (const path of world.querySelectorAll<SVGPathElement>("path.sky-bucket[data-unit-id]")) {
    const dest = buckets.get(path.dataset.unitId ?? "");
    const at = dest ? placedBuckets.get(dest.id) : undefined;
    if (!dest || !at) continue;
    const transform = bucketTransform(dest, at);
    if (transform) path.setAttribute("transform", transform);
    else path.removeAttribute("transform");
  }
  for (const star of world.querySelectorAll<SVGGElement>("g.sky-star[data-unit-id]")) {
    const dest = buckets.get(star.dataset.unitId ?? "");
    const at = dest ? placedBuckets.get(dest.id) : undefined;
    if (!dest || !at) continue;
    if (at.cx === dest.cx && at.cy === dest.cy) star.removeAttribute("transform");
    else star.setAttribute("transform", `translate(${at.cx - dest.cx} ${at.cy - dest.cy})`);
  }
  for (const edge of world.querySelectorAll<SVGLineElement>("line.sky-edge[data-edge-id]")) {
    const found = to.unitEdges.find((item) => item.id === edge.dataset.edgeId);
    if (!found) continue;
    const a = placedBuckets.get(found.aId);
    const b = placedBuckets.get(found.bId);
    if (!a || !b) continue;
    writeLine(edge, a.cx, a.cy, b.cx, b.cy);
  }

  const cardById = new Map(to.cards.map((card) => [card.id, placeCard(card, motion.cards.get(card.id), k)]));
  const placedCards = to.cards.map((card) => {
    const place = cardById.get(card.id)!;
    return { id: card.id, x: place.x, y: place.y };
  });

  const near = level === "near";
  for (const group of world.querySelectorAll<SVGGElement>("g[data-link-id]")) {
    const link = to.links.find((item) => item.id === group.dataset.linkId);
    if (!link) continue;
    const placed = placedLink(link, motion, k);
    const d = curvesPath(near ? placed.pieces : placed.midPieces);
    for (const path of group.querySelectorAll("path")) path.setAttribute("d", d);
  }

  for (const group of world.querySelectorAll<SVGGElement>("g.graph-fork[data-fork-id]")) {
    const fork = to.forks.find((item) => item.id === group.dataset.forkId);
    if (!fork) continue;
    const placed = placedFork(fork, motion, k);
    const parentEls = [...group.querySelectorAll<SVGGElement>(':scope > g[data-seg="parent"]')];
    const childEls = [...group.querySelectorAll<SVGGElement>(':scope > g[data-seg="child"]')];
    const parents = parentEls
      .map((el) => placed.parentDrops.find((drop) => drop.parentId === el.dataset.personId))
      .filter((drop): drop is (typeof placed.parentDrops)[number] => Boolean(drop));
    const kids = childEls
      .map((el) => placed.childDrops.find((drop) => drop.childId === el.dataset.personId))
      .filter((drop): drop is (typeof placed.childDrops)[number] => Boolean(drop));
    if (!parents.length || !kids.length) continue;
    const guides = forkGuides(parents, kids, placed.joinY, placed.railY);
    for (const el of parentEls) {
      const drop = placed.parentDrops.find((item) => item.parentId === el.dataset.personId);
      if (!drop) continue;
      for (const line of el.querySelectorAll("line")) writeLine(line, drop.x, drop.y0, drop.x, guides.joinY);
    }
    for (const el of childEls) {
      const drop = placed.childDrops.find((item) => item.childId === el.dataset.personId);
      if (!drop) continue;
      for (const line of el.querySelectorAll("line")) writeLine(line, drop.x, guides.railY, drop.x, drop.y1);
    }
    const join = group.querySelector<SVGLineElement>(':scope > line[data-seg="join"]');
    if (join) {
      writeLine(join, guides.joinL, guides.joinY, guides.joinR, guides.joinY);
      join.setAttribute("visibility", guides.joinWide ? "visible" : "hidden");
    }
    const rail = group.querySelector<SVGLineElement>(':scope > line[data-seg="rail"]');
    if (rail) {
      writeLine(rail, guides.railL, guides.railY, guides.railR, guides.railY);
      rail.setAttribute("visibility", guides.railWide ? "visible" : "hidden");
    }
    const stem = group.querySelector<SVGLineElement>(':scope > line[data-seg="stem"]');
    if (stem) writeLine(stem, guides.stemX, guides.joinY, guides.stemX, guides.railY);
    const kin = group.querySelector<SVGTextElement>(':scope > text[data-seg="kin"]');
    if (kin) {
      kin.setAttribute("x", String(guides.stemX));
      kin.setAttribute("y", String((guides.joinY + guides.railY) / 2));
    }
  }

  const coupleLines = new Map<string, SVGLineElement>();
  for (const line of world.querySelectorAll<SVGLineElement>("line[data-couple]")) {
    if (line.dataset.couple) coupleLines.set(line.dataset.couple, line);
  }
  const coupleTints = new Map<string, HTMLElement>();
  for (const tint of world.querySelectorAll<HTMLElement>(".couple-tint[data-couple]")) {
    if (tint.dataset.couple) coupleTints.set(tint.dataset.couple, tint);
  }
  const coupleUnlinks = new Map<string, HTMLElement>();
  for (const unlink of world.querySelectorAll<HTMLElement>(".sky-unlink[data-couple]")) {
    if (unlink.dataset.couple) coupleUnlinks.set(unlink.dataset.couple, unlink);
  }
  for (const couple of to.couples) {
    if (!couple.bar) continue;
    const cy = placedCoupleCy(couple.partnerIds, couple.cy, motion, k);
    const geom = coupleBarGeometry(placedCards, couple.partnerIds, cy);
    if (!geom) continue;
    const line = coupleLines.get(couple.id);
    if (line) {
      writeLine(line, geom.x1, geom.y, geom.x2, geom.y);
      line.setAttribute("visibility", geom.showBar ? "visible" : "hidden");
    }
    const tint = coupleTints.get(couple.id);
    if (tint) {
      tint.style.left = `${geom.tint.left}px`;
      tint.style.top = `${geom.tint.top}px`;
      tint.style.width = `${geom.tint.width}px`;
      tint.style.height = `${geom.tint.height}px`;
    }
    const unlink = coupleUnlinks.get(couple.id);
    if (unlink) {
      unlink.style.left = `${geom.unlink.left}px`;
      unlink.style.top = `${geom.unlink.top}px`;
      unlink.style.visibility = geom.showBar ? "" : "hidden";
    }
  }

  for (const label of world.querySelectorAll<HTMLElement>(".sky-label[data-unit-id]")) {
    const dest = buckets.get(label.dataset.unitId ?? "");
    const at = dest ? placedBuckets.get(dest.id) : undefined;
    if (!dest || !at) continue;
    const anchor = labelAnchor(at, (label.dataset.level as ZoomLevel) || level);
    label.style.left = `${anchor.x}px`;
    label.style.top = `${anchor.y}px`;
  }
}
