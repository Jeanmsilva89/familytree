import type { KinKind, Person, TreeData, Union } from "./types";
import { kinOf, strongestKin } from "./types";

/**
 * A household is a couple (a married or partnered union), or a single parent,
 * plus their children who do not yet have a household of their own.
 *
 * Households are derived, never stored: `deriveHouseholds` is a pure function
 * of the people, unions and child links already on the tree.
 */
export type Household = {
  id: string;
  /** The couple union this household grew from. Missing for a single parent. */
  unionId?: string;
  /** One or two adults who head the household, in union order. */
  headIds: string[];
  /** Children of a head who do not head a household of their own, oldest first. */
  childIds: string[];
  /** Quiet label such as "Jon & Lena". */
  label: string;
};

export type HouseholdLinkKind =
  /** `personId` grew up in `fromId` (a head there is their parent) and now lives in `toId`. */
  | "child"
  /** `personId` shares a child with a head of `toId` but is not a head there. */
  | "coparent"
  /** `personId` has another recorded couple union with a head of `toId`. */
  | "partner";

export type HouseholdLink = {
  id: string;
  kind: HouseholdLinkKind;
  /** Household `personId` comes from. Missing when that person has no household. */
  fromId?: string;
  toId: string;
  personId: string;
  kin: KinKind;
};

export type Households = {
  households: Household[];
  links: HouseholdLink[];
  /** People who head no household and are no one's child at home. */
  loose: string[];
  /** Person id → household id, for heads and children alike. */
  homeOf: Record<string, string>;
};

const isCoupleKind = (union: Union) => union.kind === "married" || union.kind === "partnered";

function byBirthThenName(a: Person, b: Person): number {
  const ad = a.birthDate ?? "9999-99-99";
  const bd = b.birthDate ?? "9999-99-99";
  if (ad !== bd) return ad.localeCompare(bd);
  return a.givenName.localeCompare(b.givenName) || a.id.localeCompare(b.id);
}

