import type { Person, TreeData } from "./types";
import { displayName } from "./types";
import { parentsOf, unionsFor } from "./tree";

export function relationshipToFocus(tree: TreeData, person: Person): string {
  const focusId = tree.focusPersonId ?? tree.people[0]?.id;
  if (!focusId || person.id === focusId) return "starting person";
  if (parentsOf(tree, person.id).some((p) => p.id === focusId)) return "child";
  if (parentsOf(tree, focusId).some((p) => p.id === person.id)) return "parent";
  if (unionsFor(tree, focusId).some((u) => u.partnerIds.includes(person.id))) return "partner";
  const focusParents = parentsOf(tree, focusId).map((p) => p.id);
  if (focusParents.length && parentsOf(tree, person.id).some((p) => focusParents.includes(p.id))) {
    return "sibling";
  }
  return "family";
}

export function cardLines(tree: TreeData, person: Person): { name: string; rel: string } {
  return { name: displayName(person), rel: relationshipToFocus(tree, person) };
}
