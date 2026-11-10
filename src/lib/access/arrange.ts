import { newId } from "../ids";
import type { TreeData } from "../types";
import { deriveBranch } from "./branch";
import { asInviteId, asLensId, asPersonId, asTreeId, type InviteId, type LensId, type PersonId, type TreeId } from "./ids";
import { acceptedInvite, exposeLink, pendingInvite, revokedInvite } from "./link";
import { emptyAccess, emptyGraph, guestViewer, memberViewer, sameViewer, type AccessState, type Forest, type LensEffect, type LensRule, type LinkGrant, type Viewer, type VisibilityLens, type VisibleGraph } from "./types";
import { ownerWorkingView, resolveVisibility } from "./visibility";

/**
 * The one tree on this device. Access state names it so the domain can tell
 * a member from a guest without putting access fields inside `TreeData`.
 */
export const DEVICE_TREE_ID = asTreeId("device");

/** Who the owner is arranging for. `owner` is the on-device working view. */
export type LookingAs =
  | { kind: "owner" }
  | { kind: "member"; personId: PersonId }
  | { kind: "guest"; inviteId: InviteId };

export type PersonMark = {
  personId: PersonId;
  /** `ghost` is only drawn while arranging, so a hidden person can be touched again. */
  draw: "shown" | "ghost";
  presence: "shown" | "dimmed";
  details: "open" | "withheld";
  effect: "include" | "dim" | "hide" | "unset";
};

function forestOf(tree: TreeData): Forest {
  return { [DEVICE_TREE_ID]: tree };
}

function ownerId(access: AccessState): PersonId | undefined {
  return access.trees.find((row) => row.treeId === DEVICE_TREE_ID)?.ownerPersonId;
}

export function viewerFor(access: AccessState, looking: LookingAs): Viewer | null {
  if (looking.kind === "owner") {
    const owner = ownerId(access);
    return owner ? memberViewer(DEVICE_TREE_ID, owner) : null;
  }
  if (looking.kind === "member") return memberViewer(DEVICE_TREE_ID, looking.personId);
  return guestViewer(DEVICE_TREE_ID, looking.inviteId);
}

/** What the chosen viewer is allowed to see. The owner gets `ownerWorkingView`. */
export function graphForViewer(tree: TreeData, access: AccessState, looking: LookingAs): VisibleGraph {
  const viewer = viewerFor(access, looking);
  if (!viewer) return emptyGraph();
  const forest = forestOf(tree);
  if (looking.kind === "owner") return ownerWorkingView(forest, access, viewer);
  return resolveVisibility(forest, access, viewer);
}

/**
 * The device holder, recorded once. Prefers the tree's focus person, then the
 * first person. Does not replace an owner already stored.
 */
export function ensureDeviceOwner(access: AccessState, tree: TreeData): AccessState {
  if (ownerId(access)) return access;
  const focus = tree.focusPersonId;
  const owner = focus && tree.people.some((person) => person.id === focus) ? focus : tree.people[0]?.id;
  if (!owner) return access;
  return {
    ...access,
    trees: [...access.trees, { treeId: DEVICE_TREE_ID, ownerPersonId: asPersonId(owner) }],
  };
}

function lensFor(access: AccessState, viewer: Viewer): VisibilityLens | undefined {
  return [...access.lenses].reverse().find((lens) => sameViewer(lens.viewer, viewer));
}

function lensIdFor(viewer: Viewer): LensId {
  const key = viewer.kind === "member" ? `member:${viewer.personId}` : `guest:${viewer.inviteId}`;
  return asLensId(`lens:${key}`);
}

function writeLens(
  access: AccessState,
  viewer: Viewer,
  rules: readonly LensRule[],
  detailGrants: VisibilityLens["detailGrants"],
): AccessState {
  const previous = lensFor(access, viewer);
  const next: VisibilityLens = {
    id: previous?.id ?? lensIdFor(viewer),
    viewer,
    rules,
    detailGrants,
  };
  return {
    ...access,
    lenses: [...access.lenses.filter((lens) => !sameViewer(lens.viewer, viewer)), next],
  };
}

function writeRules(access: AccessState, viewer: Viewer, rules: readonly LensRule[]): AccessState {
  return writeLens(access, viewer, rules, lensFor(access, viewer)?.detailGrants ?? []);
}

