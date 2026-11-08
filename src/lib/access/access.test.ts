import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTreeJson } from "../tree";
import { loadTree, resetTreeStoreForTests, type TreeBackend } from "../db";
import type { TreeData } from "../types";
import {
  FIXTURE_ADOPTION,
  FIXTURE_DIVORCE,
  FIXTURE_FOSTER,
  FIXTURE_HALF,
  FIXTURE_OTHER,
  FIXTURE_REMARRIAGE,
  FIXTURE_SAME_SEX,
  FIXTURE_TREES,
  FIXTURE_UNKNOWN,
  HOME_TREE_ID,
  OTHER_TREE_ID,
  OUTSIDE_TREE_ID,
  ax,
} from "./fixtures";
import {
  acceptedInvite,
  asInviteId,
  asLensId,
  asPersonId,
  asTreeId,
  deriveBranch,
  emptyAccess,
  exposeLink,
  guestViewer,
  memberViewer,
  ownerWorkingView,
  pendingInvite,
  resolveEdit,
  resolveVisibility,
  revokedInvite,
  type AccessState,
  type Forest,
  type LensRule,
  type VisibilityLens,
} from "./index";

const home = asTreeId(HOME_TREE_ID);
const other = asTreeId(OTHER_TREE_ID);
const outside = asTreeId(OUTSIDE_TREE_ID);
const pid = (id: string) => asPersonId(ax(id));
const inviteYan = asInviteId(ax("invite-yan"));
const inviteZed = asInviteId(ax("invite-zed"));

const names = (branch: { members: { personId: string }[] }) => branch.members.map((m) => m.personId).sort();

function forestOf(...entries: [string, TreeData][]): Forest {
  return Object.fromEntries(entries);
}

function access(partial: Partial<AccessState> = {}): AccessState {
  return { ...emptyAccess(), ...partial };
}

function lens(viewer: VisibilityLens["viewer"], rules: LensRule[], detailGrants: VisibilityLens["detailGrants"] = []): VisibilityLens {
  return { id: asLensId(ax("lens")), viewer, rules, detailGrants };
}

describe("fixture data stays labeled", () => {
  it("uses FIXTURE family names and no birth dates", () => {
    for (const tree of FIXTURE_TREES) {
      assert.ok(tree.people.length > 0);
      for (const person of tree.people) {
        assert.equal(person.familyName, "FIXTURE");
        assert.equal(person.id.startsWith("ax-fx-"), true);
        assert.equal(person.birthDate, undefined);
      }
    }
  });
});

