import type { Person, TreeData, Union } from "./types";
import { kidsUnderUnion, parentsOf, unionsFor } from "./tree";
import { householdCouple, showsCoupleBar } from "./layout";

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

function isBarredCouple(tree: TreeData, people: Person[]): boolean {
  if (people.length !== 2) return false;
  const union = sharedUnion(tree, people);
  return showsCoupleBar(union?.kind, 2);
}

function focusHouseholdGroups(tree: TreeData, focus: Person): GenerationGroup[] {
  const homeIds = householdCouple(tree, focus.id);
  const homePeople = uniquePeople(
    homeIds.map((id) => tree.people.find((p) => p.id === id)).filter(Boolean) as Person[],
  );
  const seated = new Set(homePeople.map((p) => p.id));
  const groups: GenerationGroup[] = [];
  if (homePeople.length) {
    groups.push({
      parentId: `home-${focus.id}`,
      label: "",
      people: homePeople,
      coupleBar: isBarredCouple(tree, homePeople),
    });
  }
  for (const union of unionsFor(tree, focus.id)) {
    for (const pid of union.partnerIds) {
      if (pid === focus.id || seated.has(pid)) continue;
      const other = tree.people.find((p) => p.id === pid);
      if (!other) continue;
      seated.add(pid);
      groups.push({
        parentId: `partner-${pid}`,
        label: "",
        people: [other],
        coupleBar: false,
      });
    }
  }
  return groups;
}

function childGroupsFor(tree: TreeData, focus: Person, unions: Union[]): GenerationGroup[] {
  const used = new Set<string>();
  const groups: GenerationGroup[] = [];
  const homeIds = householdCouple(tree, focus.id);
  const homeUnion = tree.unions.find(
    (union) => homeIds.length >= 2 && homeIds.every((id) => union.partnerIds.includes(id)),
  );
  const ordered = [...(homeUnion ? [homeUnion] : []), ...unions.filter((union) => union.id !== homeUnion?.id)];
  for (const union of ordered) {
    const kids = uniquePeople(kidsUnderUnion(tree, union)).filter((kid) => !used.has(kid.id));
    if (!kids.length) continue;
    kids.forEach((kid) => used.add(kid.id));
    const otherId = union.partnerIds.find((id) => id !== focus.id);
    const other = otherId ? tree.people.find((p) => p.id === otherId) : undefined;
    groups.push({
      parentId: union.id,
      label: other ? `With ${other.givenName.trim()}` : "",
      people: kids,
    });
  }
  const lone = uniquePeople(childrenOfPerson(tree, focus.id).filter((kid) => !used.has(kid.id)));
  if (lone.length) {
    groups.push({ parentId: `lone-${focus.id}`, label: "", people: lone });
  }
  return groups;
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
  return {
    parentId: child.id,
    label: parentsLabel(child),
    people,
    coupleBar: isBarredCouple(tree, people),
  };
}

export function buildGenerationLanes(tree: TreeData, focusHint?: string): GenerationLane[] {
  const focusId = focusHint ?? tree.focusPersonId ?? tree.people[0]?.id;
  const focus = focusId ? tree.people.find((p) => p.id === focusId) : undefined;
  if (!focus) return [];

  const parents = parentsOf(tree, focus.id);
  const unions = unionsFor(tree, focus.id);
  const household = focusHouseholdGroups(tree, focus);
  const partners = uniquePeople(household.flatMap((group) => group.people)).filter((p) => p.id !== focus.id);
  const coupleBar = household.some((group) => group.coupleBar);

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
    parentGroups.push({
      parentId: focus.id,
      label: parentsLabel(focus),
      people: parents,
      coupleBar: isBarredCouple(tree, parents),
    });
  }
  for (const partner of partners) {
    const group = parentSideGroup(tree, partner);
    if (group) parentGroups.push(group);
  }
  const parentLanePeople = uniquePeople(parentGroups.flatMap((g) => g.people));

  const kidGroups = childGroupsFor(tree, focus, unions);
  const children = uniquePeople(kidGroups.flatMap((group) => group.people));

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
  const focusGroups: GenerationGroup[] = [
    ...household,
    ...(siblings.length
      ? [
          {
            parentId: `sibs-${focus.id}`,
            label: `${focus.givenName.trim()} siblings`,
            people: siblings,
          },
        ]
      : []),
  ];
  const focusPeople = uniquePeople([...household.flatMap((group) => group.people), ...siblings]);
  lanes.push({ id: "focus", people: focusPeople, coupleBar, groups: focusGroups });
  if (children.length) {
    lanes.push({
      id: "children",
      people: children,
      groups: kidGroups.length ? kidGroups : undefined,
    });
  }
  if (grandchildren.length) lanes.push({ id: "grandchildren", people: grandchildren, groups });
  return lanes;
}
