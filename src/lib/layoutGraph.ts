import type { Person, TreeData } from "./types";
import { partnerStatus, strongestKin, type KinKind } from "./types";
import { kidsUnderUnion, kinBetween } from "./tree";
import {
  AREA,
  CARD,
  computeGenerations,
  householdCouple,
  showsCoupleBar,
  type GraphLayout,
  type LaidArea,
  type LaidBridge,
  type LaidCard,
  type LaidCouple,
  type LaidEdge,
  type LaidFork,
} from "./layout";
import { deriveHouseholds, householdOfPerson, type Household } from "./households";

type Place = { x: number; gen: number };

/**
 * One household laid out as a block: heads on the top row, children at home
 * on the row below. Blocks that share a row never overlap, so the household
 * areas drawn around them never overlap either. People with no household get
 * a small block with no area.
 */
type Block = {
  id: string;
  household?: Household;
  headIds: string[];
  childIds: string[];
  top: number;
  bottom: number;
  w: number;
  x: number;
  /** -1 left partner's side, +1 right partner's side, 0 the focus household. */
  side: number;
  visit: number;
};

type Neighbor = { block: Block; via: string; rel: "up" | "down" | "across" };

function personById(tree: TreeData, id: string): Person | undefined {
  return tree.people.find((p) => p.id === id);
}

function parentIdsOf(tree: TreeData, childId: string): string[] {
  const ids = new Set<string>();
  for (const link of tree.childLinks) {
    if (link.childId === childId) link.parentIds.forEach((id) => ids.add(id));
  }
  return [...ids].filter((id) => personById(tree, id));
}

function childIdsOf(tree: TreeData, parentId: string): string[] {
  return [...new Set(tree.childLinks.filter((l) => l.parentIds.includes(parentId)).map((l) => l.childId))].filter(
    (id) => personById(tree, id),
  );
}

function partnerIdsOf(tree: TreeData, id: string): string[] {
  const out = new Set<string>();
  for (const union of tree.unions) {
    if (!union.partnerIds.includes(id)) continue;
    for (const pid of union.partnerIds) if (pid !== id && personById(tree, pid)) out.add(pid);
  }
  return [...out];
}

function birthKey(person: Person | undefined): string {
  if (!person) return "~";
  return `${person.birthDate ?? "9999-99-99"}|${person.givenName}|${person.id}`;
}

function unitWidth(count: number) {
  if (count <= 1) return CARD.w;
  return count * CARD.w + (count - 1) * CARD.coupleGap;
}

function rowWidth(count: number) {
  if (count <= 0) return 0;
  return count * CARD.w + (count - 1) * CARD.gap;
}

function rowY(gen: number, maxGen: number): number {
  return CARD.pad + (maxGen - gen) * (CARD.h + CARD.laneGap);
}

function emptyGraph(): GraphLayout {
  return {
    width: 320,
    height: 240,
    cards: [],
    couples: [],
    edges: [],
    forks: [],
    householdIds: [],
    areas: [],
    bridges: [],
  };
}

function finiteNumber(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((s, n) => s + n, 0) / xs.length;
}

function sittingDistance(left: number, right: number) {
  return right - left <= CARD.w + CARD.coupleGap + 0.51;
}

function makeFork(
  id: string,
  parents: LaidCard[],
  children: LaidCard[],
  dotted: boolean,
  acrossHouseholds: boolean,
): LaidFork | null {
  if (!parents.length || !children.length) return null;
  const parentBottom = Math.max(...parents.map((p) => p.y)) + CARD.h;
  const childTop = Math.min(...children.map((c) => c.y));
  if (!Number.isFinite(parentBottom) || !Number.isFinite(childTop)) return null;
  const gap = Math.max(24, childTop - parentBottom);
  const joinY = parentBottom + Math.min(acrossHouseholds ? 14 : 20, gap * 0.28);
  // A fork that leaves its household runs its rail in the open lane between
  // areas, so the drops visibly enter each child's own area.
  const railY = acrossHouseholds ? parentBottom + gap / 2 : childTop - Math.min(16, gap * 0.22);
  const parentXs = parents.map((p) => p.x);
  const childXs = children.map((c) => c.x);
  const stemX = parentXs.reduce((s, n) => s + n, 0) / parentXs.length;
  return {
    id,
    parentIds: parents.map((p) => p.id),
    childIds: children.map((c) => c.id),
    dotted,
    joinY,
    railY: Math.max(joinY + 8, railY),
    joinLeft: Math.min(...parentXs),
    joinRight: Math.max(...parentXs),
    railLeft: Math.min(...childXs, stemX),
    railRight: Math.max(...childXs, stemX),
    stemX,
    parentDrops: parents.map((p) => ({ x: p.x, y0: p.y + CARD.h, parentId: p.id, kin: "blood" as KinKind })),
    childDrops: children.map((c) => ({ x: c.x, y1: c.y, childId: c.id, kin: "blood" as KinKind })),
    kin: "blood",
  };
}

