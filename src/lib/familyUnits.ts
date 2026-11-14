import { kinMembership, parentsAreUnknown } from "./kinMembership";
import type { FamilyUnitOverride, KinKind, TreeData, Union } from "./types";

export { parentsAreUnknown };

/**
 * Family units are the "buckets" of the family sky: each person belongs to
 * exactly one unit, derived from the tree by the maternal rule below and then
 * adjusted by manual overrides. Nothing here is stored except the overrides.
 *
 * The maternal rule, applied to every person:
 *
 * 1. Couple. A person's couple is their strongest married or partnered union
 *    (married beats partnered, then more shared children, then the more
 *    recently recorded union). Separated, divorced, and unspecified unions
 *    are not couples, so a former couple keeps two units. A divorced union
 *    still draws a quiet line between those people. A separation does not.
 * 2. Anchor. In a couple, the woman anchors: her partner joins her unit. A
 *    person counts as a woman only when the tree records them as someone's
 *    mother. When that does not decide it (two women, two men, or no roles
 *    recorded), the partner whose own parent is on the tree anchors, and if
 *    both or neither have one, the partner listed first in the union does.
 *    The join is refused when either partner has a placing child the other
 *    is not a placing parent of. Those two stay in their own families, with
 *    a partner link between the buckets. A remarriage does not pull a child
 *    into a step-parent's bucket, and it does not pull the step-parent into
 *    the child's. An unknown parent is never filled in from a partner.
 * 3. Parents. Someone who is not joining a partner joins their line parent.
 *    The order, and the rule that a couple does not share a home across a
 *    step boundary, live in `kinMembership`. Classic household areas use that
 *    same function. Which parent links pull a child into a parent's bucket,
 *    strongest first:
 *    blood and adopted are equal, then foster. A step link never does. Among
 *    equal links, the mother comes before a parent with no role, before the
 *    father, before the parent listed first. Role is the recorded parent
 *    role, not a gender; two mothers, or two fathers, use the same rule.
 *    A missing kin kind is blood, so a backup from before kin kinds still
 *    places that child with that parent.
 *    Step alone never places someone in a bucket, and it never counts as
 *    that person having a parent on the tree when a couple needs an anchor.
 *    Foster does place the child, and it does count as family for that
 *    anchor, but it loses to a blood or adopted parent. The line drawn for
 *    a foster child stays foster. Foster is a real placing relationship:
 *    the child sits with the foster parent, and a spouse who is not also a
 *    placing parent does not share that bucket.
 *    A step-only child, or a child whose parents are unknown or not on the
 *    tree, heads their own unit (with their partner, if they have one) and
 *    the step link is drawn between buckets. Membership never walks a
 *    partner edge to invent a parent.
 *    Children follow their mother, daughters stay with their family, a son
 *    who marries out goes with his wife when every child is a child of both,
 *    and a single son stays with his parents. That maternal placement still
 *    wins over a step link.
 * 4. Root. Someone with no anchoring partner and no line parent heads a unit.
 *    The unit is named after them and their couple partner.
 *
 * Overrides then point a person at another person's unit (or at a unit of
 * their own). Everyone who belongs through that person moves with them, and
 * a person who had joined their partner's unit brings that household (the
 * partner and the children who follow them) along, unless the partner has an
 * override of their own. A unit of their own splits off just the person. An
 * override naming someone not on the tree, or one that would loop back
 * through the person, is ignored and reported.
 */

export type JoinReason =
  | { kind: "root" }
  | { kind: "partner"; personId: string }
  | { kind: "parent"; personId: string }
  /** Moved by an override; `by` names the partner whose override carried this household along. */
  | { kind: "override"; personId: string; by?: string }
  | { kind: "own" };

export type FamilyUnit = {
  id: string;
  /** The person the unit is derived from. */
  rootId: string;
  /** The root, then the root's couple partner when they share the unit. */
  headIds: string[];
  /** Everyone in the unit, in tree order. */
  memberIds: string[];
  /** Quiet label such as "Cora & Carl". */
  label: string;
};

export type UnitLinkKind = KinKind | "partner" | "divorced";

/** A person-to-person tie that crosses from one unit into another. */
export type UnitLink = {
  id: string;
  kind: UnitLinkKind;
  /** The parent (or the first listed partner). */
  fromPersonId: string;
  /** The child (or the other partner). */
  toPersonId: string;
  fromUnitId: string;
  toUnitId: string;
};

export type FamilyUnits = {
  units: FamilyUnit[];
  /** Person id → unit id. */
  unitOf: Record<string, string>;
  /** Why each person is in their unit. */
  via: Record<string, JoinReason>;
  links: UnitLink[];
  ignoredOverrides: FamilyUnitOverride[];
};

export const unitIdFor = (rootId: string) => `fu-${rootId}`;

