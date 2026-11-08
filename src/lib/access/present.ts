import type { Person, TreeData } from "../types";
import { asPersonId, type TreeId } from "./ids";
import {
  emptyGraph,
  type VisibleChildLink,
  type VisibleGraph,
  type VisiblePerson,
  type VisibleUnion,
} from "./types";

export type Presence = "shown" | "dimmed";
export type DetailLevel = "open" | "withheld";

/** Names only, unless details are open. Living contact fields stay off the object when withheld. */
export function presentPerson(
  treeId: TreeId,
  person: Person,
  presence: Presence,
  details: DetailLevel,
): VisiblePerson {
  const card: VisiblePerson = {
    treeId,
    personId: asPersonId(person.id),
    givenName: person.givenName,
    ...(person.familyName ? { familyName: person.familyName } : {}),
    presence,
    details,
  };
  if (details !== "open") return card;
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

/**
 * Unions and parent links are included only when every person they name is
 * in `chosen`. A hidden parent or partner is not revealed by the link.
 */
export function graphAmong(
  treeId: TreeId,
  tree: TreeData,
  chosen: ReadonlyMap<string, { presence: Presence; details: DetailLevel }>,
): VisibleGraph {
  if (!chosen.size) return emptyGraph();
  const people = tree.people
    .filter((person) => chosen.has(person.id))
    .map((person) => {
      const spec = chosen.get(person.id)!;
      return presentPerson(treeId, person, spec.presence, spec.details);
    });
  const known = new Set(people.map((person) => person.personId as string));

  const unions: VisibleUnion[] = [];
  for (const union of tree.unions) {
    if (!union.partnerIds.every((id) => known.has(id))) continue;
    unions.push({
      treeId,
      id: union.id,
      partnerIds: union.partnerIds.map((id) => asPersonId(id)),
      kind: union.kind,
    });
  }

  const childLinks: VisibleChildLink[] = [];
  for (const link of tree.childLinks) {
    if (!known.has(link.childId) || !link.parentIds.every((id) => known.has(id))) continue;
    childLinks.push({
      treeId,
      id: link.id,
      childId: asPersonId(link.childId),
      parentIds: link.parentIds.map((id) => asPersonId(id)),
    });
  }

  return { people, unions, childLinks };
}

export function personKey(treeId: string, personId: string): string {
  return `${treeId}\u0000${personId}`;
}
