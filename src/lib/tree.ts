import type { ChildLink, KinKind, LinkRole, ParentRole, Person, TreeData, Union, UnionKind } from "./types";
import { kinOf } from "./types";
import { emptyTree } from "./types";
import { newId, nowIso } from "./ids";

function stamp(): Pick<Person, "createdAt" | "updatedAt"> {
  const t = nowIso();
  return { createdAt: t, updatedAt: t };
}

export function createPerson(givenName: string, extras: Partial<Person> = {}): Person {
  const name = givenName.trim();
  if (!name) throw new Error("A given name is required.");
  return {
    id: extras.id ?? newId("p"),
    givenName: name,
    familyName: extras.familyName?.trim() || undefined,
    bio: extras.bio?.trim() || undefined,
    birthDate: extras.birthDate || undefined,
    otherDates: extras.otherDates,
    emails: extras.emails,
    phones: extras.phones,
    photo: extras.photo,
    extras: extras.extras,
    ...stamp(),
  };
}

export function startWithName(givenName: string): TreeData {
  const person = createPerson(givenName);
  return { people: [person], unions: [], childLinks: [], focusPersonId: person.id };
}

export function getPerson(tree: TreeData, id: string): Person | undefined {
  return tree.people.find((p) => p.id === id);
}

export function unionsFor(tree: TreeData, personId: string): Union[] {
  return tree.unions.filter((u) => u.partnerIds.includes(personId));
}

export function childrenOf(tree: TreeData, parentIds: string[]): ChildLink[] {
  const set = new Set(parentIds);
  return tree.childLinks.filter((link) => link.parentIds.some((id) => set.has(id)));
}

export function parentsOf(tree: TreeData, childId: string): Person[] {
  const ids = new Set<string>();
  for (const link of tree.childLinks) {
    if (link.childId === childId) link.parentIds.forEach((id) => ids.add(id));
  }
  return tree.people.filter((p) => ids.has(p.id));
}

export function kinBetween(tree: TreeData, childId: string, parentId: string): KinKind {
  for (const link of tree.childLinks) {
    if (link.childId === childId && link.parentIds.includes(parentId)) return kinOf(link, parentId);
  }
  return "blood";
}

export function childrenOfPerson(tree: TreeData, parentId: string): Person[] {
  const ids = new Set(
    tree.childLinks.filter((link) => link.parentIds.includes(parentId)).map((link) => link.childId),
  );
  return tree.people.filter((p) => ids.has(p.id));
}

export function parentRoleOf(tree: TreeData, childId: string, parentId: string): ParentRole | undefined {
  const link = tree.childLinks.find((item) => item.childId === childId && item.parentIds.includes(parentId));
  return link?.roles?.[parentId];
}

export function updateParentLink(
  tree: TreeData,
  childId: string,
  parentId: string,
  patch: { role?: ParentRole | ""; kin?: KinKind },
): TreeData {
  return {
    ...tree,
    childLinks: tree.childLinks.map((link) => {
      if (link.childId !== childId || !link.parentIds.includes(parentId)) return link;
      const roles = { ...link.roles };
      if (patch.role === "") delete roles[parentId];
      else if (patch.role) roles[parentId] = patch.role;
      const kin = { ...link.kin };
      if (patch.kin === "blood") delete kin[parentId];
      else if (patch.kin) kin[parentId] = patch.kin;
      return {
        ...link,
        roles: Object.keys(roles).length ? roles : undefined,
        kin: Object.keys(kin).length ? kin : undefined,
      };
    }),
  };
}

export function kidsOfParents(tree: TreeData, parentIds: string[]): Person[] {
  const want = [...parentIds].sort().join("|");
  const ids = new Set<string>();
  for (const link of tree.childLinks) {
    const key = [...link.parentIds].sort().join("|");
    const shares = link.parentIds.some((id) => parentIds.includes(id));
    if (key === want || (parentIds.length === 1 && shares && link.parentIds.length === 1)) {
      ids.add(link.childId);
    }
  }
  return tree.people.filter((p) => ids.has(p.id));
}

