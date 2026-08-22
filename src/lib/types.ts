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

export function emptyTree(): TreeData {
  return { people: [], unions: [], childLinks: [] };
}

export function displayName(person: Person): string {
  return [person.givenName, person.familyName].filter(Boolean).join(" ").trim();
}
