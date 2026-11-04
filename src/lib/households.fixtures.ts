import type { ChildLink, KinKind, Person, TreeData, Union, UnionKind } from "./types";

/**
 * TEST FIXTURES ONLY. These trees exist for unit tests of household areas.
 * They are never loaded into the app or saved to a device.
 * Ids are prefixed `fx-` so a fixture can never collide with real data.
 */

function fx(id: string, givenName: string, birthDate?: string): Person {
  return {
    id: `fx-${id}`,
    givenName,
    ...(birthDate ? { birthDate } : {}),
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function couple(id: string, a: string, b: string, kind: UnionKind): Union {
  return { id: `fx-u-${id}`, partnerIds: [`fx-${a}`, `fx-${b}`], kind };
}

function kid(child: string, parents: string[], kin?: Record<string, KinKind>): ChildLink {
  return {
    id: `fx-c-${child}`,
    childId: `fx-${child}`,
    parentIds: parents.map((p) => `fx-${p}`),
    ...(kin
      ? { kin: Object.fromEntries(Object.entries(kin).map(([p, k]) => [`fx-${p}`, k])) }
      : {}),
  };
}

export const fxId = (id: string) => `fx-${id}`;

/**
 * FIXTURE: the shape from the design brief. Carl & Cora are one household; their
 * grown children Lena, Hana and Joe each head their own household.
 */
export const FIXTURE_SIBLING_HOUSEHOLDS: TreeData = {
  focusPersonId: "fx-jon",
  people: [
    fx("carl", "Carl"),
    fx("cora", "Cora"),
    fx("jon", "Jon", "1989-01-01"),
    fx("lena", "Lena", "1990-01-01"),
    fx("hana", "Hana"),
    fx("kit", "Kit"),
    fx("joe", "Joe"),
    fx("tess", "Tess"),
    fx("gus", "Gus", "2018-01-01"),
    fx("ivy", "Ivy", "2021-01-01"),
    fx("ned", "Ned", "2023-01-01"),
    fx("otto", "Otto", "2025-01-01"),
    fx("opal", "Opal"),
    fx("wren", "Wren"),
    fx("finn", "Finn"),
    fx("lou", "Lou"),
    fx("abe", "Abe"),
  ],
  unions: [
    couple("cc", "carl", "cora", "married"),
    couple("jl", "jon", "lena", "married"),
    couple("hc", "kit", "hana", "married"),
    couple("jt", "joe", "tess", "married"),
  ],
  childLinks: [
    kid("lena", ["carl", "cora"]),
    kid("hana", ["carl", "cora"]),
    kid("joe", ["carl", "cora"]),
    kid("gus", ["jon", "lena"]),
    kid("ivy", ["jon", "lena"]),
    kid("ned", ["jon", "lena"]),
    kid("otto", ["jon", "lena"]),
    kid("opal", ["kit", "hana"]),
    kid("wren", ["kit", "hana"]),
    kid("finn", ["kit", "hana"]),
    kid("lou", ["joe", "tess"]),
    kid("abe", ["joe", "tess"]),
  ],
};

/**
 * FIXTURE: remarriage. Dad was married to Mom (now separated) and is married
 * again to Stepmom. Their shared child Kid has one home; Stepmom brings her
 * own child from before.
 */
export const FIXTURE_REMARRIAGE: TreeData = {
  focusPersonId: "fx-dad",
  people: [
    fx("dad", "Dad"),
    fx("mom", "Mom"),
    fx("stepmom", "Stepmom"),
    fx("kid", "Kid", "2012-01-01"),
    fx("stepkid", "Stepkid", "2010-01-01"),
    fx("baby", "Baby", "2020-01-01"),
  ],
  unions: [
    couple("dm", "dad", "mom", "separated"),
    couple("ds", "dad", "stepmom", "married"),
  ],
  childLinks: [
    kid("kid", ["dad", "mom"]),
    kid("stepkid", ["stepmom"]),
    kid("baby", ["dad", "stepmom"]),
  ],
};

/** FIXTURE: both parents remarried, so their shared child has two candidate homes. */
export const FIXTURE_BOTH_REMARRIED: TreeData = {
  focusPersonId: "fx-kid",
  people: [
    fx("dad", "Dad"),
    fx("mom", "Mom"),
    fx("stepmom", "Stepmom"),
    fx("stepdad", "Stepdad"),
    fx("kid", "Kid"),
  ],
  unions: [
    couple("dm", "dad", "mom", "separated"),
    couple("ds", "dad", "stepmom", "married"),
    couple("mt", "mom", "stepdad", "partnered"),
  ],
  childLinks: [kid("kid", ["dad", "mom"])],
};

/** FIXTURE: a single mother with an adopted daughter, who later starts her own household. */
export const FIXTURE_ADOPTED_SINGLE_PARENT: TreeData = {
  focusPersonId: "fx-mother",
  people: [
    fx("mother", "Mother"),
    fx("adoptee", "Adoptee"),
    fx("son", "Son"),
    fx("spouse", "Spouse"),
    fx("grandkid", "Grandkid"),
  ],
  unions: [couple("as", "adoptee", "spouse", "married")],
  childLinks: [
    kid("adoptee", ["mother"], { mother: "adopted" }),
    kid("son", ["mother"], { mother: "adopted" }),
    kid("grandkid", ["adoptee", "spouse"]),
  ],
};

/** FIXTURE: a step-parent. Mom's child from before lives with Mom and her partner. */
export const FIXTURE_STEP_PARENT: TreeData = {
  focusPersonId: "fx-mom",
  people: [fx("mom", "Mom"), fx("stepdad", "Stepdad"), fx("child", "Child"), fx("stepchild", "Stepchild")],
  unions: [couple("ms", "mom", "stepdad", "partnered")],
  childLinks: [
    kid("child", ["mom"]),
    kid("stepchild", ["mom", "stepdad"], { stepdad: "step" }),
  ],
};

/**
 * FIXTURE: unmarried co-parents. Ada and Eli share two children but are
 * not a couple. Ada's parents are on the tree; Eli's are not.
 */
export const FIXTURE_COPARENTS: TreeData = {
  focusPersonId: "fx-ada",
  people: [
    fx("grandma", "Grandma"),
    fx("grandpa", "Grandpa"),
    fx("ada", "Ada"),
    fx("eli", "Eli"),
    fx("june", "June"),
    fx("milo", "Milo"),
  ],
  unions: [
    couple("gp", "grandma", "grandpa", "married"),
    couple("ae", "ada", "eli", "unspecified"),
  ],
  childLinks: [
    kid("ada", ["grandma", "grandpa"]),
    kid("june", ["ada", "eli"]),
    kid("milo", ["ada", "eli"]),
  ],
};

/**
 * FIXTURE: an unknown parent. Kid's link names a parent id that is not on the
 * tree, and a lone person has no relatives at all.
 */
export const FIXTURE_UNKNOWN_PARENT: TreeData = {
  focusPersonId: "fx-parent",
  people: [fx("parent", "Parent"), fx("kid", "Kid"), fx("loner", "Loner")],
  unions: [],
  childLinks: [
    { id: "fx-c-kid", childId: "fx-kid", parentIds: ["fx-parent", "fx-missing"] },
  ],
};
