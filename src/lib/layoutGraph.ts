import type { Person, TreeData } from "./types";
import { kidsUnderUnion, unionsFor } from "./tree";
import {
  CARD,
  householdCouple,
  showsCoupleBar,
  type GraphLayout,
  type LaidCard,
  type LaidCouple,
  type LaidEdge,
} from "./layout";

type Place = { x: number; gen: number };

type Node = {
  ids: string[];
  gen: number;
  children: Node[];
};

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

function sortPeople(people: Person[]): Person[] {
  return [...people].sort((a, b) => {
    const ad = a.birthDate ?? "9999-99-99";
    const bd = b.birthDate ?? "9999-99-99";
    if (ad !== bd) return ad.localeCompare(bd);
    const byName = a.givenName.localeCompare(b.givenName);
    return byName || a.id.localeCompare(b.id);
  });
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
      if (!showsCoupleBar(union.kind, union.partnerIds.length)) continue;
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
  return { full: sortPeople(full), half: sortPeople(half), step: sortPeople(step) };
}

function auntsUncles(tree: TreeData, focusId: string): Person[] {
  const parents = parentIdsOf(tree, focusId);
  const parentSet = new Set(parents);
  const found: Person[] = [];
  const seen = new Set<string>();
  for (const parentId of parents) {
    const gp = parentIdsOf(tree, parentId);
    if (!gp.length) continue;
    const gpSet = new Set(gp);
    for (const person of tree.people) {
      if (person.id === focusId || parentSet.has(person.id) || seen.has(person.id)) continue;
      const theirs = parentIdsOf(tree, person.id);
      if (!theirs.some((id) => gpSet.has(id))) continue;
      seen.add(person.id);
      found.push(person);
    }
  }
  return sortPeople(found);
}

function placeCouple(places: Map<string, Place>, ids: string[], gen: number, centerX: number) {
  const present = ids.filter((id) => id);
  if (present.length === 0) return centerX;
  if (present.length === 1) {
    places.set(present[0], { x: centerX, gen });
    return centerX;
  }
  const span = CARD.w + CARD.coupleGap;
  const left = centerX - ((present.length - 1) * span) / 2;
  present.forEach((id, i) => {
    places.set(id, { x: left + i * span, gen });
  });
  return centerX;
}

function unitWidth(count: number) {
  if (count <= 1) return CARD.w;
  return count * CARD.w + (count - 1) * CARD.coupleGap;
}

function rowY(gen: number, maxGen: number): number {
  return CARD.pad + (maxGen - gen) * (CARD.h + CARD.laneGap);
}

function emptyGraph(): GraphLayout {
  return { width: 320, height: 240, cards: [], couples: [], edges: [], householdIds: [] };
}

function finiteNumber(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((s, n) => s + n, 0) / xs.length;
}

function primaryPartnerId(
  tree: TreeData,
  id: string,
  placed: Set<string>,
  blocked: Set<string>,
): string | undefined {
  const unions = unionsFor(tree, id).filter((u) =>
    u.partnerIds.some(
      (pid) => pid !== id && personById(tree, pid) && !placed.has(pid) && !blocked.has(pid),
    ),
  );
  const preferred =
    unions.find((u) => u.kind === "married" || u.kind === "partnered") ?? unions[0];
  return preferred?.partnerIds.find(
    (pid) => pid !== id && personById(tree, pid) && !placed.has(pid) && !blocked.has(pid),
  );
}

function collectAncestors(tree: TreeData, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const q = [id];
  while (q.length) {
    const cur = q.pop()!;
    for (const parent of parentIdsOf(tree, cur)) {
      if (seen.has(parent) || !personById(tree, parent)) continue;
      seen.add(parent);
      out.push(parent);
      q.push(parent);
    }
  }
  return out;
}

function isAncestorOf(tree: TreeData, elder: string, young: string): boolean {
  return elder === young || collectAncestors(tree, young).includes(elder);
}

