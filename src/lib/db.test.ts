import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addChild, addParent, addPartner, addSibling, addUnlinkedPerson, startWithName } from "./tree";
import {
  loadTree,
  resetTreeStoreForTests,
  saveTree,
  type TreeBackend,
} from "./db";
import type { TreeData } from "./types";

function memoryBackend(initial?: TreeData): TreeBackend & { delayMs: number; store: { current?: TreeData } } {
  const store: { current?: TreeData } = { current: initial ? structuredClone(initial) : undefined };
  return {
    store,
    delayMs: 0,
    async get() {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      return store.current ? structuredClone(store.current) : undefined;
    },
    async put(tree) {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      store.current = structuredClone(tree);
    },
    async del() {
      store.current = undefined;
    },
  };
}

describe("tree persist", () => {
  it("addChild then reload still has the child", async () => {
    resetTreeStoreForTests();
    const backend = memoryBackend();
    let tree = startWithName("Alex");
    const alex = tree.people[0].id;
    tree = addPartner(tree, alex, "Sam");
    const sam = tree.people.find((p) => p.givenName === "Sam")!.id;
    tree = addChild(tree, [alex, sam], "Riley");
    await saveTree(tree, backend);
    resetTreeStoreForTests();
    const reloaded = await loadTree(backend);
    assert.equal(reloaded.people.some((p) => p.givenName === "Riley"), true);
    assert.equal(reloaded.people.length, 3);
  });

  it("in-flight save wins over a remount load", async () => {
    resetTreeStoreForTests();
    let tree = startWithName("Alex");
    const alex = tree.people[0].id;
    tree = addPartner(tree, alex, "Sam");
    const backend = memoryBackend(tree);
    backend.delayMs = 40;
    await loadTree(backend);

    const sam = tree.people.find((p) => p.givenName === "Sam")!.id;
    const withChild = addChild(tree, [alex, sam], "Riley");
    const save = saveTree(withChild, backend);
    const remount = loadTree(backend);
    const [savedWait, loaded] = await Promise.all([save, remount]);
    void savedWait;
    assert.equal(loaded.people.some((p) => p.givenName === "Riley"), true);
    resetTreeStoreForTests();
    const after = await loadTree(backend);
    assert.equal(after.people.some((p) => p.givenName === "Riley"), true);
  });

  it("parent partner sibling and unlinked survive reload", async () => {
    resetTreeStoreForTests();
    const backend = memoryBackend();
    let tree = startWithName("Alex");
    const alex = tree.people[0].id;
    tree = addParent(tree, alex, "Pat");
    tree = addPartner(tree, alex, "Sam");
    tree = addSibling(tree, alex, "Jordan");
    tree = addUnlinkedPerson(tree, "Casey");
    await saveTree(tree, backend);
    resetTreeStoreForTests();
    const reloaded = await loadTree(backend);
    const names = reloaded.people.map((p) => p.givenName).sort();
    assert.deepEqual(names, ["Alex", "Casey", "Jordan", "Pat", "Sam"]);
  });
});
