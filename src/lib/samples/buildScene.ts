import raw from "../../../scripts/fixtures/verify-family-sky.json";
import { avatarSpec } from "../avatar";
import { deriveFamilyUnits } from "../familyUnits";
import { layoutFamilySky } from "../familySky";
import { CARD, showsCoupleBar } from "../layout";
import { kinOf, type ChildLink, type Person, type TreeData, type Union } from "../types";
import { round3, type SampleFamily, type SampleLink, type SamplePerson, type SampleScene } from "./model";

/**
 * Builds the sample scene from the Families verification fixture.
 * Used by tests and to regenerate `fixtureScene.ts`. The client samples do
 * not import this file.
 */

type FixtureFile = {
  people: Person[];
  unions: Union[];
  childLinks: ChildLink[];
  focusPersonId?: string;
};

const LAYER = 2.2;
const SPREAD = 6.4;

export function fixtureTree(): TreeData {
  const data = raw as FixtureFile;
  return {
    people: data.people,
    unions: data.unions,
    childLinks: data.childLinks,
    focusPersonId: data.focusPersonId,
  };
}

function generations(tree: TreeData): Map<string, number> {
  const known = new Set(tree.people.map((person) => person.id));
  const gen = new Map<string, number>();
  for (const id of known) gen.set(id, 0);
  const edges: [string, string][] = [];
  for (const link of tree.childLinks) {
    if (!known.has(link.childId)) continue;
    for (const parentId of link.parentIds) {
      if (known.has(parentId) && parentId !== link.childId) edges.push([parentId, link.childId]);
    }
  }
  const couples = tree.unions
    .map((union) => union.partnerIds.filter((id) => known.has(id)))
    .filter((ids) => ids.length >= 2);
  for (let pass = 0; pass < known.size + 2; pass += 1) {
    let changed = false;
    for (const [parent, child] of edges) {
      const want = (gen.get(parent) ?? 0) + 1;
      if ((gen.get(child) ?? 0) < want) {
        gen.set(child, want);
        changed = true;
      }
    }
    for (const group of couples) {
      const target = Math.max(...group.map((id) => gen.get(id) ?? 0));
      for (const id of group) {
        if ((gen.get(id) ?? 0) < target) {
          gen.set(id, target);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return gen;
}

export function buildSampleScene(tree: TreeData = fixtureTree()): SampleScene {
  const units = deriveFamilyUnits(tree);
  const sky = layoutFamilySky(tree);
  const gen = generations(tree);
  const buckets = sky.buckets.filter((bucket) => units.units.some((unit) => unit.id === bucket.id));
  const xs = buckets.map((bucket) => bucket.cx);
  const ys = buckets.map((bucket) => bucket.cy);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = SPREAD / span;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const bucketOf = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  const cardOf = new Map(sky.cards.map((card) => [card.id, card]));

  const people: SamplePerson[] = tree.people.map((person) => {
    const spec = avatarSpec(person);
    const unitId = units.unitOf[person.id];
    const bucket = bucketOf.get(unitId);
    const card = cardOf.get(person.id);
    let lx = 0;
    let ly = 0;
    if (bucket && card) {
      lx = round3((card.x - bucket.cx) * scale);
      ly = round3(-((card.y + CARD.h / 2) - bucket.cy) * scale);
    }
    return {
      id: person.id,
      name: [person.givenName, person.familyName].filter(Boolean).join(" "),
      givenName: person.givenName,
      initials: spec.initials,
      hue: spec.hue,
      unitId,
      generation: gen.get(person.id) ?? 0,
      lx,
      ly,
    };
  });
  const personOf = new Map(people.map((person) => [person.id, person]));

  const families: SampleFamily[] = units.units.map((unit) => {
    const bucket = bucketOf.get(unit.id);
    const members = unit.memberIds.map((id) => personOf.get(id)).filter((person): person is SamplePerson => Boolean(person));
    const headGen = Math.min(...unit.headIds.map((id) => gen.get(id) ?? 0));
    const reach = members.reduce((max, person) => Math.max(max, Math.hypot(person.lx, person.ly)), 0);
    const head = personOf.get(unit.headIds[0]);
    return {
      id: unit.id,
      label: unit.label,
      memberIds: unit.memberIds,
      headIds: unit.headIds,
      generation: headGen,
      x: bucket ? round3((bucket.cx - midX) * scale) : 0,
      y: bucket ? round3(-(bucket.cy - midY) * scale) : 0,
      z: round3(headGen * LAYER),
      radius: round3(Math.max(0.58, 0.36 + reach * 0.28)),
      hue: head?.hue ?? 0,
    };
  });

  const links: SampleLink[] = [];
  for (const link of tree.childLinks) {
    for (const parentId of link.parentIds) {
      if (!personOf.has(parentId) || !personOf.has(link.childId) || parentId === link.childId) continue;
      links.push({
        id: `${link.id}:${parentId}`,
        fromId: parentId,
        toId: link.childId,
        kind: kinOf(link, parentId),
      });
    }
  }
  for (const union of tree.unions) {
    const ids = union.partnerIds.filter((id) => personOf.has(id));
    if (ids.length < 2) continue;
    const kind = union.kind === "divorced" ? "divorced" : showsCoupleBar(union.kind, ids.length) ? "partner" : null;
    if (!kind) continue;
    links.push({ id: union.id, fromId: ids[0], toId: ids[1], kind });
  }

  const partners: Record<string, string[]> = {};
  const parents: Record<string, string[]> = {};
  const children: Record<string, string[]> = {};
  for (const person of people) {
    partners[person.id] = [];
    parents[person.id] = [];
    children[person.id] = [];
  }
  for (const link of links) {
    if (link.kind === "partner") {
      partners[link.fromId].push(link.toId);
      partners[link.toId].push(link.fromId);
    } else if (link.kind !== "divorced") {
      if (!parents[link.toId].includes(link.fromId)) parents[link.toId].push(link.fromId);
      if (!children[link.fromId].includes(link.toId)) children[link.fromId].push(link.toId);
    }
  }

  return {
    note: "Fixture. Not a real family.",
    focusPersonId: tree.focusPersonId && personOf.has(tree.focusPersonId) ? tree.focusPersonId : people[0]?.id ?? "",
    people,
    families,
    links,
    partners,
    parents,
    children,
  };
}
