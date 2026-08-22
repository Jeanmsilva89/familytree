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

function personById(tree: TreeData, id: string): Person | undefined {
  return tree.people.find((p) => p.id === id);
}

function parentIdsOf(tree: TreeData, childId: string): string[] {
  const ids = new Set<string>();
  for (const link of tree.childLinks) {
    if (link.childId === childId) link.parentIds.forEach((id) => ids.add(id));
  }
  return [...ids];
}

function childrenOfAny(tree: TreeData, parentId: string): Person[] {
  const ids = new Set(
    tree.childLinks.filter((l) => l.parentIds.includes(parentId)).map((l) => l.childId),
  );
  return tree.people.filter((p) => ids.has(p.id));
}

function siblingSets(tree: TreeData, focusId: string) {
  const focusParents = parentIdsOf(tree, focusId);
  const parentSet = new Set(focusParents);
  const full: Person[] = [];
  const half: Person[] = [];
  const step: Person[] = [];

  if (focusParents.length) {
    for (const person of tree.people) {
      if (person.id === focusId) continue;
      const theirs = parentIdsOf(tree, person.id);
      const shared = theirs.filter((id) => parentSet.has(id));
      if (shared.length === 0) continue;
      if (focusParents.length > 1 && shared.length === focusParents.length) full.push(person);
      else half.push(person);
    }
  }

  const stepParentIds = new Set<string>();
  for (const parentId of focusParents) {
    for (const union of unionsFor(tree, parentId)) {
      for (const pid of union.partnerIds) {
        if (!parentSet.has(pid)) stepParentIds.add(pid);
      }
    }
  }
  const blood = new Set([focusId, ...full.map((p) => p.id), ...half.map((p) => p.id)]);
  for (const stepParentId of stepParentIds) {
    for (const kid of childrenOfAny(tree, stepParentId)) {
      if (blood.has(kid.id) || kid.id === focusId) continue;
      if (parentIdsOf(tree, kid.id).some((id) => parentSet.has(id))) continue;
      step.push(kid);
    }
  }
  return { full, half, step };
}
