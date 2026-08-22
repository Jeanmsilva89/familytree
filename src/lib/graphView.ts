import type { TreeData, UnionKind } from "./types";
import { showsCoupleBar } from "./layout";

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

export function centerTransform(
  viewportW: number,
  viewportH: number,
  worldX: number,
  worldY: number,
  scale: number,
): { x: number; y: number; s: number } {
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
  return Math.min(2.2, Math.max(0.28, raw));
}

export function showsCoupleHighlight(kind?: UnionKind, count = 2): boolean {
  return showsCoupleBar(kind, count);
}

export function treeContentBox(
  cards: { x: number; y: number }[],
  cardW: number,
  cardH: number,
  pad = 36,
): { minX: number; minY: number; width: number; height: number; cx: number; cy: number } {
  if (!cards.length) {
    return { minX: 0, minY: 0, width: cardW, height: cardH, cx: 0, cy: cardH / 2 };
  }
  const minX = Math.min(...cards.map((c) => c.x)) - cardW / 2 - pad;
  const maxX = Math.max(...cards.map((c) => c.x)) + cardW / 2 + pad;
  const minY = Math.min(...cards.map((c) => c.y)) - pad;
  const maxY = Math.max(...cards.map((c) => c.y)) + cardH + pad;
  return {
    minX,
    minY,
    width: Math.max(maxX - minX, cardW),
    height: Math.max(maxY - minY, cardH),
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

export function fitTreeView(
  viewportW: number,
  viewportH: number,
  cards: { x: number; y: number }[],
  cardW: number,
  cardH: number,
): { x: number; y: number; s: number } {
  const box = treeContentBox(cards, cardW, cardH);
  const s = fitContentScale(viewportW, viewportH, box.width, box.height, 24);
  return centerTransform(viewportW, viewportH, box.cx, box.cy, s);
}
