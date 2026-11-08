import type { ChildLink, KinKind, ParentRole, Person, TreeData, Union, UnionKind } from "../types";

/**
 * TEST FIXTURES ONLY. These trees exist for the access-model unit tests.
 * Every family name is "FIXTURE" and every id starts with `ax-fx-`.
 * They are never loaded into the app. No real relatives, dates, or family facts.
 */

const FIXTURE = "FIXTURE";
const STAMP = "2020-01-01T00:00:00.000Z";

export const HOME_TREE_ID = "ax-fx-tree-home";
export const OTHER_TREE_ID = "ax-fx-tree-other";
export const OUTSIDE_TREE_ID = "ax-fx-tree-outside";

export const ax = (id: string) => `ax-fx-${id}`;

function person(id: string, givenName: string, extra: Partial<Pick<Person, "bio" | "emails" | "photo">> = {}): Person {
  return {
    id: ax(id),
    givenName,
    familyName: FIXTURE,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  };
}

function couple(id: string, a: string, b: string, kind: UnionKind): Union {
  return { id: ax(id), partnerIds: [ax(a), ax(b)], kind };
}

type ParentSpec = { id: string; role?: ParentRole; kin?: KinKind };

function kid(id: string, child: string, parents: ParentSpec[]): ChildLink {
  const roles: Partial<Record<string, ParentRole>> = {};
  const kin: Partial<Record<string, KinKind>> = {};
  for (const parent of parents) {
    if (parent.role) roles[ax(parent.id)] = parent.role;
    if (parent.kin && parent.kin !== "blood") kin[ax(parent.id)] = parent.kin;
  }
  return {
    id: ax(id),
    childId: ax(child),
    parentIds: parents.map((parent) => ax(parent.id)),
    ...(Object.keys(roles).length ? { roles } : {}),
    ...(Object.keys(kin).length ? { kin } : {}),
  };
}

/**
 * FIXTURE: Ada and Ben are separated and share Cam. Cam's partner is Nia.
 * Pip is Cam and Nia's child. Obe is Nia's child with no other parent.
 * Dee, Del, and Pat are on the tree and in nobody's descendant line.
 * Ada carries fixture contact fields so visibility tests can show they stay hidden.
 * Pat carries a fixture bio so a deceased mark can open it. No birth dates.
 */
export const FIXTURE_DIVORCE: TreeData = {
  focusPersonId: ax("ada"),
  people: [
    person("ada", "Ada", { bio: "FIXTURE bio", emails: ["fixture@example.com"], photo: "fixture-photo" }),
    person("ben", "Ben"),
    person("cam", "Cam"),
    person("nia", "Nia"),
    person("pip", "Pip"),
    person("obe", "Obe"),
    person("dee", "Dee"),
    person("del", "Del"),
    person("pat", "Pat", { bio: "FIXTURE bio deceased" }),
  ],
  unions: [couple("u-ada-ben", "ada", "ben", "separated"), couple("u-cam-nia", "cam", "nia", "partnered")],
  childLinks: [
    kid("c-cam", "cam", [{ id: "ada" }, { id: "ben" }]),
    kid("c-pip", "pip", [{ id: "cam" }, { id: "nia" }]),
    kid("c-obe", "obe", [{ id: "nia" }]),
  ],
};

/**
 * FIXTURE: Ada and Ben are separated and share Cam. Ada then marries Gil.
 * Hap is Gil's child and Ada's step-child. Cam is Gil's step-child.
 */
export const FIXTURE_REMARRIAGE: TreeData = {
  focusPersonId: ax("ada"),
  people: [
    person("ada", "Ada"),
    person("ben", "Ben"),
    person("cam", "Cam"),
    person("gil", "Gil"),
    person("hap", "Hap"),
  ],
  unions: [couple("u-ada-ben", "ada", "ben", "separated"), couple("u-ada-gil", "ada", "gil", "married")],
  childLinks: [
    kid("c-cam", "cam", [{ id: "ada" }, { id: "ben" }]),
    kid("c-cam-gil", "cam", [{ id: "gil", kin: "step" }]),
    kid("c-hap", "hap", [{ id: "gil" }]),
    kid("c-hap-ada", "hap", [{ id: "ada", kin: "step" }]),
  ],
};