function unitKids(tree: TreeData, ids: string[], placed: Set<string>, blocked: Set<string>): Person[] {
  const union = tree.unions.find(
    (u) => ids.length > 1 && ids.every((id) => u.partnerIds.includes(id)),
  );
  let kids: Person[] = union ? kidsUnderUnion(tree, union) : [];
  if (!kids.length) {
    const seen = new Set<string>();
    for (const id of ids) {
      for (const kid of childrenOfAny(tree, id)) {
        if (seen.has(kid.id) || ids.includes(kid.id)) continue;
        seen.add(kid.id);
        kids.push(kid);
      }
    }
  }
  return sortPeople(
    kids.filter((k) => !placed.has(k.id) && !ids.includes(k.id) && !blocked.has(k.id)),
  );
}

function buildNode(
  tree: TreeData,
  ids: string[],
  gen: number,
  placed: Set<string>,
  maxDown: number,
  blocked: Set<string>,
): Node {
  for (const id of ids) placed.add(id);
  const children: Node[] = [];
  if (maxDown > 0) {
    for (const kid of unitKids(tree, ids, placed, blocked)) {
      if (placed.has(kid.id)) continue;
      const partner = maxDown > 1 ? primaryPartnerId(tree, kid.id, placed, blocked) : undefined;
      const childIds = partner ? [kid.id, partner] : [kid.id];
      children.push(buildNode(tree, childIds, gen - 1, placed, maxDown - 1, blocked));
    }
  }
  return { ids, gen, children };
}

function collectIds(node: Node): string[] {
  return [...node.ids, ...node.children.flatMap(collectIds)];
}

function shiftIds(ids: string[], dx: number, places: Map<string, Place>) {
  if (!dx) return;
  for (const id of ids) {
    const place = places.get(id);
    if (place) place.x += dx;
  }
}

function packNode(node: Node, left: number, places: Map<string, Place>): { left: number; right: number } {
  const selfW = unitWidth(node.ids.length);
  if (!node.children.length) {
    placeCouple(places, node.ids, node.gen, left + selfW / 2);
    return { left, right: left + selfW };
  }
  let cursor = left;
  const boxes: { left: number; right: number }[] = [];
  node.children.forEach((child, i) => {
    if (i) cursor += CARD.gap;
    const box = packNode(child, cursor, places);
    boxes.push(box);
    cursor = box.right;
  });
  const kidsLeft = boxes[0].left;
  const kidsRight = boxes[boxes.length - 1].right;
  const kidsW = kidsRight - kidsLeft;
  const width = Math.max(selfW, kidsW);
  if (kidsW < width) {
    shiftIds(node.children.flatMap(collectIds), (width - kidsW) / 2, places);
  }
  placeCouple(places, node.ids, node.gen, left + width / 2);
  return { left, right: left + width };
}

function sittingDistance(left: number, right: number) {
  return right - left <= CARD.w + CARD.coupleGap + 0.51;
}

function extraPartnerFamilies(tree: TreeData, personId: string) {
  const parents = parentIdsOf(tree, personId).filter((id) => personById(tree, id));
  const parentSet = new Set(parents);
  const families: { partnerId: string; parentId: string; kids: Person[] }[] = [];
  for (const parentId of parents) {
    for (const union of unionsFor(tree, parentId)) {
      for (const pid of union.partnerIds) {
        if (pid === parentId || parentSet.has(pid) || pid === personId) continue;
        if (!personById(tree, pid)) continue;
        if (families.some((f) => f.partnerId === pid)) continue;
        families.push({
          partnerId: pid,
          parentId,
          kids: sortPeople(
            childrenOfAny(tree, pid).filter((k) => k.id !== personId && !parentSet.has(k.id)),
          ),
        });
      }
    }
  }
  return families;
}

function bloodScore(tree: TreeData, id: string, household: Set<string>): number {
  if (household.has(id)) return 4;
  for (const hid of household) {
    if (parentIdsOf(tree, hid).includes(id)) return 3;
    if (parentIdsOf(tree, id).includes(hid)) return 3;
  }
  for (const hid of household) {
    const hp = new Set(parentIdsOf(tree, hid));
    if (hp.size && parentIdsOf(tree, id).some((pid) => hp.has(pid))) return 2;
  }
  return 0;
}

