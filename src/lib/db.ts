"use client";

import { openDB, type IDBPDatabase } from "idb";
import type { TreeData } from "./types";
import { emptyTree } from "./types";

const DB_NAME = "familytree";
const DB_VERSION = 2;
const TREE_STORE = "tree";
const TREE_KEY = "living";
const ACCESS_STORE = "access";
const ACCESS_KEY = "living";

type FamilyTreeDB = IDBPDatabase<{
  tree: { key: string; value: TreeData };
  access: { key: string; value: unknown };
}>;

export type TreeBackend = {
  get(): Promise<TreeData | undefined>;
  put(tree: TreeData): Promise<void>;
  del(): Promise<void>;
};

let dbPromise: Promise<FamilyTreeDB> | null = null;
let memory: TreeData | null = null;
let writeTail: Promise<void> = Promise.resolve();

function getDb(): Promise<FamilyTreeDB> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(TREE_STORE)) {
          db.createObjectStore(TREE_STORE);
        }
        if (!db.objectStoreNames.contains(ACCESS_STORE)) {
          db.createObjectStore(ACCESS_STORE);
        }
      },
    }) as Promise<FamilyTreeDB>;
  }
  return dbPromise;
}

function cloneTree(tree: TreeData): TreeData {
  return structuredClone(tree);
}

function normalize(stored: TreeData): TreeData {
  return {
    people: stored.people ?? [],
    unions: stored.unions ?? [],
    childLinks: stored.childLinks ?? [],
    focusPersonId: stored.focusPersonId,
    ...(stored.familyUnitOverrides?.length ? { familyUnitOverrides: stored.familyUnitOverrides } : {}),
  };
}

function enqueueWrite(job: () => Promise<void>): Promise<void> {
  writeTail = writeTail.then(job, job);
  return writeTail;
}

const idbBackend: TreeBackend = {
  async get() {
    if (typeof indexedDB === "undefined") return undefined;
    const db = await getDb();
    return db.get(TREE_STORE, TREE_KEY);
  },
  async put(tree) {
    if (typeof indexedDB === "undefined") return;
    const db = await getDb();
    await db.put(TREE_STORE, tree, TREE_KEY);
  },
  async del() {
    if (typeof indexedDB === "undefined") return;
    const db = await getDb();
    await db.delete(TREE_STORE, TREE_KEY);
  },
};

export function resetTreeStoreForTests() {
  memory = null;
  writeTail = Promise.resolve();
}

export function peekTreeMemory(): TreeData | null {
  return memory ? cloneTree(memory) : null;
}

export async function loadTree(backend: TreeBackend = idbBackend): Promise<TreeData> {
  await writeTail;
  if (memory) return cloneTree(memory);
  const stored = await backend.get();
  memory = stored ? normalize(stored) : emptyTree();
  return cloneTree(memory);
}

export async function saveTree(tree: TreeData, backend: TreeBackend = idbBackend): Promise<void> {
  memory = cloneTree(tree);
  const snapshot = memory;
  await enqueueWrite(() => backend.put(snapshot));
}

export async function clearTree(backend: TreeBackend = idbBackend): Promise<void> {
  memory = emptyTree();
  await enqueueWrite(() => backend.del());
}

export async function readAccessRecord(): Promise<unknown> {
  if (typeof indexedDB === "undefined") return undefined;
  const db = await getDb();
  return db.get(ACCESS_STORE, ACCESS_KEY);
}

export async function writeAccessRecord(value: unknown): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await getDb();
  await db.put(ACCESS_STORE, value, ACCESS_KEY);
}

export async function deleteAccessRecord(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await getDb();
  await db.delete(ACCESS_STORE, ACCESS_KEY);
}