export function deriveFamilyUnits(tree: TreeData, overrides?: FamilyUnitOverride[]): FamilyUnits {
  const index = new Map(tree.people.map((p, i) => [p.id, i]));
  const known = (id: string | null | undefined): id is string => typeof id === "string" && index.has(id);
  const membership = kinMembership(tree);
  const isMother = membership.isMother;
  const lineParent = membership.lineParent;

  // 1. Each person's couple.
  const unionIndex = new Map(tree.unions.map((u, i) => [u.id, i]));
  const sharedKids = (a: string, b: string) =>
    new Set(
      tree.childLinks.filter((l) => l.parentIds.includes(a) && l.parentIds.includes(b)).map((l) => l.childId),
    ).size;
  const coupleOf = new Map<string, { partnerId: string; union: Union }>();
  for (const person of tree.people) {
    const options = tree.unions
      .filter((u) => (u.kind === "married" || u.kind === "partnered") && u.partnerIds.includes(person.id))
      .map((union) => ({ union, partnerId: union.partnerIds.find((id) => id !== person.id && known(id)) }))
      .filter((o): o is { union: Union; partnerId: string } => Boolean(o.partnerId))
      .sort(
        (a, b) =>
          (b.union.kind === "married" ? 1 : 0) - (a.union.kind === "married" ? 1 : 0) ||
          sharedKids(person.id, b.partnerId) - sharedKids(person.id, a.partnerId) ||
          unionIndex.get(b.union.id)! - unionIndex.get(a.union.id)!,
      );
    if (options[0]) coupleOf.set(person.id, options[0]);
  }

  // 2. Who anchors a couple. A placing child of only one partner is a step
  // boundary: walking the partner edge would put that child in the other bucket.
  const anchorOf = (union: Union, a: string, b: string): string => {
    const [first, second] = union.partnerIds.indexOf(a) <= union.partnerIds.indexOf(b) ? [a, b] : [b, a];
    const firstMother = isMother(first);
    const secondMother = isMother(second);
    if (firstMother !== secondMother) return firstMother ? first : second;
    const firstUp = Boolean(lineParent(first));
    const secondUp = Boolean(lineParent(second));
    if (firstUp !== secondUp) return firstUp ? first : second;
    return first;
  };

  // 3. Base pointers: each person joins a partner, a parent, or heads a unit.
  const via = new Map<string, JoinReason>();
  for (const person of tree.people) {
    const couple = coupleOf.get(person.id);
    if (couple && anchorOf(couple.union, person.id, couple.partnerId) === couple.partnerId) {
      const blended = !membership.sharesHome(person.id, couple.partnerId);
      if (!blended) {
        via.set(person.id, { kind: "partner", personId: couple.partnerId });
        continue;
      }
    }
    const parent = lineParent(person.id);
    via.set(person.id, parent ? { kind: "parent", personId: parent } : { kind: "root" });
  }
  const next = (id: string): string | undefined => {
    const reason = via.get(id)!;
    return "personId" in reason ? reason.personId : undefined;
  };

  // Broken data can loop (someone recorded as their own ancestor). Break each
  // loop at the person who comes first on the tree.
  const state = new Map<string, 1 | 2>();
  for (const person of tree.people) {
    const path: string[] = [];
    let cur: string | undefined = person.id;
    while (cur && !state.has(cur)) {
      state.set(cur, 1);
      path.push(cur);
      cur = next(cur);
    }
    if (cur && state.get(cur) === 1) {
      const loop = path.slice(path.indexOf(cur));
      const first = loop.reduce((a, b) => (index.get(a)! <= index.get(b)! ? a : b));
      via.set(first, { kind: "root" });
    }
    for (const id of path) state.set(id, 2);
  }

  // 4. Overrides, last one per person wins; drop any that would loop.
  const requested = overrides ?? tree.familyUnitOverrides ?? [];
  const latest = new Map<string, FamilyUnitOverride>();
  for (const item of requested) latest.set(item.personId, item);
  const ignored: FamilyUnitOverride[] = [];
  const reaches = (from: string, target: string) => {
    let cur: string | undefined = from;
    for (let guard = 0; cur && guard <= tree.people.length; guard++) {
      if (cur === target) return true;
      cur = next(cur);
    }
    return false;
  };
  // A move takes the person's household along: someone who joined their
  // partner's unit moves by moving that partner (unless the partner has an
  // override of their own), so the couple and their children stay together.
  const base = new Map(via);
  for (const item of requested) {
    if (latest.get(item.personId) !== item) continue;
    if (!known(item.personId) || (item.unitOf !== null && !known(item.unitOf))) {
      ignored.push(item);
      continue;
    }
    if (item.unitOf === null) {
      via.set(item.personId, { kind: "own" });
      continue;
    }
    const joined = base.get(item.personId)!;
    const carrier =
      joined.kind === "partner" && !latest.has(joined.personId) ? joined.personId : undefined;
    const subject = carrier ?? item.personId;
    if (reaches(item.unitOf, subject) || reaches(item.unitOf, item.personId)) {
      ignored.push(item);
      continue;
    }
    via.set(subject, carrier
      ? { kind: "override", personId: item.unitOf, by: item.personId }
      : { kind: "override", personId: item.unitOf });
  }

  // 5. Resolve every person to the root of their unit.
  const rootOf = new Map<string, string>();
  const resolve = (id: string): string => {
    const chain: string[] = [];
    let cur = id;
    while (!rootOf.has(cur)) {
      chain.push(cur);
      const n = next(cur);
      if (!n) {
        rootOf.set(cur, cur);
        break;
      }
      cur = n;
    }
    const root = rootOf.get(cur)!;
    for (const c of chain) rootOf.set(c, root);
    return root;
  };
  const members = new Map<string, string[]>();
  for (const person of tree.people) {
    const root = resolve(person.id);
    members.set(root, [...(members.get(root) ?? []), person.id]);
  }

  const nameOf = (id: string) => tree.people[index.get(id)!].givenName.trim() || "?";
  const units: FamilyUnit[] = [...members.entries()]
    .sort(([a], [b]) => index.get(a)! - index.get(b)!)
    .map(([rootId, memberIds]) => {
      const partner = coupleOf.get(rootId)?.partnerId;
      const headIds = partner && rootOf.get(partner) === rootId ? [rootId, partner] : [rootId];
      return { id: unitIdFor(rootId), rootId, headIds, memberIds, label: headIds.map(nameOf).join(" & ") };
    });
  const unitOf: Record<string, string> = {};
  for (const unit of units) for (const id of unit.memberIds) unitOf[id] = unit.id;

  // 6. Person-to-person links between units.
  const links: UnitLink[] = [];
  const seen = new Set<string>();
  const push = (kind: UnitLinkKind, fromPersonId: string, toPersonId: string) => {
    const fromUnitId = unitOf[fromPersonId];
    const toUnitId = unitOf[toPersonId];
    if (fromUnitId === toUnitId) return;
    const id = `${kind}:${fromPersonId}>${toPersonId}`;
    if (seen.has(id)) return;
    seen.add(id);
    links.push({ id, kind, fromPersonId, toPersonId, fromUnitId, toUnitId });
  };
  for (const person of tree.people) {
    for (const parent of membership.parentsOf(person.id)) push(parent.kin, parent.id, person.id);
  }
  for (const union of tree.unions) {
    // Separated is two households and draws no couple line. Divorce is the
    // same for membership, and still draws a quiet line of its own.
    if (union.kind === "separated") continue;
    const linkKind: UnitLinkKind = union.kind === "divorced" ? "divorced" : "partner";
    const partners = [...new Set(union.partnerIds.filter(known))];
    for (let i = 0; i < partners.length; i++) {
      for (let j = i + 1; j < partners.length; j++) {
        const [a, b] = [partners[i], partners[j]];
        if (seen.has(`${linkKind}:${b}>${a}`)) continue;
        push(linkKind, a, b);
      }
    }
  }

  const viaOut: Record<string, JoinReason> = {};
  for (const person of tree.people) viaOut[person.id] = via.get(person.id)!;
  return { units, unitOf, via: viaOut, links, ignoredOverrides: ignored };
}