export function deriveHouseholds(tree: TreeData): Households {
  const people = new Map(tree.people.map((p) => [p.id, p]));
  const order = new Map(tree.people.map((p, i) => [p.id, i]));
  const known = (id: string) => people.has(id);

  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const kinOfPair = new Map<string, KinKind>();
  for (const link of tree.childLinks) {
    if (!known(link.childId)) continue;
    for (const parentId of link.parentIds) {
      if (!known(parentId) || parentId === link.childId) continue;
      const ps = parentsOf.get(link.childId) ?? [];
      if (!ps.includes(parentId)) ps.push(parentId);
      parentsOf.set(link.childId, ps);
      const cs = childrenOf.get(parentId) ?? [];
      if (!cs.includes(link.childId)) cs.push(link.childId);
      childrenOf.set(parentId, cs);
      kinOfPair.set(`${link.childId}|${parentId}`, kinOf(link, parentId));
    }
  }
  const parents = (id: string) => parentsOf.get(id) ?? [];
  const children = (id: string) => childrenOf.get(id) ?? [];
  const kin = (childId: string, parentId: string): KinKind => kinOfPair.get(`${childId}|${parentId}`) ?? "blood";

  const households: Household[] = [];
  const headOf = new Map<string, Household>();

  // 1. Couples. A person heads at most one household; married beats partnered,
  //    then more shared children, then the more recently recorded union.
  const unionIndex = new Map(tree.unions.map((u, i) => [u.id, i]));
  const sharedKids = (union: Union) => {
    const partners = union.partnerIds.filter(known);
    return new Set(
      tree.childLinks
        .filter(
          (l) =>
            known(l.childId) &&
            (l.unionId === union.id || (partners.length > 1 && partners.every((p) => l.parentIds.includes(p)))),
        )
        .map((l) => l.childId),
    ).size;
  };
  const couples = tree.unions
    .filter((u) => isCoupleKind(u) && new Set(u.partnerIds.filter(known)).size >= 2)
    .map((u) => ({ union: u, kids: sharedKids(u), married: u.kind === "married" ? 1 : 0 }))
    .sort(
      (a, b) =>
        b.married - a.married || b.kids - a.kids || unionIndex.get(b.union.id)! - unionIndex.get(a.union.id)!,
    );
  for (const { union } of couples) {
    const heads = [...new Set(union.partnerIds.filter(known))];
    if (heads.some((id) => headOf.has(id))) continue;
    const household: Household = { id: `hh-${union.id}`, unionId: union.id, headIds: heads, childIds: [], label: "" };
    households.push(household);
    for (const id of heads) headOf.set(id, household);
  }

  // 2. Children whose parents head no couple household pick one "home parent".
  //    That parent heads a single-parent household. Prefer a parent who already
  //    heads one, then the parent with more children, then one whose own
  //    parents are on the tree, then the parent listed first.
  const peopleInOrder = [...tree.people].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const homeParent = new Map<string, string>();
  for (const person of peopleInOrder) {
    const ps = parents(person.id);
    if (!ps.length || ps.some((p) => headOf.has(p))) continue;
    const ranked = [...ps].sort((a, b) => {
      const aSolo = [...homeParent.values()].includes(a) ? 1 : 0;
      const bSolo = [...homeParent.values()].includes(b) ? 1 : 0;
      if (aSolo !== bSolo) return bSolo - aSolo;
      if (children(a).length !== children(b).length) return children(b).length - children(a).length;
      const aUp = parents(a).length ? 1 : 0;
      const bUp = parents(b).length ? 1 : 0;
      if (aUp !== bUp) return bUp - aUp;
      return ps.indexOf(a) - ps.indexOf(b);
    });
    homeParent.set(person.id, ranked[0]);
  }
  for (const person of peopleInOrder) {
    const parentId = homeParent.get(person.id);
    if (!parentId || headOf.has(parentId)) continue;
    const household: Household = { id: `hh-solo-${parentId}`, headIds: [parentId], childIds: [], label: "" };
    households.push(household);
    headOf.set(parentId, household);
  }

  // 3. Everyone who heads nothing lives with a parent who heads a household:
  //    the one where most of their parents are heads, then blood over step,
  //    then the household found first.
  const homeOf: Record<string, string> = {};
  for (const household of households) for (const id of household.headIds) homeOf[id] = household.id;
  for (const person of peopleInOrder) {
    if (headOf.has(person.id)) continue;
    const candidates = new Map<string, { household: Household; count: number; blood: number }>();
    for (const parentId of parents(person.id)) {
      const household = headOf.get(parentId);
      if (!household) continue;
      const entry = candidates.get(household.id) ?? { household, count: 0, blood: 0 };
      entry.count += 1;
      if (kin(person.id, parentId) === "blood") entry.blood += 1;
      candidates.set(household.id, entry);
    }
    const best = [...candidates.values()].sort(
      (a, b) =>
        b.count - a.count || b.blood - a.blood || households.indexOf(a.household) - households.indexOf(b.household),
    )[0];
    if (!best) continue;
    best.household.childIds.push(person.id);
    homeOf[person.id] = best.household.id;
  }
  for (const household of households) {
    household.childIds.sort((a, b) => byBirthThenName(people.get(a)!, people.get(b)!));
    household.label = household.headIds.map((id) => people.get(id)!.givenName.trim() || "?").join(" & ");
  }

  const loose = peopleInOrder.map((p) => p.id).filter((id) => !homeOf[id]);

  // 4. Links between households.
  const links: HouseholdLink[] = [];
  const seen = new Set<string>();
  const push = (link: Omit<HouseholdLink, "id">) => {
    const id = `${link.kind}:${link.fromId ?? "-"}>${link.toId}:${link.personId}`;
    if (seen.has(id)) return;
    seen.add(id);
    links.push({ id, ...link });
  };
  for (const person of peopleInOrder) {
    const toId = homeOf[person.id];
    if (!toId) continue;
    const byHousehold = new Map<string, string[]>();
    for (const parentId of parents(person.id)) {
      const fromId = homeOf[parentId];
      if (!fromId || fromId === toId || !headOf.has(parentId)) continue;
      byHousehold.set(fromId, [...(byHousehold.get(fromId) ?? []), parentId]);
    }
    for (const [fromId, ps] of byHousehold) {
      push({ kind: "child", fromId, toId, personId: person.id, kin: strongestKin(ps.map((p) => kin(person.id, p))) });
    }
  }
  for (const person of peopleInOrder) {
    if (headOf.has(person.id)) continue;
    for (const childId of children(person.id)) {
      const toId = homeOf[childId];
      if (!toId || toId === homeOf[person.id]) continue;
      push({ kind: "coparent", fromId: homeOf[person.id], toId, personId: person.id, kin: kin(childId, person.id) });
    }
  }
  for (const union of tree.unions) {
    const partners = [...new Set(union.partnerIds.filter(known))];
    if (partners.length < 2) continue;
    if (households.some((h) => h.unionId === union.id)) continue;
    for (const a of partners) {
      for (const b of partners) {
        if (a === b || !headOf.has(b)) continue;
        const toId = homeOf[b];
        if (homeOf[a] === toId) continue;
        if (links.some((l) => l.kind === "coparent" && l.personId === a && l.toId === toId)) continue;
        push({ kind: "partner", fromId: homeOf[a], toId, personId: a, kin: "blood" });
      }
    }
  }

  return { households, links, loose, homeOf };
}

export function householdOfPerson(result: Households, personId: string): Household | undefined {
  const id = result.homeOf[personId];
  return id ? result.households.find((h) => h.id === id) : undefined;
}

/** Parent households of `householdId`: households one of its heads grew up in. */
export function parentHouseholds(result: Households, householdId: string): Household[] {
  const household = result.households.find((h) => h.id === householdId);
  if (!household) return [];
  const fromIds = result.links
    .filter((l) => l.kind === "child" && l.toId === householdId && household.headIds.includes(l.personId))
    .map((l) => l.fromId!);
  return result.households.filter((h) => fromIds.includes(h.id));
}

/** Households whose heads grew up in the same parent household as one of this household's heads. */
export function siblingHouseholds(result: Households, householdId: string): Household[] {
  const parentIds = new Set(parentHouseholds(result, householdId).map((h) => h.id));
  return result.households.filter(
    (h) => h.id !== householdId && parentHouseholds(result, h.id).some((p) => parentIds.has(p.id)),
  );
}
