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

type Place = { x: number; gen: number };

function placeCouple(
  places: Map<string, Place>,
  ids: string[],
  gen: number,
  centerX: number,
) {
  if (ids.length === 0) return centerX;
  if (ids.length === 1) {
    places.set(ids[0], { x: centerX, gen });
    return centerX;
  }
  const span = CARD.w + CARD.coupleGap;
  const left = centerX - span / 2;
  const right = centerX + span / 2;
  places.set(ids[0], { x: left, gen });
  places.set(ids[1], { x: right, gen });
  ids.slice(2).forEach((id, i) => {
    places.set(id, { x: right + (i + 1) * (CARD.w + CARD.gap), gen });
  });
  return centerX;
}

function rowY(gen: number, minGen: number, maxGen: number): number {
  const topGen = maxGen;
  return CARD.pad + (topGen - gen) * (CARD.h + CARD.laneGap);
}

function emptyGraph(): GraphLayout {
  return { width: 320, height: 240, cards: [], couples: [], edges: [] };
}

function finiteNumber(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function buildGraph(tree: TreeData, focusHint?: string): GraphLayout {
  const focusId = focusHint ?? tree.focusPersonId ?? tree.people[0]?.id;
  const focus = focusId ? personById(tree, focusId) : undefined;
  if (!focus || tree.people.length === 0) {
    return emptyGraph();
  }

  const places = new Map<string, Place>();
  const unions = unionsFor(tree, focus.id);
  const primary = unions[0];
  const primaryIds = primary
    ? primary.partnerIds.filter((id) => personById(tree, id))
    : [focus.id];
  const orderedPrimary = primaryIds.includes(focus.id)
    ? [focus.id, ...primaryIds.filter((id) => id !== focus.id)]
    : primaryIds;

  placeCouple(places, orderedPrimary, 0, 0);

  unions.slice(1).forEach((union, i) => {
    const extras = union.partnerIds.filter((id) => id !== focus.id && !places.has(id));
    extras.forEach((id, j) => {
      places.set(id, { x: (i + 1) * 220 + j * (CARD.w + CARD.gap), gen: 0 });
    });
  });

  const kidClusters: { parentIds: string[]; kids: Person[]; center: number }[] = [];
  for (const union of unions) {
    const kids = kidsUnderUnion(tree, union);
    const partners = union.partnerIds.filter((id) => places.has(id));
    const center =
      partners.reduce((sum, id) => sum + (places.get(id)?.x ?? 0), 0) / Math.max(partners.length, 1);
    kidClusters.push({ parentIds: partners, kids, center });
  }
  const covered = new Set(kidClusters.flatMap((c) => c.kids.map((k) => k.id)));
  const lone = childrenOfAny(tree, focus.id).filter((k) => !covered.has(k.id));
  if (lone.length) {
    kidClusters.push({ parentIds: [focus.id], kids: lone, center: places.get(focus.id)?.x ?? 0 });
  }

  for (const cluster of kidClusters) {
    cluster.kids.forEach((kid, i) => {
      const n = cluster.kids.length;
      const start = cluster.center - ((n - 1) * (CARD.w + CARD.gap)) / 2;
      places.set(kid.id, { x: start + i * (CARD.w + CARD.gap), gen: -1 });
    });
  }

  const focusParents = parentIdsOf(tree, focus.id);
  const parentUnion = tree.unions.find((u) =>
    focusParents.length > 0 && focusParents.every((id) => u.partnerIds.includes(id)),
  );
  const parentCenter = places.get(focus.id)?.x ?? 0;
  if (focusParents.length) {
    const ordered = parentUnion
      ? parentUnion.partnerIds.filter((id) => focusParents.includes(id))
      : focusParents;
    placeCouple(places, ordered, 1, parentCenter);
    for (const pid of ordered) {
      const gps = parentIdsOf(tree, pid);
      if (gps.length) placeCouple(places, gps, 2, places.get(pid)?.x ?? parentCenter);
    }
  }

  const partnerIds = orderedPrimary.filter((id) => id !== focus.id);
  partnerIds.forEach((pid, side) => {
    const inLaws = parentIdsOf(tree, pid);
    if (!inLaws.length) return;
    const dir = places.get(pid)!.x >= (places.get(focus.id)?.x ?? 0) ? 1 : -1;
    const cx = (places.get(pid)?.x ?? 0) + dir * 170;
    placeCouple(places, inLaws, 1, cx);
    for (const inLaw of inLaws) {
      const gps = parentIdsOf(tree, inLaw);
      if (gps.length) placeCouple(places, gps, 2, places.get(inLaw)?.x ?? cx);
    }
    void side;
  });

  const { full, half, step } = siblingSets(tree, focus.id);
  const focusX = places.get(focus.id)?.x ?? 0;
  const bloodDir = -1;
  let cursor = focusX + bloodDir * (CARD.w + CARD.gap + 8);
  for (const sib of [...full, ...half]) {
    if (places.has(sib.id)) continue;
    places.set(sib.id, { x: cursor, gen: 0 });
    cursor += bloodDir * (CARD.w + CARD.gap);
  }
  cursor += bloodDir * 12;
  for (const sib of step) {
    if (places.has(sib.id)) continue;
    places.set(sib.id, { x: cursor, gen: 0 });
    cursor += bloodDir * (CARD.w + CARD.gap);
  }

  for (const cluster of kidClusters) {
    for (const kid of cluster.kids) {
      const unionsOfKid = unionsFor(tree, kid.id);
      for (const union of unionsOfKid) {
        const extras = union.partnerIds.filter((id) => id !== kid.id && !places.has(id));
        extras.forEach((id, i) => {
          places.set(id, { x: (places.get(kid.id)?.x ?? 0) + (CARD.w + CARD.coupleGap) * (i + 1), gen: -1 });
        });
        const gkids = kidsUnderUnion(tree, union);
        const partners = union.partnerIds.filter((id) => places.has(id));
        const center =
          partners.reduce((sum, id) => sum + (places.get(id)!.x), 0) / Math.max(partners.length, 1);
        gkids.forEach((gk, i) => {
          if (places.has(gk.id)) return;
          const n = gkids.length;
          places.set(gk.id, {
            x: center - ((n - 1) * (CARD.w + CARD.gap)) / 2 + i * (CARD.w + CARD.gap),
            gen: -2,
          });
        });
      }
    }
  }

  for (const person of tree.people) {
    if (!places.has(person.id)) places.set(person.id, { x: 420 + places.size * 20, gen: 0 });
  }

  for (const [id, place] of [...places.entries()]) {
    if (!finiteNumber(place.x) || !finiteNumber(place.gen)) places.delete(id);
  }
  if (!places.size) return emptyGraph();

  const gens = [...places.values()].map((p) => p.gen).filter(finiteNumber);
  if (!gens.length) return emptyGraph();
  const minGen = Math.min(...gens);
  const maxGen = Math.max(...gens);

  const byGen = new Map<number, string[]>();
  for (const [id, place] of places) {
    const list = byGen.get(place.gen) ?? [];
    list.push(id);
    byGen.set(place.gen, list);
  }
  for (const [, ids] of byGen) {
    ids.sort((a, b) => places.get(a)!.x - places.get(b)!.x);
    for (let i = 1; i < ids.length; i++) {
      const prev = places.get(ids[i - 1])!;
      const cur = places.get(ids[i])!;
      const minX = prev.x + CARD.w + CARD.gap;
      if (cur.x < minX) cur.x = minX;
    }
  }

  const xs = [...places.values()].map((p) => p.x).filter(finiteNumber);
  if (!xs.length) return emptyGraph();
  const minX = Math.min(...xs);
  if (!finiteNumber(minX)) return emptyGraph();
  const shift = CARD.pad + CARD.w / 2 - minX;
  for (const place of places.values()) place.x += shift;

  const cards: LaidCard[] = tree.people.flatMap((person) => {
    const place = places.get(person.id);
    if (!place) return [];
    const y = rowY(place.gen, minGen, maxGen);
    if (!finiteNumber(place.x) || !finiteNumber(y)) return [];
    return [{
      id: person.id,
      person,
      x: place.x,
      y,
      gen: place.gen,
    }];
  });
  if (!cards.length) return emptyGraph();
  const byCard = new Map(cards.map((c) => [c.id, c]));

  const couples: LaidCouple[] = [];
  for (const union of tree.unions) {
    const partners = union.partnerIds.map((id) => byCard.get(id)).filter(Boolean) as LaidCard[];
    if (partners.length < 2) continue;
    const left = partners.reduce((a, b) => (a.x < b.x ? a : b));
    const right = partners.reduce((a, b) => (a.x > b.x ? a : b));
    couples.push({
      id: union.id,
      partnerIds: union.partnerIds,
      kind: union.kind,
      bar: showsCoupleBar(union.kind, partners.length),
      cx: (left.x + right.x) / 2,
      cy: left.y + CARD.h * 0.48,
    });
  }

  const edges: LaidEdge[] = [];
  for (const link of tree.childLinks) {
    const child = byCard.get(link.childId);
    if (!child) continue;
    const parents = link.parentIds.map((id) => byCard.get(id)).filter(Boolean) as LaidCard[];
    if (!parents.length) continue;
    const fromX = parents.reduce((s, p) => s + p.x, 0) / parents.length;
    const fromY = Math.max(...parents.map((p) => p.y)) + CARD.h;
    if (!finiteNumber(fromX) || !finiteNumber(fromY) || !finiteNumber(child.x) || !finiteNumber(child.y)) continue;
    edges.push({ fromX, fromY, toX: child.x, toY: child.y });
  }

  const maxCardX = Math.max(...cards.map((c) => c.x)) + CARD.w / 2 + CARD.pad;
  const maxCardY = Math.max(...cards.map((c) => c.y)) + CARD.h + CARD.pad;
  const width = finiteNumber(maxCardX) ? Math.max(320, maxCardX) : 320;
  const height = finiteNumber(maxCardY) ? Math.max(280, maxCardY) : 280;
  return {
    width,
    height,
    cards,
    couples,
    edges,
    focusId: focus.id,
  };
}

export function kidClusterCenters(layout: GraphLayout, tree: TreeData) {
  return tree.unions.map((union) => {
    const kids = kidsUnderUnion(tree, union);
    const cards = kids.map((k) => layout.cards.find((c) => c.id === k.id)).filter(Boolean) as LaidCard[];
    const parents = union.partnerIds
      .map((id) => layout.cards.find((c) => c.id === id))
      .filter(Boolean) as LaidCard[];
    const parentMid = parents.reduce((s, p) => s + p.x, 0) / Math.max(parents.length, 1);
    const kidMid = cards.reduce((s, c) => s + c.x, 0) / Math.max(cards.length, 1);
    return { unionId: union.id, parentMid, kidMid, kids: cards };
  });
}
