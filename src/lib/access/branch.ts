import type { KinKind, TreeData } from "../types";
import { kinOf } from "../types";
import { asPersonId, type PersonId, type TreeId } from "./ids";

/**
 * A branch is the root, the people reached downward by a line link, and the
 * partners of those people. It is derived from the graph. Nothing here is stored.
 *
 * Line links are blood, adopted, and foster. A missing kin kind is blood, matching
 * `kinOf`. Step links are not line links.
 *
 * In the branch:
 * - the root
 * - descendants through blood, adopted, or foster
 * - partners of the root and of those descendants, for every union kind,
 *   including separated
 *
 * Out of the branch:
 * - step-children and step-parents
 * - ancestors, siblings, and half-siblings (they belong to the parent's branch)
 * - a partner's child who is not also a descendant of the root
 * - a co-parent who has a child link but no union
 * - a parent who is not on the tree. No placeholder person is created.
 *
 * Parent role is ignored, so two mothers or two fathers are symmetric.
 * If a person is reached by both foster and blood or adopted, the blood or
 * adopted tie is the one kept.
 */
export type BranchTie =
  | { kind: "root" }
  | { kind: "partner"; viaPersonId: PersonId; unionId: string }
  | { kind: "descendant"; viaParentId: PersonId; kin: Exclude<KinKind, "step">; depth: number }
  | { kind: "descendant-partner"; viaPersonId: PersonId; unionId: string };

export type BranchMember = {
  personId: PersonId;
  tie: BranchTie;
};

export type Branch = {
  treeId: TreeId;
  rootId: PersonId;
  /** Tree order. */
  members: BranchMember[];
};

const LINE_STRENGTH: Record<Exclude<KinKind, "step">, number> = {
  blood: 2,
  adopted: 2,
  foster: 1,
};

export function deriveBranch(treeId: TreeId, tree: TreeData, rootId: PersonId): Branch {
  const index = new Map(tree.people.map((person, i) => [person.id, i]));
  if (!index.has(rootId)) return { treeId, rootId, members: [] };

  const ties = new Map<string, BranchTie>();
  const depth = new Map<string, number>([[rootId, 0]]);
  const descendants = new Set<string>([rootId]);
  ties.set(rootId, { kind: "root" });

  const queue = [rootId as string];
  while (queue.length) {
    const id = queue.shift()!;
    const parentDepth = depth.get(id) ?? 0;
    for (const link of tree.childLinks) {
      if (!link.parentIds.includes(id) || !index.has(link.childId)) continue;
      const kin = kinOf(link, id);
      if (kin !== "blood" && kin !== "adopted" && kin !== "foster") continue;
      const next: BranchTie = {
        kind: "descendant",
        viaParentId: asPersonId(id),
        kin,
        depth: parentDepth + 1,
      };
      const prev = ties.get(link.childId);
      if (!prev) {
        ties.set(link.childId, next);
        depth.set(link.childId, parentDepth + 1);
        descendants.add(link.childId);
        queue.push(link.childId);
        continue;
      }
      if (prev.kind === "descendant" && LINE_STRENGTH[kin] > LINE_STRENGTH[prev.kin]) {
        ties.set(link.childId, next);
        depth.set(link.childId, parentDepth + 1);
      }
    }
  }

  for (const id of descendants) {
    for (const union of tree.unions) {
      if (!union.partnerIds.includes(id)) continue;
      for (const partnerId of union.partnerIds) {
        if (partnerId === id || !index.has(partnerId) || ties.has(partnerId)) continue;
        ties.set(partnerId, {
          kind: id === rootId ? "partner" : "descendant-partner",
          viaPersonId: asPersonId(id),
          unionId: union.id,
        });
      }
    }
  }

  const members = [...ties.entries()]
    .sort((a, b) => index.get(a[0])! - index.get(b[0])!)
    .map(([personId, tie]) => ({ personId: asPersonId(personId), tie }));

  return { treeId, rootId, members };
}
