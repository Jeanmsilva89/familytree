import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveFamilyUnits } from "../familyUnits";
import type { Person, TreeData } from "../types";
import { parseAccess, serializeAccess } from "./arrange";
import { FIXTURE_DIVORCE, FIXTURE_REMARRIAGE, HOME_TREE_ID, ax } from "./fixtures";
import { asInviteId, asLensId, asPersonId, asTreeId, DEVICE_TREE_ID } from "./ids";
import { acceptedInvite, pendingInvite, revokedInvite } from "./link";
import {
  SHARE_NOT_BUNDLE,
  exportShareBundle,
  importShareBundle,
  linkSharedPerson,
  parseShareBundle,
  parseShareBundleText,
  removeSharedFamily,
  serializeShareBundle,
  summarizeShareBundle,
  type ShareIds,
} from "./share";
import {
  emptyAccess,
  guestViewer,
  memberViewer,
  resolveEdit,
  type AccessState,
  type LensRule,
  type VisibilityLens,
} from "./index";

const home = asTreeId(HOME_TREE_ID);
const device = DEVICE_TREE_ID;
const pid = (id: string) => asPersonId(ax(id));
const EXPORTED = "2024-06-01T00:00:00.000Z";
const IMPORTED = "2024-07-01T00:00:00.000Z";
const LATER = "2024-08-01T00:00:00.000Z";
const STAMP = "2020-01-01T00:00:00.000Z";

function lens(viewer: VisibilityLens["viewer"], rules: LensRule[], detailGrants: VisibilityLens["detailGrants"] = []): VisibilityLens {
  return { id: asLensId("lens-share"), viewer, rules, detailGrants };
}

function owned(extra: Partial<AccessState> = {}): AccessState {
  return {
    ...emptyAccess(),
    ...extra,
    trees: extra.trees ?? [{ treeId: home, ownerPersonId: pid("ada") }],
  };
}

function idsFor(prefix = "loc"): ShareIds & { personCalls: string[] } {
  const personCalls: string[] = [];
  let n = 0;
  return {
    personCalls,
    person: (source) => {
      personCalls.push(source);
      return `${prefix}-p-${source}`;
    },
    union: (source) => `${prefix}-u-${source}-${n++}`,
    child: (source) => `${prefix}-c-${source}-${n++}`,
  };
}

function person(id: string, givenName: string, extra: Partial<Person> = {}): Person {
  return { id, givenName, familyName: "FIXTURE", createdAt: STAMP, updatedAt: STAMP, ...extra };
}

function hostTree(): TreeData {
  return {
    focusPersonId: "home-host",
    people: [
      person("home-host", "Ada", { bio: "HOME bio", birthDate: "1800-01-01" }),
      person("home-kid", "Kid"),
    ],
    unions: [],
    childLinks: [{ id: "home-c-kid", childId: "home-kid", parentIds: ["home-host"] }],
  };
}

function hostAccess(): AccessState {
  return { ...emptyAccess(), trees: [{ treeId: device, ownerPersonId: asPersonId("home-host") }] };
}

function divorceWithDate(): TreeData {
  return {
    ...FIXTURE_DIVORCE,
    people: FIXTURE_DIVORCE.people.map((item) => (item.id === ax("ada") ? { ...item, birthDate: "1800-01-01" } : item)),
  };
}

