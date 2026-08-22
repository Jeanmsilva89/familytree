export type UnionKind = "unspecified" | "partnered" | "married" | "separated";

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
  createdAt: string;
  updatedAt: string;
};

export type Union = {
  id: string;
  partnerIds: string[];
  kind: UnionKind;
};

export type ChildLink = {
  id: string;
  childId: string;
  parentIds: string[];
  unionId?: string;
};

export type TreeData = {
  people: Person[];
  unions: Union[];
  childLinks: ChildLink[];
  focusPersonId?: string;
};

export type LinkRole = "parent" | "partner" | "child";

export function emptyTree(): TreeData {
  return { people: [], unions: [], childLinks: [] };
}

export function displayName(person: Person): string {
  return [person.givenName, person.familyName].filter(Boolean).join(" ").trim();
}

export function initials(person: Person): string {
  const g = person.givenName?.trim()[0] ?? "";
  const f = person.familyName?.trim()[0] ?? "";
  return (g + f).toUpperCase() || "?";
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