function annotateFork(fork: LaidFork, tree: TreeData): LaidFork {
  const parentDrops = fork.parentDrops.map((drop) => ({
    ...drop,
    kin: strongestKin(fork.childIds.map((childId) => kinBetween(tree, childId, drop.parentId))),
  }));
  const childDrops = fork.childDrops.map((drop) => ({
    ...drop,
    kin: strongestKin(fork.parentIds.map((parentId) => kinBetween(tree, drop.childId, parentId))),
  }));
  return {
    ...fork,
    parentDrops,
    childDrops,
    kin: strongestKin([...parentDrops.map((drop) => drop.kin), ...childDrops.map((drop) => drop.kin)]),
  };
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

/** Generations for every person, including people outside the focus family. */
function allGenerations(tree: TreeData, homeIds: string[]): Map<string, number> {
  const gen = computeGenerations(tree, homeIds);
  // A family the focus walk never reaches is seeded from the same person
  // whichever way the saved list is ordered. Otherwise the rows flip.
  const pending = [...tree.people].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const person of pending) {
    if (gen.has(person.id)) continue;
    const seed = householdCouple(tree, person.id);
    const more = computeGenerations(tree, seed.length ? seed : [person.id]);
    for (const [id, g] of more) if (!gen.has(id)) gen.set(id, g);
    if (!gen.has(person.id)) gen.set(person.id, 0);
  }
  return gen;
}

/**
 * Superellipse for a household area around a content box of half-size
 * (halfW, halfH): pad the box, then grow the radii just enough that the
 * curve clears the box corners.
 */
export function areaShape(halfW: number, halfH: number): { rx: number; ry: number; n: number } {
  const n = AREA.n;
  const rx = halfW + AREA.padX;
  const ry = halfH + AREA.padY;
  const fill = Math.pow(halfW / rx, n) + Math.pow(halfH / ry, n);
  const k = Math.max(1, Math.pow(fill / 0.97, 1 / n));
  return { rx: rx * k, ry: ry * k, n };
}

/**
 * Couples, parent lines, and forks for cards that already have positions.
 * `acrossHouseholds` is true when a fork leaves the parents' household, which
 * drops the rail in the open lane between areas.
 */