/**
 * FIXTURE: Kit's biological parent is Ivy and adoptive parent is Jo.
 * They are partnered. Parent role does not decide the branch.
 */
export const FIXTURE_ADOPTION: TreeData = {
  focusPersonId: ax("kit"),
  people: [person("ivy", "Ivy"), person("jo", "Jo"), person("kit", "Kit")],
  unions: [couple("u-ivy-jo", "ivy", "jo", "partnered")],
  childLinks: [
    kid("c-kit", "kit", [
      { id: "ivy", role: "mother" },
      { id: "jo", role: "father", kin: "adopted" },
    ]),
  ],
};

/**
 * FIXTURE: Vic fosters Kit. Ivy is the only blood parent. No union.
 */
export const FIXTURE_FOSTER: TreeData = {
  focusPersonId: ax("kit"),
  people: [person("ivy", "Ivy"), person("vic", "Vic"), person("kit", "Kit")],
  unions: [],
  childLinks: [
    kid("c-kit", "kit", [{ id: "ivy", role: "mother" }]),
    kid("c-kit-vic", "kit", [{ id: "vic", kin: "foster" }]),
  ],
};

/**
 * FIXTURE: Lea and Mo are both mothers of Nix. No father role is recorded.
 */
export const FIXTURE_SAME_SEX: TreeData = {
  focusPersonId: ax("nix"),
  people: [person("lea", "Lea"), person("mo", "Mo"), person("nix", "Nix")],
  unions: [couple("u-lea-mo", "lea", "mo", "partnered")],
  childLinks: [
    kid("c-nix", "nix", [
      { id: "lea", role: "mother" },
      { id: "mo", role: "mother" },
    ]),
  ],
};

/**
 * FIXTURE: Pim has one recorded parent, Ora. The other parent is not on the tree.
 */
export const FIXTURE_UNKNOWN: TreeData = {
  focusPersonId: ax("pim"),
  people: [person("ora", "Ora"), person("pim", "Pim")],
  unions: [],
  childLinks: [kid("c-pim", "pim", [{ id: "ora" }])],
};

/**
 * FIXTURE: Sib and Ume share Quinn and no other parent. Rue is Sib's other
 * parent. Tan is Ume's other parent. Quinn and Rue are separated. Quinn and
 * Tan are partnered.
 */
export const FIXTURE_HALF: TreeData = {
  focusPersonId: ax("sib"),
  people: [
    person("quinn", "Quinn"),
    person("rue", "Rue"),
    person("tan", "Tan"),
    person("sib", "Sib"),
    person("ume", "Ume"),
  ],
  unions: [
    couple("u-quinn-rue", "quinn", "rue", "separated"),
    couple("u-quinn-tan", "quinn", "tan", "partnered"),
  ],
  childLinks: [
    kid("c-sib", "sib", [{ id: "quinn" }, { id: "rue" }]),
    kid("c-ume", "ume", [{ id: "quinn" }, { id: "tan" }]),
  ],
};

/**
 * FIXTURE: a second tree. Wes is Zed's parent. Zed carries a fixture bio.
 */
export const FIXTURE_OTHER: TreeData = {
  focusPersonId: ax("wes"),
  people: [person("wes", "Wes"), person("zed", "Zed", { bio: "FIXTURE bio" })],
  unions: [],
  childLinks: [kid("c-zed", "zed", [{ id: "wes" }])],
};

export const FIXTURE_TREES: TreeData[] = [
  FIXTURE_DIVORCE,
  FIXTURE_REMARRIAGE,
  FIXTURE_ADOPTION,
  FIXTURE_FOSTER,
  FIXTURE_SAME_SEX,
  FIXTURE_UNKNOWN,
  FIXTURE_HALF,
  FIXTURE_OTHER,
];
