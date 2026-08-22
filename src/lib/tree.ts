import type { ChildLink, Person, TreeData, Union, UnionKind } from "./types";
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
): TreeData {
  if (parentIds.length < 1) throw new Error("A child needs at least one parent.");
  const child = createPerson(givenName);
  const resolvedUnion =
    unionId ??
    tree.unions.find((u) => parentIds.every((id) => u.partnerIds.includes(id)))?.id;
  const link: ChildLink = {
    id: newId("c"),
    childId: child.id,
    parentIds: [...new Set(parentIds)],
    unionId: resolvedUnion,
  };
  return { ...withPerson(tree, child), childLinks: [...tree.childLinks, link] };
}

export function addParent(tree: TreeData, childId: string, givenName: string): TreeData {
  const child = getPerson(tree, childId);
  if (!child) throw new Error("Person not found.");
  const parent = createPerson(givenName);
  const existing = tree.childLinks.find((link) => link.childId === childId);

  if (!existing) {
    const link: ChildLink = { id: newId("c"), childId, parentIds: [parent.id] };
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
    const updated: ChildLink = {
      ...existing,
      parentIds: [otherParentId, parent.id],
      unionId,
    };
    return {
      ...withPerson(tree, parent),
      unions,
      childLinks: tree.childLinks.map((l) => (l.id === existing.id ? updated : l)),
    };
  }

  const link: ChildLink = { id: newId("c"), childId, parentIds: [parent.id] };
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

export function removePerson(tree: TreeData, id: string): TreeData {
  const people = tree.people.filter((p) => p.id !== id);
  const unions = tree.unions
    .map((u) => ({ ...u, partnerIds: u.partnerIds.filter((pid) => pid !== id) }))
    .filter((u) => u.partnerIds.length > 0);
  const childLinks = tree.childLinks
    .filter((l) => l.childId !== id)
    .map((l) => ({ ...l, parentIds: l.parentIds.filter((pid) => pid !== id) }))
    .filter((l) => l.parentIds.length > 0);
  const focusPersonId = tree.focusPersonId === id ? people[0]?.id : tree.focusPersonId;
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
