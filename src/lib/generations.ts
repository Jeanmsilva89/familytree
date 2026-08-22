import type { Person, TreeData } from "./types";
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
  people: Person[];
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

export function buildGenerationLanes(tree: TreeData, focusHint?: string): GenerationLane[] {
  const focusId = focusHint ?? tree.focusPersonId ?? tree.people[0]?.id;
  const focus = focusId ? tree.people.find((p) => p.id === focusId) : undefined;
  if (!focus) return [];

  const parents = parentsOf(tree, focus.id);
  const grandparents = uniquePeople(parents.flatMap((parent) => parentsOf(tree, parent.id)));

  const unions = unionsFor(tree, focus.id);
  const primary = unions[0];
  const partnerIds = new Set(unions.flatMap((u) => u.partnerIds).filter((id) => id !== focus.id));
  const partners = tree.people.filter((p) => partnerIds.has(p.id));
  const couple = uniquePeople([focus, ...partners]);
  const coupleBar = showsCoupleBar(primary?.kind, couple.length);

  const fromUnions = unions.flatMap((u) => kidsUnderUnion(tree, u));
  const lone = childrenOfPerson(tree, focus.id);
  const children = uniquePeople([...fromUnions, ...lone]);

  const groups: GenerationGroup[] = [];
  for (const child of children) {
    const gkids = childrenOfPerson(tree, child.id);
    if (gkids.length) groups.push({ parentId: child.id, people: gkids });
  }
  const grandchildren = uniquePeople(groups.flatMap((g) => g.people));

  const lanes: GenerationLane[] = [];
  if (grandparents.length) lanes.push({ id: "grandparents", people: grandparents });
  if (parents.length) lanes.push({ id: "parents", people: parents });
  lanes.push({ id: "focus", people: couple, coupleBar });
  if (children.length) lanes.push({ id: "children", people: children });
  if (grandchildren.length) lanes.push({ id: "grandchildren", people: grandchildren, groups });
  return lanes;
}
