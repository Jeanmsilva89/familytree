export type ExtraField = {
  key: string;
  value: string;
};

export type UnionKind = "unspecified" | "partnered" | "married" | "separated" | "divorced";
/** What the tree says about a union. `remarried` is derived from a divorce plus a later marriage. It is never stored. */
export type PartnerStatus = UnionKind | "remarried";
export type ParentRole = "father" | "mother";
export type KinKind = "blood" | "adopted" | "step" | "foster";

export const UNION_KIND_OPTIONS: { value: UnionKind; label: string }[] = [
  { value: "married", label: "Married" },
  { value: "partnered", label: "Partnered" },
  { value: "divorced", label: "Divorced" },
  { value: "separated", label: "Two households / separated" },
  { value: "unspecified", label: "Unspecified" },
];

const STORED_UNION_KINDS = new Set<string>(UNION_KIND_OPTIONS.map((option) => option.value));

/**
 * A stored couple kind. A missing kind, and the derived word `remarried`,
 * become a real stored kind. Separation is not rewritten as divorce.
 */
export function migrateUnionKind(kind: unknown): UnionKind {
  if (kind === "remarried") return "married";
  if (typeof kind === "string" && STORED_UNION_KINDS.has(kind)) return kind as UnionKind;
  return "unspecified";
}

/**
 * Married, divorced, or remarried. Remarried means this union is married and
 * one of these people has another union that is divorced. A separation does
 * not count: that would invent a divorce. Roles and gender are ignored.
 */
export function partnerStatus(tree: { unions: Union[] }, union: Union): PartnerStatus {
  const kind = migrateUnionKind(union.kind);
  if (kind !== "married") return kind;
  const again = tree.unions.some((other) => {
    if (other.id === union.id) return false;
    return migrateUnionKind(other.kind) === "divorced" && other.partnerIds.some((id) => union.partnerIds.includes(id));
  });
  return again ? "remarried" : "married";
}

export function partnerStatusLabel(status: PartnerStatus): string {
  if (status === "remarried") return "Remarried";
  return unionKindLabel(status);
}

export const KIN_KIND_OPTIONS: { value: KinKind; label: string }[] = [
  { value: "blood", label: "Blood" },
  { value: "adopted", label: "Adopted" },
  { value: "step", label: "Step" },
  { value: "foster", label: "Foster" },
];

export const PARENT_ROLE_OPTIONS: { value: ParentRole | ""; label: string }[] = [
  { value: "mother", label: "Mother" },
  { value: "father", label: "Father" },
  { value: "", label: "Parent" },
];

export function unionKindLabel(kind: UnionKind): string {
  return UNION_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? "Unspecified";
}

export function kinKindLabel(kind: KinKind): string {
  return KIN_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? "Blood";
}

export function kinOf(link: { kin?: Partial<Record<string, KinKind>> }, parentId: string): KinKind {
  return link.kin?.[parentId] ?? "blood";
}

export function strongestKin(kinds: KinKind[]): KinKind {
  if (kinds.includes("blood")) return "blood";
  if (kinds.includes("adopted")) return "adopted";
  if (kinds.includes("foster")) return "foster";
  return kinds[0] ?? "blood";
}

export type ImportantDate = {
  id: string;
  label: string;
  date: string;
};

export type Person = {
  id: string;
  givenName: string;
  familyName?: string;
  bio?: string;
  birthDate?: string;
  otherDates?: ImportantDate[];
  emails?: string[];
  phones?: string[];
  /** Optional local photo as a small data URL. */
  photo?: string;
  /** Free-form facts beyond genealogy (occupation, notes, nicknames, …). */
  extras?: ExtraField[];
  /** Manual graph x after auto-layout, set by dragging in the classic view. */
  graphX?: number;
  /**
   * Pixels to the right of this person's automatic place on their family-sky
   * row. The classic graph ignores it. Absent means the automatic place.
   */
  rowNudge?: number;
  createdAt: string;
  updatedAt: string;
};

export type Union = {
  id: string;
  partnerIds: string[];
  kind: UnionKind;
  marriedOn?: string;
  extras?: ExtraField[];
};

/**
 * A parent who is not a person on the tree.
 * Never filled in from a partner. Role is optional because the parent may be
 * unknown in every way, not only unnamed.
 */
export type UnknownParent = {
  role?: ParentRole;
};

export type ChildLink = {
  id: string;
  childId: string;
  parentIds: string[];
  unionId?: string;
  roles?: Partial<Record<string, ParentRole>>;
  /** How each parent relates to the child. Missing keys are blood. */
  kin?: Partial<Record<string, KinKind>>;
  /**
   * Parents who are not people on the tree. A partner is not written here
   * in their place. A parent id that is not on the tree means the same thing.
   */
  unknownParents?: UnknownParent[];
};

/**
 * Manual family-unit choice for one person. `unitOf` names someone whose unit
 * this person should join (usually that unit's head); `null` gives the person
 * a unit of their own. Pure data, applied by `deriveFamilyUnits`.
 */
export type FamilyUnitOverride = {
  personId: string;
  unitOf: string | null;
};

export type TreeData = {
  people: Person[];
  unions: Union[];
  childLinks: ChildLink[];
  focusPersonId?: string;
  /** Manual family-unit reassignments, applied over the maternal rule. */
  familyUnitOverrides?: FamilyUnitOverride[];
};

export type LinkRole = "parent" | "partner" | "child" | "sibling";

export function emptyTree(): TreeData {
  return { people: [], unions: [], childLinks: [] };
}

export function cleanExtras(extras?: ExtraField[]): ExtraField[] | undefined {
  const next = (extras ?? [])
    .map((item) => ({ key: item.key.trim(), value: item.value.trim() }))
    .filter((item) => item.key && item.value);
  return next.length ? next : undefined;
}

export function displayName(person: Person): string {
  return [person.givenName, person.familyName].filter(Boolean).join(" ").trim();
}

export function initials(person: Person): string {
  const g = person.givenName?.trim()[0] ?? "";
  const f = person.familyName?.trim()[0] ?? "";
  return (g + f).toUpperCase() || "?";
}

export function matchPeople(people: Person[], query: string, excludeId?: string, limit = 6): Person[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return people
    .filter((person) => person.id !== excludeId)
    .map((person) => ({ person, name: displayName(person).toLowerCase() }))
    .filter(({ name }) => name.includes(needle) || name.split(/\s+/).some((part) => part.startsWith(needle)))
    .sort((a, b) => {
      const aStart = a.name.startsWith(needle) ? 0 : 1;
      const bStart = b.name.startsWith(needle) ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map(({ person }) => person);
}

export function ageFromBirthDate(birthDate?: string, now = new Date()): string | undefined {
  if (!birthDate) return undefined;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return undefined;
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age -= 1;
  if (age < 0 || age > 140) return undefined;
  return String(age);
}
