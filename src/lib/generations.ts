import type { Person, TreeData, Union } from "./types";
import { kidsUnderUnion, parentsOf, unionsFor } from "./tree";
import { showsCoupleBar } from "./layout";

export type GenerationLaneId =
  | "grandparents"
  | "parents"
  | "focus"
  | "children"
  | "grandchildren";

export type GenerationGroup = {
  parentId: string;
  label: string;
  people: Person[];
  coupleBar?: boolean;
};

export type GenerationLane = {
  id: GenerationLaneId;
  people: Person[];
  groups?: GenerationGroup[];
  coupleBar?: boolean;
};

function uniquePeople(people: Person[]): Person[] {
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const person of people) {
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    out.push(person);
  }
  return out;
}

function childrenOfPerson(tree: TreeData, parentId: string): Person[] {
  const ids = new Set(
    tree.childLinks.filter((l) => l.parentIds.includes(parentId)).map((l) => l.childId),
  );
  return tree.people.filter((p) => ids.has(p.id));
}

function sharedUnion(tree: TreeData, people: Person[]): Union | undefined {
  if (people.length < 2) return undefined;
  return tree.unions.find((u) => people.every((p) => u.partnerIds.includes(p.id)));
}

function parentsLabel(child: Person): string {
  const first = child.givenName.trim() || "Their";
  return `${first}'s parents`;
}

export function siblingsOf(tree: TreeData, personId: string): Person[] {
  const parentIds = new Set(parentsOf(tree, personId).map((p) => p.id));
  if (!parentIds.size) return [];
  const ids = new Set<string>();
  for (const link of tree.childLinks) {
    if (link.childId === personId) continue;
    if (link.parentIds.some((id) => parentIds.has(id))) ids.add(link.childId);
  }
  return tree.people.filter((p) => ids.has(p.id));
}

export function parentSideGroup(tree: TreeData, child: Person): GenerationGroup | undefined {
  const people = parentsOf(tree, child.id);
  if (!people.length) return undefined;
  const union = sharedUnion(tree, people);
  return {
    parentId: child.id,
    label: parentsLabel(child),
    people,
    coupleBar: showsCoupleBar(union?.kind, people.length),
  };
}

export function buildGenerationLanes(tree: TreeData, focusHint?: string): GenerationLane[] {
  const focusId = focusHint ?? tree.focusPersonId ?? tree.people[0]?.id;
  const focus = focusId ? tree.people.find((p) => p.id === focusId) : undefined;
  if (!focus) return [];

  const parents = parentsOf(tree, focus.id);
  const unions = unionsFor(tree, focus.id);
  const primary = unions[0];
  const partnerIds = new Set(unions.flatMap((u) => u.partnerIds).filter((id) => id !== focus.id));
  const partners = tree.people.filter((p) => partnerIds.has(p.id));
  const couple = uniquePeople([focus, ...partners]);
  const coupleBar = showsCoupleBar(primary?.kind, couple.length);

  const grandGroups: GenerationGroup[] = [];
  const parentGeneration = uniquePeople([
    ...parents,
    ...partners.flatMap((p) => parentsOf(tree, p.id)),
  ]);
  for (const parent of parentGeneration) {
    const group = parentSideGroup(tree, parent);
    if (group) grandGroups.push(group);
  }
  const grandparents = uniquePeople(grandGroups.flatMap((g) => g.people));

  const parentGroups: GenerationGroup[] = [];
  if (parents.length) {
    const union = sharedUnion(tree, parents);
    parentGroups.push({
      parentId: focus.id,
      label: parentsLabel(focus),
      people: parents,
      coupleBar: showsCoupleBar(union?.kind, parents.length),
    });
  }
  for (const partner of partners) {
    const group = parentSideGroup(tree, partner);
    if (group) parentGroups.push(group);
  }
  const parentLanePeople = uniquePeople(parentGroups.flatMap((g) => g.people));

  const fromUnions = unions.flatMap((u) => kidsUnderUnion(tree, u));
  const lone = childrenOfPerson(tree, focus.id);
  const children = uniquePeople([...fromUnions, ...lone]);

  const groups: GenerationGroup[] = [];
  for (const child of children) {
    const gkids = childrenOfPerson(tree, child.id);
    if (!gkids.length) continue;
    groups.push({
      parentId: child.id,
      label: `${child.givenName.trim()}'s`,
      people: gkids,
    });
  }
  const grandchildren = uniquePeople(groups.flatMap((g) => g.people));

  const lanes: GenerationLane[] = [];
  if (grandparents.length) {
    lanes.push({ id: "grandparents", people: grandparents, groups: grandGroups });
  }
  if (parentLanePeople.length) {
    lanes.push({ id: "parents", people: parentLanePeople, groups: parentGroups });
  }
  const siblings = uniquePeople(siblingsOf(tree, focus.id));
  const focusPeople = uniquePeople([...couple, ...siblings]);
  const focusGroups: GenerationGroup[] | undefined = siblings.length
    ? [
        { parentId: `couple-${focus.id}`, label: "", people: couple, coupleBar },
        {
          parentId: `sibs-${focus.id}`,
          label: `${focus.givenName.trim()} siblings`,
          people: siblings,
        },
      ]
    : undefined;
  lanes.push({ id: "focus", people: focusPeople, coupleBar, groups: focusGroups });
  if (children.length) lanes.push({ id: "children", people: children });
  if (grandchildren.length) lanes.push({ id: "grandchildren", people: grandchildren, groups });
  return lanes;
}
