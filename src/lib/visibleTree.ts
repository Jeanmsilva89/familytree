import type { ChildLink, FamilyUnitOverride, TreeData, Union } from "./types";

function pickRecord<T>(record: Partial<Record<string, T>> | undefined, ids: string[]) {
  if (!record) return undefined;
  const next: Partial<Record<string, T>> = {};
  for (const id of ids) {
    const value = record[id];
    if (value !== undefined) next[id] = value;
  }
  return Object.keys(next).length ? next : undefined;
}

/**
 * Child links a lens may still draw. Hidden parents are removed. A parent id
 * that was never a person stays, and an explicit unknown parent stays, so
 * hiding a step-parent does not invent a placing parent or erase "Parents
 * unknown".
 */
export function visibleChildLinks(tree: TreeData, ids: ReadonlySet<string>): ChildLink[] {
  const onTree = new Set(tree.people.map((person) => person.id));
  return tree.childLinks.flatMap((link) => {
    if (!ids.has(link.childId)) return [];
    const parentIds = link.parentIds.filter((id) => ids.has(id) || !onTree.has(id));
    const visibleParents = parentIds.filter((id) => ids.has(id));
    const roles = pickRecord(link.roles, visibleParents);
    const kin = pickRecord(link.kin, visibleParents);
    const unknownParents = link.unknownParents?.length ? link.unknownParents : undefined;
    if (!parentIds.length && !unknownParents) return [];
    return [{
      ...link,
      parentIds,
      ...(roles ? { roles } : { roles: undefined }),
      ...(kin ? { kin } : { kin: undefined }),
      ...(unknownParents ? { unknownParents } : { unknownParents: undefined }),
    }];
  });
}

/**
 * The tree a lens is allowed to draw. Hidden people are removed before any
 * bucket, label, link, or saved nudge is computed, so a saved place cannot
 * show them or reserve a hole that names them.
 */
export function treeForLens(tree: TreeData, visibleIds: ReadonlySet<string>): TreeData {
  const people = tree.people.filter((person) => visibleIds.has(person.id));
  const ids = new Set(people.map((person) => person.id));
  const unions: Union[] = tree.unions.flatMap((union) => {
    const partnerIds = union.partnerIds.filter((id) => ids.has(id));
    if (partnerIds.length < 2) return [];
    return [{ ...union, partnerIds }];
  });
  const childLinks = visibleChildLinks(tree, ids);
  const overrides: FamilyUnitOverride[] = (tree.familyUnitOverrides ?? []).filter(
    (item) => ids.has(item.personId) && (item.unitOf === null || ids.has(item.unitOf)),
  );
  const focus = tree.focusPersonId && ids.has(tree.focusPersonId) ? tree.focusPersonId : people[0]?.id;
  return {
    people,
    unions,
    childLinks,
    ...(focus ? { focusPersonId: focus } : {}),
    ...(overrides.length ? { familyUnitOverrides: overrides } : {}),
  };
}
