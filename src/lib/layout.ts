import type { Person, TreeData, Union } from "./types";
import { displayName } from "./types";
import { kidsUnderUnion, parentsOf, unionsFor } from "./tree";

export type CoupleUnit = {
  id: string;
  union?: Union;
  partners: Person[];
  children: Person[];
};

export type TreeView = {
  focus?: Person;
  parentUnits: CoupleUnit[];
  selfUnits: CoupleUnit[];
  loneChildren: Person[];
  others: Person[];
};

export function displayNames(people: Person[]): string {
  return people.map(displayName).join(" & ");
}

export function buildView(tree: TreeData, selectedId?: string): TreeView {
  const focusId = selectedId ?? tree.focusPersonId ?? tree.people[0]?.id;
  const focus = tree.people.find((p) => p.id === focusId);

  if (!focus) {
    return { parentUnits: [], selfUnits: [], loneChildren: [], others: tree.people };
  }

  const parentPeople = parentsOf(tree, focus.id);
  const parentUnits: CoupleUnit[] = [];
  if (parentPeople.length) {
    const parentUnion = tree.unions.find((u) =>
      parentPeople.every((p) => u.partnerIds.includes(p.id)),
    );
    parentUnits.push({
      id: parentUnion?.id ?? `parents-${focus.id}`,
      union: parentUnion,
      partners: parentPeople,
      children: [focus],
    });
  }

  const ownUnions = unionsFor(tree, focus.id);
  const selfUnits: CoupleUnit[] = ownUnions.map((union) => ({
    id: union.id,
    union,
    partners: union.partnerIds
      .map((id) => tree.people.find((p) => p.id === id))
      .filter((p): p is Person => Boolean(p)),
    children: kidsUnderUnion(tree, union),
  }));

  const coveredKids = new Set(selfUnits.flatMap((u) => u.children.map((c) => c.id)));
  const loneChildren = tree.people.filter((p) =>
    tree.childLinks.some(
      (l) => l.childId === p.id && l.parentIds.includes(focus.id) && !coveredKids.has(p.id),
    ),
  );

  if (selfUnits.length === 0 && loneChildren.length === 0) {
    selfUnits.push({ id: `solo-${focus.id}`, partners: [focus], children: [] });
  } else if (selfUnits.length === 0) {
    selfUnits.push({ id: `solo-${focus.id}`, partners: [focus], children: loneChildren });
    loneChildren.length = 0;
  }

  const seen = new Set<string>([
    focus.id,
    ...parentPeople.map((p) => p.id),
    ...selfUnits.flatMap((u) => [...u.partners, ...u.children].map((p) => p.id)),
    ...loneChildren.map((p) => p.id),
  ]);
  const others = tree.people.filter((p) => !seen.has(p.id));

  return { focus, parentUnits, selfUnits, loneChildren, others };
}
