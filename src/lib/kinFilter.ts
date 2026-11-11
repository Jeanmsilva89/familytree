import type { KinKind } from "./types";

export type LineFilter = {
  genealogyOnly: boolean;
  blood: boolean;
  adopted: boolean;
  step: boolean;
  foster: boolean;
  couples: boolean;
  /** Household areas and the connectors between them (classic graph). */
  households: boolean;
  /** Family sky: one bucket per family unit, with semantic zoom. */
  families: boolean;
  /** Opt-in orbit focus. Off leaves the generation rows and the family sky alone. */
  orbit: boolean;
};

export const DEFAULT_LINE_FILTER: LineFilter = {
  genealogyOnly: false,
  blood: true,
  adopted: true,
  step: true,
  foster: true,
  couples: true,
  households: true,
  families: true,
  orbit: false,
};

export function lineFilterAllows(filter: LineFilter, kin: KinKind): boolean {
  if (filter.genealogyOnly) return kin === "blood";
  return filter[kin];
}

export function lineFilterAllowsCouples(filter: LineFilter): boolean {
  return !filter.genealogyOnly && filter.couples;
}

export function genealogyOnlyFilter(on: boolean, previous: LineFilter): LineFilter {
  return { ...previous, genealogyOnly: on };
}

export function toggleHouseholds(filter: LineFilter): LineFilter {
  return { ...filter, households: !filter.households };
}

export function toggleFamilies(filter: LineFilter): LineFilter {
  return { ...filter, families: !filter.families };
}

export function toggleOrbit(filter: LineFilter): LineFilter {
  return { ...filter, orbit: !filter.orbit };
}

export function toggleLineKind(filter: LineFilter, key: Exclude<keyof LineFilter, "genealogyOnly" | "households" | "families" | "orbit">): LineFilter {
  return { ...filter, genealogyOnly: false, [key]: !filter[key] };
}