export function kidsUnderUnion(tree: TreeData, union: Union): Person[] {
  const ids = new Set(
    tree.childLinks
      .filter(
        (link) =>
          link.unionId === union.id ||
          (link.parentIds.length === union.partnerIds.length &&
            union.partnerIds.every((id) => link.parentIds.includes(id))),
      )
      .map((link) => link.childId),
  );
  return tree.people.filter((p) => ids.has(p.id));
}

function withPerson(tree: TreeData, person: Person): TreeData {
  return { ...tree, people: [...tree.people, person] };
}

export function addPartner(
  tree: TreeData,
  personId: string,
  givenName: string,
  kind: UnionKind = "partnered",
): TreeData {
  const person = getPerson(tree, personId);
  if (!person) throw new Error("Person not found.");
  const partner = createPerson(givenName);
  const union: Union = { id: newId("u"), partnerIds: [personId, partner.id], kind };
  return { ...withPerson(tree, partner), unions: [...tree.unions, union] };
}

export function addChild(
  tree: TreeData,
  parentIds: string[],
  givenName: string,
  unionId?: string,
  kin?: Partial<Record<string, KinKind>>,
): TreeData {
  if (parentIds.length < 1) throw new Error("A child needs at least one parent.");
  const child = createPerson(givenName);
  const resolvedUnion =
    unionId ??
    tree.unions.find((u) => parentIds.every((id) => u.partnerIds.includes(id)))?.id;
  const kinMap = kin
    ? Object.fromEntries(Object.entries(kin).filter(([, value]) => value && value !== "blood"))
    : undefined;
  const link: ChildLink = {
    id: newId("c"),
    childId: child.id,
    parentIds: [...new Set(parentIds)],
    unionId: resolvedUnion,
    kin: kinMap && Object.keys(kinMap).length ? kinMap : undefined,
  };
  return { ...withPerson(tree, child), childLinks: [...tree.childLinks, link] };
}

export function addParent(
  tree: TreeData,
  childId: string,
  givenName: string,
  parentRole?: ParentRole,
  kinKind: KinKind = "blood",
): TreeData {
  const child = getPerson(tree, childId);
  if (!child) throw new Error("Person not found.");
  const parent = createPerson(givenName);
  const withMeta = (link: ChildLink, parentId: string): ChildLink => {
    const next: ChildLink = { ...link };
    if (parentRole) next.roles = { ...link.roles, [parentId]: parentRole };
    if (kinKind !== "blood") next.kin = { ...link.kin, [parentId]: kinKind };
    return next;
  };
  const existing = tree.childLinks.find((link) => link.childId === childId);

  if (!existing) {
    const link = withMeta({ id: newId("c"), childId, parentIds: [parent.id] }, parent.id);
    return { ...withPerson(tree, parent), childLinks: [...tree.childLinks, link] };
  }

  if (existing.parentIds.length === 1) {
    const otherParentId = existing.parentIds[0];
    let unions = tree.unions;
    let unionId = existing.unionId;
    if (!unionId) {
      const union: Union = {
        id: newId("u"),
        partnerIds: [otherParentId, parent.id],
        kind: "unspecified",
      };
      unions = [...unions, union];
      unionId = union.id;
    }
    const updated = withMeta({ ...existing, parentIds: [otherParentId, parent.id], unionId }, parent.id);
    return {
      ...withPerson(tree, parent),
      unions,
      childLinks: tree.childLinks.map((l) => (l.id === existing.id ? updated : l)),
    };
  }

  const link = withMeta({ id: newId("c"), childId, parentIds: [parent.id] }, parent.id);
  return { ...withPerson(tree, parent), childLinks: [...tree.childLinks, link] };
}

export function updatePerson(tree: TreeData, id: string, patch: Partial<Person>): TreeData {
  return {
    ...tree,
    people: tree.people.map((p) =>
      p.id === id
        ? {
            ...p,
            ...patch,
            id: p.id,
            givenName: (patch.givenName ?? p.givenName).trim(),
            updatedAt: nowIso(),
          }
        : p,
    ),
  };
}