export function buildGraph(tree: TreeData, focusHint?: string): GraphLayout {
  const homeIds = householdCouple(tree, focusHint);
  const focusId = homeIds[0] ?? focusHint ?? tree.focusPersonId ?? tree.people[0]?.id;
  const focus = focusId ? personById(tree, focusId) : undefined;
  if (!focus || tree.people.length === 0) return emptyGraph();
  const householdIds = homeIds.length ? homeIds : [focus.id];
  const householdSet = new Set(householdIds);

  const places = new Map<string, Place>();
  const placed = new Set<string>();
  const reserved = new Set<string>([
    ...householdIds,
    ...householdIds.flatMap((id) => collectAncestors(tree, id)),
  ]);
  const blocked = new Set<string>(reserved);

  const leftHome = householdIds[0];
  const rightHome = householdIds.length > 1 ? householdIds[householdIds.length - 1] : undefined;

  const leftSibs = siblingSets(tree, leftHome);
  const rightSibs = rightHome ? siblingSets(tree, rightHome) : { full: [] as Person[], half: [] as Person[], step: [] as Person[] };
  const leftAunts = auntsUncles(tree, leftHome).filter((p) => !householdSet.has(p.id) && !reserved.has(p.id));
  const rightAunts = rightHome
    ? auntsUncles(tree, rightHome).filter((p) => !householdSet.has(p.id) && !reserved.has(p.id))
    : [];
  const leftExtras = extraPartnerFamilies(tree, leftHome).filter((f) => !reserved.has(f.partnerId));
  const rightExtras = rightHome
    ? extraPartnerFamilies(tree, rightHome).filter((f) => !reserved.has(f.partnerId))
    : [];
  const extraFamilies = [...leftExtras, ...rightExtras];

  const splitFull = Math.ceil(leftSibs.full.length / 2);
  const soloLeftFull = rightHome ? leftSibs.full : leftSibs.full.slice(0, splitFull);
  const soloRightFull = rightHome ? [] : leftSibs.full.slice(splitFull);

  function makeColumn(ids: string[], gen: number, maxDown: number): Node | null {
    const present = ids.filter((id) => personById(tree, id) && !placed.has(id));
    if (!present.length) return null;
    return buildNode(tree, present, gen, placed, maxDown, blocked);
  }

  function personColumn(
    personId: string,
    gen: number,
    maxDown: number,
    inlaw: "left" | "right",
  ): Node | null {
    if (reserved.has(personId) || placed.has(personId) || !personById(tree, personId)) return null;
    const extraBlock = new Set(blocked);
    for (const hid of householdIds) extraBlock.add(hid);
    const sit = primaryPartnerId(tree, personId, placed, extraBlock);
    if (!sit || reserved.has(sit)) return makeColumn([personId], gen, maxDown);
    const ids = inlaw === "left" ? [sit, personId] : [personId, sit];
    return makeColumn(ids, gen, maxDown);
  }

  let cursor = 0;
  function pack(node: Node | null) {
    if (!node) return;
    const box = packNode(node, cursor, places);
    cursor = box.right + CARD.gap;
  }

  for (const fam of leftExtras) pack(personColumn(fam.partnerId, 1, 1, "left"));
  for (const aunt of leftAunts) pack(personColumn(aunt.id, 1, 1, "left"));
  for (const person of [...leftSibs.step, ...leftSibs.half, ...soloLeftFull]) {
    pack(personColumn(person.id, 0, 1, "left"));
  }
  pack(makeColumn(householdIds, 0, 2));
  for (const person of [...soloRightFull, ...rightSibs.full, ...rightSibs.half, ...rightSibs.step]) {
    pack(personColumn(person.id, 0, 1, "right"));
  }
  for (const aunt of rightAunts) pack(personColumn(aunt.id, 1, 1, "right"));
  for (const fam of rightExtras) pack(personColumn(fam.partnerId, 1, 1, "right"));

  for (const hid of householdIds) {
    for (const union of unionsFor(tree, hid)) {
      for (const pid of union.partnerIds) {
        if (householdSet.has(pid) || placed.has(pid) || !personById(tree, pid)) continue;
        pack(personColumn(pid, 0, 1, "right"));
      }
    }
  }

  const homeXs = householdIds.map((id) => places.get(id)?.x).filter(finiteNumber);
  const homeMid = homeXs.length ? avg(homeXs) : (places.get(focus.id)?.x ?? 0);

  const placeAncestors = (personId: string, gen: number, preferX: number) => {
    if (gen > 2) return;
    const elders = parentIdsOf(tree, personId).filter((id) => personById(tree, id));
    if (!elders.length) return;
    const union = tree.unions.find((u) => elders.every((id) => u.partnerIds.includes(id)));
    const ordered = (union ? union.partnerIds.filter((id) => elders.includes(id)) : elders).filter(
      (id) => personById(tree, id),
    );
    const missing = ordered.filter((id) => !places.has(id));
    if (missing.length) {
      placeCouple(places, missing, gen, preferX);
      missing.forEach((id) => placed.add(id));
    }
    for (const pid of ordered) {
      const x = places.get(pid)?.x ?? preferX;
      placeAncestors(pid, gen + 1, x);
    }
  };

  for (const hid of householdIds) {
    const hx = places.get(hid)?.x ?? homeMid;
    placeAncestors(hid, 1, hx);
  }

  for (const fam of extraFamilies) {
    if (places.has(fam.partnerId)) {
      const kidXs = fam.kids.map((k) => places.get(k.id)?.x).filter(finiteNumber);
      if (kidXs.length && places.get(fam.partnerId)?.gen === 1) {
        places.get(fam.partnerId)!.x = avg(kidXs);
      }
      continue;
    }
    const kidXs = fam.kids.map((k) => places.get(k.id)?.x).filter(finiteNumber);
    const parentX = places.get(fam.parentId)?.x ?? homeMid;
    const goLeft = (places.get(fam.parentId)?.x ?? 0) <= homeMid;
    const desired = kidXs.length ? avg(kidXs) : parentX + (goLeft ? -1 : 1) * (CARD.w + CARD.gap);
    placeCouple(places, [fam.partnerId], 1, desired);
    placed.add(fam.partnerId);
    fam.kids.forEach((kid, i) => {
      if (places.has(kid.id)) return;
      const n = fam.kids.length;
      places.set(kid.id, {
        x: desired - ((n - 1) * (CARD.w + CARD.gap)) / 2 + i * (CARD.w + CARD.gap),
        gen: 0,
      });
      placed.add(kid.id);
    });
  }

  const placedXs = [...places.values()].map((p) => p.x).filter(finiteNumber);
  let extraX = (placedXs.length ? Math.max(...placedXs) : 0) + CARD.w + CARD.gap * 3;
  for (const person of tree.people) {
    if (places.has(person.id)) continue;
    places.set(person.id, { x: extraX, gen: 0 });
    extraX += CARD.w + CARD.gap;
  }

  for (const [id, place] of [...places.entries()]) {
    if (!finiteNumber(place.x) || !finiteNumber(place.gen)) places.delete(id);
  }
  if (!places.size) return emptyGraph();

  const gens = [...new Set([...places.values()].map((p) => p.gen).filter(finiteNumber))].sort(
    (a, b) => b - a,
  );

  const faceInlawsOutward = () => {
    const mid = avg(
      householdIds.map((id) => places.get(id)?.x).filter(finiteNumber),
    );
    if (!Number.isFinite(mid)) return;
    for (const union of tree.unions) {
      if (!showsCoupleBar(union.kind, union.partnerIds.length)) continue;
      const ids = union.partnerIds.filter((id) => places.has(id));
      if (ids.length !== 2) continue;
      const [a, b] = ids;
      const sa = bloodScore(tree, a, householdSet);
      const sb = bloodScore(tree, b, householdSet);
      if (sa === sb) continue;
      const blood = sa > sb ? a : b;
      const inlaw = sa > sb ? b : a;
      const bloodP = places.get(blood)!;
      const inlawP = places.get(inlaw)!;
      if (bloodP.gen !== inlawP.gen) continue;
      if (Math.abs(inlawP.x - mid) < Math.abs(bloodP.x - mid)) {
        const tmp = bloodP.x;
        bloodP.x = inlawP.x;
        inlawP.x = tmp;
      }
    }
  };
  faceInlawsOutward();

  const sideSign = (id: string): number => {
    if (!rightHome) return 0;
    if (id === leftHome) return -1;
    if (id === rightHome) return 1;
    const toLeft = isAncestorOf(tree, id, leftHome);
    const toRight = isAncestorOf(tree, id, rightHome);
    if (toLeft && toRight) return 0;
    if (toLeft) return -1;
    if (toRight) return 1;
    const x = places.get(id)?.x;
    if (!finiteNumber(x)) return 0;
    const mid = avg(householdIds.map((hid) => places.get(hid)?.x).filter(finiteNumber));
    if (!Number.isFinite(mid)) return 0;
    return x < mid ? -1 : 1;
  };

  type Unit = { ids: string[]; gen: number; side: number };

  const avgX = (ids: string[]) =>
    avg(ids.map((id) => places.get(id)?.x).filter(finiteNumber));

  const unitsForGen = (gen: number): Unit[] => {
    const ids = [...places.entries()]
      .filter(([, p]) => p.gen === gen)
      .map(([id]) => id);
    const used = new Set<string>();
    const units: Unit[] = [];
    for (const union of tree.unions) {
      if (!showsCoupleBar(union.kind, union.partnerIds.length)) continue;
      const members = union.partnerIds.filter((id) => ids.includes(id));
      if (members.length < 2) continue;
      if (members.some((id) => used.has(id))) continue;
      members.forEach((id) => used.add(id));
      const sideVals = members.map(sideSign);
      const side = sideVals.every((s) => s === sideVals[0]) ? sideVals[0] : 0;
      units.push({ ids: members, gen, side });
    }
    for (const id of ids) {
      if (used.has(id)) continue;
      units.push({ ids: [id], gen, side: sideSign(id) });
    }
    units.sort((a, b) => avgX(a.ids) - avgX(b.ids));
    return units;
  };

  const setUnitMid = (unit: Unit, mid: number) => {
    const ordered = [...unit.ids].sort((a, b) => (places.get(a)?.x ?? 0) - (places.get(b)?.x ?? 0));
    placeCouple(places, ordered, unit.gen, mid);
  };

  const parentKidGroups = (): { parents: string[]; kids: string[]; parentGen: number }[] => {
    const groups: { parents: string[]; kids: string[]; parentGen: number }[] = [];
    const seen = new Set<string>();
    for (const union of tree.unions) {
      const parents = union.partnerIds.filter((id) => places.has(id));
      const kids = kidsUnderUnion(tree, union)
        .map((k) => k.id)
        .filter((id) => places.has(id));
      if (!parents.length || !kids.length) continue;
      const gens = parents.map((id) => places.get(id)!.gen);
      if (gens.some((g) => g !== gens[0])) continue;
      seen.add(parents.slice().sort().join("|"));
      groups.push({ parents, kids, parentGen: gens[0] });
    }
    for (const link of tree.childLinks) {
      const parents = link.parentIds.filter((id) => places.has(id));
      if (!parents.length || !places.has(link.childId)) continue;
      const key = parents.slice().sort().join("|");
      if (seen.has(key)) continue;
      const gens = parents.map((id) => places.get(id)!.gen);
      if (gens.some((g) => g !== gens[0])) continue;
      seen.add(key);
      groups.push({ parents, kids: [link.childId], parentGen: gens[0] });
    }
    return groups.sort((a, b) => a.parentGen - b.parentGen);
  };

  const alignParentsToKids = () => {
    for (const group of parentKidGroups()) {
      const kidXs = group.kids.map((id) => places.get(id)?.x).filter(finiteNumber);
      const parXs = group.parents.map((id) => places.get(id)?.x).filter(finiteNumber);
      if (!kidXs.length || !parXs.length) continue;
      const dx = avg(kidXs) - avg(parXs);
      if (!dx) continue;
      for (const id of group.parents) places.get(id)!.x += dx;
    }
  };

  const separateUnits = (gen: number) => {
    const units = unitsForGen(gen);
    if (units.length < 2) return;
    units.sort((a, b) => {
      if (a.side !== b.side) return a.side - b.side;
      return avgX(a.ids) - avgX(b.ids);
    });
    for (let i = 1; i < units.length; i++) {
      const prev = units[i - 1];
      const cur = units[i];
      const prevRight = avgX(prev.ids) + unitWidth(prev.ids.length) / 2;
      const curLeft = avgX(cur.ids) - unitWidth(cur.ids.length) / 2;
      const overlap = prevRight + CARD.gap - curLeft;
      if (overlap <= 0) continue;
      if (prev.side < 0 && cur.side > 0) {
        setUnitMid(prev, avgX(prev.ids) - overlap / 2);
        setUnitMid(cur, avgX(cur.ids) + overlap / 2);
      } else if (cur.side >= 0 && prev.side >= 0) {
        setUnitMid(cur, avgX(cur.ids) + overlap);
      } else {
        setUnitMid(prev, avgX(prev.ids) - overlap);
      }
    }
    for (let i = units.length - 2; i >= 0; i--) {
      const cur = units[i];
      const next = units[i + 1];
      const nextLeft = avgX(next.ids) - unitWidth(next.ids.length) / 2;
      const curRight = avgX(cur.ids) + unitWidth(cur.ids.length) / 2;
      const overlap = curRight + CARD.gap - nextLeft;
      if (overlap > 0) setUnitMid(cur, avgX(cur.ids) - overlap);
    }
  };

  alignParentsToKids();
  for (const gen of gens) separateUnits(gen);
  alignParentsToKids();
  for (const gen of gens) separateUnits(gen);
  faceInlawsOutward();
  for (const gen of gens) separateUnits(gen);

  const xs = [...places.values()].map((p) => p.x).filter(finiteNumber);
  if (!xs.length) return emptyGraph();
  const minX = Math.min(...xs);
  const shift = CARD.pad + CARD.w / 2 - minX;
  for (const place of places.values()) place.x += shift;

  const maxGen = Math.max(...gens);
  const cards: LaidCard[] = tree.people.flatMap((person) => {
    const place = places.get(person.id);
    if (!place) return [];
    const y = rowY(place.gen, maxGen);
    if (!finiteNumber(place.x) || !finiteNumber(y)) return [];
    return [{ id: person.id, person, x: place.x, y, gen: place.gen }];
  });
  if (!cards.length) return emptyGraph();
  const byCard = new Map(cards.map((c) => [c.id, c]));

  const couples: LaidCouple[] = [];
  for (const union of tree.unions) {
    const partners = union.partnerIds.map((id) => byCard.get(id)).filter(Boolean) as LaidCard[];
    if (partners.length < 2) continue;
    const left = partners.reduce((a, b) => (a.x < b.x ? a : b));
    const right = partners.reduce((a, b) => (a.x > b.x ? a : b));
    if (left.gen !== right.gen) continue;
    const adjacent = sittingDistance(left.x, right.x);
    couples.push({
      id: union.id,
      partnerIds: union.partnerIds,
      kind: union.kind,
      bar: adjacent && showsCoupleBar(union.kind, partners.length),
      cx: (left.x + right.x) / 2,
      cy: left.y + CARD.h * 0.5,
    });
  }

  const edges: LaidEdge[] = [];
  for (const link of tree.childLinks) {
    const child = byCard.get(link.childId);
    if (!child) continue;
    const parentCards = link.parentIds.map((id) => byCard.get(id)).filter(Boolean) as LaidCard[];
    if (!parentCards.length) continue;
    const fromX = parentCards.reduce((s, p) => s + p.x, 0) / parentCards.length;
    const fromY = Math.max(...parentCards.map((p) => p.y)) + CARD.h;
    if (!finiteNumber(fromX) || !finiteNumber(fromY) || !finiteNumber(child.x) || !finiteNumber(child.y)) continue;
    edges.push({
      fromX,
      fromY,
      toX: child.x,
      toY: child.y,
      parentIds: parentCards.map((p) => p.id),
      childId: child.id,
    });
  }

  const maxCardX = Math.max(...cards.map((c) => c.x)) + CARD.w / 2 + CARD.pad;
  const maxCardY = Math.max(...cards.map((c) => c.y)) + CARD.h + CARD.pad;
  return {
    width: finiteNumber(maxCardX) ? Math.max(320, maxCardX) : 320,
    height: finiteNumber(maxCardY) ? Math.max(280, maxCardY) : 280,
    cards,
    couples,
    edges,
    focusId: focus.id,
    householdIds,
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