describe("branch membership", () => {
  it("puts a child shared by divorced parents in both branches, with the former partner", () => {
    const ada = deriveBranch(home, FIXTURE_DIVORCE, pid("ada"));
    const ben = deriveBranch(home, FIXTURE_DIVORCE, pid("ben"));
    assert.deepEqual(names(ada), [pid("ada"), pid("ben"), pid("cam"), pid("nia"), pid("pip")].sort());
    assert.deepEqual(names(ben), [pid("ada"), pid("ben"), pid("cam"), pid("nia"), pid("pip")].sort());
    const cam = ada.members.find((m) => m.personId === pid("cam"));
    assert.equal(cam?.tie.kind, "descendant");
    if (cam?.tie.kind === "descendant") {
      assert.equal(cam.tie.kin, "blood");
      assert.equal(cam.tie.depth, 1);
      assert.equal(cam.tie.viaParentId, pid("ada"));
    }
    assert.equal(ada.members.find((m) => m.personId === pid("ben"))?.tie.kind, "partner");
    const pip = ada.members.find((m) => m.personId === pid("pip"));
    assert.equal(pip?.tie.kind, "descendant");
    if (pip?.tie.kind === "descendant") assert.equal(pip.tie.depth, 2);
    assert.equal(ada.members.find((m) => m.personId === pid("nia"))?.tie.kind, "descendant-partner");
  });

  it("keeps a partner's other child out of the branch", () => {
    const ada = deriveBranch(home, FIXTURE_DIVORCE, pid("ada"));
    assert.equal(ada.members.some((m) => m.personId === pid("obe")), false);
    const nia = deriveBranch(home, FIXTURE_DIVORCE, pid("nia"));
    assert.ok(names(nia).includes(pid("obe")));
    assert.equal(nia.members.some((m) => m.personId === pid("ada")), false);
  });

  it("does not treat a co-parent as a partner when no union is recorded", () => {
    const tree: TreeData = { ...FIXTURE_DIVORCE, unions: [] };
    const ada = deriveBranch(home, tree, pid("ada"));
    // The child link still reaches Cam and Pip. Ben and Nia were only partners via unions.
    assert.deepEqual(names(ada), [pid("ada"), pid("cam"), pid("pip")].sort());
    assert.equal(ada.members.some((m) => m.personId === pid("ben")), false);
    assert.equal(ada.members.some((m) => m.personId === pid("nia")), false);
  });

  it("leaves step-children out of a remarriage and keeps each parent's own child", () => {
    const ada = deriveBranch(home, FIXTURE_REMARRIAGE, pid("ada"));
    const gil = deriveBranch(home, FIXTURE_REMARRIAGE, pid("gil"));
    assert.deepEqual(names(ada), [pid("ada"), pid("ben"), pid("cam"), pid("gil")].sort());
    assert.equal(ada.members.some((m) => m.personId === pid("hap")), false);
    assert.deepEqual(names(gil), [pid("ada"), pid("gil"), pid("hap")].sort());
    assert.equal(gil.members.some((m) => m.personId === pid("cam")), false);
    assert.equal(gil.members.some((m) => m.personId === pid("ben")), false);
    const hap = gil.members.find((m) => m.personId === pid("hap"));
    assert.equal(hap?.tie.kind, "descendant");
    if (hap?.tie.kind === "descendant") assert.equal(hap.tie.kin, "blood");
  });

  it("includes an adopted child and the biological parent, and a foster child", () => {
    const ivy = deriveBranch(home, FIXTURE_ADOPTION, pid("ivy"));
    const jo = deriveBranch(home, FIXTURE_ADOPTION, pid("jo"));
    assert.deepEqual(names(ivy), [pid("ivy"), pid("jo"), pid("kit")].sort());
    assert.deepEqual(names(jo), [pid("ivy"), pid("jo"), pid("kit")].sort());
    const adopted = jo.members.find((m) => m.personId === pid("kit"));
    assert.equal(adopted?.tie.kind, "descendant");
    if (adopted?.tie.kind === "descendant") assert.equal(adopted.tie.kin, "adopted");
    const biological = ivy.members.find((m) => m.personId === pid("kit"));
    if (biological?.tie.kind === "descendant") assert.equal(biological.tie.kin, "blood");

    const foster = deriveBranch(home, FIXTURE_FOSTER, pid("vic"));
    const blood = deriveBranch(home, FIXTURE_FOSTER, pid("ivy"));
    assert.deepEqual(names(foster), [pid("kit"), pid("vic")].sort());
    assert.deepEqual(names(blood), [pid("ivy"), pid("kit")].sort());
    const fostered = foster.members.find((m) => m.personId === pid("kit"));
    if (fostered?.tie.kind === "descendant") assert.equal(fostered.tie.kin, "foster");
  });

  it("treats same-sex parents the same, ignoring which parent role is recorded", () => {
    const link = FIXTURE_SAME_SEX.childLinks[0];
    assert.equal(link.roles?.[ax("lea")], "mother");
    assert.equal(link.roles?.[ax("mo")], "mother");
    assert.equal(link.roles?.[ax("lea")] === "father", false);
    const lea = deriveBranch(home, FIXTURE_SAME_SEX, pid("lea"));
    const mo = deriveBranch(home, FIXTURE_SAME_SEX, pid("mo"));
    assert.deepEqual(names(lea), [pid("lea"), pid("mo"), pid("nix")].sort());
    assert.deepEqual(names(mo), [pid("lea"), pid("mo"), pid("nix")].sort());
  });

  it("does not invent a person for an unknown parent", () => {
    const ora = deriveBranch(home, FIXTURE_UNKNOWN, pid("ora"));
    assert.deepEqual(names(ora), [pid("ora"), pid("pim")].sort());
    assert.equal(FIXTURE_UNKNOWN.people.length, 2);
    assert.equal(FIXTURE_UNKNOWN.childLinks[0].parentIds.length, 1);
    assert.equal(ora.members.every((m) => FIXTURE_UNKNOWN.people.some((p) => p.id === m.personId)), true);
  });

  it("puts half-siblings in the shared parent's branch and not in each other's", () => {
    const quinn = deriveBranch(home, FIXTURE_HALF, pid("quinn"));
    const sib = deriveBranch(home, FIXTURE_HALF, pid("sib"));
    const ume = deriveBranch(home, FIXTURE_HALF, pid("ume"));
    const rue = deriveBranch(home, FIXTURE_HALF, pid("rue"));
    assert.deepEqual(names(quinn), [pid("quinn"), pid("rue"), pid("sib"), pid("tan"), pid("ume")].sort());
    assert.deepEqual(names(sib), [pid("sib")]);
    assert.deepEqual(names(ume), [pid("ume")]);
    assert.equal(sib.members.some((m) => m.personId === pid("ume")), false);
    assert.equal(rue.members.some((m) => m.personId === pid("ume")), false);
    assert.equal(rue.members.some((m) => m.personId === pid("tan")), false);
  });

  it("returns an empty branch when the root is not on the tree", () => {
    const missing = deriveBranch(home, FIXTURE_UNKNOWN, pid("missing"));
    assert.deepEqual(missing.members, []);
  });

  it("treats a missing kin kind as blood", () => {
    const ada = deriveBranch(home, FIXTURE_DIVORCE, pid("ada"));
    const cam = ada.members.find((m) => m.personId === pid("cam"));
    assert.equal(FIXTURE_DIVORCE.childLinks[0].kin, undefined);
    if (cam?.tie.kind === "descendant") assert.equal(cam.tie.kin, "blood");
  });
});

