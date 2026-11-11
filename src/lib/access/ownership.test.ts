import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTreeJson } from "../tree";
import type { TreeData } from "../types";
import { FIXTURE_DIVORCE, HOME_TREE_ID, OTHER_TREE_ID, ax } from "./fixtures";
import {
  acceptedInvite,
  asInviteId,
  asPersonId,
  asTreeId,
  canEdit,
  emptyAccess,
  guestViewer,
  handBranch,
  memberViewer,
  ownedBranchLabels,
  parseAccess,
  pendingInvite,
  revokeInviteCard,
  separateAccess,
  serializeAccess,
  type AccessState,
} from "./index";

/**
 * FIXTURE only. Ada and Ben share Cam. Cam's partner is Nia. Pip is their child.
 * Obe is Nia's child and is not in Cam's branch. No real relatives.
 */

const home = asTreeId(HOME_TREE_ID);
const other = asTreeId(OTHER_TREE_ID);
const pid = (id: string) => asPersonId(ax(id));
const lane = asInviteId("invite-lane");
const wynn = asInviteId("invite-wynn");
const forest = { [home]: FIXTURE_DIVORCE };
const cam = { kind: "person" as const, treeId: home, personId: pid("cam") };
const obe = { kind: "person" as const, treeId: home, personId: pid("obe") };
const ada = { kind: "person" as const, treeId: home, personId: pid("ada") };
const pip = { kind: "person" as const, treeId: home, personId: pid("pip") };
const nia = { kind: "person" as const, treeId: home, personId: pid("nia") };

function owned(extra: Partial<AccessState> = {}): AccessState {
  return {
    ...emptyAccess(),
    trees: [{ treeId: home, ownerPersonId: pid("ada") }],
    links: [
      pendingInvite({
        id: lane,
        sourceTreeId: home,
        targetTreeId: home,
        invitedByPersonId: pid("ada"),
        guestLabel: "Lane FIXTURE",
      }),
    ],
    ...extra,
  };
}

