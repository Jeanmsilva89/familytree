import type { ChildLink, KinKind, ParentRole, Person, TreeData, Union, UnionKind } from "./types";

/**
 * TEST FIXTURES ONLY. These trees exist for unit tests of family units (the
 * "buckets" in the family sky). They are never loaded into the app or saved
 * to a device. Ids are prefixed `fu-fx-` and every family name is "FIXTURE",
 * so a fixture can never be mistaken for, or collide with, real data.
 */

const FIXTURE = "FIXTURE";

function fx(id: string, givenName: string, birthDate?: string): Person {
  return {
    id: `fu-fx-${id}`,
    givenName,
    familyName: FIXTURE,
    ...(birthDate ? { birthDate } : {}),
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function couple(a: string, b: string, kind: UnionKind): Union {
  return { id: `fu-fx-u-${a}-${b}`, partnerIds: [`fu-fx-${a}`, `fu-fx-${b}`], kind };
}

type ParentSpec = [id: string, role?: ParentRole | "", kin?: KinKind];

function kid(child: string, parents: ParentSpec[]): ChildLink {
  const roles: Partial<Record<string, ParentRole>> = {};
  const kin: Partial<Record<string, KinKind>> = {};
  for (const [id, role, k] of parents) {
    if (role) roles[`fu-fx-${id}`] = role;
    if (k && k !== "blood") kin[`fu-fx-${id}`] = k;
  }
  return {
    id: `fu-fx-c-${child}`,
    childId: `fu-fx-${child}`,
    parentIds: parents.map(([id]) => (id.startsWith("!") ? id.slice(1) : `fu-fx-${id}`)),
    ...(Object.keys(roles).length ? { roles } : {}),
    ...(Object.keys(kin).length ? { kin } : {}),
  };
}

export const fuId = (id: string) => `fu-fx-${id}`;

/**
 * FIXTURE: invented names in the shape from the design brief. Cora & Carl's
 * daughters Lena and Hana stay with them, so Jon, Kit and all the
 * grandchildren join the Cora & Carl unit. Their son Joe marries Tess, whose
 * parents are not on the tree, so Joe joins a new Tess & Joe unit. Jon's Dad
 * and Mom are separated; Dad is not in a couple, so he stays with his own
 * parents. Ids follow the invented names.
 */
export const FIXTURE_MATERNAL_FAMILY: TreeData = {
  focusPersonId: fuId("jon"),
  people: [
    fx("carl", "Carl"),
    fx("cora", "Cora"),
    fx("lena", "Lena", "1990-01-01"),
    fx("hana", "Hana", "1992-01-01"),
    fx("joe", "Joe", "1994-01-01"),
    fx("jon", "Jon", "1989-01-01"),
    fx("kit", "Kit"),
    fx("tess", "Tess"),
    fx("gk1", "Grandkid 1", "2018-01-01"),
    fx("gk2", "Grandkid 2", "2020-01-01"),
    fx("gk3", "Grandkid 3", "2022-01-01"),
    fx("gk4", "Grandkid 4", "2024-01-01"),
    fx("cz1", "Cousin 1"),
    fx("cz2", "Cousin 2"),
    fx("cz3", "Cousin 3"),
    fx("lt1", "Little 1"),
    fx("lt2", "Little 2"),
    fx("dad", "Dad"),
    fx("mom", "Mom"),
    fx("grandpa", "Grandpa"),
    fx("grandma", "Grandma"),
  ],
  unions: [
    couple("carl", "cora", "married"),
    couple("jon", "lena", "married"),
    couple("kit", "hana", "married"),
    couple("joe", "tess", "married"),
    couple("dad", "mom", "separated"),
    couple("grandpa", "grandma", "married"),
  ],
  childLinks: [
    kid("lena", [["carl", "father"], ["cora", "mother"]]),
    kid("hana", [["carl", "father"], ["cora", "mother"]]),
    kid("joe", [["carl", "father"], ["cora", "mother"]]),
    kid("gk1", [["jon", "father"], ["lena", "mother"]]),
    kid("gk2", [["jon", "father"], ["lena", "mother"]]),
    kid("gk3", [["jon", "father"], ["lena", "mother"]]),
    kid("gk4", [["jon", "father"], ["lena", "mother"]]),
    kid("cz1", [["kit", "father"], ["hana", "mother"]]),
    kid("cz2", [["kit", "father"], ["hana", "mother"]]),
    kid("cz3", [["kit", "father"], ["hana", "mother"]]),
    kid("lt1", [["joe", "father"], ["tess", "mother"]]),
    kid("lt2", [["joe", "father"], ["tess", "mother"]]),
    kid("jon", [["dad", "father"], ["mom", "mother"]]),
    kid("dad", [["grandpa", "father"], ["grandma", "mother"]]),
  ],
};

/**
 * FIXTURE: remarriage with half and step children. Dad and Mom separated;
 * Kid is theirs. Dad then married Stepmom; Baby is theirs, and Stepkid is
 * Stepmom's child from before, with Dad as step-parent.
 */
export const FIXTURE_REMARRIAGE: TreeData = {
  focusPersonId: fuId("dad"),
  people: [
    fx("dad", "Dad"),
    fx("mom", "Mom"),
    fx("stepmom", "Stepmom"),
    fx("kid", "Kid", "2012-01-01"),
    fx("stepkid", "Stepkid", "2010-01-01"),
    fx("baby", "Baby", "2020-01-01"),
  ],
  unions: [couple("dad", "mom", "separated"), couple("dad", "stepmom", "married")],
  childLinks: [
    kid("kid", [["dad", "father"], ["mom", "mother"]]),
    kid("stepkid", [["stepmom", "mother"], ["dad", "father", "step"]]),
    kid("baby", [["dad", "father"], ["stepmom", "mother"]]),
  ],
};

/**
 * FIXTURE: a step-father with a son of his own (mother not on the tree), and
 * a stepchild whose only recorded parent is that step-father.
 */
export const FIXTURE_STEP_FAMILY: TreeData = {
  focusPersonId: fuId("mom"),
  people: [
    fx("gran", "Gran"),
    fx("mom", "Mom"),
    fx("stepdad", "Stepdad"),
    fx("child", "Child"),
    fx("hisson", "His son"),
    fx("fosterkid", "Fosterkid"),
  ],
  unions: [couple("mom", "stepdad", "partnered")],
  childLinks: [
    kid("mom", [["gran", "mother"]]),
    kid("child", [["mom", "mother"], ["stepdad", "father", "step"]]),
    kid("hisson", [["stepdad", "father"]]),
    kid("fosterkid", [["stepdad", "father", "foster"]]),
  ],
};

/**
 * FIXTURE: divorced and unmarried co-parents. Ana and Ben are separated and
 * both have parents on the tree; their child is Cy. Dee and Eli share a child,
 * Fay, with a union of unspecified kind (not a couple); Eli has no family on
 * the tree.
 */
export const FIXTURE_COPARENTS: TreeData = {
  focusPersonId: fuId("ana"),
  people: [
    fx("anamom", "Ana's mom"),
    fx("anadad", "Ana's dad"),
    fx("benmom", "Ben's mom"),
    fx("bendad", "Ben's dad"),
    fx("ana", "Ana"),
    fx("ben", "Ben"),
    fx("cy", "Cy"),
    fx("dee", "Dee"),
    fx("eli", "Eli"),
    fx("fay", "Fay"),
  ],
  unions: [
    couple("anadad", "anamom", "married"),
    couple("bendad", "benmom", "married"),
    couple("ben", "ana", "separated"),
    couple("eli", "dee", "unspecified"),
  ],
  childLinks: [
    kid("ana", [["anadad", "father"], ["anamom", "mother"]]),
    kid("ben", [["bendad", "father"], ["benmom", "mother"]]),
    kid("cy", [["ben", "father"], ["ana", "mother"]]),
    kid("fay", [["eli", "father"], ["dee", "mother"]]),
  ],
};

/**
 * FIXTURE: single parents. Sol is a single father whose parents are on the
 * tree; Ray is his child. Uma is a single mother with no parents recorded.
 */
export const FIXTURE_SINGLE_PARENTS: TreeData = {
  focusPersonId: fuId("sol"),
  people: [
    fx("solmom", "Sol's mom"),
    fx("soldad", "Sol's dad"),
    fx("sol", "Sol"),
    fx("ray", "Ray"),
    fx("uma", "Uma"),
    fx("vic", "Vic"),
  ],
  unions: [couple("soldad", "solmom", "married")],
  childLinks: [
    kid("sol", [["soldad", "father"], ["solmom", "mother"]]),
    kid("ray", [["sol", "father"]]),
    kid("vic", [["uma", "mother"]]),
  ],
};

/**
 * FIXTURE: unknown parents and unknown sex. Kid's link names a parent who is
 * not on the tree. Lone has no relatives. Pat and Quinn are a childless
 * married couple with no mother/father roles recorded anywhere; only Quinn's
 * parent is on the tree.
 */
export const FIXTURE_UNKNOWN: TreeData = {
  focusPersonId: fuId("parent"),
  people: [
    fx("parent", "Parent"),
    fx("kid", "Kid"),
    fx("lone", "Lone"),
    fx("pat", "Pat"),
    fx("quinn", "Quinn"),
    fx("quinnparent", "Quinn's parent"),
  ],
  unions: [couple("pat", "quinn", "married")],
  childLinks: [
    kid("kid", [["parent", "mother"], ["!fu-fx-missing", "father"]]),
    kid("quinn", [["quinnparent"]]),
  ],
};

/**
 * FIXTURE: same-sex couples. Mia and Noa are married mothers who both have
 * parents on the tree (Mia is listed first). Ola and Pia are married mothers
 * where only Pia (listed second) has a parent on the tree.
 */
export const FIXTURE_SAME_SEX: TreeData = {
  focusPersonId: fuId("mia"),
  people: [
    fx("miamom", "Mia's mom"),
    fx("noamom", "Noa's mom"),
    fx("mia", "Mia"),
    fx("noa", "Noa"),
    fx("tot", "Tot"),
    fx("ola", "Ola"),
    fx("pia", "Pia"),
    fx("piamom", "Pia's mom"),
    fx("lil", "Lil"),
  ],
  unions: [couple("mia", "noa", "married"), couple("ola", "pia", "married")],
  childLinks: [
    kid("mia", [["miamom", "mother"]]),
    kid("noa", [["noamom", "mother"]]),
    kid("tot", [["mia", "mother"], ["noa", "mother"]]),
    kid("pia", [["piamom", "mother"]]),
    kid("lil", [["ola", "mother"], ["pia", "mother"]]),
  ],
};

/**
 * FIXTURE: no daughter line. Al & Bea have only sons, Cal and Dan. Cal
 * marries Eve, whose parents are not on the tree; Dan is single and childless.
 * Gus only has a father, Hal, recorded.
 */
export const FIXTURE_NO_DAUGHTERS: TreeData = {
  focusPersonId: fuId("al"),
  people: [
    fx("al", "Al"),
    fx("bea", "Bea"),
    fx("cal", "Cal"),
    fx("dan", "Dan"),
    fx("eve", "Eve"),
    fx("kit", "Kit"),
    fx("hal", "Hal"),
    fx("gus", "Gus"),
  ],
  unions: [couple("al", "bea", "married"), couple("cal", "eve", "married")],
  childLinks: [
    kid("cal", [["al", "father"], ["bea", "mother"]]),
    kid("dan", [["al", "father"], ["bea", "mother"]]),
    kid("kit", [["cal", "father"], ["eve", "mother"]]),
    kid("gus", [["hal", "father"]]),
  ],
};

/** FIXTURE: broken data. Ouro is recorded as their own grandparent. */
export const FIXTURE_CYCLE: TreeData = {
  focusPersonId: fuId("ouro"),
  people: [fx("ouro", "Ouro"), fx("boros", "Boros")],
  unions: [],
  childLinks: [kid("ouro", [["boros", "mother"]]), kid("boros", [["ouro", "mother"]])],
};

export const ALL_FAMILY_UNIT_FIXTURES: Record<string, TreeData> = {
  FIXTURE_MATERNAL_FAMILY,
  FIXTURE_REMARRIAGE,
  FIXTURE_STEP_FAMILY,
  FIXTURE_COPARENTS,
  FIXTURE_SINGLE_PARENTS,
  FIXTURE_UNKNOWN,
  FIXTURE_SAME_SEX,
  FIXTURE_NO_DAUGHTERS,
  FIXTURE_CYCLE,
};