describe("edit rights", () => {
  const divorce = forestOf([HOME_TREE_ID, FIXTURE_DIVORCE]);
  const remarriage = forestOf([HOME_TREE_ID, FIXTURE_REMARRIAGE]);
  const adoption = forestOf([HOME_TREE_ID, FIXTURE_ADOPTION]);
  const foster = forestOf([HOME_TREE_ID, FIXTURE_FOSTER]);
  const sameSex = forestOf([HOME_TREE_ID, FIXTURE_SAME_SEX]);
  const unknown = forestOf([HOME_TREE_ID, FIXTURE_UNKNOWN]);
  const half = forestOf([HOME_TREE_ID, FIXTURE_HALF]);
  const linked = forestOf([HOME_TREE_ID, FIXTURE_DIVORCE], [OTHER_TREE_ID, FIXTURE_OTHER]);

  const camPerson = { kind: "person" as const, treeId: home, personId: pid("cam") };
  const camLink = { kind: "childLink" as const, treeId: home, childLinkId: ax("c-cam") };
  const camStep = { kind: "childLink" as const, treeId: home, childLinkId: ax("c-cam-gil") };
  const adaGil = { kind: "union" as const, treeId: home, unionId: ax("u-ada-gil") };

  function roots(parties: { branchRootId: string }[]) {
    return parties.map((party) => party.branchRootId).sort();
  }

  it("needs agreement when divorced parents both edit a shared child", () => {
    const state = access();
    const ada = resolveEdit(divorce, state, memberViewer(home, pid("ada")), camLink);
    const ben = resolveEdit(divorce, state, memberViewer(home, pid("ben")), camLink);
    assert.equal(ada.mayEdit, true);
    assert.equal(ada.rank, "line");
    assert.equal(ada.forBranchRootId, pid("ada"));
    assert.equal(ben.mayEdit, true);
    assert.equal(ada.branchConflict.kind, "needs-agreement");
    if (ada.branchConflict.kind === "needs-agreement") {
      assert.deepEqual(roots(ada.branchConflict.parties), [pid("ada"), pid("ben")].sort());
    }
    assert.equal(ada.standing, undefined);
    assert.equal(ben.standing, undefined);

    const person = resolveEdit(divorce, state, memberViewer(home, pid("ada")), camPerson);
    assert.equal(person.mayEdit, true);
    assert.equal(person.branchConflict.kind, "needs-agreement");
    assert.equal(person.standing?.rank, "self");
    assert.equal(person.standing?.branchRootId, pid("cam"));
  });

  it("lets the child stand on their own record and the tree owner stand over both parents", () => {
    const cam = resolveEdit(divorce, access(), memberViewer(home, pid("cam")), camPerson);
    assert.equal(cam.mayEdit, true);
    assert.equal(cam.rank, "self");
    assert.equal(cam.standing?.rank, "self");

    const owned = access({ trees: [{ treeId: home, ownerPersonId: pid("dee") }] });
    const dee = resolveEdit(divorce, owned, memberViewer(home, pid("dee")), camLink);
    const ada = resolveEdit(divorce, owned, memberViewer(home, pid("ada")), camPerson);
    assert.equal(dee.mayEdit, true);
    assert.equal(dee.rank, "tree-owner");
    assert.equal(dee.standing?.rank, "tree-owner");
    assert.equal(dee.standing?.branchRootId, pid("dee"));
    assert.equal(ada.standing?.rank, "tree-owner");
    assert.equal(ada.branchConflict.kind, "needs-agreement");
  });

  it("lets a delegate edit for the branch owner who invited them", () => {
    const state = access({
      delegates: [{ treeId: home, branchRootId: pid("ben"), personId: pid("del") }],
    });
    const del = resolveEdit(divorce, state, memberViewer(home, pid("del")), camPerson);
    assert.equal(del.mayEdit, true);
    assert.equal(del.rank, "line");
    assert.equal(del.forBranchRootId, pid("ben"));
    if (del.branchConflict.kind === "needs-agreement") {
      const ben = del.branchConflict.parties.find((party) => party.branchRootId === pid("ben"));
      assert.deepEqual(ben?.actors, [pid("ben"), pid("del")]);
    } else {
      assert.fail("expected the parents to still need agreement");
    }
    const hap = resolveEdit(
      forestOf([HOME_TREE_ID, FIXTURE_REMARRIAGE]),
      state,
      memberViewer(home, pid("del")),
      { kind: "person", treeId: home, personId: pid("hap") },
    );
    assert.equal(hap.mayEdit, false);
  });

  it("gives a step-parent no edit on the step-child, and a claim only on the step link", () => {
    const state = access();
    const gil = memberViewer(home, pid("gil"));
    const person = resolveEdit(remarriage, state, gil, { kind: "person", treeId: home, personId: pid("cam") });
    const blood = resolveEdit(remarriage, state, gil, camLink);
    const step = resolveEdit(remarriage, state, gil, camStep);
    const union = resolveEdit(remarriage, state, gil, adaGil);
    assert.equal(person.mayEdit, false);
    assert.equal(blood.mayEdit, false);
    assert.equal(step.mayEdit, true);
    assert.equal(step.rank, "partner");
    assert.equal(union.mayEdit, true);
    assert.equal(union.rank, "self");
    if (step.branchConflict.kind === "needs-agreement") {
      assert.deepEqual(roots(step.branchConflict.parties), [pid("ada"), pid("ben")].sort());
    } else {
      assert.fail("expected the line parents to need agreement on the step link");
    }
    const adaOnHap = resolveEdit(remarriage, state, memberViewer(home, pid("ada")), {
      kind: "person",
      treeId: home,
      personId: pid("hap"),
    });
    assert.equal(adaOnHap.mayEdit, false);
  });

  it("treats biological and adoptive parents as equal line claims", () => {
    const state = access();
    const link = { kind: "childLink" as const, treeId: home, childLinkId: ax("c-kit") };
    const ivy = resolveEdit(adoption, state, memberViewer(home, pid("ivy")), link);
    const jo = resolveEdit(adoption, state, memberViewer(home, pid("jo")), link);
    assert.equal(ivy.mayEdit, true);
    assert.equal(jo.mayEdit, true);
    assert.equal(ivy.rank, "line");
    assert.equal(jo.rank, "line");
    assert.equal(ivy.branchConflict.kind, "needs-agreement");
    assert.equal(ivy.standing, undefined);
    if (ivy.branchConflict.kind === "needs-agreement") {
      assert.deepEqual(roots(ivy.branchConflict.parties), [pid("ivy"), pid("jo")].sort());
    }
  });

  it("lets a foster parent edit, and lets the line parent prevail", () => {
    const state = access();
    const link = { kind: "childLink" as const, treeId: home, childLinkId: ax("c-kit-vic") };
    const ivy = resolveEdit(foster, state, memberViewer(home, pid("ivy")), link);
    const vic = resolveEdit(foster, state, memberViewer(home, pid("vic")), link);
    assert.equal(ivy.mayEdit, true);
    assert.equal(vic.mayEdit, true);
    assert.equal(vic.rank, "care");
    assert.equal(ivy.branchConflict.kind, "resolved");
    if (ivy.branchConflict.kind === "resolved") {
      assert.equal(ivy.branchConflict.prevails.branchRootId, pid("ivy"));
      assert.equal(ivy.branchConflict.prevails.rank, "line");
    }
    assert.equal(ivy.standing?.branchRootId, pid("ivy"));
    assert.equal(vic.standing?.rank, "line");
  });

  it("leaves one branch claim when the other parent is unknown", () => {
    const link = { kind: "childLink" as const, treeId: home, childLinkId: ax("c-pim") };
    const ora = resolveEdit(unknown, access(), memberViewer(home, pid("ora")), link);
    assert.equal(ora.mayEdit, true);
    assert.equal(ora.branchConflict.kind, "none");
    if (ora.branchConflict.kind === "none") assert.equal(ora.branchConflict.party?.branchRootId, pid("ora"));
    assert.equal(ora.standing?.branchRootId, pid("ora"));
    const person = resolveEdit(unknown, access(), memberViewer(home, pid("ora")), {
      kind: "person",
      treeId: home,
      personId: pid("pim"),
    });
    assert.equal(person.standing?.rank, "self");
    assert.equal(person.branchConflict.kind, "none");
  });

  it("does not let a half-sibling edit the other half-sibling", () => {
    const sib = resolveEdit(half, access(), memberViewer(home, pid("sib")), {
      kind: "person",
      treeId: home,
      personId: pid("ume"),
    });
    assert.equal(sib.mayEdit, false);
  });

  it("needs agreement between same-sex parents on the child link", () => {
    const link = { kind: "childLink" as const, treeId: home, childLinkId: ax("c-nix") };
    const lea = resolveEdit(sameSex, access(), memberViewer(home, pid("lea")), link);
    assert.equal(lea.mayEdit, true);
    assert.equal(lea.branchConflict.kind, "needs-agreement");
    if (lea.branchConflict.kind === "needs-agreement") {
      assert.deepEqual(roots(lea.branchConflict.parties), [pid("lea"), pid("mo")].sort());
    }
  });

  it("refuses a guest and a person from another tree", () => {
    const guest = resolveEdit(
      divorce,
      access(),
      guestViewer(home, inviteYan),
      camPerson,
    );
    assert.equal(guest.mayEdit, false);
    const wes = resolveEdit(linked, access({
      trees: [{ treeId: other, ownerPersonId: pid("wes") }],
    }), memberViewer(other, pid("wes")), camPerson);
    assert.equal(wes.mayEdit, false);
  });
});