function deceased(access: AccessState, personId: PersonId): boolean {
  return access.deceasedPersonIds.some((row) => row.treeId === DEVICE_TREE_ID && row.personId === personId);
}

/**
 * Whether the Share details toggle is on, and whether it can move.
 * The viewer and a deceased person stay open, so the toggle is held on.
 * A revoked invite cannot grant anything.
 */
export function detailToggle(access: AccessState, looking: LookingAs, personId: PersonId): { shared: boolean; locked: boolean } {
  const self = looking.kind === "member" && looking.personId === personId;
  if (looking.kind === "owner" || self || deceased(access, personId)) return { shared: true, locked: true };
  if (looking.kind === "guest") {
    const link = linkFor(access, looking.inviteId);
    if (!link || link.status === "revoked") return { shared: false, locked: true };
  }
  const viewer = viewerFor(access, looking);
  const shared = Boolean(
    viewer && lensFor(access, viewer)?.detailGrants.some((grant) => grant.treeId === DEVICE_TREE_ID && grant.personId === personId),
  );
  return { shared, locked: false };
}

/**
 * Grant or withdraw living details for one person on the viewer's lens.
 * A grant does not add anyone to the visible set. The viewer's own details
 * and a deceased person's details stay open, so those toggles do nothing.
 * A revoked invite does nothing. The owner's working view is unchanged.
 */
export function toggleDetailGrant(tree: TreeData, access: AccessState, looking: LookingAs, personId: PersonId): AccessState {
  if (looking.kind === "owner" || !onTree(tree, personId)) return access;
  if (deceased(access, personId)) return access;
  if (looking.kind === "member" && looking.personId === personId) return access;
  if (looking.kind === "guest") {
    const link = linkFor(access, looking.inviteId);
    if (!link || link.status === "revoked") return access;
  }
  const viewer = viewerFor(access, looking);
  if (!viewer) return access;
  const previous = lensFor(access, viewer);
  const grants = previous?.detailGrants ?? [];
  const has = grants.some((grant) => grant.treeId === DEVICE_TREE_ID && grant.personId === personId);
  const detailGrants = has
    ? grants.filter((grant) => !(grant.treeId === DEVICE_TREE_ID && grant.personId === personId))
    : [...grants, { treeId: DEVICE_TREE_ID, personId }];
  return writeLens(access, viewer, previous?.rules ?? [], detailGrants);
}

function replaceRule(rules: readonly LensRule[], next: LensRule): LensRule[] {
  let replaced = false;
  const mapped = rules.map((rule) => {
    const same = next.scope === "person"
      ? rule.scope === "person" && rule.personId === next.personId && rule.treeId === next.treeId
      : rule.scope === "branch" && rule.branchRootId === next.branchRootId && rule.treeId === next.treeId;
    if (!same) return rule;
    replaced = true;
    return next;
  });
  return replaced ? mapped : [...mapped, next];
}

function onTree(tree: TreeData, personId: string): boolean {
  return tree.people.some((person) => person.id === personId);
}

function linkFor(access: AccessState, inviteId: InviteId) {
  return access.links.find((link) => link.id === inviteId && link.sourceTreeId === DEVICE_TREE_ID);
}

function offerGrant(access: AccessState, inviteId: InviteId): LinkGrant {
  const offer = access.offers?.find((row) => row.inviteId === inviteId)?.grant;
  return {
    personIds: [...(offer?.personIds ?? [])],
    branchRootIds: [...(offer?.branchRootIds ?? [])],
  };
}

function withOffer(access: AccessState, inviteId: InviteId, grant: LinkGrant): AccessState {
  const offers = [...(access.offers ?? []).filter((row) => row.inviteId !== inviteId), { inviteId, grant }];
  return { ...access, offers };
}

function cyclePresence(tree: TreeData, access: AccessState, viewer: Viewer, personId: PersonId): LensEffect {
  const visible = resolveVisibility(forestOf(tree), access, viewer).people.find((person) => person.personId === personId);
  if (!visible) return "include";
  return visible.presence === "dimmed" ? "hide" : "dim";
}

function cycleBranchEffect(current: LensEffect | undefined): LensEffect {
  if (current === "include") return "dim";
  if (current === "dim") return "hide";
  return "include";
}