export function connectLaidCards(
  tree: TreeData,
  cards: LaidCard[],
  acrossHouseholds: (parentIds: string[], childIds: string[]) => boolean = () => false,
): { couples: LaidCouple[]; edges: LaidEdge[]; forks: LaidFork[] } {
  const byCard = new Map(cards.map((c) => [c.id, c]));

  const couples: LaidCouple[] = [];
  for (const union of tree.unions) {
    const partners = union.partnerIds.map((id) => byCard.get(id)).filter(Boolean) as LaidCard[];
    if (partners.length < 2) continue;
    const l = partners.reduce((a, b) => (a.x < b.x ? a : b));
    const r = partners.reduce((a, b) => (a.x > b.x ? a : b));
    if (l.gen !== r.gen) continue;
    couples.push({
      id: union.id,
      partnerIds: union.partnerIds,
      kind: union.kind,
      status: partnerStatus(tree, union),
      bar: sittingDistance(l.x, r.x) && showsCoupleBar(union.kind, partners.length),
      cx: (l.x + r.x) / 2,
      cy: l.y + CARD.h * 0.5,
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
    if (!finiteNumber(fromX) || !finiteNumber(fromY)) continue;
    edges.push({ fromX, fromY, toX: child.x, toY: child.y, parentIds: parentCards.map((p) => p.id), childId: child.id });
  }

  const forks: LaidFork[] = [];
  const grouped = new Map<string, { parents: LaidCard[]; children: LaidCard[]; dotted: boolean }>();
  for (const union of tree.unions) {
    const parents = union.partnerIds.map((id) => byCard.get(id)).filter(Boolean) as LaidCard[];
    const children = kidsUnderUnion(tree, union).map((kid) => byCard.get(kid.id)).filter(Boolean) as LaidCard[];
    if (parents.length < 1 || !children.length) continue;
    const key = parents.map((p) => p.id).sort().join("|");
    const xs = parents.map((p) => p.x).sort((a, b) => a - b);
    const adjacent = parents.length > 1 && sittingDistance(xs[0], xs[xs.length - 1]);
    grouped.set(key, { parents, children, dotted: parents.length > 1 && !(adjacent && showsCoupleBar(union.kind, parents.length)) });
  }
  for (const link of tree.childLinks) {
    const child = byCard.get(link.childId);
    const parents = link.parentIds.map((id) => byCard.get(id)).filter(Boolean) as LaidCard[];
    if (!child || !parents.length) continue;
    const key = parents.map((p) => p.id).sort().join("|");
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.children.some((c) => c.id === child.id)) existing.children.push(child);
      continue;
    }
    const xs = parents.map((p) => p.x).sort((a, b) => a - b);
    const adjacent = parents.length > 1 && sittingDistance(xs[0], xs[xs.length - 1]);
    grouped.set(key, { parents, children: [child], dotted: parents.length > 1 && !adjacent });
  }
  let forkN = 0;
  for (const group of grouped.values()) {
    const across = acrossHouseholds(
      group.parents.map((parent) => parent.id),
      group.children.map((child) => child.id),
    );
    const fork = makeFork(`fork-${forkN++}`, group.parents, group.children, group.dotted, across);
    if (fork) forks.push(annotateFork(fork, tree));
  }

  return { couples, edges, forks };
}

