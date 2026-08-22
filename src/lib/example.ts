import type { TreeData } from "./types";

/** Tiny fictional EXAMPLE family. Never auto-loaded as the user's tree. */
export const EXAMPLE_TREE: TreeData = {
  focusPersonId: "ex_alex",
  people: [
    {
      id: "ex_alex",
      givenName: "Alex",
      familyName: "River",
      bio: "Example parent — not a real person.",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "ex_jordan",
      givenName: "Jordan",
      familyName: "River",
      bio: "Example partner — not a real person.",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "ex_sam",
      givenName: "Sam",
      familyName: "River",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
    {
      id: "ex_riley",
      givenName: "Riley",
      familyName: "River",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ],
  unions: [{ id: "ex_u1", partnerIds: ["ex_alex", "ex_jordan"], kind: "partnered" }],
  childLinks: [
    { id: "ex_c1", childId: "ex_sam", parentIds: ["ex_alex", "ex_jordan"], unionId: "ex_u1" },
    { id: "ex_c2", childId: "ex_riley", parentIds: ["ex_alex", "ex_jordan"], unionId: "ex_u1" },
  ],
};

export function cloneExample(): TreeData {
  return structuredClone(EXAMPLE_TREE);
}
