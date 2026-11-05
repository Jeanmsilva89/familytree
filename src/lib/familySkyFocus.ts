import type { FamilySky, SkyCouple, SkyFork } from "./familySky";
import type { LaidFork } from "./layout";
import { graphFromPersonalMap, type PersonalMap } from "./personalMap";
import type { TreeData } from "./types";

/**
 * The family sky drawn as one person's personal map.
 *
 * Cards take the personal-map seats. Family buckets and the links between
 * them are hidden for the duration of the focus, so nothing from the overview
 * sits under the gathered family. Couple bars and parent lines come from the
 * same personal-map graph the classic view uses. Unit membership is left as
 * it was, for the return to the sky.
 */
export function skyFromPersonalMap(sky: FamilySky, tree: TreeData, map: PersonalMap): FamilySky {
  const graph = graphFromPersonalMap(tree, map);
  const at = new Map(graph.cards.map((card) => [card.id, card]));
  const cards = sky.cards.map((card) => {
    const next = at.get(card.id);
    return next ? { ...card, x: next.x, y: next.y, gen: next.gen } : card;
  });
  const unitOf = (id: string) => sky.units.unitOf[id] ?? sky.cards.find((card) => card.id === id)?.unitId ?? "";
  const couples: SkyCouple[] = graph.couples.map((couple) => ({
    ...couple,
    unitId: unitOf(couple.partnerIds[0] ?? ""),
  }));
  const forks: SkyFork[] = graph.forks.map((fork: LaidFork) => ({
    ...fork,
    unitId: unitOf(map.focusId),
  }));
  return {
    ...sky,
    width: graph.width,
    height: graph.height,
    cards,
    couples,
    forks,
    links: [],
    unitEdges: [],
    buckets: [],
    shift: { x: 0, y: 0 },
  };
}