describe("tree links", () => {
  const trees = forestOf([HOME_TREE_ID, FIXTURE_DIVORCE], [OTHER_TREE_ID, FIXTURE_OTHER]);
  const grantAda = { personIds: [] as ReturnType<typeof pid>[], branchRootIds: [pid("ada")] };

  it("exposes nothing while an invite is pending", () => {
    const link = pendingInvite({
      id: inviteYan,
      sourceTreeId: home,
      targetTreeId: outside,
      invitedByPersonId: pid("ada"),
      guestLabel: "Yan FIXTURE",
    });
    assert.equal(link.status, "pending");
    const exposed = exposeLink(trees, emptyAccess(), link);
    assert.deepEqual(exposed.people, []);
    assert.deepEqual(exposed.unions, []);
    assert.deepEqual(exposed.childLinks, []);
  });

  it("exposes a granted branch after accept, and withholds living details", () => {
    const link = acceptedInvite({
      id: inviteYan,
      sourceTreeId: home,
      targetTreeId: outside,
      invitedByPersonId: pid("ada"),
      guestLabel: "Yan FIXTURE",
      grant: grantAda,
    });
    const exposed = exposeLink(trees, emptyAccess(), link);
    assert.deepEqual(
      exposed.people.map((person) => person.personId).sort(),
      [pid("ada"), pid("ben"), pid("cam"), pid("nia"), pid("pip")].sort(),
    );
    const ada = exposed.people.find((person) => person.personId === pid("ada"));
    assert.equal(ada?.details, "withheld");
    assert.equal(ada?.givenName, "Ada");
    assert.equal(ada?.familyName, "FIXTURE");
    assert.equal("bio" in (ada ?? {}), false);
    assert.equal("emails" in (ada ?? {}), false);
    assert.equal("photo" in (ada ?? {}), false);
    assert.equal(exposed.people.some((person) => person.personId === pid("obe")), false);
    assert.ok(exposed.unions.some((union) => union.id === ax("u-ada-ben")));
    assert.equal(exposed.childLinks.some((link) => link.id === ax("c-obe")), false);
  });

  it("omits a sealed person from a branch grant and includes an explicit person grant", () => {
    const sealed = access({ sealedPersonIds: [{ treeId: home, personId: pid("cam") }] });
    const byBranch = exposeLink(trees, sealed, acceptedInvite({
      id: inviteYan,
      sourceTreeId: home,
      targetTreeId: outside,
      invitedByPersonId: pid("ada"),
      guestLabel: "Yan FIXTURE",
      grant: grantAda,
    }));
    assert.equal(byBranch.people.some((person) => person.personId === pid("cam")), false);
    assert.equal(byBranch.childLinks.some((link) => link.childId === pid("cam")), false);

    const byPerson = exposeLink(trees, sealed, acceptedInvite({
      id: inviteYan,
      sourceTreeId: home,
      targetTreeId: outside,
      invitedByPersonId: pid("ada"),
      guestLabel: "Yan FIXTURE",
      grant: { personIds: [pid("cam")], branchRootIds: [] },
    }));
    assert.equal(byPerson.people.some((person) => person.personId === pid("cam")), true);
  });

  it("opens details for a deceased person and still withholds the living", () => {
    const state = access({ deceasedPersonIds: [{ treeId: home, personId: pid("pat") }] });
    const exposed = exposeLink(trees, state, acceptedInvite({
      id: inviteYan,
      sourceTreeId: home,
      targetTreeId: outside,
      invitedByPersonId: pid("ada"),
      guestLabel: "Yan FIXTURE",
      grant: { personIds: [pid("ada"), pid("pat")], branchRootIds: [] },
    }));
    const ada = exposed.people.find((person) => person.personId === pid("ada"));
    const pat = exposed.people.find((person) => person.personId === pid("pat"));
    assert.equal(ada?.details, "withheld");
    assert.equal(pat?.details, "open");
    assert.equal(pat?.bio, "FIXTURE bio deceased");
  });

  it("exposes nothing after the link is revoked, even if the grant remains", () => {
    const link = revokedInvite({
      id: inviteYan,
      sourceTreeId: home,
      targetTreeId: outside,
      invitedByPersonId: pid("ada"),
      guestLabel: "Yan FIXTURE",
      grant: grantAda,
    });
    assert.equal(link.status, "revoked");
    const exposed = exposeLink(trees, emptyAccess(), link);
    assert.deepEqual(exposed.people, []);
  });

  it("exposes nothing from an accepted link with an empty grant", () => {
    const exposed = exposeLink(trees, emptyAccess(), acceptedInvite({
      id: inviteZed,
      sourceTreeId: other,
      targetTreeId: home,
      invitedByPersonId: pid("wes"),
      inviteePersonId: pid("ada"),
      grant: { personIds: [], branchRootIds: [] },
    }));
    assert.deepEqual(exposed.people, []);
  });
});

