export type ExtraField = {
  key: string;
  value: string;
};

export type UnionKind = "unspecified" | "partnered" | "married" | "separated";
export type ParentRole = "father" | "mother";

export const UNION_KIND_OPTIONS: { value: UnionKind; label: string }[] = [
  { value: "married", label: "Married" },
  { value: "partnered", label: "Partnered" },
  { value: "separated", label: "Two households / separated" },
  { value: "unspecified", label: "Unspecified" },
];

export function unionKindLabel(kind: UnionKind): string {
  return UNION_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? "Unspecified";
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
  /** Manual graph x after auto-layout, set by dragging in edit mode. */
  graphX?: number;
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

export type ChildLink = {
  id: string;
  childId: string;
  parentIds: string[];
  unionId?: string;
  roles?: Partial<Record<string, ParentRole>>;
};

export type TreeData = {
  people: Person[];
  unions: Union[];
  childLinks: ChildLink[];
  focusPersonId?: string;
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
