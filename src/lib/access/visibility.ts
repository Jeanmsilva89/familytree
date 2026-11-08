import { deriveBranch } from "./branch";
import { asTreeId } from "./ids";
import { exposeLink } from "./link";
import { graphAmong, personKey, type DetailLevel, type Presence } from "./present";
import {
  emptyGraph,
  sameViewer,
  type AccessState,
  type Forest,
  type LensEffect,
  type Viewer,
  type VisibilityLens,
  type VisibleGraph,
} from "./types";

/**
 * Resolves the people a viewer can see.
 *
 * Private by default. A member sees a person only when a lens rule includes
 * them, and only from their own tree or from an accepted link aimed at them.
 * A guest starts from the people that accepted invite grants, and a lens can
 * hide or dim inside that set. A lens arranged for someone else is ignored.
 * A sealed person is skipped by branch rules and revealed by a person rule
 * on their own tree, or by an explicit person grant on a link.
 *
 * Living details stay withheld unless the viewer is that person, a detail
 * grant names them, or they are marked deceased.
 */

type Candidate = { treeId: string; personId: string; sealed: boolean };

function aimsAt(link: { status: string; id: string; sourceTreeId: string; targetTreeId: string; inviteePersonId?: string }, viewer: Viewer): boolean {
  if (link.status !== "accepted") return false;
  if (viewer.kind === "guest") return link.id === viewer.inviteId && link.sourceTreeId === viewer.treeId;
  return link.targetTreeId === viewer.treeId || link.inviteePersonId === viewer.personId;
}

function poolFor(forest: Forest, access: AccessState, viewer: Viewer): Map<string, Candidate> {
  const pool = new Map<string, Candidate>();
  if (viewer.kind === "member") {
    const tree = forest[viewer.treeId];
    if (tree) {
      for (const person of tree.people) {
        pool.set(personKey(viewer.treeId, person.id), {
          treeId: viewer.treeId,
          personId: person.id,
          sealed: access.sealedPersonIds.some((row) => row.treeId === viewer.treeId && row.personId === person.id),
        });
      }
    }
  }
  for (const link of access.links) {
    if (!aimsAt(link, viewer)) continue;
    const exposed = exposeLink(forest, access, link);
    for (const person of exposed.people) {
      pool.set(personKey(person.treeId, person.personId), {
        treeId: person.treeId,
        personId: person.personId,
        sealed: false,
      });
    }
  }
  return pool;
}

function lensFor(access: AccessState, viewer: Viewer, lens?: VisibilityLens): VisibilityLens | undefined {
  if (lens) return sameViewer(lens.viewer, viewer) ? lens : undefined;
  return [...access.lenses].reverse().find((item) => sameViewer(item.viewer, viewer));
}

function detailsFor(access: AccessState, viewer: Viewer, treeId: string, personId: string, lens?: VisibilityLens): DetailLevel {
  if (access.deceasedPersonIds.some((row) => row.treeId === treeId && row.personId === personId)) return "open";
  if (viewer.kind === "member" && viewer.treeId === treeId && viewer.personId === personId) return "open";
  if (lens?.detailGrants.some((grant) => grant.treeId === treeId && grant.personId === personId)) return "open";
  return "withheld";
}

export function resolveVisibility(
  forest: Forest,
  access: AccessState,
  viewer: Viewer,
  lens?: VisibilityLens,
): VisibleGraph {
  const pool = poolFor(forest, access, viewer);
  const chosenLens = lensFor(access, viewer, lens);
  const branchMark = new Map<string, LensEffect>();
  const personMark = new Map<string, LensEffect>();

  if (viewer.kind === "guest") {
    for (const key of pool.keys()) branchMark.set(key, "include");
  }

  for (const rule of chosenLens?.rules ?? []) {
    if (rule.scope === "branch") {
      const tree = forest[rule.treeId];
      if (!tree) continue;
      const branch = deriveBranch(rule.treeId, tree, rule.branchRootId);
      for (const member of branch.members) {
        const key = personKey(rule.treeId, member.personId);
        const candidate = pool.get(key);
        if (!candidate || candidate.sealed) continue;
        branchMark.set(key, rule.effect);
      }
      continue;
    }
    const key = personKey(rule.treeId, rule.personId);
    if (!pool.has(key)) continue;
    personMark.set(key, rule.effect);
  }

  const chosenByTree = new Map<string, Map<string, { presence: Presence; details: DetailLevel }>>();
  for (const [key, candidate] of pool) {
    const effect = personMark.get(key) ?? branchMark.get(key);
    if (!effect || effect === "hide") continue;
    const treeChosen = chosenByTree.get(candidate.treeId) ?? new Map();
    treeChosen.set(candidate.personId, {
      presence: effect === "dim" ? "dimmed" : "shown",
      details: detailsFor(access, viewer, candidate.treeId, candidate.personId, chosenLens),
    });
    chosenByTree.set(candidate.treeId, treeChosen);
  }

  const people = [];
  const unions = [];
  const childLinks = [];
  for (const [treeId, tree] of Object.entries(forest)) {
    const part = graphAmong(asTreeId(treeId), tree, chosenByTree.get(treeId) ?? new Map());
    people.push(...part.people);
    unions.push(...part.unions);
    childLinks.push(...part.childLinks);
  }
  return { people, unions, childLinks };
}

/**
 * The tree owner's on-device working view: every person on their own tree,
 * details open, including people sealed from other viewers. Linked trees stay
 * out until a lens grants them. Anyone who is not that owner gets an empty graph.
 */
export function ownerWorkingView(forest: Forest, access: AccessState, viewer: Viewer): VisibleGraph {
  if (viewer.kind !== "member") return emptyGraph();
  const owner = access.trees.find((tree) => tree.treeId === viewer.treeId)?.ownerPersonId;
  if (!owner || owner !== viewer.personId) return emptyGraph();
  const tree = forest[viewer.treeId];
  if (!tree) return emptyGraph();
  const chosen = new Map<string, { presence: Presence; details: DetailLevel }>();
  for (const person of tree.people) chosen.set(person.id, { presence: "shown", details: "open" });
  return graphAmong(viewer.treeId, tree, chosen);
}
