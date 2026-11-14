import { deriveFamilyUnits, type FamilyUnits, type UnitLinkKind } from "./familyUnits";
import type { TreeData } from "./types";
import { treeForLens } from "./visibleTree";

export { treeForLens, visibleChildLinks } from "./visibleTree";

/**
 * Where a family sits in the sky.
 *
 * The seed is a pure function of the kinship graph and of saved overrides.
 * The order of people, links, or unions in the saved arrays is not an input:
 * the same relatives land in the same places on every reload and every device.
 * A force layout cannot promise that. One extra person changes every repulsion,
 * so the whole sky rearranges. This seed hangs each family from its parent
 * family instead, and keeps every coordinate in sums of widths and gaps.
 *
 * `child` means below the parent (blood, adopted, foster, then step).
 * `satellite` means beside the family this one actually links to, when it
 * has no parent of its own (a partnerless parent, a divorced partner).
 * `root` means the top of a component.
 */

export type SkyAttach = "root" | "child" | "satellite";

export type SkySeedBucket = {
  id: string;
  rootId: string;
  /** Members sorted by id, so the list does not follow the saved array. */
  memberIds: string[];
  parentId: string | null;
  place: SkyAttach;
  /** Left-to-right index among families that share a parent and a place. */
  slot: number;
  /** 0 at a root. Children add one. A satellite keeps its host's depth. */
  depth: number;
};

export type FamilySkySeed = {
  buckets: SkySeedBucket[];
};

export type BucketSize = { w: number; h: number };

const KIN_RANK: Record<UnitLinkKind, number> = {
  blood: 0,
  adopted: 1,
  foster: 2,
  step: 3,
  partner: 4,
  divorced: 5,
};

const CHILD_KIN: ReadonlySet<UnitLinkKind> = new Set(["blood", "adopted", "foster", "step"]);

function byText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

type ParentChoice = Map<string, string>;

function reaches(from: string, target: string, next: ParentChoice) {
  let cur: string | undefined = from;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === target) return true;
    seen.add(cur);
    cur = next.get(cur);
  }
  return false;
}

/**
 * Parent, sibling slot, and depth for every family unit.
 * Step links place a bucket below the step-parent's family. They do not
 * change who is a member of that family; membership stays with the maternal rule.
 */
export function seedFromUnits(units: FamilyUnits): FamilySkySeed {
  const byId = new Map(units.units.map((unit) => [unit.id, unit]));
  const rootOf = (unitId: string) => byId.get(unitId)?.rootId ?? unitId;
  const unitIds = [...byId.keys()].sort(byText);

  const incoming = new Map<string, { from: string; kind: UnitLinkKind; fromPerson: string; toPerson: string }[]>();
  const touching = new Map<string, { other: string; kind: UnitLinkKind }[]>();
  for (const link of units.links) {
    if (link.fromUnitId === link.toUnitId) continue;
    if (CHILD_KIN.has(link.kind)) {
      const list = incoming.get(link.toUnitId) ?? [];
      list.push({
        from: link.fromUnitId,
        kind: link.kind,
        fromPerson: link.fromPersonId,
        toPerson: link.toPersonId,
      });
      incoming.set(link.toUnitId, list);
    }
    const addTouch = (id: string, other: string) => {
      const list = touching.get(id) ?? [];
      list.push({ other, kind: link.kind });
      touching.set(id, list);
    };
    addTouch(link.fromUnitId, link.toUnitId);
    addTouch(link.toUnitId, link.fromUnitId);
  }

  const chosen: ParentChoice = new Map();
  for (const id of unitIds) {
    const options = (incoming.get(id) ?? []).slice().sort((a, b) =>
      KIN_RANK[a.kind] - KIN_RANK[b.kind] ||
      byText(rootOf(a.from), rootOf(b.from)) ||
      byText(a.fromPerson, b.fromPerson) ||
      byText(a.toPerson, b.toPerson),
    );
    for (const edge of options) {
      if (reaches(edge.from, id, chosen)) continue;
      chosen.set(id, edge.from);
      break;
    }
  }

  const beside = new Map<string, string>();
  const satellitesOf = new Map<string, string[]>();
  const chain = (from: string) => {
    let cur: string | undefined = from;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      cur = beside.get(cur) ?? chosen.get(cur);
    }
    return seen;
  };
  for (const id of unitIds) {
    if (chosen.has(id)) continue;
    const hosts = (touching.get(id) ?? [])
      .filter((edge) => edge.other !== id)
      .filter((edge) => !chain(edge.other).has(id))
      .filter((edge) => chosen.has(edge.other) || byText(rootOf(id), rootOf(edge.other)) > 0)
      .sort((a, b) => KIN_RANK[a.kind] - KIN_RANK[b.kind] || byText(rootOf(a.other), rootOf(b.other)));
    const host = hosts[0]?.other;
    if (!host) continue;
    beside.set(id, host);
    const list = satellitesOf.get(host) ?? [];
    list.push(id);
    satellitesOf.set(host, list);
  }

  const childrenOf = new Map<string, string[]>();
  for (const [id, parent] of chosen) {
    const list = childrenOf.get(parent) ?? [];
    list.push(id);
    childrenOf.set(parent, list);
  }
  const byRoot = (a: string, b: string) => byText(rootOf(a), rootOf(b));
  for (const list of childrenOf.values()) list.sort(byRoot);
  for (const list of satellitesOf.values()) list.sort(byRoot);
  const roots = unitIds.filter((id) => !chosen.has(id) && !beside.has(id)).sort(byRoot);

  const depth = new Map<string, number>();
  const walk = (id: string, d: number) => {
    depth.set(id, d);
    for (const child of childrenOf.get(id) ?? []) walk(child, d + 1);
    for (const satellite of satellitesOf.get(id) ?? []) walk(satellite, d);
  };
  for (const id of roots) walk(id, 0);

  const buckets: SkySeedBucket[] = unitIds.map((id) => {
    const place: SkyAttach = beside.has(id) ? "satellite" : chosen.has(id) ? "child" : "root";
    const parentId = chosen.get(id) ?? beside.get(id) ?? null;
    const siblings = place === "satellite"
      ? satellitesOf.get(beside.get(id)!)!
      : place === "child"
        ? childrenOf.get(chosen.get(id)!)!
        : roots;
    return {
      id,
      rootId: rootOf(id),
      memberIds: [...(byId.get(id)?.memberIds ?? [])].sort(byText),
      parentId,
      place,
      slot: siblings.indexOf(id),
      depth: depth.get(id) ?? 0,
    };
  });
  buckets.sort((a, b) => byText(a.rootId, b.rootId) || byText(a.id, b.id));
  return { buckets };
}