describe("branch ownership", () => {
  it("hands a branch to a guest and lets them edit only inside it", () => {
    const access = handBranch(owned(), home, pid("cam"), lane);
    const guest = guestViewer(home, lane);
    assert.equal(access.branchOwners?.length, 1);
    assert.equal(access.branchOwners?.[0]?.branchRootId, pid("cam"));
    assert.equal(access.branchOwners?.[0]?.inviteId, lane);

    assert.equal(canEdit(forest, access, guest, cam), true);
    assert.equal(canEdit(forest, access, guest, nia), true);
    assert.equal(canEdit(forest, access, guest, pip), true);
    assert.equal(canEdit(forest, access, guest, obe), false);
    assert.equal(canEdit(forest, access, guest, ada), false);

    const couple = FIXTURE_DIVORCE.unions.find((union) => union.id === ax("u-cam-nia"));
    const parents = FIXTURE_DIVORCE.unions.find((union) => union.id === ax("u-ada-ben"));
    assert.ok(couple && parents);
    assert.equal(canEdit(forest, access, guest, { kind: "union", treeId: home, unionId: couple.id }), true);
    assert.equal(canEdit(forest, access, guest, { kind: "union", treeId: home, unionId: parents.id }), false);

    const pipLink = FIXTURE_DIVORCE.childLinks.find((link) => link.id === ax("c-pip"));
    const camLink = FIXTURE_DIVORCE.childLinks.find((link) => link.id === ax("c-cam"));
    assert.ok(pipLink && camLink);
    assert.equal(canEdit(forest, access, guest, { kind: "childLink", treeId: home, childLinkId: pipLink.id }), true);
    assert.equal(canEdit(forest, access, guest, { kind: "childLink", treeId: home, childLinkId: camLink.id }), false);
  });

  it("lets the tree owner edit anyone the guest cannot, then takes the branch back", () => {
    let access = handBranch(owned(), home, pid("cam"), lane);
    const owner = memberViewer(home, pid("ada"));
    assert.equal(canEdit(forest, access, owner, obe), true);
    assert.equal(canEdit(forest, access, owner, cam), true);

    access = handBranch(access, home, pid("cam"), null);
    assert.equal(access.branchOwners, undefined);
    assert.equal(canEdit(forest, access, guestViewer(home, lane), cam), false);
    assert.equal(canEdit(forest, access, owner, cam), true);
  });

  it("replaces the holder and ignores a revoked or unknown invite", () => {
    let access = handBranch(owned(), home, pid("cam"), lane);
    access = {
      ...access,
      links: [
        ...access.links,
        pendingInvite({
          id: wynn,
          sourceTreeId: home,
          targetTreeId: home,
          invitedByPersonId: pid("ada"),
          guestLabel: "Wynn FIXTURE",
        }),
      ],
    };
    access = handBranch(access, home, pid("cam"), wynn);
    assert.equal(access.branchOwners?.length, 1);
    assert.equal(access.branchOwners?.[0]?.inviteId, wynn);
    assert.equal(canEdit(forest, access, guestViewer(home, lane), cam), false);
    assert.equal(canEdit(forest, access, guestViewer(home, wynn), cam), true);

    const revoked = handBranch(
      {
        ...access,
        links: access.links.map((link) => (link.id === wynn ? { ...link, status: "revoked" as const } : link)),
      },
      home,
      pid("ada"),
      wynn,
    );
    assert.equal(revoked.branchOwners?.[0]?.branchRootId, pid("cam"));
    assert.equal(canEdit(forest, revoked, guestViewer(home, wynn), cam), false);

    const unknown = handBranch(access, home, pid("ada"), asInviteId("invite-missing"));
    assert.equal(unknown, access);
  });

  it("ends ownership when the invite is revoked", () => {
    const handed = handBranch(owned(), home, pid("cam"), lane);
    const also = handBranch(handed, home, pid("nia"), lane);
    assert.equal(also.branchOwners?.length, 2);
    const revoked = revokeInviteCard(also, lane);
    assert.equal(revoked.branchOwners, undefined);
    assert.equal(canEdit(forest, revoked, guestViewer(home, lane), cam), false);
    assert.equal(canEdit(forest, revoked, guestViewer(home, lane), nia), false);
  });

  it("keeps an imported shared family read-only for the owner and for a guest who was handed it", () => {
    const tree: TreeData = FIXTURE_DIVORCE;
    const access = handBranch(
      {
        ...owned(),
        sharedFamilies: [
          {
            id: "sf-cam",
            sourceTreeId: other,
            ownerPersonId: pid("ada"),
            ownerName: "Ada FIXTURE",
            exportedAt: "2020-01-01T00:00:00.000Z",
            importedAt: "2020-01-02T00:00:00.000Z",
            members: [
              { sourcePersonId: pid("cam"), localPersonId: pid("cam") },
              { sourcePersonId: pid("nia"), localPersonId: pid("nia") },
            ],
            bridges: [],
          },
        ],
      },
      home,
      pid("cam"),
      lane,
    );
    assert.equal(canEdit(forest, access, memberViewer(home, pid("ada")), cam), false);
    assert.equal(canEdit(forest, access, guestViewer(home, lane), cam), false);
    assert.equal(canEdit(forest, access, guestViewer(home, lane), pip), true);
    const couple = tree.unions.find((union) => union.partnerIds.every((id) => id === ax("cam") || id === ax("nia")));
    assert.ok(couple);
    assert.equal(canEdit({ [home]: tree }, access, guestViewer(home, lane), { kind: "union", treeId: home, unionId: couple.id }), false);
  });

  it("names the guest on people inside a handed branch and not on anyone else", () => {
    const access = handBranch(owned(), home, pid("cam"), lane);
    const labels = ownedBranchLabels(FIXTURE_DIVORCE, access, home);
    assert.equal(labels[ax("cam")], "Lane");
    assert.equal(labels[ax("nia")], "Lane");
    assert.equal(labels[ax("pip")], "Lane");
    assert.equal(labels[ax("obe")], undefined);
    assert.equal(labels[ax("ada")], undefined);
  });

  it("loads older access and trees that have no branch owners", () => {
    const legacy = parseAccess(JSON.stringify({
      trees: [{ treeId: HOME_TREE_ID, ownerPersonId: ax("ada") }],
      links: [],
    }));
    assert.equal(legacy.branchOwners, undefined);
    assert.equal(canEdit(forest, { ...legacy, trees: [{ treeId: home, ownerPersonId: pid("ada") }] }, guestViewer(home, lane), cam), false);

    const round = parseAccess(serializeAccess(handBranch(owned(), home, pid("cam"), lane)));
    assert.equal(round.branchOwners?.[0]?.inviteId, lane);
    assert.equal(round.branchOwners?.[0]?.branchRootId, pid("cam"));

    const junk = parseAccess(JSON.stringify({
      branchOwners: [
        { treeId: "", branchRootId: ax("cam"), inviteId: "invite-lane" },
        { nope: true },
        { treeId: HOME_TREE_ID, branchRootId: ax("cam"), inviteId: "invite-lane" },
      ],
    }));
    assert.equal(junk.branchOwners?.length, 1);

    const tree = parseTreeJson(JSON.stringify({
      people: FIXTURE_DIVORCE.people,
      unions: FIXTURE_DIVORCE.unions,
      childLinks: FIXTURE_DIVORCE.childLinks,
    }));
    assert.equal("branchOwners" in tree, false);
    assert.equal("access" in tree, false);
    const split = separateAccess(tree);
    assert.equal(split.access, null);
  });

  it("still accepts an invite that was accepted before hands existed", () => {
    const accepted = acceptedInvite({
      id: lane,
      sourceTreeId: home,
      targetTreeId: home,
      invitedByPersonId: pid("ada"),
      guestLabel: "Lane FIXTURE",
      grant: { personIds: [pid("cam")], branchRootIds: [] },
    });
    const access = handBranch({ ...owned(), links: [accepted] }, home, pid("cam"), lane);
    assert.equal(canEdit(forest, access, guestViewer(home, lane), cam), true);
    assert.equal(canEdit(forest, access, guestViewer(home, lane), ada), false);
  });
});
