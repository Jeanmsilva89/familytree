import { applyFamilyUnitOverride, deriveFamilyUnits } from "../familyUnits";
import { newId } from "../ids";
import type { ChildLink, KinKind, LinkRole, ParentRole, Person, TreeData, Union, UnionKind } from "../types";
import { displayName, migrateUnionKind } from "../types";
import { linkExisting, parentsOf, removePerson, unlinkExisting } from "../tree";
import type { PersonId, TreeId } from "./ids";
import { asPersonId, asTreeId } from "./ids";
import type {
  AccessState,
  EditSubject,
  SharedBridge,
  SharedFamily,
  SharedMember,
  Viewer,
  VisibleChildLink,
  VisiblePerson,
  VisibleUnion,
} from "./types";
import { resolveVisibility } from "./visibility";

/**
 * An offline share. The file is built on the sender's device from
 * `resolveVisibility` and leaves only if they hand it over. Nothing here
 * uploads it.
 *
 * Version 1 is the only shape this app reads. A later version is rejected
 * at the boundary so an unknown file cannot be half-applied.
 */
export const SHARE_FORMAT = "familytree-share";
export const SHARE_VERSION = 1;

export const SHARE_NOT_BUNDLE = "This share file is not a family bundle.";
export const SHARE_NO_VERSION = "This share file has no version.";

export function shareUnknownVersion(version: unknown): string {
  return `This share file uses version ${String(version)}, which this app cannot read.`;
}

export type SharePerson = {
  id: string;
  givenName: string;
  familyName?: string;
  presence: "shown" | "dimmed";
  details: "open" | "withheld";
  bio?: string;
  birthDate?: string;
  emails?: string[];
  phones?: string[];
  otherDates?: { id: string; label: string; date: string }[];
  photo?: string;
  extras?: { key: string; value: string }[];
};

export type ShareUnion = {
  id: string;
  partnerIds: string[];
  kind: UnionKind;
};

export type ShareChildLink = {
  id: string;
  childId: string;
  parentIds: string[];
  roles?: Partial<Record<string, ParentRole>>;
  kin?: Partial<Record<string, KinKind>>;
  /** Parents who are not people in this file. No ids, so a hidden relative cannot be named. */
  unknownParents?: { role?: ParentRole }[];
};

export type ShareBundle = {
  format: typeof SHARE_FORMAT;
  version: typeof SHARE_VERSION;
  source: {
    treeId: string;
    ownerPersonId: string;
    ownerName: string;
    exportedAt: string;
  };
  people: SharePerson[];
  unions: ShareUnion[];
  childLinks: ShareChildLink[];
};

export type ShareIds = {
  person: (sourcePersonId: string) => string;
  union: (sourceUnionId: string) => string;
  child: (sourceChildLinkId: string) => string;
};

const KIN: readonly KinKind[] = ["blood", "adopted", "step", "foster"];
const ROLES: readonly ParentRole[] = ["mother", "father"];
const LINK_ROLES: readonly LinkRole[] = ["parent", "partner", "child", "sibling"];

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(message);
  return value.trim();
}

function copyList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return items.length ? items.map((item) => item.trim()) : undefined;
}

/**
 * What `viewer` is allowed to see, and nothing else.
 * Hidden people are absent. A withheld living person keeps their name only.
 * The viewer's own details, a detail grant, and a deceased mark stay open,
 * because that is what `resolveVisibility` already decided.
 */
