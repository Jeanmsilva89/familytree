"use client";

import { useCallback, useEffect, useState } from "react";
import { clearTree, loadTree, saveTree } from "@/lib/db";
import { cloneExample } from "@/lib/example";
import {
  addChild,
  addParent,
  addPartner,
  removePerson,
  startWithName,
  updatePerson,
} from "@/lib/tree";
import type { Person, TreeData, UnionKind } from "@/lib/types";
import { emptyTree } from "@/lib/types";

export function useTree() {
  const [tree, setTree] = useState<TreeData>(emptyTree());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTree()
      .then((loaded) => {
        if (!cancelled) {
          setTree(loaded);
          setReady(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not open local storage.");
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: TreeData) => {
    setTree(next);
    setError(null);
    try {
      await saveTree(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }, []);

  const start = useCallback(
    async (name: string) => persist(startWithName(name)),
    [persist],
  );

  const loadExample = useCallback(async () => persist(cloneExample()), [persist]);

  const reset = useCallback(async () => {
    await clearTree();
    setTree(emptyTree());
  }, []);

  const replace = useCallback(async (next: TreeData) => persist(next), [persist]);

  const partner = useCallback(
    async (personId: string, name: string, kind: UnionKind = "partnered") =>
      persist(addPartner(tree, personId, name, kind)),
    [persist, tree],
  );

  const child = useCallback(
    async (parentIds: string[], name: string, unionId?: string) =>
      persist(addChild(tree, parentIds, name, unionId)),
    [persist, tree],
  );

  const parent = useCallback(
    async (childId: string, name: string) => persist(addParent(tree, childId, name)),
    [persist, tree],
  );

  const edit = useCallback(
    async (id: string, patch: Partial<Person>) => persist(updatePerson(tree, id, patch)),
    [persist, tree],
  );

  const remove = useCallback(
    async (id: string) => persist(removePerson(tree, id)),
    [persist, tree],
  );

  return {
    tree,
    ready,
    error,
    started: tree.people.length > 0,
    start,
    loadExample,
    reset,
    replace,
    partner,
    child,
    parent,
    edit,
    remove,
  };
}
