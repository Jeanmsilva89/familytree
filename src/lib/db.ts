"use client";

import { openDB, type IDBPDatabase } from "idb";
import type { TreeData } from "./types";
import { emptyTree } from "./types";

const DB_NAME = "kinstart";
const DB_VERSION = 1;
const TREE_STORE = "tree";
const TREE_KEY = "living";

type KinstartDB = IDBPDatabase<{ tree: { key: string; value: TreeData } }>;

let dbPromise: Promise<KinstartDB> | null = null;

function getDb(): Promise<KinstartDB> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(TREE_STORE)) {
          db.createObjectStore(TREE_STORE);
        }
      },
    }) as Promise<KinstartDB>;
  }
  return dbPromise;
}

export async function loadTree(): Promise<TreeData> {
  if (typeof indexedDB === "undefined") return emptyTree();
  const db = await getDb();
  const stored = await db.get(TREE_STORE, TREE_KEY);
  if (!stored) return emptyTree();
  return {
    people: stored.people ?? [],
    unions: stored.unions ?? [],
    childLinks: stored.childLinks ?? [],
    focusPersonId: stored.focusPersonId,
  };
}

export async function saveTree(tree: TreeData): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await getDb();
  await db.put(TREE_STORE, tree, TREE_KEY);
}

export async function clearTree(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await getDb();
  await db.delete(TREE_STORE, TREE_KEY);
}
