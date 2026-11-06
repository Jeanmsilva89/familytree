import { describe, it } from "node:test";
import assert from "node:assert/strict";
import raw from "../../scripts/fixtures/verify-family-sky.json";
import { layoutFamilySky } from "./familySky";
import {
  commitUnlink,
  coupleUnlinkMark,
  curveUnlinkMark,
  forkUnlinkMark,
  skyUnlinkEnabled,
  unlinkConfirmText,
  unlinkRequest,
  unlinkSkyMark,
  type SkyUnlinkMark,
} from "./skyUnlink";
import type { TreeData } from "./types";

/** The labeled Families-lens fixture. Not a real family. */
function fixtureTree(): TreeData {
  return structuredClone(raw) as TreeData;
}

function byName(tree: TreeData, given: string) {
  const person = tree.people.find((p) => p.givenName === given);
  assert.ok(person, `${given} Fixture should be on the tree`);
  return person;
}

describe("tap a sky link in edit mode", () => {
  it("removes a parent curve and leaves the rest of the fixture tree", () => {
    const tree = fixtureTree();
    const sky = layoutFamilySky(tree);
    const ada = byName(tree, "Ada").id;
    const eli = byName(tree, "Eli").id;
    const link = sky.links.find((item) => item.kind === "blood" && item.fromPersonId === ada && item.toPersonId === eli);
    assert.ok(link, "Ada → Eli should be a person-to-person sky curve");
    const mark = curveUnlinkMark(link);
    assert.ok(mark);
    assert.equal(mark.mark, "curve");
    if (mark.mark !== "curve" || mark.kind === "partner") assert.fail("Ada → Eli is a parent curve");

    const next = unlinkSkyMark(tree, mark);
    assert.equal(layoutFamilySky(next).links.some((item) => item.fromPersonId === ada && item.toPersonId === eli), false);
    assert.equal(next.childLinks.some((item) => item.childId === eli && item.parentIds.includes(ada)), false);
    assert.ok(next.childLinks.some((item) => item.childId === eli && item.parentIds.includes(byName(tree, "Ben").id)));
    assert.equal(next.people.length, tree.people.length);
    assert.ok(next.unions.some((union) => union.partnerIds.includes(ada) && union.partnerIds.includes(byName(tree, "Ben").id)));
  });

  it("removes a step curve the same way as a blood curve", () => {
    const tree = fixtureTree();
    const sky = layoutFamilySky(tree);
    const stu = byName(tree, "Stu").id;
    const nia = byName(tree, "Nia").id;
    const link = sky.links.find((item) => item.kind === "step" && item.fromPersonId === stu && item.toPersonId === nia);
    assert.ok(link, "Stu → Nia should be a step sky curve");
    const mark = curveUnlinkMark(link);
    assert.ok(mark);
    const next = unlinkSkyMark(tree, mark);
    assert.equal(next.childLinks.some((item) => item.childId === nia), false);
    assert.ok(next.people.some((person) => person.id === nia));
    assert.ok(next.unions.some((union) => union.partnerIds.includes(nia) && union.partnerIds.includes(byName(tree, "Pal").id)));
  });

  it("removes one parent from a fork and keeps the other parent", () => {
    const tree = fixtureTree();
    const sky = layoutFamilySky(tree);
    const cora = byName(tree, "Cora").id;
    const fork = sky.forks.find((item) => item.childDrops.some((drop) => drop.childId === cora));
    const drop = fork?.childDrops.find((item) => item.childId === cora);
    assert.ok(fork && drop, "Cora should hang from a parent fork");
    const mark = forkUnlinkMark(fork, drop);
    assert.ok(mark, "a fork with a parent and a child is an unlink target");
    assert.equal(mark.mark, "fork");
    assert.ok(fork.parentIds.includes(mark.parentId));
    assert.ok(tree.childLinks.some((item) => item.childId === cora && item.parentIds.includes(mark.parentId)));

    const next = unlinkSkyMark(tree, mark);
    assert.equal(next.childLinks.some((item) => item.childId === cora && item.parentIds.includes(mark.parentId)), false);
    const other = fork.parentIds.find((id) => id !== mark.parentId);
    assert.ok(other);
    assert.ok(next.childLinks.some((item) => item.childId === cora && item.parentIds.includes(other)));
    assert.equal(next.people.length, tree.people.length);
  });

  it("asks, then removes a couple bar without dropping their child", async () => {
    const tree = fixtureTree();
    const sky = layoutFamilySky(tree);
    const dee = byName(tree, "Dee").id;
    const eli = byName(tree, "Eli").id;
    const fay = byName(tree, "Fay").id;
    const couple = sky.couples.find((item) => item.bar && item.partnerIds.includes(dee) && item.partnerIds.includes(eli));
    assert.ok(couple, "Dee and Eli should share a couple bar");
    const mark = coupleUnlinkMark(couple.partnerIds);
    assert.ok(mark);
    assert.equal(mark.mark, "couple");
    assert.equal(
      unlinkConfirmText(tree.people, mark),
      `Unlink ${byName(tree, "Dee").givenName} Fixture and ${byName(tree, "Eli").givenName} Fixture as partners?`,
    );

    let asked = "";
    let called: { personId: string; otherId: string; role: string } | null = null;
    const committed = await commitUnlink(tree.people, mark, (personId, otherId, role) => {
      called = { personId, otherId, role };
    }, (message) => {
      asked = message;
      return true;
    });
    assert.equal(committed, true);
    assert.match(asked, /Unlink Dee Fixture and Eli Fixture as partners\?/);
    assert.deepEqual(called, unlinkRequest(mark));

    const next = unlinkSkyMark(tree, mark);
    assert.equal(next.unions.some((union) => union.partnerIds.includes(dee) && union.partnerIds.includes(eli)), false);
    assert.ok(next.childLinks.some((item) => item.childId === fay && item.parentIds.includes(dee) && item.parentIds.includes(eli)));
    assert.equal(layoutFamilySky(next).couples.some((item) => item.partnerIds.includes(dee) && item.partnerIds.includes(eli)), false);
  });

  it("does not unlink a couple when the confirm is declined", async () => {
    const tree = fixtureTree();
    const mark = coupleUnlinkMark([byName(tree, "Nia").id, byName(tree, "Pal").id]);
    assert.ok(mark);
    let calls = 0;
    const committed = await commitUnlink(tree.people, mark, () => {
      calls += 1;
    }, () => false);
    assert.equal(committed, false);
    assert.equal(calls, 0);
    assert.equal(unlinkSkyMark(tree, mark).unions.length, tree.unions.length - 1);
  });

  it("turns a partner curve into the classic partner unlink", () => {
    const tree = fixtureTree();
    const ada = byName(tree, "Ada").id;
    const ben = byName(tree, "Ben").id;
    const mark = curveUnlinkMark({ kind: "partner", fromPersonId: ada, toPersonId: ben });
    assert.ok(mark);
    assert.deepEqual(unlinkRequest(mark), { personId: ada, otherId: ben, role: "partner" });
    const next = unlinkSkyMark(tree, mark);
    assert.equal(next.unions.some((union) => union.partnerIds.includes(ada) && union.partnerIds.includes(ben)), false);
    assert.ok(next.childLinks.some((item) => item.childId === byName(tree, "Cora").id && item.parentIds.includes(ada)));
  });

  it("uses the classic parent-link wording", () => {
    const tree = fixtureTree();
    const mark: SkyUnlinkMark = {
      mark: "curve",
      kind: "blood",
      parentId: byName(tree, "Gran").id,
      childId: byName(tree, "Mae").id,
    };
    assert.equal(unlinkConfirmText(tree.people, mark), "Remove the parent link from Gran Fixture to Mae Fixture?");
    assert.deepEqual(unlinkRequest(mark), { personId: mark.childId, otherId: mark.parentId, role: "parent" });
  });

  it("refuses a couple or fork that does not name two people", () => {
    assert.equal(coupleUnlinkMark(["fx-nia"]), null);
    assert.equal(coupleUnlinkMark(["fx-nia", "fx-nia"]), null);
    assert.equal(forkUnlinkMark({ parentIds: [] }, { childId: "fx-cora", kin: "blood" }), null);
  });

  it("only offers sky unlink while editing, close up", () => {
    assert.equal(skyUnlinkEnabled(true, "near"), true);
    assert.equal(skyUnlinkEnabled(false, "near"), false);
    assert.equal(skyUnlinkEnabled(true, "mid"), false);
    assert.equal(skyUnlinkEnabled(true, "far"), false);
  });
});