describe("share bundle export", () => {
  const tree = divorceWithDate();
  const ben = memberViewer(home, pid("ben"));
  const ada = memberViewer(home, pid("ada"));

  function bundleFor(viewer: VisibilityLens["viewer"], rules: LensRule[], access: AccessState = owned(), grants: VisibilityLens["detailGrants"] = []) {
    return exportShareBundle(tree, { ...access, lenses: [lens(viewer, rules, grants)] }, viewer, EXPORTED);
  }

  it("leaves hidden people out and reduces withheld living details to a name", () => {
    const bundle = bundleFor(ben, [
      { scope: "person", treeId: home, personId: pid("ada"), effect: "include" },
      { scope: "person", treeId: home, personId: pid("ben"), effect: "include" },
      { scope: "person", treeId: home, personId: pid("cam"), effect: "dim" },
      { scope: "person", treeId: home, personId: pid("dee"), effect: "hide" },
    ]);
    const names = bundle.people.map((item) => item.givenName).sort();
    assert.deepEqual(names, ["Ada", "Ben", "Cam"]);
    assert.equal(bundle.people.some((item) => item.id === ax("dee")), false);
    assert.equal(bundle.people.some((item) => item.id === ax("nia")), false);
    const cam = bundle.people.find((item) => item.id === ax("cam"));
    assert.equal(cam?.presence, "dimmed");
    assert.equal(cam?.details, "withheld");
    assert.equal(cam?.givenName, "Cam");
    assert.equal("bio" in (cam ?? {}), false);
    assert.equal("photo" in (cam ?? {}), false);
    assert.equal("birthDate" in (cam ?? {}), false);
    assert.equal(JSON.stringify(bundle).includes("fx-dee"), false);
    const text = JSON.stringify(bundle);
    assert.equal(text.includes(ax("pip")), false);
    assert.equal(bundle.unions.some((union) => union.id === ax("u-cam-nia")), false);
    assert.equal(bundle.childLinks.some((link) => link.childId === ax("pip")), false);
  });

  it("opens details for a grant, for the viewer, and for someone marked deceased", () => {
    const dead = owned({ deceasedPersonIds: [{ treeId: home, personId: pid("pat") }] });
    const bundle = bundleFor(
      ben,
      [
        { scope: "person", treeId: home, personId: pid("ada"), effect: "include" },
        { scope: "person", treeId: home, personId: pid("ben"), effect: "include" },
        { scope: "person", treeId: home, personId: pid("pat"), effect: "include" },
      ],
      dead,
      [{ treeId: home, personId: pid("ada") }],
    );
    const adaCard = bundle.people.find((item) => item.id === ax("ada"));
    assert.equal(adaCard?.details, "open");
    assert.equal(adaCard?.bio, "FIXTURE bio");
    assert.deepEqual(adaCard?.emails, ["fixture@example.com"]);
    assert.equal(adaCard?.photo, "fixture-photo");
    assert.equal(adaCard?.birthDate, "1800-01-01");
    const self = exportShareBundle(
      tree,
      { ...owned(), lenses: [lens(ada, [{ scope: "person", treeId: home, personId: pid("ada"), effect: "include" }])] },
      ada,
      EXPORTED,
    );
    assert.equal(self.people[0].details, "open");
    assert.equal(self.people[0].bio, "FIXTURE bio");
    const pat = bundle.people.find((item) => item.id === ax("pat"));
    assert.equal(pat?.details, "open");
    assert.equal(pat?.bio, "FIXTURE bio deceased");
  });

  it("does not put a hidden owner's living details in the file, only their name", () => {
    const bundle = bundleFor(ben, [{ scope: "person", treeId: home, personId: pid("ben"), effect: "include" }]);
    assert.equal(bundle.source.ownerName, "Ada FIXTURE");
    assert.equal(bundle.people.some((item) => item.id === ax("ada")), false);
    assert.equal(JSON.stringify(bundle).includes("FIXTURE bio"), false);
    assert.equal(JSON.stringify(bundle).includes("fixture@example.com"), false);
    assert.equal(JSON.stringify(bundle).includes("fixture-photo"), false);
  });

  it("keeps a step link and drops a link that names someone hidden", () => {
    const view = memberViewer(home, pid("gil"));
    const rules: LensRule[] = ["ada", "gil", "cam", "hap"].map((id) => ({
      scope: "person" as const,
      treeId: home,
      personId: pid(id),
      effect: "include" as const,
    }));
    const bundle = exportShareBundle(
      FIXTURE_REMARRIAGE,
      { ...owned(), lenses: [lens(view, rules)] },
      view,
      EXPORTED,
    );
    assert.equal(bundle.people.some((item) => item.id === ax("ben")), false);
    assert.equal(bundle.childLinks.some((link) => link.id === ax("c-cam")), false);
    const step = bundle.childLinks.find((link) => link.id === ax("c-cam-gil"));
    assert.equal(step?.kin?.[ax("gil")], "step");
    const adaStep = bundle.childLinks.find((link) => link.id === ax("c-hap-ada"));
    assert.equal(adaStep?.kin?.[ax("ada")], "step");
    assert.equal(adaStep?.roles?.[ax("ada")], undefined);
  });

  it("shows nothing for a pending or revoked invite, even when a lens names people", () => {
    const invite = pendingInvite({
      id: asInviteId("invite-quinn"),
      sourceTreeId: home,
      targetTreeId: home,
      invitedByPersonId: pid("ada"),
      guestLabel: "Quinn FIXTURE",
    });
    const guest = guestViewer(home, invite.id);
    const rules: LensRule[] = [{ scope: "person", treeId: home, personId: pid("ada"), effect: "include" }];
    const pending = exportShareBundle(tree, owned({ links: [invite], lenses: [lens(guest, rules)] }), guest, EXPORTED);
    assert.deepEqual(pending.people, []);
    assert.equal(JSON.stringify(pending).includes("FIXTURE bio"), false);
    const revoked = revokedInvite({ ...invite, grant: { personIds: [pid("ada")], branchRootIds: [] } });
    const closed = exportShareBundle(tree, owned({ links: [revoked], lenses: [lens(guest, rules)] }), guest, EXPORTED);
    assert.deepEqual(closed.people, []);
  });

  it("sends an accepted guest only the people the invite grants, details withheld", () => {
    const invite = acceptedInvite({
      id: asInviteId("invite-yan"),
      sourceTreeId: home,
      targetTreeId: asTreeId("ax-fx-tree-outside"),
      invitedByPersonId: pid("ada"),
      guestLabel: "Yan FIXTURE",
      grant: { personIds: [pid("ada")], branchRootIds: [] },
    });
    const guest = guestViewer(home, invite.id);
    const bundle = exportShareBundle(tree, owned({ links: [invite] }), guest, EXPORTED);
    assert.deepEqual(bundle.people.map((item) => item.id), [ax("ada")]);
    assert.equal(bundle.people[0].details, "withheld");
    assert.equal("bio" in bundle.people[0], false);
    assert.equal(bundle.unions.length, 0);
    assert.equal(JSON.stringify(bundle).includes("fixture-photo"), false);
  });
});

