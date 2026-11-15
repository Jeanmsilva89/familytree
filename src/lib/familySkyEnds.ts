import { CARD } from "./layout";

/** Radius of the round portrait drawn when a family is open but not close up. */
export const AVATAR_NODE_R = 44;

/**
 * How far the stroke stops outside the portrait or the avatar.
 * Far enough that the line does not cover the face, close enough that it
 * clearly belongs to that person.
 */
export const NODE_GAP = 6;

/** Circle the family-zoom stroke meets: the avatar plus {@link NODE_GAP}. */
export const AVATAR_ROOM = AVATAR_NODE_R + NODE_GAP;

export type NodeLevel = "far" | "mid" | "near";

/**
 * A dimmed person is still on the sky, so a link may end on them.
 * A hidden person is not an end: the link is not drawn.
 */
export type NodeVisibility = "shown" | "dimmed" | "hidden";

export type PersonNode = {
  /** Card top-center, the point stored on a sky card. */
  x: number;
  y: number;
  /** Family star. Used when the sky is collapsed and the person is not drawn. */
  starX: number;
  starY: number;
};

export type MarkLike = {
  draw: "shown" | "ghost";
  presence: "shown" | "dimmed";
};

/**
 * How a lens mark draws this person.
 * No lens: everyone is shown. A ghost is only there so a hidden person can
 * be touched again, so a link does not end on them. Dimmed stays shown.
 */
export function nodeVisibility(mark: MarkLike | undefined, lensOn: boolean): NodeVisibility {
  if (!lensOn) return "shown";
  if (!mark || mark.draw !== "shown") return "hidden";
  return mark.presence === "dimmed" ? "dimmed" : "shown";
}

/**
 * Where a person-to-person link ends on this person.
 *
 * `mid` is the round avatar. `near` is the portrait card. The point sits
 * {@link NODE_GAP} pixels outside that node, on the side facing `toward`.
 *
 * `far` collapses every person into the family star, and the sky draws one
 * line between two stars instead of a line per person. The end is the star.
 *
 * A hidden person returns null: the link is not drawn. A dimmed person is
 * still visible, so the link still ends on their node.
 */
export function personLinkEnd(
  person: PersonNode,
  toward: { x: number; y: number },
  level: NodeLevel,
  visibility: NodeVisibility = "shown",
): { x: number; y: number } | null {
  if (visibility === "hidden") return null;
  if (level === "far") return { x: person.starX, y: person.starY };
  const center = nodeCenter(person, level);
  if (level === "mid") return along(center, toward, AVATAR_ROOM);
  return rectPoint(center, toward, CARD.w / 2, CARD.h / 2, NODE_GAP);
}

/** Center of the node drawn at `level`. At star zoom that is the family star. */
export function nodeCenter(person: PersonNode, level: NodeLevel): { x: number; y: number } {
  if (level === "far") return { x: person.starX, y: person.starY };
  return { x: person.x, y: person.y + CARD.h / 2 };
}

/**
 * Signed distance from `point` to the node edge.
 * Positive is outside, negative is inside. A star is a point, so this is
 * the distance from the star.
 */
export function gapOutsideNode(point: { x: number; y: number }, person: PersonNode, level: NodeLevel): number {
  const center = nodeCenter(person, level);
  if (level === "far") return Math.hypot(point.x - center.x, point.y - center.y);
  if (level === "mid") return Math.hypot(point.x - center.x, point.y - center.y) - AVATAR_NODE_R;
  const dx = Math.abs(point.x - center.x) - CARD.w / 2;
  const dy = Math.abs(point.y - center.y) - CARD.h / 2;
  if (dx > 0 && dy > 0) return Math.hypot(dx, dy);
  return Math.max(dx, dy);
}

function along(center: { x: number; y: number }, toward: { x: number; y: number }, radius: number) {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: center.x + (dx / len) * radius, y: center.y + (dy / len) * radius };
}

function rectPoint(
  center: { x: number; y: number },
  toward: { x: number; y: number },
  halfW: number,
  halfH: number,
  gap: number,
) {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tx = Math.abs(ux) > 1e-9 ? halfW / Math.abs(ux) : Infinity;
  const ty = Math.abs(uy) > 1e-9 ? halfH / Math.abs(uy) : Infinity;
  const t = Math.min(tx, ty) + gap;
  return { x: center.x + ux * t, y: center.y + uy * t };
}