function branchEffect(access: AccessState, viewer: Viewer, rootId: PersonId): LensEffect | undefined {
  let effect: LensEffect | undefined;
  for (const rule of lensFor(access, viewer)?.rules ?? []) {
    if (rule.scope === "branch" && rule.treeId === DEVICE_TREE_ID && rule.branchRootId === rootId) effect = rule.effect;
  }
  return effect;
}

/**
 * Touch a person while arranging for `looking`.
 * The owner's working view is unchanged.
 * A member cycles include, then dim, then hide, then include.
 * A pending guest toggles that person on the invite offer. The preview stays empty.
 * An accepted guest cycles inside the grant and cannot add anyone outside it.
 * A revoked invite ignores the touch.
 */
export function touchPerson(tree: TreeData, access: AccessState, looking: LookingAs, personId: PersonId): AccessState {
  if (looking.kind === "owner" || !onTree(tree, personId)) return access;
  if (looking.kind === "guest") {
    const link = linkFor(access, looking.inviteId);
    if (!link) return access;
    if (link.status === "pending") {
      const grant = offerGrant(access, link.id);
      const personIds = grant.personIds.includes(personId)
        ? grant.personIds.filter((id) => id !== personId)
        : [...grant.personIds, personId];
      return withOffer(access, link.id, { ...grant, personIds });
    }
    if (link.status !== "accepted") return access;
    const pool = new Set(exposeLink(forestOf(tree), access, link).people.map((person) => person.personId as string));
    if (!pool.has(personId)) return access;
    const viewer = guestViewer(DEVICE_TREE_ID, link.id);
    const effect = cyclePresence(tree, access, viewer, personId);
    const rules = replaceRule(lensFor(access, viewer)?.rules ?? [], {
      scope: "person",
      treeId: DEVICE_TREE_ID,
      personId,
      effect,
    });
    return writeRules(access, viewer, rules);
  }
  const viewer = memberViewer(DEVICE_TREE_ID, looking.personId);
  const effect = cyclePresence(tree, access, viewer, personId);
  const rules = replaceRule(lensFor(access, viewer)?.rules ?? [], {
    scope: "person",
    treeId: DEVICE_TREE_ID,
    personId,
    effect,
  });
  return writeRules(access, viewer, rules);
}

/**
 * Touch a branch, rooted at `branchRootId`. Same viewer rules as `touchPerson`.
 * A pending guest toggles that root on the offer. Person rules already stored
 * stay in place, so they still beat the branch.
 */
export function touchBranch(tree: TreeData, access: AccessState, looking: LookingAs, branchRootId: PersonId): AccessState {
  if (looking.kind === "owner" || !onTree(tree, branchRootId)) return access;
  const branch = deriveBranch(DEVICE_TREE_ID, tree, branchRootId);
  if (!branch.members.length) return access;
  if (looking.kind === "guest") {
    const link = linkFor(access, looking.inviteId);
    if (!link) return access;
    if (link.status === "pending") {
      const grant = offerGrant(access, link.id);
      const branchRootIds = grant.branchRootIds.includes(branchRootId)
        ? grant.branchRootIds.filter((id) => id !== branchRootId)
        : [...grant.branchRootIds, branchRootId];
      return withOffer(access, link.id, { ...grant, branchRootIds });
    }
    if (link.status !== "accepted") return access;
    const pool = new Set(exposeLink(forestOf(tree), access, link).people.map((person) => person.personId as string));
    if (!branch.members.some((member) => pool.has(member.personId))) return access;
    const viewer = guestViewer(DEVICE_TREE_ID, link.id);
    const effect = cycleBranchEffect(branchEffect(access, viewer, branchRootId));
    const rules = replaceRule(lensFor(access, viewer)?.rules ?? [], {
      scope: "branch",
      treeId: DEVICE_TREE_ID,
      branchRootId,
      effect,
    });
    return writeRules(access, viewer, rules);
  }
  const viewer = memberViewer(DEVICE_TREE_ID, looking.personId);
  const effect = cycleBranchEffect(branchEffect(access, viewer, branchRootId));
  const rules = replaceRule(lensFor(access, viewer)?.rules ?? [], {
    scope: "branch",
    treeId: DEVICE_TREE_ID,
    branchRootId,
    effect,
  });
  return writeRules(access, viewer, rules);
}

