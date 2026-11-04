import type { TreeData, UnionKind } from "./types";
import { CARD, showsCoupleBar } from "./layout";

export type Camera = { x: number; y: number; s: number };

export function highlightedCoupleIds(tree: TreeData, selectedId?: string): Set<string> {
  const ids = new Set<string>();
  if (!selectedId) return ids;
  ids.add(selectedId);
  for (const union of tree.unions) {
    if (!union.partnerIds.includes(selectedId)) continue;
    if (!showsCoupleBar(union.kind, union.partnerIds.length)) continue;
    for (const id of union.partnerIds) ids.add(id);
  }
  return ids;
}

export function clampScale(s: number) {
  return Math.min(2.2, Math.max(0.45, s));
}

export function centerTransform(
  viewportW: number,
  viewportH: number,
  worldX: number,
  worldY: number,
  scale: number,
): Camera {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: viewportW / 2 - worldX * s,
    y: viewportH / 2 - worldY * s,
    s,
  };
}

export function fitContentScale(
  viewportW: number,
  viewportH: number,
  contentW: number,
  contentH: number,
  pad = 28,
): number {
  const sx = (viewportW - pad * 2) / Math.max(contentW, 1);
  const sy = (viewportH - pad * 2) / Math.max(contentH, 1);
  const raw = Math.min(sx, sy);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(2.2, Math.max(0.55, raw));
}

/** Keep the world point under (screenX, screenY) still while changing scale. */
export function scaleAround(view: Camera, screenX: number, screenY: number, nextScale: number): Camera {
  const s0 = view.s || 1;
  const s = clampScale(nextScale);
  const worldX = (screenX - view.x) / s0;
  const worldY = (screenY - view.y) / s0;
  return {
    x: screenX - worldX * s,
    y: screenY - worldY * s,
    s,
  };
}

/**
 * Pinch zoom + two-finger pan: the world point that sat under the starting
 * midpoint stays under the current midpoint as the fingers move and spread.
 */
export function pinchCamera(
  start: Camera & { dist: number; midX: number; midY: number },
  dist: number,
  midX: number,
  midY: number,
): Camera {
  const worldX = (start.midX - start.x) / (start.s || 1);
  const worldY = (start.midY - start.y) / (start.s || 1);
  const s = clampScale(start.s * (dist / Math.max(start.dist, 1e-6)));
  return {
    x: midX - worldX * s,
    y: midY - worldY * s,
    s,
  };
}

export function coupleTintBox(partners: { x: number; y: number }[], pad = 10) {
  if (partners.length < 2) return null;
  const minX = Math.min(...partners.map((p) => p.x)) - CARD.w / 2 - pad;
  const maxX = Math.max(...partners.map((p) => p.x)) + CARD.w / 2 + pad;
  const y = Math.min(...partners.map((p) => p.y)) - pad;
  return { left: minX, top: y, width: maxX - minX, height: CARD.h + pad * 2 };
}

export function showsCoupleHighlight(kind?: UnionKind, count = 2): boolean {
  return showsCoupleBar(kind, count);
}

/** SVG path for a superellipse area: |x/rx|^n + |y/ry|^n = 1. */
export function superellipsePath(area: { cx: number; cy: number; rx: number; ry: number; n: number }, steps = 96): string {
  const { cx, cy, rx, ry, n } = area;
  const e = 2 / n;
  const pts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = cx + rx * Math.sign(c) * Math.pow(Math.abs(c), e);
    const y = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), e);
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(" L ")} Z`;
}

/**
 * SVG path for a household connector: straight down from the parents, across
 * the open lane between areas, then down into the person, with soft corners.
 */
export function bridgePath(bridge: { fromX: number; fromY: number; toX: number; toY: number }, radius = 14): string {
  const { fromX, fromY, toX, toY } = bridge;
  if (Math.abs(toX - fromX) < 0.5) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  const laneY = fromY + (toY - fromY) / 2;
  const dir = Math.sign(toX - fromX);
  const r = Math.max(0, Math.min(radius, Math.abs(toX - fromX) / 2, Math.abs(laneY - fromY)));
  return [
    `M ${fromX} ${fromY}`,
    `L ${fromX} ${laneY - r}`,
    `Q ${fromX} ${laneY} ${fromX + dir * r} ${laneY}`,
    `L ${toX - dir * r} ${laneY}`,
    `Q ${toX} ${laneY} ${toX} ${laneY + r}`,
    `L ${toX} ${toY}`,
  ].join(" ");
}