export function setUnionKind(tree: TreeData, unionId: string, kind: UnionKind): TreeData {
  return {
    ...tree,
    unions: tree.unions.map((u) => (u.id === unionId ? { ...u, kind } : u)),
  };
}

export function updateUnion(tree: TreeData, unionId: string, patch: Partial<Union>): TreeData {
  return {
    ...tree,
    unions: tree.unions.map((u) => (u.id === unionId ? { ...u, ...patch, id: u.id } : u)),
  };
}

export function nextFocusAfterRemove(tree: TreeData, id: string): string | undefined {
  const remaining = tree.people.filter((p) => p.id !== id);
  if (!remaining.length) return undefined;
  const partnerIds = unionsFor(tree, id).flatMap((u) => u.partnerIds).filter((pid) => pid !== id);
  const parentIds = parentsOf(tree, id).map((p) => p.id);
  return (
    remaining.find((p) => partnerIds.includes(p.id))?.id ??
    remaining.find((p) => parentIds.includes(p.id))?.id ??
    remaining[0]?.id
  );
}

export function removePerson(tree: TreeData, id: string): TreeData {
  const people = tree.people.filter((p) => p.id !== id);
  const unions = tree.unions
    .map((u) => ({ ...u, partnerIds: u.partnerIds.filter((pid) => pid !== id) }))
    .filter((u) => u.partnerIds.length > 0);
  const childLinks = tree.childLinks
    .filter((l) => l.childId !== id)
    .map((l) => ({ ...l, parentIds: l.parentIds.filter((pid) => pid !== id) }));
  const focusPersonId =
    tree.focusPersonId === id ? nextFocusAfterRemove(tree, id) : tree.focusPersonId;
  return { people, unions, childLinks, focusPersonId };
}

export function mergeTree(base: TreeData, incoming: TreeData): TreeData {
  const people = [...base.people];
  const seen = new Set(people.map((p) => p.id));
  for (const p of incoming.people) {
    if (!seen.has(p.id)) {
      people.push(p);
      seen.add(p.id);
    }
  }
  return {
    people,
    unions: [...base.unions, ...incoming.unions],
    childLinks: [...base.childLinks, ...incoming.childLinks],
    focusPersonId: base.focusPersonId ?? incoming.focusPersonId,
  };
}

export { emptyTree };

export function addUnlinkedPerson(tree: TreeData, givenName: string): TreeData {
  const person = createPerson(givenName);
  return {
    ...withPerson(tree, person),
    focusPersonId: tree.focusPersonId ?? person.id,
  };
}

export function addSibling(tree: TreeData, personId: string, givenName: string): TreeData {
  const person = getPerson(tree, personId);
  if (!person) throw new Error("Person not found.");
  const parents = parentsOf(tree, personId);
  if (parents.length === 0) throw new Error("Add a parent first");
  const parentIds = parents.map((p) => p.id);
  const unionId = tree.childLinks.find((l) => l.childId === personId)?.unionId;
  return addChild(tree, parentIds, givenName, unionId);
}

export function setFocus(tree: TreeData, personId: string): TreeData {
  if (!getPerson(tree, personId)) throw new Error("Person not found.");
  return { ...tree, focusPersonId: personId };
}

