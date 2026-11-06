import type { UnitLinkKind } from "./familyUnits";
import { unlinkExisting } from "./tree";
import type { KinKind, LinkRole, Person, TreeData } from "./types";
import { displayName } from "./types";

/** Kin drawn on a sky curve or a parent/child fork. Partner is its own mark. */
export type SkyKinKind = Exclude<UnitLinkKind, "partner">;

/**
 * One sky mark that names exactly one relationship.
 * A curve joins two people in different families.
 * A couple is the bar between partners.
 * A fork is one parent on one child.
 */
export type SkyUnlinkMark =
  | { mark: "curve"; kind: SkyKinKind; parentId: string; childId: string }
  | { mark: "curve"; kind: "partner"; partnerIds: readonly [string, string] }
  | { mark: "couple"; partnerIds: readonly [string, string] }
  | { mark: "fork"; kind: SkyKinKind; parentId: string; childId: string };

export type UnlinkRequest = {
  personId: string;
  otherId: string;
  role: Exclude<LinkRole, "sibling">;
};

type Pair = readonly [string, string];

function pair(a: string, b: string): Pair | null {
  if (!a || !b || a === b) return null;
  return [a, b];
}

/** The curve the sky drew between two people, or nothing if it is not a relationship. */
export function curveUnlinkMark(link: {
  kind: UnitLinkKind;
  fromPersonId: string;
  toPersonId: string;
}): SkyUnlinkMark | null {
  if (link.kind === "partner") {
    const partnerIds = pair(link.fromPersonId, link.toPersonId);
    return partnerIds ? { mark: "curve", kind: "partner", partnerIds } : null;
  }
  const ends = pair(link.fromPersonId, link.toPersonId);
  if (!ends) return null;
  return { mark: "curve", kind: link.kind, parentId: ends[0], childId: ends[1] };
}

/** The couple bar. One partner, or the same person twice, is not a couple. */
export function coupleUnlinkMark(partnerIds: readonly string[]): Extract<SkyUnlinkMark, { mark: "couple" }> | null {
  const ends = pair(partnerIds[0] ?? "", partnerIds[1] ?? "");
  return ends ? { mark: "couple", partnerIds: ends } : null;
}

/**
 * The child drop of a fork. Classic edit removes the fork's first parent
 * from that child, which is the only parent this mark can name.
 */
export function forkUnlinkMark(
  fork: { parentIds: readonly string[] },
  drop: { childId: string; kin: KinKind },
): Extract<SkyUnlinkMark, { mark: "fork" }> | null {
  const parentId = fork.parentIds[0] ?? "";
  if (!pair(parentId, drop.childId)) return null;
  return { mark: "fork", kind: drop.kin, parentId, childId: drop.childId };
}

/** The classic `onUnlink` call for this mark. */
export function unlinkRequest(mark: SkyUnlinkMark): UnlinkRequest {
  if (mark.mark === "couple") return { personId: mark.partnerIds[0], otherId: mark.partnerIds[1], role: "partner" };
  if (mark.mark === "curve" && mark.kind === "partner") {
    return { personId: mark.partnerIds[0], otherId: mark.partnerIds[1], role: "partner" };
  }
  return { personId: mark.childId, otherId: mark.parentId, role: "parent" };
}

/** Same mutation the classic graph uses. Not a second way to edit the tree. */
export function unlinkSkyMark(tree: TreeData, mark: SkyUnlinkMark): TreeData {
  const request = unlinkRequest(mark);
  return unlinkExisting(tree, request.personId, request.otherId, request.role);
}

function named(people: readonly Person[], id: string, fallback: string) {
  const person = people.find((item) => item.id === id);
  return person ? displayName(person) : fallback;
}

/** Wording from classic TreeCanvas, so the sky asks the same question. */
export function unlinkConfirmText(people: readonly Person[], mark: SkyUnlinkMark): string {
  if (mark.mark === "couple" || (mark.mark === "curve" && mark.kind === "partner")) {
    const [a, b] = mark.partnerIds;
    return `Unlink ${named(people, a, "this couple")} and ${named(people, b, "them")} as partners?`;
  }
  return `Remove the parent link from ${named(people, mark.parentId, "this person")} to ${named(people, mark.childId, "this person")}?`;
}

/**
 * Ask, then call the classic unlink handler.
 * Returns false when the person declines. A partner mark always asks.
 * A parent mark asks with the classic parent-link question, then unlinks.
 */
export async function commitUnlink(
  people: readonly Person[],
  mark: SkyUnlinkMark,
  onUnlink: (personId: string, otherId: string, role: Exclude<LinkRole, "sibling">) => void | Promise<void>,
  ask: (message: string) => boolean = (message) => globalThis.confirm(message),
): Promise<boolean> {
  if (!ask(unlinkConfirmText(people, mark))) return false;
  const request = unlinkRequest(mark);
  await onUnlink(request.personId, request.otherId, request.role);
  return true;
}

/** Edit mode, close enough to see people. Far and mid stars stay view-only. */
export function skyUnlinkEnabled(editMode: boolean, level: "far" | "mid" | "near"): boolean {
  return editMode && level === "near";
}
