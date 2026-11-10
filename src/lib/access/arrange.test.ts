import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadTree, resetTreeStoreForTests, type TreeBackend } from "../db";
import { parseTreeJson } from "../tree";
import type { Person, TreeData } from "../types";
import {
  acceptInviteCard,
  addGuestCard,
  DEVICE_TREE_ID,
  ensureDeviceOwner,
  graphForViewer,
  marksForViewer,
  parseAccess,
  revokeInviteCard,
  separateAccess,
  serializeAccess,
  toggleDetailGrant,
  touchBranch,
  touchPerson,
  type LookingAs,
} from "./arrange";
import { asInviteId, asPersonId } from "./ids";
import { emptyAccess } from "./types";

const STAMP = "2020-01-01T00:00:00.000Z";

function person(id: string, givenName: string, extra: Partial<Pick<Person, "bio" | "birthDate" | "photo">> = {}): Person {
  return {
    id,
    givenName,
    familyName: "Fixture",
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  };
}

const ada = person("ada", "Ada");
const ben = person("ben", "Ben");
const eli = person("eli", "Eli", { bio: "Eli fixture bio", birthDate: "1990-01-01" });
const dee = person("dee", "Dee");
const fay = person("fay", "Fay", { bio: "Fay fixture bio", birthDate: "2015-05-05", photo: "fay-photo" });
const rex = person("rex", "Rex");
const cam = person("cam", "Cam", { bio: "Cam fixture bio" });

const tree: TreeData = {
  people: [ada, ben, eli, dee, fay, rex, cam],
  unions: [
    { id: "u-ab", partnerIds: [ada.id, ben.id], kind: "married" },
    { id: "u-ed", partnerIds: [eli.id, dee.id], kind: "married" },
  ],
  childLinks: [
    { id: "c-eli", childId: eli.id, parentIds: [ada.id, ben.id] },
    { id: "c-fay", childId: fay.id, parentIds: [eli.id, dee.id] },
  ],
  focusPersonId: ada.id,
};

const pid = (id: string) => asPersonId(id);
const eliView: LookingAs = { kind: "member", personId: pid(eli.id) };
const ownerView: LookingAs = { kind: "owner" };
const quinn = asInviteId("invite-quinn");
const guestView: LookingAs = { kind: "guest", inviteId: quinn };

function ids(access: ReturnType<typeof emptyAccess>, looking: LookingAs) {
  return graphForViewer(tree, access, looking).people.map((person) => person.personId as string).sort();
}

function withOwner(extra: Partial<ReturnType<typeof emptyAccess>> = {}) {
  return { ...ensureDeviceOwner(emptyAccess(), tree), ...extra };
}

describe("owner working view", () => {
  it("shows the whole tree, including a sealed person, until another viewer is chosen", () => {
    const access = withOwner({
      sealedPersonIds: [{ treeId: DEVICE_TREE_ID, personId: pid(cam.id) }],
    });
    const view = graphForViewer(tree, access, ownerView);
    assert.deepEqual(ids(access, ownerView), tree.people.map((person) => person.id).sort());
    assert.equal(view.people.every((person) => person.details === "open" && person.presence === "shown"), true);
    const sealed = view.people.find((person) => person.personId === cam.id);
    assert.equal(sealed?.bio, "Cam fixture bio");
    const touched = touchPerson(tree, access, ownerView, pid(fay.id));
    assert.equal(touched, access);
    assert.deepEqual(ids(touched, ownerView), ids(access, ownerView));
    const branched = touchBranch(tree, access, ownerView, pid(eli.id));
    assert.equal(branched, access);
  });
});

