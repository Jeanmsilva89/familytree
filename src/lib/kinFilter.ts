import type { KinKind } from "./types";

export type LineFilter = {
  genealogyOnly: boolean;
  blood: boolean;
  adopted: boolean;
  step: boolean;
  foster: boolean;
  couples: boolean;
};

export const DEFAULT_LINE_FILTER: LineFilter = {
  genealogyOnly: false,
  blood: true,
  adopted: true,
  step: true,
  foster: true,
  couples: true,
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

export function toggleLineKind(filter: LineFilter, key: Exclude<keyof LineFilter, "genealogyOnly">): LineFilter {
  return { ...filter, genealogyOnly: false, [key]: !filter[key] };
}
