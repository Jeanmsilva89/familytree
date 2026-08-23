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