describe("arranging a member lens", () => {
  it("cycles a person through include, dim, and hide, then back", () => {
    let access = withOwner();
    assert.deepEqual(ids(access, eliView), []);

    access = touchPerson(tree, access, eliView, pid(fay.id));
    let fayCard = graphForViewer(tree, access, eliView).people.find((person) => person.personId === fay.id);
    assert.equal(fayCard?.presence, "shown");
    assert.equal(fayCard?.details, "withheld");
    assert.equal(fayCard?.bio, undefined);
    assert.equal(fayCard?.birthDate, undefined);
    assert.equal(fayCard?.photo, undefined);
    assert.equal(graphForViewer(tree, access, eliView).childLinks.some((link) => link.childId === fay.id), false);

    access = touchPerson(tree, access, eliView, pid(fay.id));
    fayCard = graphForViewer(tree, access, eliView).people.find((person) => person.personId === fay.id);
    assert.equal(fayCard?.presence, "dimmed");
    assert.equal(fayCard?.details, "withheld");

    access = touchPerson(tree, access, eliView, pid(fay.id));
    assert.deepEqual(ids(access, eliView), []);

    access = touchPerson(tree, access, eliView, pid(fay.id));
    assert.deepEqual(ids(access, eliView), [fay.id]);
    assert.deepEqual(ids(access, ownerView), tree.people.map((person) => person.id).sort());
  });

  it("opens a person's own details and keeps everyone else's living details shut", () => {
    let access = withOwner();
    access = touchPerson(tree, access, eliView, pid(eli.id));
    const self = graphForViewer(tree, access, eliView).people.find((person) => person.personId === eli.id);
    assert.equal(self?.details, "open");
    assert.equal(self?.bio, "Eli fixture bio");
    access = touchPerson(tree, access, eliView, pid(fay.id));
    const other = graphForViewer(tree, access, eliView).people.find((person) => person.personId === fay.id);
    assert.equal(other?.details, "withheld");
  });

  it("includes a branch, skips a sealed person, and lets a person touch reveal them", () => {
    let access = withOwner({
      sealedPersonIds: [{ treeId: DEVICE_TREE_ID, personId: pid(cam.id) }],
    });
    access = touchBranch(tree, access, eliView, pid(eli.id));
    assert.deepEqual(ids(access, eliView), [dee.id, eli.id, fay.id].sort());
    const view = graphForViewer(tree, access, eliView);
    assert.equal(view.unions.some((union) => union.id === "u-ed"), true);
    assert.equal(view.childLinks.some((link) => link.childId === fay.id), true);
    assert.equal(view.people.some((person) => person.personId === cam.id), false);

    access = touchPerson(tree, access, eliView, pid(cam.id));
    const revealed = graphForViewer(tree, access, eliView).people.find((person) => person.personId === cam.id);
    assert.equal(revealed?.presence, "shown");
    assert.equal(revealed?.bio, undefined);
  });

  it("lets a later person touch dim someone a branch included", () => {
    let access = withOwner();
    access = touchBranch(tree, access, eliView, pid(eli.id));
    access = touchPerson(tree, access, eliView, pid(fay.id));
    const view = graphForViewer(tree, access, eliView);
    assert.equal(view.people.find((person) => person.personId === fay.id)?.presence, "dimmed");
    assert.equal(view.people.find((person) => person.personId === dee.id)?.presence, "shown");
  });

  it("grants and withdraws living details without revealing anyone outside the view", () => {
    let access = withOwner({
      deceasedPersonIds: [{ treeId: DEVICE_TREE_ID, personId: pid(rex.id) }],
    });
    access = touchPerson(tree, access, eliView, pid(fay.id));
    access = touchPerson(tree, access, eliView, pid(dee.id));
    access = touchPerson(tree, access, eliView, pid(dee.id));
    const before = graphForViewer(tree, access, eliView);
    assert.equal(before.people.find((person) => person.personId === fay.id)?.details, "withheld");
    assert.equal(before.people.find((person) => person.personId === fay.id)?.photo, undefined);
    assert.equal(before.people.some((person) => person.personId === cam.id), false);

    access = toggleDetailGrant(tree, access, eliView, pid(fay.id));
    access = toggleDetailGrant(tree, access, eliView, pid(cam.id));
    access = toggleDetailGrant(tree, access, eliView, pid(eli.id));
    access = toggleDetailGrant(tree, access, eliView, pid(rex.id));
    const granted = graphForViewer(tree, access, eliView);
    const fayCard = granted.people.find((person) => person.personId === fay.id);
    assert.equal(fayCard?.presence, "shown");
    assert.equal(fayCard?.details, "open");
    assert.equal(fayCard?.bio, "Fay fixture bio");
    assert.equal(fayCard?.birthDate, "2015-05-05");
    assert.equal(fayCard?.photo, "fay-photo");
    assert.equal(granted.people.some((person) => person.personId === cam.id), false);
    assert.equal(JSON.stringify(granted).includes("Cam fixture bio"), false);
    const self = granted.people.find((person) => person.personId === eli.id);
    assert.equal(self, undefined);
    const rexCard = granted.people.find((person) => person.personId === rex.id);
    assert.equal(rexCard, undefined);
    const stored = access.lenses.find((item) => item.viewer.kind === "member" && item.viewer.personId === eli.id);
    assert.deepEqual(stored?.detailGrants.map((grant) => grant.personId), [fay.id, cam.id]);

    const arranging = marksForViewer(tree, access, eliView, false);
    assert.equal(arranging.find((mark) => mark.personId === fay.id)?.details, "open");
    assert.equal(arranging.find((mark) => mark.personId === cam.id)?.details, "withheld");
    assert.equal(arranging.find((mark) => mark.personId === cam.id)?.draw, "ghost");
    const preview = marksForViewer(tree, access, eliView, true);
    assert.equal(preview.find((mark) => mark.personId === fay.id)?.details, "open");
    assert.equal(preview.some((mark) => mark.personId === cam.id), false);

    access = touchPerson(tree, access, eliView, pid(fay.id));
    const dimmed = graphForViewer(tree, access, eliView).people.find((person) => person.personId === fay.id);
    assert.equal(dimmed?.presence, "dimmed");
    assert.equal(dimmed?.details, "open");
    assert.equal(dimmed?.photo, "fay-photo");

    access = toggleDetailGrant(tree, access, eliView, pid(fay.id));
    const withdrawn = graphForViewer(tree, access, eliView).people.find((person) => person.personId === fay.id);
    assert.equal(withdrawn?.presence, "dimmed");
    assert.equal(withdrawn?.details, "withheld");
    assert.equal(withdrawn?.photo, undefined);
    assert.equal(withdrawn?.birthDate, undefined);
    assert.equal(withdrawn?.bio, undefined);

    const owner = graphForViewer(tree, access, ownerView);
    assert.equal(owner.people.every((person) => person.details === "open"), true);
    assert.equal(toggleDetailGrant(tree, access, ownerView, pid(fay.id)), access);
    const restored = parseAccess(serializeAccess(access));
    assert.equal(graphForViewer(tree, restored, eliView).people.find((person) => person.personId === fay.id)?.details, "withheld");
  });

  it("keeps a viewer's own details and a deceased person's details open without a grant", () => {
    let access = withOwner({
      deceasedPersonIds: [{ treeId: DEVICE_TREE_ID, personId: pid(rex.id) }],
    });
    access = touchPerson(tree, access, eliView, pid(eli.id));
    access = touchPerson(tree, access, eliView, pid(rex.id));
    const self = graphForViewer(tree, access, eliView).people.find((person) => person.personId === eli.id);
    const rexCard = graphForViewer(tree, access, eliView).people.find((person) => person.personId === rex.id);
    assert.equal(self?.details, "open");
    assert.equal(self?.bio, "Eli fixture bio");
    assert.equal(rexCard?.details, "open");
    const untouched = toggleDetailGrant(tree, access, eliView, pid(eli.id));
    assert.equal(untouched, access);
    const stillDead = toggleDetailGrant(tree, access, eliView, pid(rex.id));
    assert.equal(stillDead, access);
    assert.equal(graphForViewer(tree, stillDead, eliView).people.find((person) => person.personId === eli.id)?.details, "open");
    assert.equal(graphForViewer(tree, stillDead, eliView).people.find((person) => person.personId === rex.id)?.details, "open");
  });

  it("marks hidden people as ghosts while arranging and drops them in preview", () => {
    let access = withOwner();
    access = touchPerson(tree, access, eliView, pid(fay.id));
    access = touchPerson(tree, access, eliView, pid(fay.id));
    access = touchPerson(tree, access, eliView, pid(fay.id));
    const arranging = marksForViewer(tree, access, eliView, false);
    const fayMark = arranging.find((mark) => mark.personId === fay.id);
    assert.equal(fayMark?.draw, "ghost");
    assert.equal(fayMark?.effect, "hide");
    const preview = marksForViewer(tree, access, eliView, true);
    assert.equal(preview.some((mark) => mark.personId === fay.id), false);
    const ownerMarks = marksForViewer(tree, access, ownerView, true);
    assert.equal(ownerMarks.length, tree.people.length);
    assert.equal(ownerMarks.every((mark) => mark.draw === "shown" && mark.details === "open"), true);
  });
});