export function unitOfPerson(result: FamilyUnits, personId: string): FamilyUnit | undefined {
  const id = result.unitOf[personId];
  return id ? result.units.find((u) => u.id === id) : undefined;
}

/**
 * Who moves along when `personId` is moved to another unit: everyone whose
 * unit runs through them, or, when they joined their partner's unit, through
 * that partner. The person themself is not included.
 */
export function movesWith(tree: TreeData, personId: string): string[] {
  const result = deriveFamilyUnits(tree);
  const joined = result.via[personId];
  const partnerId = joined?.kind === "partner" ? joined.personId : undefined;
  const partnerOverride = (tree.familyUnitOverrides ?? []).some((o) => o.personId === partnerId);
  const carrier = partnerId && !partnerOverride ? partnerId : personId;
  const through = (id: string) => {
    for (let cur: string | undefined = id, guard = 0; cur && guard <= tree.people.length; guard++) {
      if (cur === carrier) return true;
      const reason: JoinReason | undefined = result.via[cur];
      cur = reason && "personId" in reason ? reason.personId : undefined;
    }
    return false;
  };
  return tree.people.map((p) => p.id).filter((id) => id !== personId && through(id));
}

/** Set (`{ unitOf }`) or clear (`"auto"`) one person's family-unit override. */
export function applyFamilyUnitOverride(
  tree: TreeData,
  personId: string,
  choice: { unitOf: string | null } | "auto",
): TreeData {
  const rest = (tree.familyUnitOverrides ?? []).filter((o) => o.personId !== personId);
  const nextOverrides = choice === "auto" ? rest : [...rest, { personId, unitOf: choice.unitOf }];
  const { familyUnitOverrides: _drop, ...base } = tree;
  void _drop;
  return nextOverrides.length ? { ...base, familyUnitOverrides: nextOverrides } : base;
}