export function linkExisting(
  tree: TreeData,
  personId: string,
  otherId: string,
  role: LinkRole,
  kind: UnionKind = "partnered",
  parentRole?: ParentRole,
  kinKind: KinKind = "blood",
): TreeData {
  if (personId === otherId) throw new Error("Cannot link a person to themselves.");
  const person = getPerson(tree, personId);
  const other = getPerson(tree, otherId);
  if (!person || !other) throw new Error("Person not found.");

  if (role === "partner") {
    const already = tree.unions.find(
      (u) => u.partnerIds.includes(personId) && u.partnerIds.includes(otherId),
    );
    if (already) return setUnionKind(tree, already.id, kind);
    const union: Union = { id: newId("u"), partnerIds: [personId, otherId], kind };
    return { ...tree, unions: [...tree.unions, union] };
  }

  if (role === "parent") {
    const withMeta = (link: ChildLink): ChildLink => {
      const next: ChildLink = { ...link };
      if (parentRole) next.roles = { ...link.roles, [otherId]: parentRole };
      if (kinKind !== "blood") next.kin = { ...link.kin, [otherId]: kinKind };
      return next;
    };
    const existing = tree.childLinks.find((link) => link.childId === personId);
    if (!existing) {
      const link = withMeta({ id: newId("c"), childId: personId, parentIds: [otherId] });
      return { ...tree, childLinks: [...tree.childLinks, link] };
    }
    if (existing.parentIds.includes(otherId)) {
      return {
        ...tree,
        childLinks: tree.childLinks.map((l) => (l.id === existing.id ? withMeta(l) : l)),
      };
    }
    if (existing.parentIds.length === 1) {
      const otherParentId = existing.parentIds[0];
      let unions = tree.unions;
      let unionId = existing.unionId;
      if (!unionId) {
        const union: Union = {
          id: newId("u"),
          partnerIds: [otherParentId, otherId],
          kind: "unspecified",
        };
        unions = [...unions, union];
        unionId = union.id;
      }
      return {
        ...tree,
        unions,
        childLinks: tree.childLinks.map((l) =>
          l.id === existing.id ? withMeta({ ...existing, parentIds: [otherParentId, otherId], unionId }) : l,
        ),
      };
    }
    const link = withMeta({ id: newId("c"), childId: personId, parentIds: [otherId] });
    return { ...tree, childLinks: [...tree.childLinks, link] };
  }

  if (role === "sibling") {
    const parents = parentsOf(tree, personId);
    if (parents.length === 0) throw new Error("Add a parent first");
    const parentIds = parents.map((p) => p.id);
    const unionId = tree.childLinks.find((l) => l.childId === personId)?.unionId;
    if (tree.childLinks.some((l) => l.childId === otherId && parentIds.every((id) => l.parentIds.includes(id)))) {
      return tree;
    }
    const link: ChildLink = { id: newId("c"), childId: otherId, parentIds: [...parentIds], unionId };
    return { ...tree, childLinks: [...tree.childLinks, link] };
  }

  const unions = unionsFor(tree, personId);
  const parentIds = unions[0]?.partnerIds ?? [personId];
  const unionId = unions[0]?.id;
  if (tree.childLinks.some((l) => l.childId === otherId && parentIds.every((id) => l.parentIds.includes(id)))) {
    if (kinKind === "blood") return tree;
    return {
      ...tree,
      childLinks: tree.childLinks.map((l) => {
        if (l.childId !== otherId) return l;
        const kin = { ...l.kin };
        for (const id of parentIds) kin[id] = kinKind;
        return { ...l, kin };
      }),
    };
  }
  const kin =
    kinKind === "blood"
      ? undefined
      : Object.fromEntries(parentIds.map((id) => [id, kinKind]));
  const link: ChildLink = { id: newId("c"), childId: otherId, parentIds: [...new Set(parentIds)], unionId, kin };
  return { ...tree, childLinks: [...tree.childLinks, link] };
}

