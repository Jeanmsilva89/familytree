import { kinMembership, type KinMembership } from "./kinMembership";
import { treeForLens } from "./visibleTree";
import type { KinKind, Person, TreeData, Union } from "./types";
import { strongestKin } from "./types";

/**
 * A household is a couple, or one parent, plus the children who still live
 * there. Membership is the same rule as a Families bucket: blood, adopted,
 * and foster place a child, and a step link does not. A couple shares a
 * household only when neither partner has a placing child the other is not
 * a parent of. Otherwise each keeps their own household, and the step-child
 * stays in their parent's.
 *
 * Households are derived, never stored: `deriveHouseholds` is a pure function
 * of the people, unions and child links already on the tree. Pass `visibleIds`
 * to drop everyone a lens has hidden before any household is shaped.
 */
export type Household = {
  id: string;
  /** The couple union this household grew from. Missing for a single parent. */
  unionId?: string;
  /** One or two adults who head the household, in union order. */
  headIds: string[];
  /** Children of a head who do not head a household of their own, oldest first. */
  childIds: string[];
  /** Quiet label such as "Jon & Lena", or "Parents unknown" for a household of one. */
  label: string;
  /** Every member's placing parents are absent, and the tree says so. */
  parentsUnknown?: boolean;
};

export type HouseholdLinkKind =
  /** `personId` grew up in `fromId` (a head there is their parent) and now lives in `toId`. */
  | "child"
  /** `personId` shares a child with a head of `toId` but is not a head there. */
  | "coparent"
  /** `personId` has another recorded couple union with a head of `toId`. */
  | "partner"
  /** `personId` is a step-child. The link connects the homes. It does not share them. */
  | "step";

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

function kinBetween(membership: KinMembership, childId: string, parentId: string): KinKind {
  return membership.parentsOf(childId).find((parent) => parent.id === parentId)?.kin ?? "blood";
}

