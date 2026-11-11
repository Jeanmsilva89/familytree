import type { SamplePose, SampleRing, SampleScene } from "./model";

/** Same curve the card shader uses, so HTML labels stay on the panels. */
export function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export function familyById(scene: SampleScene) {
  return new Map(scene.families.map((family) => [family.id, family]));
}

export function personPlace(scene: SampleScene, personId: string): { x: number; y: number; z: number } | null {
  const person = scene.people.find((item) => item.id === personId);
  if (!person) return null;
  const family = scene.families.find((item) => item.id === person.unitId);
  if (!family) return null;
  return { x: family.x + person.lx, y: family.y + person.ly, z: family.z + 0.22 };
}

/**
 * Far: one star per household, people stacked on the family.
 * Near: each person at their own seat.
 * The GPU lerps these. The CPU only writes them when the level changes.
 */
export function cardPoses(scene: SampleScene, level: "far" | "near"): SamplePose[] {
  const families = familyById(scene);
  return scene.people.map((person) => {
    const family = families.get(person.unitId);
    const place = personPlace(scene, person.id) ?? { x: 0, y: 0, z: 0 };
    if (!family || level === "near") {
      return { id: person.id, ...place, scale: 0.74, alpha: 1 };
    }
    const star = person.id === family.headIds[0];
    return {
      id: person.id,
      x: family.x,
      y: family.y,
      z: family.z,
      scale: star ? 0.34 : 0.12,
      alpha: star ? 1 : 0,
    };
  });
}

function arc(ids: string[], radius: number, center: number, spread: number) {
  const sorted = [...ids].sort();
  const placed = new Map<string, { x: number; y: number }>();
  sorted.forEach((id, index) => {
    const angle = sorted.length === 1 ? center : center - spread / 2 + (spread * index) / (sorted.length - 1);
    placed.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  return placed;
}

/**
 * Partner beside the person. Parents, children, and siblings on the near
 * ring. Everyone else steps back and fades.
 */
export function orbitPoses(scene: SampleScene, focusId: string): SamplePose[] {
  const known = new Set(scene.people.map((person) => person.id));
  if (!known.has(focusId)) return cardPoses(scene, "near");
  const role = new Map<string, SampleRing>(scene.people.map((person) => [person.id, "outer"]));
  role.set(focusId, "center");
  const claim = (ids: string[], ring: SampleRing) => {
    for (const id of ids) {
      if (role.get(id) === "outer") role.set(id, ring);
    }
  };
  claim(scene.partners[focusId] ?? [], "partner");
  const parents = scene.parents[focusId] ?? [];
  const children = scene.children[focusId] ?? [];
  claim(parents, "near");
  claim(children, "near");
  const siblings = new Set<string>();
  for (const parentId of parents) {
    for (const childId of scene.children[parentId] ?? []) {
      if (childId !== focusId) siblings.add(childId);
    }
  }
  claim([...siblings], "near");

  const partners = scene.people.filter((person) => role.get(person.id) === "partner").map((person) => person.id);
  const parentIds = scene.people.filter((person) => role.get(person.id) === "near" && parents.includes(person.id)).map((person) => person.id);
  const childIds = scene.people.filter((person) => role.get(person.id) === "near" && children.includes(person.id)).map((person) => person.id);
  const siblingIds = scene.people
    .filter((person) => role.get(person.id) === "near" && !parentIds.includes(person.id) && !childIds.includes(person.id))
    .map((person) => person.id);
  const outerIds = scene.people.filter((person) => role.get(person.id) === "outer").map((person) => person.id);

  const at = new Map<string, { x: number; y: number; z: number; scale: number; alpha: number }>();
  at.set(focusId, { x: 0, y: 0, z: 0.16, scale: 1.05, alpha: 1 });
  partners.forEach((id, index) => {
    at.set(id, { x: 1.35 + index * 1.15, y: 0, z: 0.16, scale: 1, alpha: 1 });
  });
  for (const [id, pos] of arc(parentIds, 2.25, Math.PI / 2, Math.PI / 2)) {
    at.set(id, { ...pos, z: 0, scale: 0.9, alpha: 1 });
  }
  for (const [id, pos] of arc(childIds, 2.25, -Math.PI / 2, Math.PI / 2)) {
    at.set(id, { ...pos, z: 0, scale: 0.9, alpha: 1 });
  }
  for (const [id, pos] of arc(siblingIds, 1.95, Math.PI, Math.PI / 5)) {
    at.set(id, { ...pos, z: 0, scale: 0.88, alpha: 1 });
  }
  for (const [id, pos] of arc(outerIds, 4.55, 0.4, Math.PI * 2 * 0.92)) {
    at.set(id, { ...pos, z: -0.55, scale: 0.68, alpha: 0.36 });
  }

  return scene.people.map((person) => {
    const pose = at.get(person.id) ?? { x: 0, y: 0, z: 0, scale: 0.7, alpha: 0.36 };
    return { id: person.id, ring: role.get(person.id), ...pose };
  });
}

export function poseDistance(pose: SamplePose): number {
  return Math.hypot(pose.x, pose.y, pose.z);
}
