import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Person, TreeData } from "../types";
import {
  acceptInviteCard,
  addGuestCard,
  ensureDeviceOwner,
  graphForViewer,
  touchPerson,
} from "./arrange";
import { asInviteId, asPersonId } from "./ids";
import { emptyAccess } from "./types";
import { loadAccess, resetAccessStoreForTests, saveAccess, type AccessBackend } from "./store";

const STAMP = "2020-01-01T00:00:00.000Z";

function person(id: string, givenName: string): Person {
  return { id, givenName, familyName: "Fixture", createdAt: STAMP, updatedAt: STAMP, bio: `${givenName} fixture bio` };
}

const ada = person("ada", "Ada");
const fay = person("fay", "Fay");
const tree: TreeData = {
  people: [ada, fay],
  unions: [],
  childLinks: [],
  focusPersonId: ada.id,
};

function memoryBackend(): AccessBackend & { saved: { current?: unknown } } {
  const saved: { current?: unknown } = {};
  return {
    saved,
    async get() {
      return saved.current === undefined ? undefined : structuredClone(saved.current);
    },
    async put(value) {
      saved.current = structuredClone(value);
    },
    async del() {
      saved.current = undefined;
    },
  };
}

describe("access persists beside the tree", () => {
  it("reloads a dimmed person and an accepted guest", async () => {
    resetAccessStoreForTests();
    const backend = memoryBackend();
    let access = ensureDeviceOwner(emptyAccess(), tree);
    const eli = { kind: "member" as const, personId: asPersonId(ada.id) };
    access = touchPerson(tree, access, eli, asPersonId(fay.id));
    access = touchPerson(tree, access, eli, asPersonId(fay.id));
    const invite = asInviteId("invite-quinn");
    access = addGuestCard(access, "Quinn Fixture", asPersonId(ada.id), invite);
    access = touchPerson(tree, access, { kind: "guest", inviteId: invite }, asPersonId(fay.id));
    access = acceptInviteCard(access, invite);
    access = touchPerson(tree, access, { kind: "guest", inviteId: invite }, asPersonId(fay.id));

    await saveAccess(access, backend);
    resetAccessStoreForTests();
    const loaded = await loadAccess(backend);

    const member = graphForViewer(tree, loaded, eli);
    assert.equal(member.people.find((person) => person.personId === fay.id)?.presence, "dimmed");
    assert.equal(member.people.find((person) => person.personId === fay.id)?.bio, undefined);
    const guest = graphForViewer(tree, loaded, { kind: "guest", inviteId: invite });
    assert.equal(guest.people[0]?.presence, "dimmed");
    assert.equal(guest.people[0]?.details, "withheld");
    assert.equal(loaded.links.find((link) => link.id === invite)?.status, "accepted");
    resetAccessStoreForTests();
  });
});