export function buildGraph(tree: TreeData, focusHint?: string): GraphLayout {
  if (tree.people.length === 0) return emptyGraph();
  const hint = focusHint ?? tree.focusPersonId;
  const focus = (hint ? personById(tree, hint) : undefined) ?? tree.people[0];
  if (!focus) return emptyGraph();

  const derived = deriveHouseholds(tree);
  const focusHome = householdOfPerson(derived, focus.id);
  const householdIds =
    focusHome && focusHome.headIds.includes(focus.id)
      ? [focus.id, ...focusHome.headIds.filter((id) => id !== focus.id)]
      : [focus.id];
  const householdSet = new Set(householdIds);
  const gen = allGenerations(tree, householdIds);

  // Blocks: one per household, one per person with no household.
  const blocks: Block[] = [];
  const blockOfPerson = new Map<string, Block>();
  const addBlock = (id: string, headIds: string[], childIds: string[], household?: Household) => {
    const top = Math.max(...headIds.map((h) => gen.get(h) ?? 0));
    const bottom = childIds.length ? top - 1 : top;
    for (const h of headIds) gen.set(h, top);
    for (const c of childIds) gen.set(c, top - 1);
    const contentW = Math.max(unitWidth(headIds.length), rowWidth(childIds.length));
    const contentH = childIds.length ? 2 * CARD.h + CARD.laneGap : CARD.h;
    const w = household ? 2 * areaShape(contentW / 2, contentH / 2).rx : contentW + 2 * AREA.loosePad;
    const block: Block = {
      id,
      household,
      headIds: [...headIds],
      childIds: [...childIds],
      top,
      bottom,
      w,
      x: 0,
      side: 0,
      visit: -1,
    };
    blocks.push(block);
    for (const id2 of [...headIds, ...childIds]) blockOfPerson.set(id2, block);
    return block;
  };
  for (const household of derived.households) addBlock(household.id, household.headIds, household.childIds, household);
  for (const id of derived.loose) addBlock(`loose-${id}`, [id], []);
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const homeBlock = blockOfPerson.get(focus.id)!;

  // Who links to whom, as seen from each block.
  const neighbors = new Map<string, Neighbor[]>(blocks.map((b) => [b.id, []]));
  for (const link of derived.links) {
    const to = blockById.get(link.toId);
    const from = link.fromId ? blockById.get(link.fromId) : blockOfPerson.get(link.personId);
    if (!to || !from || to === from) continue;
    if (link.kind === "child") {
      neighbors.get(to.id)!.push({ block: from, via: link.personId, rel: "up" });
      neighbors.get(from.id)!.push({ block: to, via: link.personId, rel: "down" });
    } else {
      neighbors.get(to.id)!.push({ block: from, via: link.personId, rel: "across" });
      neighbors.get(from.id)!.push({ block: to, via: link.personId, rel: "across" });
    }
  }

  const halfSiblingsIn = (block: Block, personId: string) => {
    const mine = new Set(parentIdsOf(tree, personId));
    return block.childIds.filter((id) => parentIdsOf(tree, id).some((p) => mine.has(p))).length;
  };

  // Seat heads: in-laws outward, blood relatives toward the focus household.
  // Above the focus generation, the partner whose own parents are on the tree
  // sits outward so each line of ancestors climbs on its own side.
  const orderHeads = (block: Block) => {
    if (block === homeBlock && householdIds.length > 1 && householdIds.every((id) => block.headIds.includes(id))) {
      block.headIds = [...householdIds];
      return;
    }
    if (block.headIds.length < 2 || block.side === 0) return;
    const ancestorRow = block.top > homeBlock.top;
    const inward = (id: string) => [ancestorRow ? (parentIdsOf(tree, id).length ? 0 : 1) : 0, bloodScore(tree, id, householdSet)];
    const original = [...block.headIds];
    const sorted = [...block.headIds].sort((a, b) => {
      const [a1, a2] = inward(a);
      const [b1, b2] = inward(b);
      return a1 - b1 || a2 - b2 || original.indexOf(b) - original.indexOf(a);
    });
    // `sorted` runs outward → inward.
    block.headIds = block.side < 0 ? sorted : sorted.reverse();
  };

  const personX = (id: string): number => {
    const block = blockOfPerson.get(id);
    if (!block) return 0;
    const hi = block.headIds.indexOf(id);
    if (hi >= 0) {
      const span = CARD.w + CARD.coupleGap;
      return block.x - ((block.headIds.length - 1) * span) / 2 + hi * span;
    }
    const ci = block.childIds.indexOf(id);
    const step = CARD.w + CARD.gap;
    return block.x - ((block.childIds.length - 1) * step) / 2 + ci * step;
  };
  const left = (b: Block) => b.x - b.w / 2;
  const right = (b: Block) => b.x + b.w / 2;

  // Breadth-first from the focus household: parents' households above and
  // beside, grown children's households beside, partners beyond.
  let visit = 0;
  const place = (root: Block, side: number, x: number) => {
    root.side = side;
    root.x = x;
    root.visit = visit++;
    orderHeads(root);
    const queue = [root];
    const alternate = { up: -1, down: 1, across: 1 };
    while (queue.length) {
      const a = queue.shift()!;
      const list = neighbors.get(a.id)!.filter((n) => n.block.visit < 0);
      const relRank = { up: 0, down: 1, across: 2 };
      list.sort((p, q) => {
        if (p.rel !== q.rel) return relRank[p.rel] - relRank[q.rel];
        if (p.rel === "up") {
          const pi = a.headIds.indexOf(p.via);
          const qi = a.headIds.indexOf(q.via);
          if (pi !== qi) return (pi < 0 ? 99 : pi) - (qi < 0 ? 99 : qi);
          const ph = halfSiblingsIn(p.block, p.via);
          const qh = halfSiblingsIn(q.block, q.via);
          if (ph !== qh) return qh - ph;
        }
        if (p.rel === "down") {
          const byBirth = birthKey(personById(tree, p.via)).localeCompare(birthKey(personById(tree, q.via)));
          if (byBirth) return byBirth;
        }
        // Array position is not part of the graph. The same people in a
        // different saved order must keep the same left and right.
        return p.block.id < q.block.id ? -1 : p.block.id > q.block.id ? 1 : 0;
      });
      const rankOf = new Map<string, number>();
      for (const n of list) {
        const b = n.block;
        if (b.visit >= 0) continue;
        if (a === homeBlock && a.side === 0) {
          // Each partner's family climbs on that partner's side, even when the
          // focus is one of their children.
          const heads = a.headIds;
          if (n.rel === "up" && heads.length > 1 && n.via === heads[0]) b.side = -1;
          else if (n.rel === "up" && heads.length > 1 && n.via === heads[heads.length - 1]) b.side = 1;
          else {
            b.side = alternate[n.rel];
            alternate[n.rel] = -alternate[n.rel];
          }
        } else {
          b.side = a.side;
        }
        orderHeads(b);
        const dir = b.side || 1;
        const key = `${n.rel}|${n.via}`;
        const rank = rankOf.get(key) ?? 0;
        rankOf.set(key, rank + 1);
        if (n.rel === "up") b.x = personX(n.via) + dir * rank * 0.5;
        else if (n.rel === "down") b.x = a.x + dir * 0.25 * (rank + 1);
        else b.x = a.x + dir * (a.w / 2 + b.w / 2 + AREA.gap);
        b.visit = visit++;
        queue.push(b);
      }
    }
  };
  place(homeBlock, 0, 0);
  const pending = blocks
    .filter((block) => block.visit < 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const block of pending) {
    if (block.visit >= 0) continue;
    const placed = blocks.filter((b) => b.visit >= 0);
    const edge = placed.length ? Math.max(...placed.map(right)) : 0;
    place(block, 1, edge + AREA.gap * 3 + block.w / 2);
  }

  // Keep this left-to-right order for every row, so families stay on their side.
  const order = new Map(
    [...blocks]
      .sort((a, b) => a.side - b.side || a.x - b.x || a.visit - b.visit)
      .map((b, i) => [b.id, i]),
  );
  const rows = [...new Set(blocks.flatMap((b) => [b.top, b.bottom]))];

  const resolve = () => {
    for (let pass = 0; pass < 400; pass++) {
      let moved = false;
      for (const r of rows) {
        const list = blocks
          .filter((b) => b.bottom <= r && r <= b.top)
          .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
        if (list.length < 2) continue;
        let split = list.findIndex((b) => b.side >= 0);
        if (split < 0) split = list.length;
        if (split > 0 && split < list.length) {
          const a = list[split - 1];
          const b = list[split];
          const overlap = right(a) + AREA.gap - left(b);
          if (overlap > 0.01) {
            if (b === homeBlock) a.x -= overlap;
            else {
              a.x -= overlap / 2;
              b.x += overlap / 2;
            }
            moved = true;
          }
        }
        for (let i = split + 1; i < list.length; i++) {
          const overlap = right(list[i - 1]) + AREA.gap - left(list[i]);
          if (overlap > 0.01) {
            list[i].x += overlap;
            moved = true;
          }
        }
        for (let i = split - 2; i >= 0; i--) {
          const overlap = right(list[i]) + AREA.gap - left(list[i + 1]);
          if (overlap > 0.01) {
            list[i].x -= overlap;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  };

  // Pull each household toward the people it connects to (parents above,
  // grown children beside), then push areas apart again.
  const outsideTies = (block: Block): [string, string][] => {
    const ties: [string, string][] = [];
    const inside = new Set([...block.headIds, ...block.childIds]);
    for (const id of inside) {
      const related = [...parentIdsOf(tree, id), ...(block.headIds.includes(id) ? childIdsOf(tree, id) : [])];
      for (const other of related) {
        if (!inside.has(other) && blockOfPerson.has(other)) ties.push([id, other]);
      }
    }
    if (!block.household) {
      for (const id of inside) for (const other of partnerIdsOf(tree, id)) if (!inside.has(other)) ties.push([id, other]);
    }
    return ties;
  };
  const byVisit = [...blocks].sort((a, b) => a.visit - b.visit);
  resolve();
  for (let round = 0; round < 10; round++) {
    for (const block of byVisit) {
      if (block === homeBlock) continue;
      const ties = outsideTies(block);
      if (!ties.length) continue;
      block.x += avg(ties.map(([mine, theirs]) => personX(theirs) - personX(mine)));
      resolve();
    }
  }

  const places = new Map<string, Place>();
  for (const block of blocks) {
    for (const id of [...block.headIds, ...block.childIds]) places.set(id, { x: personX(id), gen: gen.get(id) ?? 0 });
  }

  // Shift so the leftmost area starts a little inside the world.
  const shift = CARD.pad / 2 - Math.min(...blocks.map(left));
  for (const p of places.values()) p.x += shift;
  for (const person of tree.people) {
    if (typeof person.graphX === "number" && Number.isFinite(person.graphX) && places.has(person.id)) {
      places.get(person.id)!.x = person.graphX;
    }
  }

  const maxGen = Math.max(...[...places.values()].map((p) => p.gen).filter(finiteNumber));
  const cards: LaidCard[] = tree.people.flatMap((person) => {
    const p = places.get(person.id);
    if (!p) return [];
    const y = rowY(p.gen, maxGen);
    if (!finiteNumber(p.x) || !finiteNumber(y)) return [];
    return [{ id: person.id, person, x: p.x, y, gen: p.gen }];
  });
  if (!cards.length) return emptyGraph();

  const { couples, edges, forks } = connectLaidCards(tree, cards, (parentIds, childIds) => {
    const homes = new Set(parentIds.map((id) => blockOfPerson.get(id)));
    return childIds.some((id) => !homes.has(blockOfPerson.get(id)));
  });
  const byCard = new Map(cards.map((card) => [card.id, card]));

  // Household areas from the final card positions.
  const areas: LaidArea[] = [];
  for (const block of blocks) {
    if (!block.household) continue;
    const members = [...block.headIds, ...block.childIds].map((id) => byCard.get(id)).filter(Boolean) as LaidCard[];
    if (!members.length) continue;
    const minX = Math.min(...members.map((c) => c.x)) - CARD.w / 2;
    const maxX = Math.max(...members.map((c) => c.x)) + CARD.w / 2;
    const minY = Math.min(...members.map((c) => c.y));
    const maxY = Math.max(...members.map((c) => c.y)) + CARD.h;
    const halfW = (maxX - minX) / 2;
    const halfH = (maxY - minY) / 2;
    const shape = areaShape(halfW, halfH);
    const heads = [...block.headIds].sort((a, b) => (byCard.get(a)?.x ?? 0) - (byCard.get(b)?.x ?? 0));
    areas.push({
      id: block.household.id,
      label: heads.map((id) => personById(tree, id)?.givenName.trim() || "?").join(" & "),
      headIds: heads,
      memberIds: [...block.headIds, ...block.childIds],
      isHome: block === homeBlock,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      ...shape,
    });
  }

  // One connector per household link, from the parents into the child's area.
  const bridges: LaidBridge[] = [];
  for (const link of derived.links) {
    if (link.kind !== "child" || !link.fromId) continue;
    const child = byCard.get(link.personId);
    const from = blockById.get(link.fromId);
    if (!child || !from) continue;
    const parents = parentIdsOf(tree, link.personId)
      .filter((id) => from.headIds.includes(id))
      .map((id) => byCard.get(id))
      .filter(Boolean) as LaidCard[];
    if (!parents.length) continue;
    bridges.push({
      id: link.id,
      fromAreaId: link.fromId,
      toAreaId: link.toId,
      personId: link.personId,
      kind: link.kind,
      kin: link.kin,
      fromX: avg(parents.map((p) => p.x)),
      fromY: Math.max(...parents.map((p) => p.y)) + CARD.h,
      toX: child.x,
      toY: child.y,
    });
  }

  const extentRight = Math.max(...cards.map((c) => c.x + CARD.w / 2), ...areas.map((a) => a.cx + a.rx));
  const extentBottom = Math.max(...cards.map((c) => c.y + CARD.h), ...areas.map((a) => a.cy + a.ry));
  return {
    width: finiteNumber(extentRight) ? Math.max(320, extentRight + CARD.pad / 2) : 320,
    height: finiteNumber(extentBottom) ? Math.max(280, extentBottom + CARD.pad / 2) : 280,
    cards,
    couples,
    edges,
    forks,
    focusId: focus.id,
    householdIds,
    areas,
    bridges,
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
