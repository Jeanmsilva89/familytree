import type { Person, TreeData, Union, UnionKind } from "./types";
import { displayName } from "./types";
import { kidsUnderUnion, parentsOf, unionsFor } from "./tree";

export const CARD = { w: 108, h: 140, gap: 16, coupleGap: 12, laneGap: 96, pad: 48 };
