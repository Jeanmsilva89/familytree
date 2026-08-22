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
  return Math.min(2.2, Math.max(0.55, raw));
}

export function showsCoupleHighlight(kind?: UnionKind, count = 2): boolean {
  return showsCoupleBar(kind, count);
}