describe("invite cards", () => {
  function pending() {
    let access = withOwner();
    access = addGuestCard(access, "Quinn Fixture", pid(ada.id), quinn);
    return access;
  }

  it("shows nothing while pending, the offer after accept, and nothing after revoke", () => {
    let access = pending();
    access = touchPerson(tree, access, guestView, pid(fay.id));
    assert.deepEqual(ids(access, guestView), []);
    assert.equal(marksForViewer(tree, access, guestView, true).length, 0);
    const draft = marksForViewer(tree, access, guestView, false).find((mark) => mark.personId === fay.id);
    assert.equal(draft?.draw, "ghost");
    assert.equal(draft?.effect, "include");

    access = acceptInviteCard(access, quinn);
    const granted = graphForViewer(tree, access, guestView);
    assert.deepEqual(granted.people.map((person) => person.personId), [fay.id]);
    assert.equal(granted.people[0].details, "withheld");
    assert.equal(granted.people[0].photo, undefined);
    assert.equal(granted.people[0].bio, undefined);

    access = touchPerson(tree, access, guestView, pid(ben.id));
    assert.deepEqual(ids(access, guestView), [fay.id]);
    access = touchPerson(tree, access, guestView, pid(fay.id));
    assert.equal(graphForViewer(tree, access, guestView).people[0].presence, "dimmed");

    access = touchPerson(tree, access, eliView, pid(dee.id));
    access = toggleDetailGrant(tree, access, eliView, pid(dee.id));
    access = toggleDetailGrant(tree, access, guestView, pid(fay.id));
    access = toggleDetailGrant(tree, access, guestView, pid(ben.id));
    const shared = graphForViewer(tree, access, guestView);
    assert.equal(shared.people[0].details, "open");
    assert.equal(shared.people[0].photo, "fay-photo");
    assert.equal(shared.people.some((person) => person.personId === ben.id), false);
    assert.equal(JSON.stringify(shared).includes("Ben"), false);

    access = revokeInviteCard(access, quinn);
    assert.deepEqual(ids(access, guestView), []);
    assert.equal(marksForViewer(tree, access, guestView, false).length, 0);
    const guestLens = access.lenses.find((item) => item.viewer.kind === "guest" && item.viewer.inviteId === quinn);
    assert.deepEqual(guestLens?.detailGrants ?? [], []);
    const memberLens = access.lenses.find((item) => item.viewer.kind === "member" && item.viewer.personId === eli.id);
    assert.deepEqual(memberLens?.detailGrants.map((grant) => grant.personId), [dee.id]);
    assert.equal(graphForViewer(tree, access, eliView).people.find((person) => person.personId === dee.id)?.details, "open");
    assert.equal(toggleDetailGrant(tree, access, guestView, pid(fay.id)), access);
    assert.equal(JSON.stringify(graphForViewer(tree, access, guestView)).includes("fay-photo"), false);
    const again = acceptInviteCard(access, quinn);
    assert.equal(again, access);
    assert.deepEqual(ids(access, ownerView), tree.people.map((person) => person.id).sort());
  });

  it("holds a detail grant quietly while an invite is pending, then opens it on accept", () => {
    let access = pending();
    access = touchPerson(tree, access, guestView, pid(fay.id));
    access = toggleDetailGrant(tree, access, guestView, pid(fay.id));
    access = toggleDetailGrant(tree, access, guestView, pid(ben.id));
    assert.deepEqual(ids(access, guestView), []);
    assert.equal(JSON.stringify(graphForViewer(tree, access, guestView)).includes("fay-photo"), false);
    access = acceptInviteCard(access, quinn);
    const view = graphForViewer(tree, access, guestView);
    assert.deepEqual(view.people.map((person) => person.personId), [fay.id]);
    assert.equal(view.people[0].details, "open");
    assert.equal(view.people[0].photo, "fay-photo");
    assert.equal(view.people[0].bio, "Fay fixture bio");
    assert.equal(view.people.some((person) => person.personId === ben.id), false);
  });

  it("accepts a prepared offer and does not add anyone the offer left out", () => {
    let access = pending();
    access = {
      ...access,
      offers: [{ inviteId: quinn, grant: { personIds: [pid(eli.id), pid(dee.id)], branchRootIds: [] } }],
    };
    assert.deepEqual(ids(access, guestView), []);
    access = acceptInviteCard(access, quinn);
    assert.deepEqual(ids(access, guestView), [dee.id, eli.id].sort());
    const view = graphForViewer(tree, access, guestView);
    assert.equal(view.unions.some((union) => union.partnerIds.includes(pid(eli.id)) && union.partnerIds.includes(pid(dee.id))), true);
    assert.equal(view.childLinks.some((link) => link.childId === fay.id), false);
    access = touchBranch(tree, access, guestView, pid(ada.id));
    assert.equal(ids(access, guestView).includes(ada.id), false);
    assert.equal(ids(access, guestView).includes(fay.id), false);
  });

  it("grants a branch from the offer and still withholds living details", () => {
    let access = pending();
    access = touchBranch(tree, access, guestView, pid(eli.id));
    assert.deepEqual(ids(access, guestView), []);
    access = acceptInviteCard(access, quinn);
    assert.deepEqual(ids(access, guestView), [dee.id, eli.id, fay.id].sort());
    const fayCard = graphForViewer(tree, access, guestView).people.find((person) => person.personId === fay.id);
    assert.equal(fayCard?.birthDate, undefined);
    assert.equal(fayCard?.photo, undefined);
  });
});