describe("share bundle boundary", () => {
  const sample = () => exportShareBundle(
    divorceWithDate(),
    { ...owned(), lenses: [lens(memberViewer(home, pid("ben")), [{ scope: "person", treeId: home, personId: pid("ben"), effect: "include" }])] },
    memberViewer(home, pid("ben")),
    EXPORTED,
  );

  it("reads version 1 and rejects a malformed file or an unknown version", () => {
    const bundle = sample();
    assert.deepEqual(parseShareBundle(JSON.parse(serializeShareBundle(bundle))), bundle);
    assert.equal(summarizeShareBundle(bundle).counts.people, 1);
    assert.throws(() => parseShareBundle(null), new Error(SHARE_NOT_BUNDLE));
    assert.throws(() => parseShareBundleText("{"), new Error(SHARE_NOT_BUNDLE));
    assert.throws(() => parseShareBundle({ format: "other", version: 1 }), new Error(SHARE_NOT_BUNDLE));
    assert.throws(() => parseShareBundle({ format: "familytree-share" }), /no version/);
    assert.throws(() => parseShareBundle({ format: "familytree-share", version: "1" }), /no version/);
    assert.throws(
      () => parseShareBundle({ ...JSON.parse(serializeShareBundle(bundle)), version: 2 }),
      /version 2, which this app cannot read/,
    );
    assert.throws(() => parseShareBundle({ format: "familytree-share", version: 1, source: bundle.source, people: [{ id: "x", presence: "shown", details: "withheld" }], unions: [], childLinks: [] }), /without a name/);
  });

  it("strips living details that a withheld person is not allowed to carry", () => {
    const raw = {
      format: "familytree-share",
      version: 1,
      source: { treeId: HOME_TREE_ID, ownerPersonId: ax("ada"), ownerName: "Ada FIXTURE", exportedAt: EXPORTED },
      people: [{
        id: ax("cam"),
        givenName: "Cam",
        familyName: "FIXTURE",
        presence: "shown",
        details: "withheld",
        bio: "smuggled",
        birthDate: "1800-01-01",
        photo: "smuggled-photo",
        emails: ["secret@example.com"],
      }],
      unions: [],
      childLinks: [],
    };
    const parsed = parseShareBundle(raw);
    assert.equal(parsed.people[0].givenName, "Cam");
    assert.equal("bio" in parsed.people[0], false);
    assert.equal("photo" in parsed.people[0], false);
    assert.equal("birthDate" in parsed.people[0], false);
    assert.equal(JSON.stringify(parsed).includes("smuggled"), false);
    assert.equal(JSON.stringify(parsed).includes("secret@example.com"), false);
  });

  it("rejects a link to someone the file does not contain", () => {
    assert.throws(() => parseShareBundle({
      format: "familytree-share",
      version: 1,
      source: { treeId: HOME_TREE_ID, ownerPersonId: ax("ada"), ownerName: "Ada FIXTURE", exportedAt: EXPORTED },
      people: [{ id: ax("ada"), givenName: "Ada", presence: "shown", details: "withheld" }],
      unions: [{ id: "u", partnerIds: [ax("ada"), ax("ben")], kind: "married" }],
      childLinks: [],
    }), /relative who is not in it/);
  });
});