export function exportShareBundle(
  tree: TreeData,
  access: AccessState,
  viewer: Viewer,
  exportedAt: string,
): ShareBundle {
  const when = requiredText(exportedAt, "A share needs the time it was made.");
  const owner = access.trees.find((row) => row.treeId === viewer.treeId);
  if (!owner) fail("This tree has no owner.");
  const ownerPerson = tree.people.find((person) => person.id === owner.ownerPersonId);
  const visible = resolveVisibility({ [viewer.treeId]: tree }, access, viewer);
  const people = visible.people.map(sharePerson);
  const known = new Set(people.map((person) => person.id));
  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    source: {
      treeId: viewer.treeId,
      ownerPersonId: owner.ownerPersonId,
      ownerName: ownerPerson ? displayName(ownerPerson) : "Owner",
      exportedAt: when,
    },
    people,
    unions: visible.unions.filter((union) => union.partnerIds.every((id) => known.has(id))).map(shareUnion),
    childLinks: visible.childLinks
      .filter((link) => known.has(link.childId) && link.parentIds.every((id) => known.has(id)))
      .map((link) => shareChildLink(tree, link)),
  };
}

function sharePerson(person: VisiblePerson): SharePerson {
  const card: SharePerson = {
    id: person.personId,
    givenName: person.givenName,
    ...(person.familyName ? { familyName: person.familyName } : {}),
    presence: person.presence,
    details: person.details,
  };
  if (person.details !== "open") return card;
  return {
    ...card,
    ...(person.bio ? { bio: person.bio } : {}),
    ...(person.birthDate ? { birthDate: person.birthDate } : {}),
    ...(person.emails?.length ? { emails: [...person.emails] } : {}),
    ...(person.phones?.length ? { phones: [...person.phones] } : {}),
    ...(person.otherDates?.length ? { otherDates: person.otherDates.map((date) => ({ ...date })) } : {}),
    ...(person.photo ? { photo: person.photo } : {}),
    ...(person.extras?.length ? { extras: person.extras.map((extra) => ({ ...extra })) } : {}),
  };
}

function shareUnion(union: VisibleUnion): ShareUnion {
  return { id: union.id, partnerIds: union.partnerIds.map((id) => id as string), kind: union.kind };
}

function shareChildLink(tree: TreeData, link: VisibleChildLink): ShareChildLink {
  const source = tree.childLinks.find((item) => item.id === link.id);
  const parentIds = link.parentIds.map((id) => id as string);
  const roles = pickRoles(source?.roles, parentIds);
  const kin = pickKin(source?.kin, parentIds);
  const unknownParents = readUnknownParents(source?.unknownParents);
  return {
    id: link.id,
    childId: link.childId,
    parentIds,
    ...(roles ? { roles } : {}),
    ...(kin ? { kin } : {}),
    ...(unknownParents ? { unknownParents } : {}),
  };
}

function readUnknownParents(value: unknown): { role?: ParentRole }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const next: { role?: ParentRole }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    if (role === "mother" || role === "father") next.push({ role });
    else if (role === undefined) next.push({});
  }
  return next.length ? next : undefined;
}

function pickRoles(
  roles: Partial<Record<string, ParentRole>> | undefined,
  parentIds: string[],
): Partial<Record<string, ParentRole>> | undefined {
  if (!roles) return undefined;
  const next: Partial<Record<string, ParentRole>> = {};
  for (const id of parentIds) {
    const role = roles[id];
    if (role === "mother" || role === "father") next[id] = role;
  }
  return Object.keys(next).length ? next : undefined;
}

function pickKin(
  kin: Partial<Record<string, KinKind>> | undefined,
  parentIds: string[],
): Partial<Record<string, KinKind>> | undefined {
  if (!kin) return undefined;
  const next: Partial<Record<string, KinKind>> = {};
  for (const id of parentIds) {
    const kind = kin[id];
    if (kind && kind !== "blood" && KIN.includes(kind)) next[id] = kind;
  }
  return Object.keys(next).length ? next : undefined;
}

export function serializeShareBundle(bundle: ShareBundle): string {
  return JSON.stringify(bundle);
}