export function unlinkExisting(
  tree: TreeData,
  personId: string,
  otherId: string,
  role: Exclude<LinkRole, "sibling">,
): TreeData {
  if (personId === otherId) return tree;
  if (role === "partner") {
    const dropped = new Set(
      tree.unions
        .filter((u) => u.partnerIds.includes(personId) && u.partnerIds.includes(otherId))
        .map((u) => u.id),
    );
    return {
      ...tree,
      unions: tree.unions.filter((u) => !dropped.has(u.id)),
      childLinks: tree.childLinks.map((link) =>
        link.unionId && dropped.has(link.unionId) ? { ...link, unionId: undefined } : link,
      ),
    };
  }

  const childId = role === "parent" ? personId : otherId;
  const parentId = role === "parent" ? otherId : personId;
  return {
    ...tree,
    childLinks: tree.childLinks.flatMap((link) => {
      if (link.childId !== childId || !link.parentIds.includes(parentId)) return [link];
      const parentIds = link.parentIds.filter((id) => id !== parentId);
      if (!parentIds.length) return [];
      const roles = link.roles
        ? Object.fromEntries(Object.entries(link.roles).filter(([id]) => parentIds.includes(id)))
        : undefined;
      const kin = link.kin
        ? Object.fromEntries(Object.entries(link.kin).filter(([id]) => parentIds.includes(id)))
        : undefined;
      return [{
        ...link,
        parentIds,
        roles: roles && Object.keys(roles).length ? roles : undefined,
        kin: kin && Object.keys(kin).length ? kin : undefined,
        unionId: parentIds.length > 1 ? link.unionId : undefined,
      }];
    }),
  };
}

export function dropUnion(tree: TreeData, unionId: string): TreeData {
  if (!tree.unions.some((union) => union.id === unionId)) return tree;
  return {
    ...tree,
    unions: tree.unions.filter((union) => union.id !== unionId),
    childLinks: tree.childLinks.map((link) =>
      link.unionId === unionId ? { ...link, unionId: undefined } : link,
    ),
  };
}

export function relatedIds(tree: TreeData, seed: string): Set<string> {
  if (!tree.people.some((person) => person.id === seed)) return new Set();
  const known = new Set(tree.people.map((person) => person.id));
  const ids = new Set<string>([seed]);
  for (const union of unionsFor(tree, seed)) {
    for (const pid of union.partnerIds) {
      if (known.has(pid)) ids.add(pid);
    }
  }
  const household = [...ids];

  const walkUp = (personId: string) => {
    for (const parent of parentsOf(tree, personId)) {
      if (ids.has(parent.id)) continue;
      ids.add(parent.id);
      walkUp(parent.id);
    }
  };
  const walkDown = (personId: string) => {
    for (const link of tree.childLinks) {
      if (!link.parentIds.includes(personId) || !known.has(link.childId) || ids.has(link.childId)) continue;
      ids.add(link.childId);
      walkDown(link.childId);
    }
  };
  for (const id of household) {
    walkUp(id);
    walkDown(id);
  }

  for (const id of household) {
    const parentIds = parentsOf(tree, id).map((person) => person.id);
    if (!parentIds.length) continue;
    for (const link of tree.childLinks) {
      if (link.childId === id || !known.has(link.childId)) continue;
      if (link.parentIds.some((parentId) => parentIds.includes(parentId))) ids.add(link.childId);
    }
  }

  for (const id of [...ids]) {
    for (const union of unionsFor(tree, id)) {
      for (const pid of union.partnerIds) {
        if (known.has(pid)) ids.add(pid);
      }
    }
  }
  return ids;
}

export function relatedTree(tree: TreeData, seed: string): TreeData {
  const ids = relatedIds(tree, seed);
  if (!ids.size) {
    return { ...tree, people: [], unions: [], childLinks: [], focusPersonId: seed };
  }
  return {
    ...tree,
    focusPersonId: seed,
    people: tree.people.filter((person) => ids.has(person.id)),
    unions: tree.unions.filter((union) => union.partnerIds.some((id) => ids.has(id))),
    childLinks: tree.childLinks.filter((row) => ids.has(row.childId)),
  };
}

export function serializeTreeJson(tree: TreeData): string {
  return JSON.stringify(tree);
}

export function parseTreeJson(text: string): TreeData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not a Family Tree backup.");
  }
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as TreeData).people) ||
    !Array.isArray((data as TreeData).unions) ||
    !Array.isArray((data as TreeData).childLinks)
  ) {
    throw new Error("Not a Family Tree backup.");
  }
  return data as TreeData;
}
