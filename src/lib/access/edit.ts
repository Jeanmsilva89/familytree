import type { TreeData } from "../types";
import { kinOf } from "../types";
import { deriveBranch, type BranchTie } from "./branch";
import { asPersonId, type PersonId, type TreeId } from "./ids";
import type {
  AccessState,
  BranchConflict,
  ClaimRank,
  EditDecision,
  EditParty,
  EditSubject,
  Forest,
  Viewer,
} from "./types";

/**
 * Edit claims, strongest first: tree owner, the person themselves, a line
 * parent (blood or adopted), a foster parent (care), then a partner.
 * Step gives no claim on the person. A step-parent may still edit the step
 * link they are named on, at partner rank, and a line parent prevails.
 *
 * Two parties at the top rank need agreement. Divorced parents, biological
 * and adoptive parents, and same-sex parents are that case. The tree owner
 * stands over the tie. On a person record, that person stands over other
 * branch owners when there is no tree owner. Delegates act as the branch
 * owner and do not form a separate party.
 */

const RANK: Record<ClaimRank, number> = {
  partner: 1,
  care: 2,
  line: 3,
  self: 4,
  "tree-owner": 5,
};

function deny(): EditDecision {
  return { mayEdit: false, branchConflict: { kind: "none" } };
}

function ownerOf(access: AccessState, treeId: TreeId): PersonId | undefined {
  return access.trees.find((tree) => tree.treeId === treeId)?.ownerPersonId;
}

function delegatesFor(access: AccessState, treeId: TreeId, rootId: PersonId): PersonId[] {
  return access.delegates
    .filter((row) => row.treeId === treeId && row.branchRootId === rootId)
    .map((row) => row.personId);
}

function addActor(parties: Map<string, EditParty>, rootId: PersonId, rank: ClaimRank, actor: PersonId) {
  const existing = parties.get(rootId);
  if (!existing) {
    parties.set(rootId, { branchRootId: rootId, rank, actors: [actor] });
    return;
  }
  if (RANK[rank] > RANK[existing.rank]) existing.rank = rank;
  if (!existing.actors.includes(actor)) existing.actors.push(actor);
}

function addBranch(parties: Map<string, EditParty>, access: AccessState, treeId: TreeId, rootId: PersonId, rank: ClaimRank) {
  addActor(parties, rootId, rank, rootId);
  for (const delegate of delegatesFor(access, treeId, rootId)) addActor(parties, rootId, rank, delegate);
}

function rankOfTie(tie: BranchTie): ClaimRank | undefined {
  if (tie.kind === "root") return "self";
  if (tie.kind === "descendant") return tie.kin === "foster" ? "care" : "line";
  return "partner";
}

function partiesForPerson(tree: TreeData, treeId: TreeId, access: AccessState, personId: PersonId): Map<string, EditParty> {
  const parties = new Map<string, EditParty>();
  for (const person of tree.people) {
    if (person.id === personId) continue;
    const branch = deriveBranch(treeId, tree, asPersonId(person.id));
    const member = branch.members.find((item) => item.personId === personId);
    if (!member) continue;
    const rank = rankOfTie(member.tie);
    if (!rank || rank === "self") continue;
    addBranch(parties, access, treeId, asPersonId(person.id), rank);
  }
  return parties;
}

function partiesForUnion(tree: TreeData, treeId: TreeId, access: AccessState, unionId: string): Map<string, EditParty> | undefined {
  const union = tree.unions.find((item) => item.id === unionId);
  if (!union) return undefined;
  const parties = new Map<string, EditParty>();
  for (const partnerId of union.partnerIds) {
    addBranch(parties, access, treeId, asPersonId(partnerId), "self");
  }
  for (const person of tree.people) {
    if (union.partnerIds.includes(person.id)) continue;
    const branch = deriveBranch(treeId, tree, asPersonId(person.id));
    const ties = union.partnerIds.map((id) => branch.members.find((member) => member.personId === id));
    if (ties.some((tie) => !tie)) continue;
    const descendants = ties.filter((tie) => tie?.tie.kind === "descendant");
    if (!descendants.length) continue;
    const careOnly = descendants.every((tie) => tie?.tie.kind === "descendant" && tie.tie.kin === "foster");
    addBranch(parties, access, treeId, asPersonId(person.id), careOnly ? "care" : "line");
  }
  return parties;
}