function draftOf(link: AccessState["links"][number]) {
  return {
    id: link.id,
    sourceTreeId: link.sourceTreeId,
    targetTreeId: link.targetTreeId,
    invitedByPersonId: link.invitedByPersonId,
    ...(link.inviteePersonId ? { inviteePersonId: link.inviteePersonId } : {}),
    ...(link.guestLabel ? { guestLabel: link.guestLabel } : {}),
  };
}

/** A local guest card. Nothing is sent. */
export function addGuestCard(
  access: AccessState,
  guestLabel: string,
  invitedByPersonId: PersonId,
  inviteId: InviteId = asInviteId(newId("invite")),
): AccessState {
  const label = guestLabel.trim();
  if (!label || access.links.some((link) => link.id === inviteId)) return access;
  const link = pendingInvite({
    id: inviteId,
    sourceTreeId: DEVICE_TREE_ID,
    targetTreeId: DEVICE_TREE_ID,
    invitedByPersonId,
    guestLabel: label,
  });
  return { ...access, links: [...access.links, link] };
}

/** Pending becomes accepted, using the offer arranged for that card. */
export function acceptInviteCard(access: AccessState, inviteId: InviteId): AccessState {
  const link = access.links.find((item) => item.id === inviteId);
  if (!link || link.status !== "pending") return access;
  const next = acceptedInvite({ ...draftOf(link), grant: offerGrant(access, inviteId) });
  return { ...access, links: access.links.map((item) => (item.id === inviteId ? next : item)) };
}

/** Accepted or pending becomes revoked. A revoked card stays revoked. Detail grants for that guest are cleared. */
export function revokeInviteCard(access: AccessState, inviteId: InviteId): AccessState {
  const link = access.links.find((item) => item.id === inviteId);
  if (!link || link.status === "revoked") return access;
  const next = revokedInvite({
    ...draftOf(link),
    ...(link.status === "accepted" ? { grant: link.grant } : {}),
  });
  const viewer = guestViewer(DEVICE_TREE_ID, inviteId);
  return {
    ...access,
    links: access.links.map((item) => (item.id === inviteId ? next : item)),
    lenses: access.lenses.map((lens) => (sameViewer(lens.viewer, viewer) ? { ...lens, detailGrants: [] } : lens)),
  };
}

function ghostEffect(tree: TreeData, access: AccessState, viewer: Viewer, personId: string): "hide" | "unset" {
  const lens = lensFor(access, viewer);
  if (!lens) return "unset";
  let person: LensEffect | undefined;
  let branch: LensEffect | undefined;
  for (const rule of lens.rules) {
    if (rule.treeId !== DEVICE_TREE_ID) continue;
    if (rule.scope === "person" && rule.personId === personId) person = rule.effect;
    if (rule.scope === "branch") {
      const members = deriveBranch(DEVICE_TREE_ID, tree, rule.branchRootId).members;
      if (members.some((member) => member.personId === personId)) branch = rule.effect;
    }
  }
  return (person ?? branch) === "hide" ? "hide" : "unset";
}

function offerCovers(tree: TreeData, access: AccessState, inviteId: InviteId, personId: string): boolean {
  const grant = offerGrant(access, inviteId);
  if (grant.personIds.some((id) => id === personId)) return true;
  return grant.branchRootIds.some((root) =>
    deriveBranch(DEVICE_TREE_ID, tree, root).members.some((member) => member.personId === personId),
  );
}

/**
 * Marks for the sky. Preview and the owner's working view omit anyone the
 * domain did not show. Arrange keeps ghosts so the owner can touch them.
 */