export function shareBundleFilename(ownerName: string): string {
  const slug = ownerName.trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "family"}-share.json`;
}

export function parseShareBundleText(text: string): ShareBundle {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail(SHARE_NOT_BUNDLE);
  }
  return parseShareBundle(value);
}

/** Reject a file that is not version 1. Withheld people lose any smuggled details. */
export function parseShareBundle(value: unknown): ShareBundle {
  if (!isRecord(value) || value.format !== SHARE_FORMAT) fail(SHARE_NOT_BUNDLE);
  if (!("version" in value) || typeof value.version !== "number" || !Number.isInteger(value.version)) {
    fail(SHARE_NO_VERSION);
  }
  if (value.version !== SHARE_VERSION) fail(shareUnknownVersion(value.version));
  if (!isRecord(value.source)) fail(SHARE_NOT_BUNDLE);
  let sourceTreeId: string;
  let ownerPersonId: string;
  try {
    sourceTreeId = asTreeId(requiredText(value.source.treeId, SHARE_NOT_BUNDLE));
    ownerPersonId = asPersonId(requiredText(value.source.ownerPersonId, SHARE_NOT_BUNDLE));
  } catch {
    fail(SHARE_NOT_BUNDLE);
  }
  const ownerName = requiredText(value.source.ownerName, SHARE_NOT_BUNDLE);
  const exportedAt = requiredText(value.source.exportedAt, SHARE_NOT_BUNDLE);
  if (!Array.isArray(value.people) || !Array.isArray(value.unions) || !Array.isArray(value.childLinks)) {
    fail(SHARE_NOT_BUNDLE);
  }
  const people: SharePerson[] = [];
  const seen = new Set<string>();
  for (const row of value.people) people.push(readPerson(row, seen));
  const known = new Set(people.map((person) => person.id));
  const unions = value.unions.map((row) => readUnion(row, known));
  const childLinks = value.childLinks.map((row) => readChildLink(row, known));
  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    source: { treeId: sourceTreeId, ownerPersonId, ownerName, exportedAt },
    people,
    unions,
    childLinks,
  };
}

function readPerson(value: unknown, seen: Set<string>): SharePerson {
  if (!isRecord(value)) fail(SHARE_NOT_BUNDLE);
  const id = requiredText(value.id, "This share file has a person without an id.");
  if (seen.has(id)) fail("This share file repeats a person.");
  seen.add(id);
  const givenName = requiredText(value.givenName, "This share file has a person without a name.");
  const presence = value.presence === "dimmed" ? "dimmed" : value.presence === "shown" ? "shown" : null;
  const details = value.details === "open" ? "open" : value.details === "withheld" ? "withheld" : null;
  if (!presence || !details) fail(SHARE_NOT_BUNDLE);
  const familyName = typeof value.familyName === "string" && value.familyName.trim() ? value.familyName.trim() : undefined;
  const card: SharePerson = { id, givenName, ...(familyName ? { familyName } : {}), presence, details };
  if (details !== "open") return card;
  const emails = copyList(value.emails);
  const phones = copyList(value.phones);
  const otherDates = readDates(value.otherDates);
  const extras = readExtras(value.extras);
  return {
    ...card,
    ...(typeof value.bio === "string" && value.bio.trim() ? { bio: value.bio.trim() } : {}),
    ...(typeof value.birthDate === "string" && value.birthDate.trim() ? { birthDate: value.birthDate.trim() } : {}),
    ...(emails ? { emails } : {}),
    ...(phones ? { phones } : {}),
    ...(otherDates ? { otherDates } : {}),
    ...(typeof value.photo === "string" && value.photo.trim() ? { photo: value.photo } : {}),
    ...(extras ? { extras } : {}),
  };
}

function readDates(value: unknown): SharePerson["otherDates"] {
  if (value == null) return undefined;
  if (!Array.isArray(value)) fail(SHARE_NOT_BUNDLE);
  const dates = value.filter(isRecord).map((row) => ({
    id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : "date",
    label: typeof row.label === "string" ? row.label.trim() : "",
    date: typeof row.date === "string" ? row.date.trim() : "",
  })).filter((row) => row.label && row.date);
  return dates.length ? dates : undefined;
}

function readExtras(value: unknown): SharePerson["extras"] {
  if (value == null) return undefined;
  if (!Array.isArray(value)) fail(SHARE_NOT_BUNDLE);
  const extras = value.filter(isRecord).map((row) => ({
    key: typeof row.key === "string" ? row.key.trim() : "",
    value: typeof row.value === "string" ? row.value.trim() : "",
  })).filter((row) => row.key && row.value);
  return extras.length ? extras : undefined;
}

function readUnion(value: unknown, known: Set<string>): ShareUnion {
  if (!isRecord(value)) fail(SHARE_NOT_BUNDLE);
  const id = requiredText(value.id, SHARE_NOT_BUNDLE);
  if (!Array.isArray(value.partnerIds) || value.partnerIds.length < 2) fail(SHARE_NOT_BUNDLE);
  const partnerIds = value.partnerIds.map((item) => requiredText(item, SHARE_NOT_BUNDLE));
  if (partnerIds.some((item) => !known.has(item))) fail("This share file lists a relative who is not in it.");
  const kind = migrateUnionKind(value.kind);
  if (value.kind === "remarried" || kind !== value.kind) fail("This share file has a relationship this app cannot read.");
  return { id, partnerIds, kind };
}

function readChildLink(value: unknown, known: Set<string>): ShareChildLink {
  if (!isRecord(value)) fail(SHARE_NOT_BUNDLE);
  const id = requiredText(value.id, SHARE_NOT_BUNDLE);
  const childId = requiredText(value.childId, SHARE_NOT_BUNDLE);
  if (!Array.isArray(value.parentIds) || value.parentIds.length < 1) fail(SHARE_NOT_BUNDLE);
  const parentIds = value.parentIds.map((item) => requiredText(item, SHARE_NOT_BUNDLE));
  if (!known.has(childId) || parentIds.some((item) => !known.has(item))) {
    fail("This share file lists a relative who is not in it.");
  }
  const roles = readRoleMap(value.roles, parentIds);
  const kin = readKinMap(value.kin, parentIds);
  const unknownParents = readUnknownParents(value.unknownParents);
  return { id, childId, parentIds, ...(roles ? { roles } : {}), ...(kin ? { kin } : {}), ...(unknownParents ? { unknownParents } : {}) };
}

function readRoleMap(value: unknown, parentIds: string[]): ShareChildLink["roles"] {
  if (value == null) return undefined;
  if (!isRecord(value)) fail(SHARE_NOT_BUNDLE);
  const roles: Partial<Record<string, ParentRole>> = {};
  for (const [id, role] of Object.entries(value)) {
    if (!parentIds.includes(id)) continue;
    if (!ROLES.includes(role as ParentRole)) fail("This share file has a relationship this app cannot read.");
    roles[id] = role as ParentRole;
  }
  return Object.keys(roles).length ? roles : undefined;
}

function readKinMap(value: unknown, parentIds: string[]): ShareChildLink["kin"] {
  if (value == null) return undefined;
  if (!isRecord(value)) fail(SHARE_NOT_BUNDLE);
  const kin: Partial<Record<string, KinKind>> = {};
  for (const [id, kind] of Object.entries(value)) {
    if (!parentIds.includes(id)) continue;
    if (kind === "blood") continue;
    if (!KIN.includes(kind as KinKind)) fail("This share file has a relationship this app cannot read.");
    kin[id] = kind as KinKind;
  }
  return Object.keys(kin).length ? kin : undefined;
}

export type ShareSummary = {
  ownerName: string;
  exportedAt: string;
  people: { id: string; givenName: string; familyName?: string }[];
  counts: { people: number; unions: number; childLinks: number };
};

export function summarizeShareBundle(bundle: ShareBundle): ShareSummary {
  return {
    ownerName: bundle.source.ownerName,
    exportedAt: bundle.source.exportedAt,
    people: bundle.people.map((person) => ({
      id: person.id,
      givenName: person.givenName,
      ...(person.familyName ? { familyName: person.familyName } : {}),
    })),
    counts: {
      people: bundle.people.length,
      unions: bundle.unions.length,
      childLinks: bundle.childLinks.length,
    },
  };
}

function defaultIds(): ShareIds {
  return {
    person: () => newId("p"),
    union: () => newId("u"),
    child: () => newId("c"),
  };
}

function familyIdFor(treeId: string, ownerPersonId: string): string {
  return `share:${treeId}:${ownerPersonId}`;
}

function takenIds(tree: TreeData): Set<string> {
  return new Set([
    ...tree.people.map((person) => person.id),
    ...tree.unions.map((union) => union.id),
    ...tree.childLinks.map((link) => link.id),
  ]);
}

function unused(taken: Set<string>, proposed: string, prefix: string): string {
  if (!taken.has(proposed)) {
    taken.add(proposed);
    return proposed;
  }
  const fallback = newId(prefix);
  taken.add(fallback);
  return fallback;
}

/**
 * Copy the bundle in as its own family. People are matched by the source id
 * stored on the family, never by name or date. A newer bundle from the same
 * tree and owner updates that family. Anyone the new file leaves out is removed.
 */
export function importShareBundle(
  tree: TreeData,
  access: AccessState,
  bundle: ShareBundle,
  options: { importedAt: string; ids?: ShareIds },
): { tree: TreeData; access: AccessState; family: SharedFamily } {
  const importedAt = requiredText(options.importedAt, "A share needs the time it was added.");
  const ids = options.ids ?? defaultIds();
  const sourceTreeId = asTreeId(bundle.source.treeId);
  const ownerPersonId = asPersonId(bundle.source.ownerPersonId);
  const existing = (access.sharedFamilies ?? []).find(
    (family) => family.sourceTreeId === sourceTreeId && family.ownerPersonId === ownerPersonId,
  );
  const previous = new Map((existing?.members ?? []).map((member) => [member.sourcePersonId as string, member.localPersonId as string]));
  const incoming = new Set(bundle.people.map((person) => person.id));
  let next = tree;
  for (const member of existing?.members ?? []) {
    if (incoming.has(member.sourcePersonId)) continue;
    if (next.people.some((person) => person.id === member.localPersonId)) {
      next = removePerson(next, member.localPersonId);
    }
  }

  const taken = takenIds(next);
  const localOf = new Map<string, string>();
  for (const person of bundle.people) {
    const reused = previous.get(person.id);
    const localId = reused && (next.people.some((item) => item.id === reused) || !taken.has(reused))
      ? reused
      : unused(taken, ids.person(person.id), "p");
    if (reused) taken.add(reused);
    localOf.set(person.id, localId);
    next = upsertPerson(next, person, localId, importedAt);
  }

  const memberIds = new Set(localOf.values());
  next = {
    ...next,
    unions: next.unions.filter((union) => !union.partnerIds.every((id) => memberIds.has(id))),
    childLinks: next.childLinks.filter(
      (link) => !(memberIds.has(link.childId) && link.parentIds.every((id) => memberIds.has(id))),
    ),
  };
  const used = takenIds(next);
  const unions: Union[] = bundle.unions.map((union) => ({
    id: unused(used, ids.union(union.id), "u"),
    partnerIds: union.partnerIds.map((id) => localOf.get(id)!),
    kind: union.kind,
  }));
  const childLinks: ChildLink[] = bundle.childLinks.map((link) => {
    const roles = remapRecord(link.roles, localOf);
    const kin = remapRecord(link.kin, localOf);
    return {
      id: unused(used, ids.child(link.id), "c"),
      childId: localOf.get(link.childId)!,
      parentIds: link.parentIds.map((id) => localOf.get(id)!),
      ...(roles ? { roles } : {}),
      ...(kin ? { kin } : {}),
      ...(link.unknownParents?.length ? { unknownParents: link.unknownParents.map((parent) => ({ ...parent })) } : {}),
    };
  });
  next = { ...next, unions: [...next.unions, ...unions], childLinks: [...next.childLinks, ...childLinks] };

  const members: SharedMember[] = bundle.people.map((person) => ({
    sourcePersonId: asPersonId(person.id),
    localPersonId: asPersonId(localOf.get(person.id)!),
  }));
  const bridges = (existing?.bridges ?? []).filter((bridge) => {
    const sharedRemains = members.some((member) => member.localPersonId === bridge.sharedPersonId);
    const homeRemains = next.people.some((person) => person.id === bridge.homePersonId);
    return sharedRemains && homeRemains;
  });
  const family: SharedFamily = {
    id: existing?.id ?? familyIdFor(sourceTreeId, ownerPersonId),
    sourceTreeId,
    ownerPersonId,
    ownerName: bundle.source.ownerName,
    exportedAt: bundle.source.exportedAt,
    importedAt,
    members,
    bridges,
  };
  next = keepHomesApart(tree, next, members.map((member) => member.localPersonId as string));
  const sharedFamilies = [
    ...(access.sharedFamilies ?? []).filter((item) => item.id !== family.id),
    family,
  ];
  return { tree: next, access: { ...access, sharedFamilies }, family };
}

function remapRecord<T extends string>(
  record: Partial<Record<string, T>> | undefined,
  localOf: Map<string, string>,
): Partial<Record<string, T>> | undefined {
  if (!record) return undefined;
  const next: Partial<Record<string, T>> = {};
  for (const [id, value] of Object.entries(record)) {
    const local = localOf.get(id);
    if (local && value) next[local] = value;
  }
  return Object.keys(next).length ? next : undefined;
}

function personFromShare(share: SharePerson, localId: string, createdAt: string, updatedAt: string): Person {
  const person: Person = {
    id: localId,
    givenName: share.givenName,
    ...(share.familyName ? { familyName: share.familyName } : {}),
    createdAt,
    updatedAt,
  };
  if (share.details !== "open") return person;
  return {
    ...person,
    ...(share.bio ? { bio: share.bio } : {}),
    ...(share.birthDate ? { birthDate: share.birthDate } : {}),
    ...(share.emails?.length ? { emails: [...share.emails] } : {}),
    ...(share.phones?.length ? { phones: [...share.phones] } : {}),
    ...(share.otherDates?.length ? { otherDates: share.otherDates.map((date) => ({ ...date })) } : {}),
    ...(share.photo ? { photo: share.photo } : {}),
    ...(share.extras?.length ? { extras: share.extras.map((extra) => ({ ...extra })) } : {}),
  };
}

function upsertPerson(tree: TreeData, share: SharePerson, localId: string, importedAt: string): TreeData {
  const existing = tree.people.find((person) => person.id === localId);
  const next = personFromShare(share, localId, existing?.createdAt ?? importedAt, importedAt);
  if (typeof existing?.graphX === "number") next.graphX = existing.graphX;
  if (typeof existing?.rowNudge === "number") next.rowNudge = existing.rowNudge;
  if (!existing) return { ...tree, people: [...tree.people, next] };
  return { ...tree, people: tree.people.map((person) => (person.id === localId ? next : person)) };
}

/**
 * Keep the imported household in the buckets the bundle describes, and keep
 * the importer's own people in theirs. A bridge may relate the two; it does
 * not move either household into the other.
 */
function withOverrides(tree: TreeData, overrides: NonNullable<TreeData["familyUnitOverrides"]>): TreeData {
  const { familyUnitOverrides: _previous, ...base } = tree;
  void _previous;
  return overrides.length ? { ...base, familyUnitOverrides: overrides } : base;
}

function pinSharedHousehold(tree: TreeData, memberIds: readonly string[]): TreeData {
  const members = new Set(memberIds);
  const rest = (tree.familyUnitOverrides ?? []).filter((item) => !members.has(item.personId));
  if (!members.size) return withOverrides(tree, rest);
  const scratch: TreeData = {
    people: tree.people.filter((person) => members.has(person.id)),
    unions: tree.unions.filter((union) => union.partnerIds.every((id) => members.has(id))),
    childLinks: tree.childLinks.filter(
      (link) => members.has(link.childId) && link.parentIds.every((id) => members.has(id)),
    ),
  };
  const derived = deriveFamilyUnits(scratch);
  const pinned = derived.units.flatMap((unit) => [
    { personId: unit.rootId, unitOf: null as string | null },
    ...unit.memberIds.filter((id) => id !== unit.rootId).map((personId) => ({ personId, unitOf: unit.rootId })),
  ]);
  return withOverrides(tree, [...rest, ...pinned]);
}

function keepHomesApart(before: TreeData, after: TreeData, memberIds: readonly string[]): TreeData {
  const members = new Set(memberIds);
  let next = pinSharedHousehold(after, memberIds);
  const prior = deriveFamilyUnits(before);
  const placed = deriveFamilyUnits(next);
  for (const person of before.people) {
    if (members.has(person.id)) continue;
    const unit = placed.units.find((item) => item.id === placed.unitOf[person.id]);
    if (!unit || !members.has(unit.rootId)) continue;
    const previous = prior.units.find((item) => item.id === prior.unitOf[person.id]);
    const root = previous?.rootId;
    next = applyFamilyUnitOverride(
      next,
      person.id,
      root && root !== person.id && !members.has(root) ? { unitOf: root } : { unitOf: null },
    );
  }
  return next;
}

function idsForSubject(tree: TreeData, subject: Exclude<EditSubject, { kind: "person" }>): string[] | undefined {
  if (subject.kind === "union") return tree.unions.find((union) => union.id === subject.unionId)?.partnerIds;
  const link = tree.childLinks.find((item) => item.id === subject.childLinkId);
  return link ? [link.childId, ...link.parentIds] : undefined;
}

export function sharedFamilyForPerson(access: AccessState, personId: string): SharedFamily | undefined {
  return (access.sharedFamilies ?? []).find((family) => family.members.some((member) => member.localPersonId === personId));
}

/** The sender owns this subject, so the importer may not edit it. A bridge is not locked. */
export function sharedLock(tree: TreeData, access: AccessState, subject: EditSubject): SharedFamily | undefined {
  const families = access.sharedFamilies ?? [];
  if (!families.length) return undefined;
  const familyOf = (id: string) => families.find((family) => family.members.some((member) => member.localPersonId === id));
  if (subject.kind === "person") return familyOf(subject.personId);
  const ids = idsForSubject(tree, subject);
  if (!ids?.length) return undefined;
  const hit = ids.map((id) => familyOf(id));
  const first = hit[0];
  if (!first || hit.some((family) => family !== first)) return undefined;
  return first;
}

/**
 * Join one imported person to one person already on this tree.
 * The two records stay themselves. Calling it again with the same role
 * changes nothing.
 */
export function linkSharedPerson(
  tree: TreeData,
  access: AccessState,
  familyId: string,
  sharedPersonId: string,
  homePersonId: string,
  role: LinkRole,
): { tree: TreeData; access: AccessState } {
  const family = (access.sharedFamilies ?? []).find((item) => item.id === familyId);
  if (!family) fail("That shared family is not on this tree.");
  const members = new Set(family.members.map((member) => member.localPersonId as string));
  if (!members.has(sharedPersonId) || !tree.people.some((person) => person.id === sharedPersonId)) {
    fail("Choose someone from the shared family.");
  }
  if (members.has(homePersonId)) fail("Link someone in your own tree.");
  if (!tree.people.some((person) => person.id === homePersonId)) fail("That person is not on your tree.");
  if (!LINK_ROLES.includes(role)) fail("This app cannot make that link.");
  const existing = family.bridges.find(
    (bridge) => bridge.homePersonId === homePersonId && bridge.sharedPersonId === sharedPersonId,
  );
  if (existing?.role === role) return { tree, access };

  let next = tree;
  if (existing) next = dropBridge(next, homePersonId, sharedPersonId, existing.role);
  next = linkExisting(next, homePersonId, sharedPersonId, role);
  next = keepHomesApart(tree, next, [...members]);
  const bridges: SharedBridge[] = [
    ...family.bridges.filter((bridge) => !(bridge.homePersonId === homePersonId && bridge.sharedPersonId === sharedPersonId)),
    { homePersonId: asPersonId(homePersonId), sharedPersonId: asPersonId(sharedPersonId), role },
  ];
  const updated: SharedFamily = { ...family, bridges };
  return {
    tree: next,
    access: {
      ...access,
      sharedFamilies: (access.sharedFamilies ?? []).map((item) => (item.id === family.id ? updated : item)),
    },
  };
}

function dropBridge(tree: TreeData, homePersonId: string, sharedPersonId: string, role: LinkRole): TreeData {
  if (role !== "sibling") return unlinkExisting(tree, homePersonId, sharedPersonId, role);
  const parentIds = new Set(parentsOf(tree, homePersonId).map((person) => person.id));
  return {
    ...tree,
    childLinks: tree.childLinks.filter((link) => {
      if (link.childId !== sharedPersonId) return true;
      return !link.parentIds.every((id) => parentIds.has(id));
    }),
  };
}

/**
 * Remove one shared family. Imported people and the links that name them go.
 * Everyone the importer already had stays, including their own links.
 */
export function removeSharedFamily(
  tree: TreeData,
  access: AccessState,
  familyId: string,
): { tree: TreeData; access: AccessState } {
  const family = (access.sharedFamilies ?? []).find((item) => item.id === familyId);
  if (!family) return { tree, access };
  let next = tree;
  for (const member of family.members) {
    if (next.people.some((person) => person.id === member.localPersonId)) {
      next = removePerson(next, member.localPersonId);
    }
  }
  const sharedFamilies = (access.sharedFamilies ?? []).filter((item) => item.id !== familyId);
  return {
    tree: next,
    access: sharedFamilies.length ? { ...access, sharedFamilies } : { ...access, sharedFamilies: undefined },
  };
}

const BRIDGE_ROLES = new Set<string>(LINK_ROLES);

/** Restore shared families from access storage. A bad row is skipped. */
export function readSharedFamilies(value: unknown): SharedFamily[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const families: SharedFamily[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== "string" || !row.id.trim()) continue;
    if (typeof row.sourceTreeId !== "string" || typeof row.ownerPersonId !== "string") continue;
    if (typeof row.ownerName !== "string" || typeof row.exportedAt !== "string" || typeof row.importedAt !== "string") continue;
    let sourceTreeId: TreeId;
    let ownerPersonId: PersonId;
    try {
      sourceTreeId = asTreeId(row.sourceTreeId);
      ownerPersonId = asPersonId(row.ownerPersonId);
    } catch {
      continue;
    }
    const members: SharedMember[] = [];
    if (Array.isArray(row.members)) {
      for (const member of row.members) {
        if (!isRecord(member) || typeof member.sourcePersonId !== "string" || typeof member.localPersonId !== "string") continue;
        try {
          members.push({
            sourcePersonId: asPersonId(member.sourcePersonId),
            localPersonId: asPersonId(member.localPersonId),
          });
        } catch {
          /* skip a blank id */
        }
      }
    }
    const bridges: SharedBridge[] = [];
    if (Array.isArray(row.bridges)) {
      for (const bridge of row.bridges) {
        if (!isRecord(bridge) || typeof bridge.homePersonId !== "string" || typeof bridge.sharedPersonId !== "string") continue;
        if (typeof bridge.role !== "string" || !BRIDGE_ROLES.has(bridge.role)) continue;
        try {
          bridges.push({
            homePersonId: asPersonId(bridge.homePersonId),
            sharedPersonId: asPersonId(bridge.sharedPersonId),
            role: bridge.role as LinkRole,
          });
        } catch {
          /* skip */
        }
      }
    }
    families.push({
      id: row.id.trim(),
      sourceTreeId,
      ownerPersonId,
      ownerName: row.ownerName.trim() || "Owner",
      exportedAt: row.exportedAt,
      importedAt: row.importedAt,
      members,
      bridges,
    });
  }
  return families;
}