function partiesForChildLink(
  tree: TreeData,
  treeId: TreeId,
  access: AccessState,
  childLinkId: string,
): Map<string, EditParty> | undefined {
  const link = tree.childLinks.find((item) => item.id === childLinkId);
  if (!link) return undefined;
  const parties = new Map<string, EditParty>();
  for (const person of tree.people) {
    const branch = deriveBranch(treeId, tree, asPersonId(person.id));
    const member = branch.members.find((item) => item.personId === link.childId);
    if (!member || member.tie.kind !== "descendant") continue;
    addBranch(parties, access, treeId, asPersonId(person.id), member.tie.kin === "foster" ? "care" : "line");
  }
  for (const parentId of link.parentIds) {
    const kin = kinOf(link, parentId);
    const rank: ClaimRank = kin === "step" ? "partner" : kin === "foster" ? "care" : "line";
    addBranch(parties, access, treeId, asPersonId(parentId), rank);
  }
  return parties;
}

function conflictOf(parties: Map<string, EditParty>): BranchConflict {
  const list = [...parties.values()].sort((a, b) => (a.branchRootId < b.branchRootId ? -1 : a.branchRootId > b.branchRootId ? 1 : 0));
  if (list.length === 0) return { kind: "none" };
  if (list.length === 1) return { kind: "none", party: list[0] };
  const max = Math.max(...list.map((party) => RANK[party.rank]));
  const top = list.filter((party) => RANK[party.rank] === max);
  if (top.length === 1) return { kind: "resolved", prevails: top[0], parties: list };
  return { kind: "needs-agreement", parties: top };
}

function standingOf(subject: EditSubject, access: AccessState, conflict: BranchConflict): EditParty | undefined {
  const owner = ownerOf(access, subject.treeId);
  if (owner) return { branchRootId: owner, rank: "tree-owner", actors: [owner] };
  if (subject.kind === "person") return { branchRootId: subject.personId, rank: "self", actors: [subject.personId] };
  if (conflict.kind === "none") return conflict.party;
  if (conflict.kind === "resolved") return conflict.prevails;
  return undefined;
}

function claimFor(
  viewer: Viewer,
  access: AccessState,
  subject: EditSubject,
  parties: Map<string, EditParty>,
): Pick<EditDecision, "mayEdit" | "rank" | "forBranchRootId"> {
  if (viewer.kind !== "member" || viewer.treeId !== subject.treeId) return { mayEdit: false };
  const owner = ownerOf(access, subject.treeId);
  if (owner && viewer.personId === owner) return { mayEdit: true, rank: "tree-owner", forBranchRootId: owner };
  if (subject.kind === "person" && viewer.personId === subject.personId) {
    return { mayEdit: true, rank: "self", forBranchRootId: subject.personId };
  }
  const acted = [...parties.values()].filter((party) => party.actors.includes(viewer.personId));
  if (!acted.length) return { mayEdit: false };
  acted.sort((a, b) => {
    const byRank = RANK[b.rank] - RANK[a.rank];
    if (byRank !== 0) return byRank;
    if (a.branchRootId === viewer.personId) return -1;
    if (b.branchRootId === viewer.personId) return 1;
    return a.branchRootId < b.branchRootId ? -1 : 1;
  });
  return { mayEdit: true, rank: acted[0].rank, forBranchRootId: acted[0].branchRootId };
}

export function resolveEdit(forest: Forest, access: AccessState, viewer: Viewer, subject: EditSubject): EditDecision {
  const tree = forest[subject.treeId];
  if (!tree) return deny();
  if (subject.kind === "person" && !tree.people.some((person) => person.id === subject.personId)) return deny();

  const parties =
    subject.kind === "person"
      ? partiesForPerson(tree, subject.treeId, access, subject.personId)
      : subject.kind === "union"
        ? partiesForUnion(tree, subject.treeId, access, subject.unionId)
        : partiesForChildLink(tree, subject.treeId, access, subject.childLinkId);
  if (!parties) return deny();

  const branchConflict = conflictOf(parties);
  return {
    ...claimFor(viewer, access, subject, parties),
    branchConflict,
    standing: standingOf(subject, access, branchConflict),
  };
}