describe("importing a shared family", () => {
  function exported() {
    const tree = divorceWithDate();
    const ben = memberViewer(home, pid("ben"));
    const rules: LensRule[] = ["ada", "ben", "cam"].map((id) => ({
      scope: "person" as const,
      treeId: home,
      personId: pid(id),
      effect: "include" as const,
    }));
    rules.push({ scope: "person", treeId: home, personId: pid("dee"), effect: "hide" });
    return exportShareBundle(
      tree,
      {
        ...owned({ deceasedPersonIds: [] }),
        lenses: [lens(ben, rules, [{ treeId: home, personId: pid("ada") }])],
      },
      ben,
      EXPORTED,
    );
  }

  it("adds the people as a new family and does not merge them with the same name and date", () => {
    const bundle = exported();
    const ids = idsFor();
    const result = importShareBundle(hostTree(), hostAccess(), bundle, { importedAt: IMPORTED, ids });
    const hosts = result.tree.people.filter((item) => item.givenName === "Ada" && item.birthDate === "1800-01-01");
    assert.equal(hosts.length, 2);
    const homeAda = result.tree.people.find((item) => item.id === "home-host");
    assert.equal(homeAda?.bio, "HOME bio");
    const sharedAda = result.tree.people.find((item) => item.id === `loc-p-${ax("ada")}`);
    assert.equal(sharedAda?.bio, "FIXTURE bio");
    assert.equal(sharedAda?.photo, "fixture-photo");
    assert.notEqual(sharedAda?.id, homeAda?.id);
    assert.equal(result.tree.unions.some((union) => union.partnerIds.includes("home-host") && union.partnerIds.includes(sharedAda!.id)), false);
    assert.equal(result.family.sourceTreeId, home);
    assert.equal(result.family.ownerPersonId, pid("ada"));
    assert.equal(result.family.ownerName, "Ada FIXTURE");
    assert.equal(result.family.importedAt, IMPORTED);
    assert.equal(result.family.exportedAt, EXPORTED);
    assert.equal("access" in result.tree, false);
    const cam = result.tree.people.find((item) => item.id === `loc-p-${ax("cam")}`);
    assert.equal(cam?.givenName, "Cam");
    assert.equal(cam?.bio, undefined);
    assert.equal(cam?.birthDate, undefined);
    assert.equal(result.tree.people.some((item) => item.givenName === "Dee"), false);
    const units = deriveFamilyUnits(result.tree);
    const hostUnit = units.unitOf["home-host"];
    assert.notEqual(units.unitOf[sharedAda!.id], hostUnit);
    assert.notEqual(units.unitOf[`loc-p-${ax("ben")}`], hostUnit);
    assert.equal(units.unitOf[`loc-p-${ax("cam")}`], units.unitOf[sharedAda!.id]);
  });

  it("is read-only for the importer, including when their id matches the sender", () => {
    const bundle = exported();
    const imported = importShareBundle(hostTree(), hostAccess(), bundle, { importedAt: IMPORTED, ids: idsFor() });
    const forest = { [device]: imported.tree };
    const owner = memberViewer(device, asPersonId("home-host"));
    const sharedBen = asPersonId(`loc-p-${ax("ben")}`);
    const decision = resolveEdit(forest, imported.access, owner, { kind: "person", treeId: device, personId: sharedBen });
    assert.equal(decision.mayEdit, false);
    assert.equal(decision.standing?.rank, "tree-owner");
    assert.equal(decision.standing?.branchRootId, pid("ada"));
    const internal = imported.tree.unions.find((union) => union.partnerIds.every((id) => id.startsWith("loc-p-")));
    assert.ok(internal);
    assert.equal(resolveEdit(forest, imported.access, owner, { kind: "union", treeId: device, unionId: internal.id }).mayEdit, false);
    const child = imported.tree.childLinks.find((link) => link.id.startsWith("loc-c-"));
    assert.ok(child);
    assert.equal(resolveEdit(forest, imported.access, owner, { kind: "childLink", treeId: device, childLinkId: child.id }).mayEdit, false);
    assert.equal(resolveEdit(forest, imported.access, owner, { kind: "person", treeId: device, personId: asPersonId("home-host") }).mayEdit, true);
    assert.equal(resolveEdit(forest, imported.access, owner, { kind: "childLink", treeId: device, childLinkId: "home-c-kid" }).mayEdit, true);

    const collided = importShareBundle(
      hostTree(),
      { ...hostAccess(), trees: [{ treeId: device, ownerPersonId: pid("ada") }] },
      bundle,
      { importedAt: IMPORTED, ids: idsFor("same") },
    );
    const still = resolveEdit(
      { [device]: collided.tree },
      collided.access,
      memberViewer(device, pid("ada")),
      { kind: "person", treeId: device, personId: asPersonId(`same-p-${ax("ben")}`) },
    );
    assert.equal(still.mayEdit, false);
  });

  it("joins the trees only through a link the importer chooses, and keeps each family in its own bucket", () => {
    const bundle = exported();
    const first = importShareBundle(hostTree(), hostAccess(), bundle, { importedAt: IMPORTED, ids: idsFor() });
    const sharedBen = `loc-p-${ax("ben")}`;
    const linked = linkSharedPerson(first.tree, first.access, first.family.id, sharedBen, "home-host", "partner");
    assert.equal(linked.tree.people.length, first.tree.people.length);
    assert.equal(linked.tree.people.filter((item) => item.givenName === "Ben").length, 1);
    const bridge = linked.tree.unions.find((union) => union.partnerIds.includes("home-host") && union.partnerIds.includes(sharedBen));
    assert.ok(bridge);
    const again = linkSharedPerson(linked.tree, linked.access, first.family.id, sharedBen, "home-host", "partner");
    assert.equal(again.tree.unions.length, linked.tree.unions.length);
    assert.equal(again.access.sharedFamilies?.[0].bridges.length, 1);
    const units = deriveFamilyUnits(linked.tree);
    assert.notEqual(units.unitOf["home-host"], units.unitOf[sharedBen]);
    assert.notEqual(units.unitOf[`loc-p-${ax("ada")}`], units.unitOf["home-host"]);
    assert.equal(units.unitOf[`loc-p-${ax("cam")}`], units.unitOf[`loc-p-${ax("ada")}`]);
    assert.equal(units.links.some((link) => link.kind === "partner" && [link.fromPersonId, link.toPersonId].sort().join() === ["home-host", sharedBen].sort().join()), true);
    const home = resolveEdit(
      { [device]: linked.tree },
      linked.access,
      memberViewer(device, asPersonId("home-host")),
      { kind: "union", treeId: device, unionId: bridge.id },
    );
    assert.equal(home.mayEdit, true);

    const adaId = `loc-p-${ax("ada")}`;
    const camId = `loc-p-${ax("cam")}`;
    const withMother: TreeData = {
      ...first.tree,
      childLinks: first.tree.childLinks.map((link) =>
        link.childId === camId ? { ...link, roles: { ...link.roles, [adaId]: "mother" } } : link,
      ),
    };
    const mother = linkSharedPerson(withMother, first.access, first.family.id, adaId, "home-host", "partner");
    const placed = deriveFamilyUnits(mother.tree);
    assert.equal(placed.unitOf[`loc-p-${ax("ada")}`], placed.unitOf[`loc-p-${ax("cam")}`]);
    assert.notEqual(placed.unitOf["home-host"], placed.unitOf[`loc-p-${ax("ada")}`]);
    assert.equal(placed.unitOf["home-kid"], placed.unitOf["home-host"]);
  });

  it("updates a newer bundle from the same source in place", () => {
    const bundle = exported();
    const ids = idsFor();
    const first = importShareBundle(hostTree(), hostAccess(), bundle, { importedAt: IMPORTED, ids });
    const linked = linkSharedPerson(first.tree, first.access, first.family.id, `loc-p-${ax("ben")}`, "home-host", "partner");
    const calls = ids.personCalls.length;
    const newer = parseShareBundle(JSON.parse(serializeShareBundle(bundle)));
    newer.people = newer.people.filter((item) => item.id !== ax("cam"));
    const adaCard = newer.people.find((item) => item.id === ax("ada"));
    if (adaCard) adaCard.bio = "FIXTURE bio updated";
    newer.people.push({ id: ax("dee"), givenName: "Dee", familyName: "FIXTURE", presence: "shown", details: "withheld" });
    newer.unions = newer.unions.filter((union) => union.partnerIds.every((id) => id !== ax("cam")));
    newer.childLinks = [];
    newer.source = { ...newer.source, exportedAt: LATER };
    const second = importShareBundle(linked.tree, linked.access, newer, { importedAt: LATER, ids });
    assert.equal(second.access.sharedFamilies?.length, 1);
    assert.equal(second.family.id, first.family.id);
    assert.equal(second.family.exportedAt, LATER);
    assert.equal(second.family.importedAt, LATER);
    const adaPerson = second.tree.people.find((item) => item.id === `loc-p-${ax("ada")}`);
    assert.equal(adaPerson?.bio, "FIXTURE bio updated");
    assert.equal(adaPerson?.createdAt, IMPORTED);
    assert.equal(second.tree.people.some((item) => item.id === `loc-p-${ax("cam")}`), false);
    assert.equal(second.tree.people.filter((item) => item.givenName === "Dee").length, 1);
    assert.equal(second.tree.people.filter((item) => item.givenName === "Ben").length, 1);
    assert.equal(ids.personCalls.length, calls + 1);
    assert.equal(second.tree.unions.filter((union) => union.partnerIds.includes("home-host") && union.partnerIds.includes(`loc-p-${ax("ben")}`)).length, 1);
    assert.equal(second.tree.people.some((item) => item.id === "home-kid"), true);
    const repeated = importShareBundle(second.tree, second.access, newer, { importedAt: LATER, ids });
    assert.equal(repeated.tree.people.length, second.tree.people.length);
    assert.equal(repeated.access.sharedFamilies?.length, 1);
  });

  it("removes only the imported people and their links", () => {
    const bundle = exported();
    const first = importShareBundle(hostTree(), hostAccess(), bundle, { importedAt: IMPORTED, ids: idsFor() });
    const linked = linkSharedPerson(first.tree, first.access, first.family.id, `loc-p-${ax("ben")}`, "home-host", "child");
    const removed = removeSharedFamily(linked.tree, linked.access, first.family.id);
    assert.deepEqual(removed.tree.people.map((item) => item.id).sort(), ["home-host", "home-kid"]);
    assert.equal(removed.tree.childLinks.some((link) => link.id === "home-c-kid"), true);
    assert.equal(removed.tree.unions.length, 0);
    assert.equal(removed.tree.childLinks.some((link) => link.childId !== "home-kid"), false);
    assert.equal(removed.access.sharedFamilies, undefined);
    assert.equal(removed.tree.people.find((item) => item.id === "home-host")?.bio, "HOME bio");
  });

  it("keeps a second source when one shared family is removed", () => {
    const bundle = exported();
    const first = importShareBundle(hostTree(), hostAccess(), bundle, { importedAt: IMPORTED, ids: idsFor("a") });
    const other = parseShareBundle(JSON.parse(serializeShareBundle(bundle)));
    other.source = { ...other.source, ownerPersonId: ax("ben"), ownerName: "Ben FIXTURE" };
    const both = importShareBundle(first.tree, first.access, other, { importedAt: IMPORTED, ids: idsFor("b") });
    assert.equal(both.access.sharedFamilies?.length, 2);
    const left = removeSharedFamily(both.tree, both.access, first.family.id);
    assert.equal(left.access.sharedFamilies?.length, 1);
    assert.equal(left.access.sharedFamilies?.[0].ownerPersonId, pid("ben"));
    assert.equal(left.tree.people.some((item) => item.id === "home-host"), true);
    assert.equal(left.tree.people.some((item) => item.id.startsWith("b-p-")), true);
    assert.equal(left.tree.people.some((item) => item.id.startsWith("a-p-")), false);
  });

  it("remembers the shared family beside the tree", () => {
    const bundle = exported();
    const imported = importShareBundle(hostTree(), hostAccess(), bundle, { importedAt: IMPORTED, ids: idsFor() });
    const restored = parseAccess(serializeAccess(imported.access));
    assert.equal(restored.sharedFamilies?.length, 1);
    assert.equal(restored.sharedFamilies?.[0].members.length, imported.family.members.length);
    assert.equal(restored.sharedFamilies?.[0].sourceTreeId, home);
  });
});
