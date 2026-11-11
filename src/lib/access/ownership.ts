import type { TreeData } from "../types";
import { deriveBranch } from "./branch";
import type { InviteId, PersonId, TreeId } from "./ids";
import { sharedLock } from "./share";
import type { AccessState, EditSubject, Forest, Viewer } from "./types";

/**
 * The tree owner hands a derived branch to a guest, or takes it back.
 * This is not a kinship claim. `resolveEdit` is unchanged. `canEdit` is the
 * gate for writing on this device: the tree owner, otherwise only a guest
 * inside a branch their invite still holds. A shared family stays locked.
 */

function liveInvite(access: AccessState, inviteId: InviteId) {
  const link = access.links.find((item) => item.id === inviteId);
  if (!link || link.status === "revoked") return undefined;
  return link;
}

function withoutHand(access: AccessState, treeId: TreeId, branchRootId: PersonId): AccessState {
  const hands = (access.branchOwners ?? []).filter(
    (hand) => !(hand.treeId === treeId && hand.branchRootId === branchRootId),
  );
  if (hands.length === (access.branchOwners?.length ?? 0)) return access;
  if (!hands.length) {
    const next = { ...access };
    delete next.branchOwners;
    return next;
  }
  return { ...access, branchOwners: hands };
}

/** `inviteId` null takes the branch back. A revoked or unknown invite changes nothing. */
export function handBranch(
  access: AccessState,
  treeId: TreeId,
  branchRootId: PersonId,
  inviteId: InviteId | null,
): AccessState {
  if (inviteId == null) return withoutHand(access, treeId, branchRootId);
  if (!liveInvite(access, inviteId)) return access;
  const hands = (access.branchOwners ?? []).filter(
    (hand) => !(hand.treeId === treeId && hand.branchRootId === branchRootId),
  );
  return { ...access, branchOwners: [...hands, { treeId, branchRootId, inviteId }] };
}

function heldRoots(access: AccessState, viewer: Viewer, treeId: TreeId): PersonId[] {
  if (viewer.kind !== "guest" || viewer.treeId !== treeId) return [];
  if (!liveInvite(access, viewer.inviteId)) return [];
  return (access.branchOwners ?? [])
    .filter((hand) => hand.treeId === treeId && hand.inviteId === viewer.inviteId)
    .map((hand) => hand.branchRootId);
}

function namedIds(tree: TreeData, subject: EditSubject): string[] | null {
  if (subject.kind === "person") {
    return tree.people.some((person) => person.id === subject.personId) ? [subject.personId] : null;
  }
  if (subject.kind === "union") {
    const union = tree.unions.find((item) => item.id === subject.unionId);
    return union ? [...union.partnerIds] : null;
  }
  const link = tree.childLinks.find((item) => item.id === subject.childLinkId);
  return link ? [link.childId, ...link.parentIds] : null;
}

function covered(tree: TreeData, treeId: TreeId, roots: readonly PersonId[], personId: string): boolean {
  return roots.some((root) =>
    deriveBranch(treeId, tree, root).members.some((member) => member.personId === personId),
  );
}

function isTreeOwner(access: AccessState, viewer: Viewer, treeId: TreeId): boolean {
  return viewer.kind === "member"
    && viewer.treeId === treeId
    && access.trees.some((row) => row.treeId === treeId && row.ownerPersonId === viewer.personId);
}

/**
 * May this viewer write this subject on this device.
 * The tree owner may, except where a shared family is locked.
 * A guest may, only when every person the subject names sits in a branch
 * their invite holds. Everyone else may not.
 */
export function canEdit(forest: Forest, access: AccessState, viewer: Viewer, subject: EditSubject): boolean {
  const tree = forest[subject.treeId];
  if (!tree) return false;
  if (sharedLock(tree, access, subject)) return false;
  if (isTreeOwner(access, viewer, subject.treeId)) return true;
  const ids = namedIds(tree, subject);
  if (!ids?.length) return false;
  const roots = heldRoots(access, viewer, subject.treeId);
  if (!roots.length) return false;
  return ids.every((id) => covered(tree, subject.treeId, roots, id));
}

function guestFirst(access: AccessState, inviteId: InviteId): string | undefined {
  const link = liveInvite(access, inviteId);
  const name = link?.guestLabel?.trim().split(/\s+/)[0];
  return name || undefined;
}

/**
 * Short guest name for each person who sits in a branch someone else holds.
 * The default sky does not have to draw this. Revoked hands are skipped.
 */
export function ownedBranchLabels(tree: TreeData, access: AccessState, treeId: TreeId): Record<string, string> {
  const labels: Record<string, string> = {};
  const hands = (access.branchOwners ?? []).filter((hand) => hand.treeId === treeId && guestFirst(access, hand.inviteId));
  for (const hand of hands) {
    const label = guestFirst(access, hand.inviteId);
    if (!label) continue;
    for (const member of deriveBranch(treeId, tree, hand.branchRootId).members) {
      if (labels[member.personId] === undefined) labels[member.personId] = label;
    }
  }
  for (const hand of hands) {
    const label = guestFirst(access, hand.inviteId);
    if (label) labels[hand.branchRootId] = label;
  }
  return labels;
}
