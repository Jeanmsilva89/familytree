import { deriveBranch } from "./branch";
import type { InviteId, PersonId, TreeId } from "./ids";
import { graphAmong, type DetailLevel } from "./present";
import { emptyGraph, type AccessState, type Forest, type LinkGrant, type TreeLink, type VisibleGraph } from "./types";

type LinkDraft = {
  id: InviteId;
  sourceTreeId: TreeId;
  targetTreeId: TreeId;
  invitedByPersonId: PersonId;
  inviteePersonId?: PersonId;
  guestLabel?: string;
};

function draftOf(draft: LinkDraft): LinkDraft {
  return {
    id: draft.id,
    sourceTreeId: draft.sourceTreeId,
    targetTreeId: draft.targetTreeId,
    invitedByPersonId: draft.invitedByPersonId,
    ...(draft.inviteePersonId ? { inviteePersonId: draft.inviteePersonId } : {}),
    ...(draft.guestLabel ? { guestLabel: draft.guestLabel } : {}),
  };
}

function copyGrant(grant: LinkGrant): LinkGrant {
  return { personIds: [...grant.personIds], branchRootIds: [...grant.branchRootIds] };
}

export function pendingInvite(draft: LinkDraft): TreeLink {
  return { ...draftOf(draft), status: "pending" };
}

export function acceptedInvite(draft: LinkDraft & { grant: LinkGrant }): TreeLink {
  if (!draft.grant || !Array.isArray(draft.grant.personIds) || !Array.isArray(draft.grant.branchRootIds)) {
    throw new Error("An accepted link needs a grant.");
  }
  return { ...draftOf(draft), status: "accepted", grant: copyGrant(draft.grant) };
}

export function revokedInvite(draft: LinkDraft & { grant?: LinkGrant }): TreeLink {
  return {
    ...draftOf(draft),
    status: "revoked",
    ...(draft.grant ? { grant: copyGrant(draft.grant) } : {}),
  };
}

function isSealed(access: AccessState, treeId: TreeId, personId: string): boolean {
  return access.sealedPersonIds.some((row) => row.treeId === treeId && row.personId === personId);
}

function isDeceased(access: AccessState, treeId: TreeId, personId: string): boolean {
  return access.deceasedPersonIds.some((row) => row.treeId === treeId && row.personId === personId);
}

/**
 * What the source tree shows across this link. Pending and revoked links show
 * nothing. An accepted link shows the grant and nothing else. Branch grants
 * skip sealed people; listing a person in the grant reveals them. Living
 * details stay withheld. A deceased person's details are open.
 */
export function exposeLink(forest: Forest, access: AccessState, link: TreeLink): VisibleGraph {
  if (link.status !== "accepted") return emptyGraph();
  const tree = forest[link.sourceTreeId];
  if (!tree) return emptyGraph();

  const ids = new Set<string>();
  for (const rootId of link.grant.branchRootIds) {
    const branch = deriveBranch(link.sourceTreeId, tree, rootId);
    for (const member of branch.members) {
      if (isSealed(access, link.sourceTreeId, member.personId)) continue;
      ids.add(member.personId);
    }
  }
  for (const personId of link.grant.personIds) {
    if (tree.people.some((person) => person.id === personId)) ids.add(personId);
  }

  const chosen = new Map<string, { presence: "shown"; details: DetailLevel }>();
  for (const person of tree.people) {
    if (!ids.has(person.id)) continue;
    chosen.set(person.id, {
      presence: "shown",
      details: isDeceased(access, link.sourceTreeId, person.id) ? "open" : "withheld",
    });
  }
  return graphAmong(link.sourceTreeId, tree, chosen);
}