export function seedFamilySky(tree: TreeData, visibleIds?: ReadonlySet<string>): FamilySkySeed {
  const source = visibleIds ? treeForLens(tree, visibleIds) : tree;
  return seedFromUnits(deriveFamilyUnits(source));
}

/**
 * Centers for a seed. `left` and `top` of a family stay put when a family
 * to its right, or a descendant, grows. Only that descendant and the families
 * beside it slide over to make room.
 */
export function placeFamilySkySeed(
  seed: FamilySkySeed,
  sizeOf: (id: string) => BucketSize,
  gap: number,
): { id: string; x: number; y: number }[] {
  const children = new Map<string, SkySeedBucket[]>();
  const satellites = new Map<string, SkySeedBucket[]>();
  const roots: SkySeedBucket[] = [];
  for (const bucket of seed.buckets) {
    if (bucket.place === "child" && bucket.parentId) {
      const list = children.get(bucket.parentId) ?? [];
      list.push(bucket);
      children.set(bucket.parentId, list);
    } else if (bucket.place === "satellite" && bucket.parentId) {
      const list = satellites.get(bucket.parentId) ?? [];
      list.push(bucket);
      satellites.set(bucket.parentId, list);
    } else {
      roots.push(bucket);
    }
  }
  const bySlot = (a: SkySeedBucket, b: SkySeedBucket) => a.slot - b.slot;
  for (const list of children.values()) list.sort(bySlot);
  for (const list of satellites.values()) list.sort(bySlot);
  roots.sort(bySlot);

  const measured = new Map<string, BucketSize>();
  const measure = (id: string): BucketSize => {
    const cached = measured.get(id);
    if (cached) return cached;
    const own = sizeOf(id);
    const kidSizes = (children.get(id) ?? []).map((bucket) => measure(bucket.id));
    const satelliteSizes = (satellites.get(id) ?? []).map((bucket) => measure(bucket.id));
    const kidsW = kidSizes.reduce((sum, size, index) => sum + size.w + (index ? gap : 0), 0);
    const bodyW = Math.max(own.w, kidsW);
    const satellitesW = satelliteSizes.reduce((sum, size, index) => sum + size.w + (index ? gap : 0), 0);
    const kidsH = kidSizes.length ? gap + Math.max(...kidSizes.map((size) => size.h)) : 0;
    const satelliteH = satelliteSizes.length ? Math.max(...satelliteSizes.map((size) => size.h)) : 0;
    const box = {
      w: satellitesW ? bodyW + gap + satellitesW : bodyW,
      h: Math.max(own.h + kidsH, satelliteH),
    };
    measured.set(id, box);
    return box;
  };

  const pos = new Map<string, { x: number; y: number }>();
  const layout = (id: string, left: number, top: number) => {
    const own = sizeOf(id);
    pos.set(id, { x: left + own.w / 2, y: top + own.h / 2 });
    const kids = children.get(id) ?? [];
    const kidsW = kids.reduce((sum, kid, index) => sum + measure(kid.id).w + (index ? gap : 0), 0);
    // A narrower next generation sits under the middle of this family.
    // A wider one stays left-aligned, so this family does not have to move.
    let cursor = left + Math.max(0, (own.w - kidsW) / 2);
    const childTop = top + own.h + gap;
    for (const kid of kids) {
      layout(kid.id, cursor, childTop);
      cursor += measure(kid.id).w + gap;
    }
    const usedW = kids.length ? cursor - gap - left : 0;
    let satelliteX = left + Math.max(own.w, usedW) + gap;
    for (const satellite of satellites.get(id) ?? []) {
      layout(satellite.id, satelliteX, top);
      satelliteX += measure(satellite.id).w + gap;
    }
  };

  let x = 0;
  for (const root of roots) {
    layout(root.id, x, 0);
    x += measure(root.id).w + gap;
  }
  return [...pos.entries()].map(([id, at]) => ({ id, x: at.x, y: at.y }));
}