describe("visibility", () => {
  const trees = forestOf([HOME_TREE_ID, FIXTURE_DIVORCE], [OTHER_TREE_ID, FIXTURE_OTHER]);
  const ben = memberViewer(home, pid("ben"));
  const ada = memberViewer(home, pid("ada"));

  function seen(graph: { people: { personId: string; presence: string }[] }) {
    return graph.people.map((person) => `${person.personId}:${person.presence}`).sort();
  }

  it("shows nothing when no rule grants it, including to the tree owner", () => {
    const state = access({ trees: [{ treeId: home, ownerPersonId: pid("dee") }] });
    const dee = memberViewer(home, pid("dee"));
    const empty = resolveVisibility(trees, state, dee, lens(dee, []));
    assert.deepEqual(empty.people, []);
    const stored = resolveVisibility(trees, state, ben);
    assert.deepEqual(stored.people, []);
  });

  it("ignores a lens arranged for a different viewer", () => {
    const state = access({
      lenses: [lens(ben, [{ scope: "branch", treeId: home, branchRootId: pid("ada"), effect: "include" }])],
    });
    const wrong = resolveVisibility(
      trees,
      state,
      ada,
      lens(ben, [{ scope: "branch", treeId: home, branchRootId: pid("ada"), effect: "include" }]),
    );
    assert.deepEqual(wrong.people, []);
  });

  it("includes a branch, hides one person, and dims another", () => {
    const view = resolveVisibility(trees, emptyAccess(), ben, lens(ben, [
      { scope: "branch", treeId: home, branchRootId: pid("ada"), effect: "include" },
      { scope: "person", treeId: home, personId: pid("ben"), effect: "hide" },
      { scope: "person", treeId: home, personId: pid("cam"), effect: "dim" },
    ]));
    assert.deepEqual(seen(view), [
      `${pid("ada")}:shown`,
      `${pid("cam")}:dimmed`,
      `${pid("nia")}:shown`,
      `${pid("pip")}:shown`,
    ].sort());
    assert.equal(view.people.some((person) => person.personId === pid("obe")), false);
    assert.equal(view.unions.some((union) => union.id === ax("u-ada-ben")), false);
    assert.ok(view.unions.some((union) => union.id === ax("u-cam-nia")));
  });

  it("lets a person include override a branch hide", () => {
    const view = resolveVisibility(trees, emptyAccess(), ben, lens(ben, [
      { scope: "branch", treeId: home, branchRootId: pid("ada"), effect: "hide" },
      { scope: "person", treeId: home, personId: pid("cam"), effect: "include" },
    ]));
    assert.deepEqual(view.people.map((person) => person.personId), [pid("cam")]);
    assert.equal(view.people[0].presence, "shown");
  });

  it("shows an invited outside relative the accepted grant, and nothing once revoked", () => {
    const accepted = acceptedInvite({
      id: inviteYan,
      sourceTreeId: home,
      targetTreeId: outside,
      invitedByPersonId: pid("ada"),
      guestLabel: "Yan FIXTURE",
      grant: { personIds: [], branchRootIds: [pid("ada")] },
    });
    const guest = guestViewer(home, inviteYan);
    const open = resolveVisibility(trees, access({ links: [accepted] }), guest);
    assert.deepEqual(
      open.people.map((person) => person.personId).sort(),
      [pid("ada"), pid("ben"), pid("cam"), pid("nia"), pid("pip")].sort(),
    );
    assert.equal(open.people.every((person) => person.details === "withheld"), true);

    const dimmed = resolveVisibility(trees, access({ links: [accepted] }), guest, lens(guest, [
      { scope: "person", treeId: home, personId: pid("pip"), effect: "dim" },
      { scope: "person", treeId: home, personId: pid("nia"), effect: "hide" },
    ]));
    // A guest lens only filters people the invite already granted.
    assert.equal(dimmed.people.find((person) => person.personId === pid("pip"))?.presence, "dimmed");
    assert.equal(dimmed.people.some((person) => person.personId === pid("nia")), false);
    assert.ok(dimmed.people.some((person) => person.personId === pid("ada")));

    const revoked = revokedInvite({
      id: inviteYan,
      sourceTreeId: home,
      targetTreeId: outside,
      invitedByPersonId: pid("ada"),
      guestLabel: "Yan FIXTURE",
      grant: { personIds: [], branchRootIds: [pid("ada")] },
    });
    const closed = resolveVisibility(trees, access({ links: [revoked] }), guest);
    assert.deepEqual(closed.people, []);
  });

  it("hides a linked tree until a grant and a lens rule both allow it", () => {
    const zedRule: LensRule = { scope: "branch", treeId: other, branchRootId: pid("wes"), effect: "include" };
    const noLink = resolveVisibility(trees, emptyAccess(), ada, lens(ada, [zedRule]));
    assert.equal(noLink.people.some((person) => person.personId === pid("zed")), false);

    const emptyGrant = acceptedInvite({
      id: inviteZed,
      sourceTreeId: other,
      targetTreeId: home,
      invitedByPersonId: pid("wes"),
      inviteePersonId: pid("ada"),
      grant: { personIds: [], branchRootIds: [] },
    });
    const grantedNothing = resolveVisibility(trees, access({ links: [emptyGrant] }), ada, lens(ada, [zedRule]));
    assert.deepEqual(grantedNothing.people, []);

    const granted = acceptedInvite({
      id: inviteZed,
      sourceTreeId: other,
      targetTreeId: home,
      invitedByPersonId: pid("wes"),
      inviteePersonId: pid("ada"),
      grant: { personIds: [], branchRootIds: [pid("wes")] },
    });
    const visible = resolveVisibility(trees, access({ links: [granted] }), ada, lens(ada, [zedRule]));
    assert.deepEqual(visible.people.map((person) => person.personId).sort(), [pid("wes"), pid("zed")].sort());
    const zed = visible.people.find((person) => person.personId === pid("zed"));
    assert.equal(zed?.details, "withheld");
    assert.equal("bio" in (zed ?? {}), false);
  });

  it("keeps a sealed person out of a branch include until a person rule grants them", () => {
    const state = access({ sealedPersonIds: [{ treeId: home, personId: pid("cam") }] });
    const byBranch = resolveVisibility(trees, state, ben, lens(ben, [
      { scope: "branch", treeId: home, branchRootId: pid("ada"), effect: "include" },
    ]));
    assert.equal(byBranch.people.some((person) => person.personId === pid("cam")), false);
    const byPerson = resolveVisibility(trees, state, ben, lens(ben, [
      { scope: "person", treeId: home, personId: pid("cam"), effect: "include" },
    ]));
    assert.equal(byPerson.people.some((person) => person.personId === pid("cam")), true);
  });

  it("withholds living details unless the viewer is that person, a grant opens them, or they are deceased", () => {
    const includeAda: LensRule = { scope: "person", treeId: home, personId: pid("ada"), effect: "include" };
    const hidden = resolveVisibility(trees, emptyAccess(), ben, lens(ben, [includeAda]));
    const adaCard = hidden.people[0];
    assert.equal(adaCard.details, "withheld");
    assert.equal("bio" in adaCard, false);
    assert.equal("emails" in adaCard, false);
    assert.equal("photo" in adaCard, false);

    const self = resolveVisibility(trees, emptyAccess(), ada, lens(ada, [includeAda]));
    assert.equal(self.people[0].details, "open");
    assert.equal(self.people[0].bio, "FIXTURE bio");
    assert.deepEqual(self.people[0].emails, ["fixture@example.com"]);

    const granted = resolveVisibility(trees, emptyAccess(), ben, lens(
      ben,
      [includeAda],
      [{ treeId: home, personId: pid("ada") }],
    ));
    assert.equal(granted.people[0].details, "open");
    assert.equal(granted.people[0].photo, "fixture-photo");

    const dead = access({ deceasedPersonIds: [{ treeId: home, personId: pid("pat") }] });
    const pat = resolveVisibility(trees, dead, ben, lens(ben, [
      { scope: "person", treeId: home, personId: pid("pat"), effect: "include" },
    ]));
    assert.equal(pat.people[0].details, "open");
    assert.equal(pat.people[0].bio, "FIXTURE bio deceased");
  });

  it("uses a lens stored on the access state when none is passed", () => {
    const state = access({
      lenses: [lens(ben, [{ scope: "person", treeId: home, personId: pid("dee"), effect: "include" }])],
    });
    const view = resolveVisibility(trees, state, ben);
    assert.deepEqual(view.people.map((person) => person.personId), [pid("dee")]);
  });

  it("gives the tree owner their own tree, including sealed people, and no linked tree", () => {
    const state = access({
      trees: [{ treeId: home, ownerPersonId: pid("dee") }],
      sealedPersonIds: [{ treeId: home, personId: pid("cam") }],
      links: [acceptedInvite({
        id: inviteZed,
        sourceTreeId: other,
        targetTreeId: home,
        invitedByPersonId: pid("wes"),
        inviteePersonId: pid("dee"),
        grant: { personIds: [], branchRootIds: [pid("wes")] },
      })],
    });
    const view = ownerWorkingView(trees, state, memberViewer(home, pid("dee")));
    assert.equal(view.people.length, FIXTURE_DIVORCE.people.length);
    assert.ok(view.people.some((person) => person.personId === pid("cam")));
    assert.equal(view.people.every((person) => person.details === "open"), true);
    assert.equal(view.people.some((person) => person.personId === pid("zed")), false);
    const stranger = ownerWorkingView(trees, state, ben);
    assert.deepEqual(stranger.people, []);
    const guest = ownerWorkingView(trees, state, guestViewer(home, inviteYan));
    assert.deepEqual(guest.people, []);
  });
});

