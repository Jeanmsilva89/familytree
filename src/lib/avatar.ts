/**
 * A quiet generated portrait for someone with no photo.
 * Geometry comes only from `person.id`, so the mark stays put if a name changes.
 * Hue and initials follow the same rules as the tree cards.
 */

export type AvatarPerson = {
  id: string;
  givenName: string;
  familyName?: string;
};

export type AvatarDisc = {
  x: number;
  y: number;
  r: number;
};

export type AvatarSpec = {
  hue: number;
  initials: string;
  /** Lighter disc. Clipped to the portrait, it leaves a crescent of the base hue. */
  light: AvatarDisc;
  /** Short rim stroke in an 80×80 view. */
  arc: string;
};

const DIR: ReadonlyArray<readonly [number, number]> = [
  [1000, 0],
  [924, 383],
  [707, 707],
  [383, 924],
  [0, 1000],
  [-383, 924],
  [-707, 707],
  [-924, 383],
  [-1000, 0],
  [-924, -383],
  [-707, -707],
  [-383, -924],
  [0, -1000],
  [383, -924],
  [707, -707],
  [924, -383],
];

function at(index: number, dist: number): { x: number; y: number } {
  const [dx, dy] = DIR[index & 15];
  return {
    x: 40 + Math.round((dx * dist) / 1000),
    y: 40 + Math.round((dy * dist) / 1000),
  };
}

function mix(seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function stream(id: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < 5; i++) {
    h = mix(h);
    out.push(h);
  }
  return out;
}

function hueOf(person: AvatarPerson): number {
  const key = `${person.givenName}|${person.familyName ?? ""}|${person.id}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function initialsFor(person: AvatarPerson): string {
  const a = person.givenName.trim().charAt(0);
  const b = (person.familyName ?? "").trim().charAt(0);
  return (a + b).toUpperCase() || "?";
}

function arcPath(start: number, span: number): string {
  const end = (start + span) & 15;
  const from = at(start, 35);
  const to = at(end, 35);
  const large = span > 8 ? 1 : 0;
  return `M${from.x} ${from.y}A35 35 0 ${large} 1 ${to.x} ${to.y}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function avatarSpec(person: AvatarPerson): AvatarSpec {
  const bits = stream(person.id);
  const lightAt = bits[0] % 16;
  return {
    hue: hueOf(person),
    initials: initialsFor(person),
    light: { ...at(lightAt, 8 + (bits[1] % 11)), r: 30 + (bits[2] % 9) },
    arc: arcPath((lightAt + 6 + (bits[3] % 5)) % 16, 4 + (bits[4] % 4)),
  };
}

export function avatarMarkup(spec: AvatarSpec): string {
  const size = spec.initials.length > 1 ? 26 : spec.initials === "?" ? 28 : 32;
  return (
    `<svg viewBox="0 0 80 80" aria-hidden="true">` +
    `<circle cx="40" cy="40" r="40" class="avatar-base"/>` +
    `<circle cx="${spec.light.x}" cy="${spec.light.y}" r="${spec.light.r}" class="avatar-lift"/>` +
    `<path d="${spec.arc}" class="avatar-arc"/>` +
    `<text x="40" y="42" text-anchor="middle" dominant-baseline="central" class="avatar-initials" font-size="${size}" font-weight="600">${escapeXml(spec.initials)}</text>` +
    `</svg>`
  );
}

export function avatarSvg(person: AvatarPerson): string {
  return avatarMarkup(avatarSpec(person));
}