export function marksForViewer(tree: TreeData, access: AccessState, looking: LookingAs, preview: boolean): PersonMark[] {
  const graph = graphForViewer(tree, access, looking);
  const visible = new Map(graph.people.map((person) => [person.personId as string, person]));
  const viewer = viewerFor(access, looking);
  const arranging = looking.kind !== "owner" && !preview;
  const link = looking.kind === "guest" ? linkFor(access, looking.inviteId) : undefined;
  const pool = link && link.status === "accepted"
    ? new Set(exposeLink(forestOf(tree), access, link).people.map((person) => person.personId as string))
    : null;
  const marks: PersonMark[] = [];
  for (const person of tree.people) {
    const shown = visible.get(person.id);
    if (shown) {
      marks.push({
        personId: asPersonId(person.id),
        draw: "shown",
        presence: shown.presence,
        details: shown.details,
        effect: shown.presence === "dimmed" ? "dim" : "include",
      });
      continue;
    }
    if (!arranging) continue;
    if (looking.kind === "member" && viewer) {
      marks.push({
        personId: asPersonId(person.id),
        draw: "ghost",
        presence: "shown",
        details: "withheld",
        effect: ghostEffect(tree, access, viewer, person.id),
      });
      continue;
    }
    if (looking.kind === "guest" && link?.status === "pending") {
      marks.push({
        personId: asPersonId(person.id),
        draw: "ghost",
        presence: "shown",
        details: "withheld",
        effect: offerCovers(tree, access, link.id, person.id) ? "include" : "unset",
      });
      continue;
    }
    if (looking.kind === "guest" && link?.status === "accepted" && pool?.has(person.id) && viewer) {
      marks.push({
        personId: asPersonId(person.id),
        draw: "ghost",
        presence: "shown",
        details: "withheld",
        effect: ghostEffect(tree, access, viewer, person.id),
      });
    }
  }
  return marks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function readGrant(value: unknown): LinkGrant | null {
  if (!isRecord(value)) return null;
  return {
    personIds: idList(value.personIds).map((id) => asPersonId(id)),
    branchRootIds: idList(value.branchRootIds).map((id) => asPersonId(id)),
  };
}

function readLink(value: unknown): AccessState["links"][number] | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.invitedByPersonId !== "string") return null;
  const source = typeof value.sourceTreeId === "string" ? value.sourceTreeId : DEVICE_TREE_ID;
  const target = typeof value.targetTreeId === "string" ? value.targetTreeId : DEVICE_TREE_ID;
  let draft;
  try {
    draft = {
      id: asInviteId(value.id),
      sourceTreeId: asTreeId(source),
      targetTreeId: asTreeId(target),
      invitedByPersonId: asPersonId(value.invitedByPersonId),
      ...(typeof value.inviteePersonId === "string" ? { inviteePersonId: asPersonId(value.inviteePersonId) } : {}),
      ...(typeof value.guestLabel === "string" && value.guestLabel.trim() ? { guestLabel: value.guestLabel.trim() } : {}),
    };
  } catch {
    return null;
  }
  try {
    if (value.status === "pending") return pendingInvite(draft);
    const grant = readGrant(value.grant);
    if (value.status === "accepted") {
      return acceptedInvite({ ...draft, grant: grant ?? { personIds: [], branchRootIds: [] } });
    }
    if (value.status === "revoked") return revokedInvite({ ...draft, ...(grant ? { grant } : {}) });
  } catch {
    return null;
  }
  return null;
}

function readEffect(value: unknown): LensEffect | null {
  return value === "include" || value === "dim" || value === "hide" ? value : null;
}

function readLens(value: unknown): VisibilityLens | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.viewer)) return null;
  const viewer = value.viewer;
  let looking: Viewer;
  try {
    if (viewer.kind === "member" && typeof viewer.personId === "string") {
      looking = memberViewer(
        asTreeId(typeof viewer.treeId === "string" ? viewer.treeId : DEVICE_TREE_ID),
        asPersonId(viewer.personId),
      );
    } else if (viewer.kind === "guest" && typeof viewer.inviteId === "string") {
      looking = guestViewer(
        asTreeId(typeof viewer.treeId === "string" ? viewer.treeId : DEVICE_TREE_ID),
        asInviteId(viewer.inviteId),
      );
    } else {
      return null;
    }
  } catch {
    return null;
  }
  const rules: LensRule[] = [];
  if (Array.isArray(value.rules)) {
    for (const rule of value.rules) {
      if (!isRecord(rule)) continue;
      const effect = readEffect(rule.effect);
      if (!effect || typeof rule.treeId !== "string") continue;
      try {
        if (rule.scope === "person" && typeof rule.personId === "string") {
          rules.push({ scope: "person", treeId: asTreeId(rule.treeId), personId: asPersonId(rule.personId), effect });
        } else if (rule.scope === "branch" && typeof rule.branchRootId === "string") {
          rules.push({ scope: "branch", treeId: asTreeId(rule.treeId), branchRootId: asPersonId(rule.branchRootId), effect });
        }
      } catch {
        /* skip a rule with a blank id */
      }
    }
  }
  const detailGrants: { treeId: TreeId; personId: PersonId }[] = [];
  if (Array.isArray(value.detailGrants)) {
    for (const grant of value.detailGrants) {
      if (!isRecord(grant) || typeof grant.treeId !== "string" || typeof grant.personId !== "string") continue;
      try {
        detailGrants.push({ treeId: asTreeId(grant.treeId), personId: asPersonId(grant.personId) });
      } catch {
        /* skip */
      }
    }
  }
  try {
    return { id: asLensId(value.id), viewer: looking, rules, detailGrants };
  } catch {
    return null;
  }
}