describe("saved trees stay compatible", () => {
  const legacyPerson = {
    id: "p-legacy-fixture",
    givenName: "Legacy",
    familyName: "FIXTURE",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };

  it("parses a backup from before access fields without adding any", () => {
    const legacy = {
      people: [legacyPerson],
      unions: [],
      childLinks: [],
      focusPersonId: legacyPerson.id,
      familyUnitOverrides: [{ personId: legacyPerson.id, unitOf: null }],
    };
    const parsed = parseTreeJson(JSON.stringify(legacy));
    assert.deepEqual(parsed, legacy);
    assert.equal("access" in parsed, false);
    assert.equal("lenses" in parsed, false);
    assert.equal("links" in parsed, false);

    const older = { people: [legacyPerson], unions: [], childLinks: [] };
    const parsedOlder = parseTreeJson(JSON.stringify(older));
    assert.deepEqual(parsedOlder, older);
    assert.equal("familyUnitOverrides" in parsedOlder, false);
  });

  it("loads a saved tree that has no access fields unchanged", async () => {
    const legacy: TreeData = {
      people: [legacyPerson],
      unions: [],
      childLinks: [],
      focusPersonId: legacyPerson.id,
      familyUnitOverrides: [{ personId: legacyPerson.id, unitOf: null }],
    };
    const backend: TreeBackend = {
      async get() {
        return structuredClone(legacy);
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
    assert.deepEqual(loaded, legacy);
    assert.equal(Object.keys(loaded).sort().join(), "childLinks,familyUnitOverrides,focusPersonId,people,unions");

    resetTreeStoreForTests();
    const bare: TreeData = { people: [legacyPerson], unions: [], childLinks: [] };
    const bareBackend: TreeBackend = {
      async get() {
        return structuredClone(bare);
      },
      async put() {},
      async del() {},
    };
    const loadedBare = await loadTree(bareBackend);
    assert.deepEqual(loadedBare.people, bare.people);
    assert.deepEqual(loadedBare.unions, bare.unions);
    assert.deepEqual(loadedBare.childLinks, bare.childLinks);
    assert.equal(loadedBare.focusPersonId, undefined);
    assert.equal("familyUnitOverrides" in loadedBare, false);
    assert.equal("access" in loadedBare, false);
    resetTreeStoreForTests();
  });
});
