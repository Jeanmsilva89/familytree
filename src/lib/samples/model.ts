/**
 * Plain scene model for the 3D samples. No three.js, and no import of the
 * live tree layout, so the sample routes can carry this data without pulling
 * it into the home bundle.
 *
 * Every person here is fixture data. Nothing in this module is a relative.
 */

export type SampleKind = "depth" | "cards" | "orbit";

export type SampleLinkKind = "blood" | "adopted" | "foster" | "step" | "partner" | "divorced";

export type SamplePerson = {
  id: string;
  /** Full fixture name, including the family name Fixture. */
  name: string;
  givenName: string;
  initials: string;
  hue: number;
  unitId: string;
  generation: number;
  /** Offset from the family center, in world units. */
  lx: number;
  ly: number;
};

export type SampleFamily = {
  id: string;
  label: string;
  memberIds: string[];
  headIds: string[];
  generation: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  hue: number;
};

export type SampleLink = {
  id: string;
  fromId: string;
  toId: string;
  kind: SampleLinkKind;
};

export type SampleScene = {
  note: string;
  focusPersonId: string;
  people: SamplePerson[];
  families: SampleFamily[];
  links: SampleLink[];
  partners: Record<string, string[]>;
  parents: Record<string, string[]>;
  children: Record<string, string[]>;
};

export type SampleRing = "center" | "partner" | "near" | "outer";

export type SamplePose = {
  id: string;
  x: number;
  y: number;
  z: number;
  scale: number;
  alpha: number;
  ring?: SampleRing;
};

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