describe("reload", () => {
  it("keeps the arranged lens and the invite after a serialize round trip", () => {
    let access = withOwner({
      deceasedPersonIds: [{ treeId: DEVICE_TREE_ID, personId: pid(rex.id) }],
    });
    access = touchPerson(tree, access, eliView, pid(fay.id));
    access = touchPerson(tree, access, eliView, pid(fay.id));
    access = touchPerson(tree, access, eliView, pid(rex.id));
    access = addGuestCard(access, "Quinn Fixture", pid(ada.id), quinn);
    access = touchPerson(tree, access, guestView, pid(dee.id));
    access = acceptInviteCard(access, quinn);
    access = revokeInviteCard(access, quinn);

    const restored = parseAccess(serializeAccess(access));
    assert.deepEqual(ids(restored, eliView), [fay.id, rex.id].sort());
    assert.equal(graphForViewer(tree, restored, eliView).people.find((person) => person.personId === fay.id)?.presence, "dimmed");
    const rexCard = graphForViewer(tree, restored, eliView).people.find((person) => person.personId === rex.id);
    assert.equal(rexCard?.details, "open");
    assert.deepEqual(ids(restored, guestView), []);
    assert.equal(restored.links.find((link) => link.id === quinn)?.status, "revoked");
    assert.deepEqual(ids(restored, ownerView), tree.people.map((person) => person.id).sort());
  });
});