export function deriveHouseholds(tree: TreeData, visibleIds?: ReadonlySet<string>): Households {
  const source = visibleIds ? treeForLens(tree, visibleIds) : tree;
  const people = new Map(source.people.map((p) => [p.id, p]));
  const known = (id: string) => people.has(id);
  const membership = kinMembership(source);
  const households: Household[] = [];
  const headOf = new Map<string, Household>();

  const ensure = (id: string) => {
    const existing = headOf.get(id);
    if (existing) return existing;
    const household: Household = { id: `hh-solo-${id}`, headIds: [id], childIds: [], label: "" };
    households.push(household);
    headOf.set(id, household);
    return household;
  };

  // Id order, not the saved array. Two devices that added the same people
  // in a different sequence still build the same households.
  const peopleInOrder = [...source.people].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 1. Couples who share a home. A step boundary keeps the partners apart.
  //    A person heads at most one household; married beats partnered, then
  //    more shared placing children, then the more recently recorded union.
  const unionIndex = new Map(source.unions.map((u, i) => [u.id, i]));
  const sharedKids = (union: Union) => {
    const partners = [...new Set(union.partnerIds.filter(known))];
    if (partners.length < 2) return 0;
    let count = 0;
    for (const person of peopleInOrder) {
      const placing = new Set(membership.placingOf(person.id).map((parent) => parent.id));
      if (partners.every((id) => placing.has(id))) count += 1;
    }
    return count;
  };
  const couples = source.unions
    .filter((union) => isCoupleKind(union) && new Set(union.partnerIds.filter(known)).size >= 2)
    .filter((union) => {
      const partners = [...new Set(union.partnerIds.filter(known))];
      return partners.length >= 2 && membership.sharesHome(partners[0], partners[1]);
    })
    .map((union) => ({ union, kids: sharedKids(union), married: union.kind === "married" ? 1 : 0 }))
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

  // 2. A line parent heads a home when nobody else already does. That is true
  //    for a child still at home, and for a grown child whose parents are a
  //    household the child has left. The parent is the line parent, never a
  //    step-parent and never whichever parent has more children.
  for (const person of peopleInOrder) {
    const parentId = membership.lineParent(person.id);
    if (!parentId || headOf.has(parentId)) continue;
    ensure(parentId);
  }

  // 3. Someone whose parents are unknown heads a household of one. A current
  //    partner who does not share the other household does too, so the
  //    step-parent has an area the step-child is not inside. A divorced or
  //    separated parent whose child lives with the other parent does too.
  for (const person of peopleInOrder) {
    if (headOf.has(person.id)) continue;
    if (membership.parentsUnknown(person.id)) ensure(person.id);
  }
  for (const person of peopleInOrder) {
    if (headOf.has(person.id)) continue;
    const current = source.unions.some(
      (union) =>
        isCoupleKind(union) &&
        union.partnerIds.includes(person.id) &&
        union.partnerIds.some((id) => id !== person.id && known(id)),
    );
    if (current) ensure(person.id);
  }
  for (const union of source.unions) {
    if (union.kind !== "divorced" && union.kind !== "separated") continue;
    const partners = [...new Set(union.partnerIds.filter(known))];
    if (partners.length < 2) continue;
    const sharedChild = peopleInOrder.some((person) => {
      const placing = membership.placingOf(person.id).map((parent) => parent.id);
      return partners.every((id) => placing.includes(id));
    });
    if (!sharedChild) continue;
    for (const id of partners) if (!headOf.has(id)) ensure(id);
  }

  // 4. A person who heads nothing lives with their line parent.
  const homeOf: Record<string, string> = {};
  for (const household of households) for (const id of household.headIds) homeOf[id] = household.id;
  for (const person of peopleInOrder) {
    if (headOf.has(person.id)) continue;
    const parentId = membership.lineParent(person.id);
    const household = parentId ? headOf.get(parentId) : undefined;
    if (!household) continue;
    household.childIds.push(person.id);
    homeOf[person.id] = household.id;
  }
  for (const household of households) {
    household.childIds.sort((a, b) => byBirthThenName(people.get(a)!, people.get(b)!));
    const members = [...household.headIds, ...household.childIds];
    household.parentsUnknown = members.length > 0 && members.every((id) => membership.parentsUnknown(id));
    household.label =
      household.parentsUnknown && members.length === 1
        ? "Parents unknown"
        : household.headIds.map((id) => people.get(id)!.givenName.trim() || "?").join(" & ");
  }

  const loose = peopleInOrder.map((person) => person.id).filter((id) => !homeOf[id]);

  // 5. Links between households. A step link connects the homes and does not merge them.
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
    for (const parent of membership.parentsOf(person.id)) {
      if (parent.kin === "step") {
        const fromId = homeOf[parent.id];
        if (fromId && fromId !== toId && headOf.has(parent.id)) {
          push({ kind: "step", fromId, toId, personId: person.id, kin: "step" });
        }
        continue;
      }
      const fromId = homeOf[parent.id];
      if (!fromId || fromId === toId || !headOf.has(parent.id)) continue;
      byHousehold.set(fromId, [...(byHousehold.get(fromId) ?? []), parent.id]);
    }
    for (const [fromId, parents] of byHousehold) {
      push({
        kind: "child",
        fromId,
        toId,
        personId: person.id,
        kin: strongestKin(parents.map((parentId) => kinBetween(membership, person.id, parentId))),
      });
    }
  }
  for (const person of peopleInOrder) {
    if (headOf.has(person.id)) continue;
    for (const child of peopleInOrder) {
      const parent = membership.parentsOf(child.id).find((item) => item.id === person.id);
      if (!parent || parent.kin === "step") continue;
      const toId = homeOf[child.id];
      if (!toId || toId === homeOf[person.id]) continue;
      push({ kind: "coparent", fromId: homeOf[person.id], toId, personId: person.id, kin: parent.kin });
    }
  }
  for (const union of source.unions) {
    const partners = [...new Set(union.partnerIds.filter(known))];
    if (partners.length < 2) continue;
    if (households.some((household) => household.unionId === union.id)) continue;
    for (const a of partners) {
      for (const b of partners) {
        if (a === b || !headOf.has(b)) continue;
        const toId = homeOf[b];
        if (homeOf[a] === toId) continue;
        if (links.some((link) => link.kind === "coparent" && link.personId === a && link.toId === toId)) continue;
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
