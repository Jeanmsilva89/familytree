import type { Person, TreeData } from "./types";
import { kidsUnderUnion, unionsFor } from "./tree";
import {
  CARD,
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
  return { width: 320, height: 240, cards: [], couples: [], edges: [] };
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

function unitKids(tree: TreeData, ids: string[], placed: Set<string>): Person[] {
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
  return sortPeople(kids.filter((k) => !placed.has(k.id) && !ids.includes(k.id)));
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
    for (const kid of unitKids(tree, ids, placed)) {
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

function arePaired(tree: TreeData, a: string, b: string): boolean {
  return tree.unions.some(
    (u) =>
      showsCoupleBar(u.kind, u.partnerIds.length) &&
      u.partnerIds.includes(a) &&
      u.partnerIds.includes(b),
  );
}

function sittingDistance(left: number, right: number) {
  return right - left <= CARD.w + CARD.coupleGap + 0.51;
}

export function buildGraph(tree: TreeData, focusHint?: string): GraphLayout {
  const focusId = focusHint ?? tree.focusPersonId ?? tree.people[0]?.id;
  const focus = focusId ? personById(tree, focusId) : undefined;
  if (!focus || tree.people.length === 0) return emptyGraph();
  const root = focus;

  const places = new Map<string, Place>();
  const placed = new Set<string>();
  const parents = parentIdsOf(tree, focus.id).filter((id) => personById(tree, id));
  const blocked = new Set<string>(parents);

  const partner = primaryPartnerId(tree, focus.id, placed, blocked);
  const focusIds = partner ? [focus.id, partner] : [focus.id];
  const { full, half, step } = siblingSets(tree, focus.id);
  const aunts = auntsUncles(tree, focus.id).filter((p) => p.id !== partner);

  const extraFamilies: { partnerId: string; parentId: string; kids: Person[] }[] = [];
  const parentSet = new Set(parents);
  for (const parentId of parents) {
    for (const union of unionsFor(tree, parentId)) {
      for (const pid of union.partnerIds) {
        if (pid === parentId || parentSet.has(pid) || pid === focus.id) continue;
        if (!personById(tree, pid)) continue;
        if (extraFamilies.some((f) => f.partnerId === pid)) continue;
        extraFamilies.push({
          partnerId: pid,
          parentId,
          kids: sortPeople(
            childrenOfAny(tree, pid).filter(
              (k) => k.id !== focus.id && !parentSet.has(k.id),
            ),
          ),
        });
      }
    }
  }

  const splitFull = Math.ceil(full.length / 2);
  const leftFull = full.slice(0, splitFull);
  const rightFull = full.slice(splitFull);
  const splitAunts = Math.ceil(aunts.length / 2);
  const leftAunts = aunts.slice(0, splitAunts);
  const rightAunts = aunts.slice(splitAunts);
  const leftExtras = extraFamilies.filter((f) => parents.indexOf(f.parentId) <= 0);
  const rightExtras = extraFamilies.filter((f) => parents.indexOf(f.parentId) > 0);

  function makeColumn(ids: string[], gen: number, maxDown: number): Node | null {
    const present = ids.filter((id) => personById(tree, id) && !placed.has(id));
    if (!present.length) return null;
    return buildNode(tree, present, gen, placed, maxDown, blocked);
  }

  function personColumn(personId: string, gen: number, maxDown: number): Node | null {
    if (placed.has(personId) || !personById(tree, personId)) return null;
    const extraBlock = new Set(blocked);
    if (personId !== root.id) extraBlock.add(root.id);
    const sit = primaryPartnerId(tree, personId, placed, extraBlock);
    return makeColumn(sit ? [personId, sit] : [personId], gen, maxDown);
  }

  let cursor = 0;
  function pack(node: Node | null) {
    if (!node) return;
    const box = packNode(node, cursor, places);
    cursor = box.right + CARD.gap;
  }

  for (const fam of leftExtras) pack(personColumn(fam.partnerId, 1, 1));
  for (const aunt of leftAunts) pack(personColumn(aunt.id, 1, 1));
  for (const person of [...step, ...half, ...leftFull]) pack(personColumn(person.id, 0, 1));
  pack(makeColumn(focusIds, 0, 2));
  for (const person of rightFull) pack(personColumn(person.id, 0, 1));
  for (const aunt of rightAunts) pack(personColumn(aunt.id, 1, 1));
  for (const fam of rightExtras) pack(personColumn(fam.partnerId, 1, 1));

  for (const union of unionsFor(tree, focus.id)) {
    for (const pid of union.partnerIds) {
      if (pid === focus.id || placed.has(pid) || !personById(tree, pid)) continue;
      pack(personColumn(pid, 0, 1));
    }
  }

  const nuclearIds = [...focusIds, ...full.map((p) => p.id), ...half.map((p) => p.id)];
  const nuclearXs = nuclearIds.map((id) => places.get(id)?.x).filter(finiteNumber);
  const nuclearMid = nuclearXs.length ? avg(nuclearXs) : (places.get(focus.id)?.x ?? 0);

  const parentUnion = tree.unions.find(
    (u) => parents.length > 0 && parents.every((id) => u.partnerIds.includes(id)),
  );
  const orderedParents = (
    parentUnion ? parentUnion.partnerIds.filter((id) => parents.includes(id)) : parents
  ).filter((id) => personById(tree, id) && !places.has(id));
  if (orderedParents.length) {
    placeCouple(places, orderedParents, 1, nuclearMid);
    orderedParents.forEach((id) => placed.add(id));
  }

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

  for (const pid of parents) {
    const x = places.get(pid)?.x ?? nuclearMid;
    placeAncestors(pid, 2, x);
  }
  if (partner) {
    const inLaws = parentIdsOf(tree, partner).filter((id) => personById(tree, id) && !places.has(id));
    if (inLaws.length) {
      const px = places.get(partner)?.x ?? nuclearMid;
      const gen1 = [...places.values()].filter((p) => p.gen === 1).map((p) => p.x);
      const right = gen1.length ? Math.max(...gen1) : px;
      placeCouple(places, inLaws, 1, right + CARD.w + CARD.gap + unitWidth(inLaws.length) / 2);
      inLaws.forEach((id) => placed.add(id));
      for (const inLaw of inLaws) {
        placeAncestors(inLaw, 2, places.get(inLaw)?.x ?? px);
      }
    }
  }

  for (const fam of extraFamilies) {
    if (places.has(fam.partnerId)) {
      const kidXs = fam.kids.map((k) => places.get(k.id)?.x).filter(finiteNumber);
      if (kidXs.length && places.get(fam.partnerId)?.gen === 1) {
        const host = places.get(fam.partnerId)!;
        host.x = avg(kidXs);
      }
      continue;
    }
    const kidXs = fam.kids.map((k) => places.get(k.id)?.x).filter(finiteNumber);
    const parentX = places.get(fam.parentId)?.x ?? nuclearMid;
    const goLeft = (places.get(fam.parentId)?.x ?? 0) <= nuclearMid;
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

  const resolveGen = (gen: number) => {
    const ids = [...places.entries()]
      .filter(([, p]) => p.gen === gen)
      .sort((a, b) => a[1].x - b[1].x)
      .map(([id]) => id);
    if (ids.length < 2) return;
    const anchorId = ids.includes(root.id)
      ? root.id
      : ids.includes(partner ?? "")
        ? partner!
        : ids[Math.floor(ids.length / 2)];
    const anchorIdx = Math.max(0, ids.indexOf(anchorId));
    for (let i = anchorIdx + 1; i < ids.length; i++) {
      const prev = places.get(ids[i - 1])!;
      const cur = places.get(ids[i])!;
      const gap = arePaired(tree, ids[i - 1], ids[i]) ? CARD.coupleGap : CARD.gap;
      const minX = prev.x + CARD.w + gap;
      if (cur.x < minX) cur.x = minX;
    }
    for (let i = anchorIdx - 1; i >= 0; i--) {
      const next = places.get(ids[i + 1])!;
      const cur = places.get(ids[i])!;
      const gap = arePaired(tree, ids[i], ids[i + 1]) ? CARD.coupleGap : CARD.gap;
      const maxX = next.x - CARD.w - gap;
      if (cur.x > maxX) cur.x = maxX;
    }
  };
  for (const gen of gens) resolveGen(gen);

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
      cy: left.y + CARD.h,
    });
  }

  const pairCenter = new Map<string, number>();
  for (const couple of couples) {
    if (!couple.bar) continue;
    for (const id of couple.partnerIds) pairCenter.set(id, couple.cx);
  }

  const edges: LaidEdge[] = [];
  for (const link of tree.childLinks) {
    const child = byCard.get(link.childId);
    if (!child) continue;
    const parentCards = link.parentIds.map((id) => byCard.get(id)).filter(Boolean) as LaidCard[];
    if (!parentCards.length) continue;
    const fromX = parentCards.reduce((s, p) => s + p.x, 0) / parentCards.length;
    const fromY = Math.max(...parentCards.map((p) => p.y)) + CARD.h;
    const toX = pairCenter.get(child.id) ?? child.x;
    if (!finiteNumber(fromX) || !finiteNumber(fromY) || !finiteNumber(toX) || !finiteNumber(child.y)) continue;
    edges.push({ fromX, fromY, toX, toY: child.y });
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
