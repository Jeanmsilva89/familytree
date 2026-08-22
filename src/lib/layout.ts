import type { Person, TreeData, Union, UnionKind } from "./types";
import { displayName } from "./types";
import { kidsUnderUnion, parentsOf, unionsFor } from "./tree";

export const CARD = { w: 108, h: 140, gap: 16, coupleGap: 12, laneGap: 96, pad: 48 };

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

export type LaidCard = {
  id: string;
  person: Person;
  x: number;
  y: number;
  gen: number;
};

export type LaidCouple = {
  id: string;
  partnerIds: string[];
  kind?: UnionKind;
  bar: boolean;
  cx: number;
  cy: number;
};

export type LaidEdge = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

export type GraphLayout = {
  width: number;
  height: number;
  cards: LaidCard[];
  couples: LaidCouple[];
  edges: LaidEdge[];
  focusId?: string;
};

export function displayNames(people: Person[]): string {
  return people.map(displayName).join(" & ");
}

export function initialsOf(person: Person): string {
  const a = person.givenName.trim().charAt(0);
  const b = (person.familyName ?? "").trim().charAt(0);
  return (a + b).toUpperCase() || "?";
}

export function swatchHue(person: Person): number {
  const key = `${person.givenName}|${person.familyName ?? ""}|${person.id}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function ageLabel(birthDate?: string, now = new Date()): string | undefined {
  if (!birthDate) return undefined;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return birthDate;
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  if (age < 0 || age > 130) return birthDate;
  return String(age);
}

export function showsCoupleBar(kind?: UnionKind, count = 2): boolean {
  if (count < 2) return false;
  return kind === "married" || kind === "partnered";
}

export function lineageIds(tree: TreeData, id: string): Set<string> {
  const ids = new Set<string>([id]);
  for (const union of unionsFor(tree, id)) {
    for (const pid of union.partnerIds) ids.add(pid);
  }

  const walkUp = (personId: string, depth: number) => {
    if (depth <= 0) return;
    for (const parent of parentsOf(tree, personId)) {
      ids.add(parent.id);
      walkUp(parent.id, depth - 1);
    }
  };
  const walkDown = (personId: string, depth: number) => {
    if (depth <= 0) return;
    for (const link of tree.childLinks) {
      if (link.parentIds.includes(personId)) {
        ids.add(link.childId);
        walkDown(link.childId, depth - 1);
      }
    }
  };
  walkUp(id, 2);
  walkDown(id, 2);
  for (const parent of parentsOf(tree, id)) {
    for (const link of tree.childLinks) {
      if (link.parentIds.includes(parent.id)) ids.add(link.childId);
    }
  }
  return ids;
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

export { buildGraph, kidClusterCenters } from "./layoutGraph";