function pairList(value: unknown, left: string, right: string): { treeId: ReturnType<typeof asTreeId>; personId: PersonId }[] {
  if (!Array.isArray(value)) return [];
  const rows: { treeId: ReturnType<typeof asTreeId>; personId: PersonId }[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item[left] !== "string" || typeof item[right] !== "string") continue;
    try {
      rows.push({ treeId: asTreeId(item[left] as string), personId: asPersonId(item[right] as string) });
    } catch {
      /* skip */
    }
  }
  return rows;
}

/** Restore access state from storage or a backup sidecar. Garbage becomes an empty state. */
export function parseAccessValue(value: unknown): AccessState {
  if (!isRecord(value)) return emptyAccess();
  const base = emptyAccess();
  try {
    if (Array.isArray(value.trees)) {
      for (const row of value.trees) {
        if (!isRecord(row) || typeof row.treeId !== "string" || typeof row.ownerPersonId !== "string") continue;
        base.trees.push({ treeId: asTreeId(row.treeId), ownerPersonId: asPersonId(row.ownerPersonId) });
      }
    }
    if (!base.trees.length && typeof value.ownerPersonId === "string") {
      base.trees.push({ treeId: DEVICE_TREE_ID, ownerPersonId: asPersonId(value.ownerPersonId) });
    }
    if (Array.isArray(value.delegates)) {
      for (const row of value.delegates) {
        if (!isRecord(row) || typeof row.treeId !== "string" || typeof row.branchRootId !== "string" || typeof row.personId !== "string") continue;
        base.delegates.push({
          treeId: asTreeId(row.treeId),
          branchRootId: asPersonId(row.branchRootId),
          personId: asPersonId(row.personId),
        });
      }
    }
    base.sealedPersonIds = pairList(value.sealedPersonIds, "treeId", "personId");
    base.deceasedPersonIds = pairList(value.deceasedPersonIds, "treeId", "personId");
    if (Array.isArray(value.links)) {
      for (const link of value.links) {
        const read = readLink(link);
        if (read) base.links.push(read);
      }
    }
    if (Array.isArray(value.lenses)) {
      for (const lens of value.lenses) {
        const read = readLens(lens);
        if (read) base.lenses.push(read);
      }
    }
    if (Array.isArray(value.offers)) {
      const offers: NonNullable<AccessState["offers"]> = [];
      for (const offer of value.offers) {
        if (!isRecord(offer) || typeof offer.inviteId !== "string") continue;
        const grant = readGrant(offer.grant);
        if (!grant) continue;
        offers.push({ inviteId: asInviteId(offer.inviteId), grant });
      }
      if (offers.length) base.offers = offers;
    }
  } catch {
    return emptyAccess();
  }
  return base;
}

export function serializeAccess(access: AccessState): string {
  return JSON.stringify(access);
}

export function parseAccess(text: string): AccessState {
  try {
    return parseAccessValue(JSON.parse(text));
  } catch {
    return emptyAccess();
  }
}

/**
 * Pull an access sidecar off a parsed backup. `parseTreeJson` is unchanged and
 * may still carry the extra field; the tree we save does not.
 */
export function separateAccess(parsed: TreeData): { tree: TreeData; access: AccessState | null } {
  const record = parsed as TreeData & { access?: unknown };
  if (!("access" in record)) return { tree: parsed, access: null };
  const { access: raw, ...rest } = record;
  const access = raw == null ? null : parseAccessValue(raw);
  return { tree: rest as TreeData, access };
}
