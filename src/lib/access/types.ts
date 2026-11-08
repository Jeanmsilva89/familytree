import type { ExtraField, ImportantDate, TreeData, UnionKind } from "../types";
import type { InviteId, LensId, PersonId, TreeId } from "./ids";

/** Every tree the access functions can see, keyed by tree id. */
export type Forest = Readonly<Record<string, TreeData>>;

/**
 * Who is looking. A member is a person on a tree. A guest is an outside
 * relative named on an invite; they have no person record on that tree.
 */
export type Viewer =
  | { kind: "member"; treeId: TreeId; personId: PersonId }
  | { kind: "guest"; treeId: TreeId; inviteId: InviteId };

export function memberViewer(treeId: TreeId, personId: PersonId): Viewer {
  return { kind: "member", treeId, personId };
}

export function guestViewer(treeId: TreeId, inviteId: InviteId): Viewer {
  return { kind: "guest", treeId, inviteId };
}

export function sameViewer(a: Viewer, b: Viewer): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "member" && b.kind === "member") {
    return a.treeId === b.treeId && a.personId === b.personId;
  }
  if (a.kind === "guest" && b.kind === "guest") {
    return a.treeId === b.treeId && a.inviteId === b.inviteId;
  }
  return false;
}

/**
 * What an accepted link is willing to show. An empty grant shows nothing.
 * A branch grant does not reveal a sealed person; listing them in `personIds` does.
 */
export type LinkGrant = {
  personIds: readonly PersonId[];
  branchRootIds: readonly PersonId[];
};

type LinkFields = {
  id: InviteId;
  sourceTreeId: TreeId;
  targetTreeId: TreeId;
  invitedByPersonId: PersonId;
  /** Set when the invitee already has a person record on the target tree. */
  inviteePersonId?: PersonId;
  /** Set when the invitee is an outside relative with no person record yet. */
  guestLabel?: string;
};

/** Pending has no grant. Accepted must have one. Revoked may keep the old grant, which is ignored. */
export type TreeLink =
  | (LinkFields & { status: "pending" })
  | (LinkFields & { status: "accepted"; grant: LinkGrant })
  | (LinkFields & { status: "revoked"; grant?: LinkGrant });

export type LensEffect = "include" | "hide" | "dim";

/** A person rule beats a branch rule. Within one scope, the later rule wins. */
export type LensRule =
  | { scope: "person"; treeId: TreeId; personId: PersonId; effect: LensEffect }
  | { scope: "branch"; treeId: TreeId; branchRootId: PersonId; effect: LensEffect };

/**
 * The arrangement an owner makes for one viewer. This is data, not a form:
 * which branches and people are included, hidden, or dimmed, plus optional
 * grants that open a living person's details.
 */
export type VisibilityLens = {
  id: LensId;
  viewer: Viewer;
  rules: readonly LensRule[];
  detailGrants: readonly { treeId: TreeId; personId: PersonId }[];
};

/**
 * Access data sits beside a tree. It is not part of `TreeData`, so a saved
 * tree from before this module still loads with the same fields.
 */
export type AccessState = {
  trees: { treeId: TreeId; ownerPersonId: PersonId }[];
  delegates: { treeId: TreeId; branchRootId: PersonId; personId: PersonId }[];
  /** Hidden from branch-level grants. A person rule, or an explicit link person grant, can still reveal them. */
  sealedPersonIds: { treeId: TreeId; personId: PersonId }[];
  /** Absent means living. Living details stay withheld unless a rule opens them. */
  deceasedPersonIds: { treeId: TreeId; personId: PersonId }[];
  links: TreeLink[];
  lenses: VisibilityLens[];
  /**
   * Grant arranged for an invite that is still pending. Accepted links carry
   * their own grant; this offer is what Accept writes onto the card.
   */
  offers?: { inviteId: InviteId; grant: LinkGrant }[];
};

export function emptyAccess(): AccessState {
  return {
    trees: [],
    delegates: [],
    sealedPersonIds: [],
    deceasedPersonIds: [],
    links: [],
    lenses: [],
  };
}

export type ClaimRank = "tree-owner" | "self" | "line" | "care" | "partner";

export type EditParty = {
  branchRootId: PersonId;
  rank: ClaimRank;
  /** The branch root, then any delegates, in the order they were recorded. */
  actors: PersonId[];
};

export type BranchConflict =
  | { kind: "none"; party?: EditParty }
  | { kind: "resolved"; prevails: EditParty; parties: EditParty[] }
  | { kind: "needs-agreement"; parties: EditParty[] };

export type EditSubject =
  | { kind: "person"; treeId: TreeId; personId: PersonId }
  | { kind: "union"; treeId: TreeId; unionId: string }
  | { kind: "childLink"; treeId: TreeId; childLinkId: string };

export type EditDecision = {
  mayEdit: boolean;
  /** Present when this viewer may edit. */
  rank?: ClaimRank;
  /** The branch root this viewer acts for. The tree owner uses their own person id. */
  forBranchRootId?: PersonId;
  /** Overlap between branch claims. The tree owner and the subject are applied separately, in `standing`. */
  branchConflict: BranchConflict;
  /**
   * Who stands when versions disagree. The tree owner stands first, then the
   * person on their own record. A relationship has no self claim, so a tie
   * between line parents leaves this unset until someone agrees or the tree
   * owner decides.
   */
  standing?: EditParty;
};

export type VisiblePerson = {
  treeId: TreeId;
  personId: PersonId;
  givenName: string;
  familyName?: string;
  presence: "shown" | "dimmed";
  details: "open" | "withheld";
  bio?: string;
  birthDate?: string;
  emails?: string[];
  phones?: string[];
  otherDates?: ImportantDate[];
  photo?: string;
  extras?: ExtraField[];
};

export type VisibleUnion = {
  treeId: TreeId;
  id: string;
  partnerIds: PersonId[];
  kind: UnionKind;
};

export type VisibleChildLink = {
  treeId: TreeId;
  id: string;
  childId: PersonId;
  parentIds: PersonId[];
};

export type VisibleGraph = {
  people: VisiblePerson[];
  unions: VisibleUnion[];
  childLinks: VisibleChildLink[];
};

export function emptyGraph(): VisibleGraph {
  return { people: [], unions: [], childLinks: [] };
}