describe("backup sidecars", () => {
  it("leaves a backup from before access unchanged and does not store access on the tree", () => {
    const legacy = {
      people: [ada],
      unions: [],
      childLinks: [],
      focusPersonId: ada.id,
    };
    const parsed = parseTreeJson(JSON.stringify(legacy));
    const split = separateAccess(parsed);
    assert.equal(split.access, null);
    assert.deepEqual(split.tree, legacy);
    assert.equal("access" in split.tree, false);

    const withSidecar = {
      ...legacy,
      note: "FIXTURE",
      access: {
        ownerPersonId: ada.id,
        offers: [{ inviteId: "invite-quinn", grant: { personIds: [eli.id], branchRootIds: [] } }],
        links: [{
          id: "invite-quinn",
          guestLabel: "Quinn Fixture",
          status: "pending",
          invitedByPersonId: ada.id,
        }],
      },
    };
    const parsedSidecar = parseTreeJson(JSON.stringify(withSidecar));
    assert.equal("access" in parsedSidecar, true);
    const taken = separateAccess(parsedSidecar);
    assert.equal("access" in taken.tree, false);
    assert.equal((taken.tree as TreeData & { note?: string }).note, "FIXTURE");
    assert.deepEqual(taken.tree.people, [ada]);
    assert.equal(taken.access?.trees[0]?.ownerPersonId, ada.id);
    assert.equal(taken.access?.links[0]?.status, "pending");
    assert.equal(taken.access?.links[0]?.guestLabel, "Quinn Fixture");
    assert.deepEqual(taken.access?.offers?.[0]?.grant.personIds, [eli.id]);
  });

  it("loads a saved tree that secretly contains access without keeping that field", async () => {
    const stored = {
      people: [ada],
      unions: [],
      childLinks: [],
      focusPersonId: ada.id,
      access: { ownerPersonId: ada.id },
    } as TreeData;
    const backend: TreeBackend = {
      async get() {
        return structuredClone(stored);
      },
      async put() {
        throw new Error("load must not write");
      },
      async del() {
        throw new Error("load must not delete");
      },
    };
    resetTreeStoreForTests();
    const loaded = await loadTree(backend);
    assert.deepEqual(loaded.people, [ada]);
    assert.equal("access" in loaded, false);
    resetTreeStoreForTests();
  });
});
