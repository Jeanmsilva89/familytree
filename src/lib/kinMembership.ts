import type { KinKind, ParentRole, TreeData } from "./types";
import { kinOf } from "./types";

/**
 * Who a child belongs with. Family buckets and classic household areas both
 * read this, so a step-parent cannot pull a child into a home the other view
 * would refuse.
 *
 * Blood and adopted place a child equally. Foster places them after those.
 * A step link never places a child, and it never counts as a parent when a
 * couple decides whether to share a home. Among placing parents, a mother
 * comes before a parent with no role, before a father, before the parent
 * listed first. An unknown parent is never filled in from a partner.
 */

export type RecordedParent = {
  id: string;
  role?: ParentRole;
  kin: KinKind;
  order: number;
};

/** Blood and adopted place a child. Foster places them only after those. Step is not a rank: it never places. */
const LINE_RANK: Record<Exclude<KinKind, "step">, number> = { blood: 0, adopted: 0, foster: 1 };
const ROLE_RANK = (role?: ParentRole) => (role === "mother" ? 0 : role === "father" ? 2 : 1);

export type KinMembership = {
  /** Known parents on the tree, including step, in the order they were recorded. */
  parentsOf(childId: string): RecordedParent[];
  /** Placing parents, strongest first. */
  placingOf(childId: string): RecordedParent[];
  /** The parent this person follows. Missing when nobody places them. */
  lineParent(childId: string): string | undefined;
  /**
   * The tree says this person's placing parents are not here: an explicit
   * unknown parent, a parent id that names nobody, or only step links.
   * Someone with no child link at all is a root, not an unknown parent.
   */
  parentsUnknown(personId: string): boolean;
  /**
   * True when neither person has a placing child the other is not a placing
   * parent of. A couple that fails this stays two homes, with a partner link
   * between them.
   */
  sharesHome(a: string, b: string): boolean;
  /** Recorded as someone's mother and not also as a father. Step roles still count. */
  isMother(personId: string): boolean;
};

export function kinMembership(tree: TreeData): KinMembership {
  const index = new Map(tree.people.map((person, i) => [person.id, i]));
  const known = (id: string | null | undefined): id is string => typeof id === "string" && index.has(id);
  const parentsOf = new Map<string, RecordedParent[]>();
  const roleSeen = new Map<string, Set<ParentRole>>();
  let order = 0;
  for (const link of tree.childLinks) {
    for (const parentId of link.parentIds) {
      const role = link.roles?.[parentId];
      if (role) roleSeen.set(parentId, new Set([...(roleSeen.get(parentId) ?? []), role]));
      if (!known(link.childId) || !known(parentId) || parentId === link.childId) continue;
      const list = parentsOf.get(link.childId) ?? [];
      if (list.some((parent) => parent.id === parentId)) continue;
      list.push({ id: parentId, role, kin: kinOf(link, parentId), order: order++ });
      parentsOf.set(link.childId, list);
    }
  }

  const placingOf = (childId: string): RecordedParent[] =>
    [...(parentsOf.get(childId) ?? [])]
      .filter((parent): parent is RecordedParent & { kin: Exclude<KinKind, "step"> } => parent.kin !== "step")
      .sort((a, b) => LINE_RANK[a.kin] - LINE_RANK[b.kin] || ROLE_RANK(a.role) - ROLE_RANK(b.role) || a.order - b.order);

  const hasExclusiveChild = (personId: string, otherId: string) => {
    for (const childId of parentsOf.keys()) {
      const placing = placingOf(childId).map((parent) => parent.id);
      if (placing.includes(personId) && !placing.includes(otherId)) return true;
    }
    return false;
  };

  return {
    parentsOf: (childId) => parentsOf.get(childId) ?? [],
    placingOf,
    lineParent: (childId) => placingOf(childId)[0]?.id,
    parentsUnknown: (personId) => parentsAreUnknown(tree, personId),
    sharesHome: (a, b) => !hasExclusiveChild(a, b) && !hasExclusiveChild(b, a),
    isMother: (personId) => {
      const roles = roleSeen.get(personId);
      return Boolean(roles?.has("mother") && !roles.has("father"));
    },
  };
}

/**
 * The person's placing parents are not on the tree, and the tree says so:
 * an explicit unknown parent, a parent id that names nobody, or only step
 * links. A person with no child link at all is a root, not an unknown parent.
 */
export function parentsAreUnknown(tree: TreeData, personId: string): boolean {
  const known = new Set(tree.people.map((person) => person.id));
  let recorded = false;
  let placing = false;
  for (const link of tree.childLinks) {
    if (link.childId !== personId) continue;
    if (link.unknownParents?.length) recorded = true;
    for (const parentId of link.parentIds) {
      if (!known.has(parentId)) {
        recorded = true;
        continue;
      }
      if (parentId === personId) continue;
      if (kinOf(link, parentId) === "step") recorded = true;
      else placing = true;
    }
  }
  return recorded && !placing;
}
