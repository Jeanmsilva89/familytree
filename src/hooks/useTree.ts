"use client";

import { useCallback, useEffect, useState } from "react";
import { clearTree, loadTree, saveTree } from "@/lib/db";
import { cloneExample } from "@/lib/example";
import {
  addChild,
  addParent,
  addPartner,
  addSibling,
  addUnlinkedPerson,
  linkExisting,
  parseTreeJson,
  removePerson,
  serializeTreeJson,
  setFocus,
  setUnionKind,
  startWithName,
  updatePerson,
} from "@/lib/tree";
import type { LinkRole, Person, TreeData, UnionKind } from "@/lib/types";
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

  const sibling = useCallback(
    async (personId: string, name: string) => {
      const before = new Set(tree.people.map((p) => p.id));
      const next = addSibling(tree, personId, name);
      await persist(next);
      return next.people.find((p) => !before.has(p.id))?.id;
    },
    [persist, tree],
  );

  const unlinked = useCallback(
    async (name: string) => persist(addUnlinkedPerson(tree, name)),
    [persist, tree],
  );

  const link = useCallback(
    async (personId: string, otherId: string, role: LinkRole, kind?: UnionKind) =>
      persist(linkExisting(tree, personId, otherId, role, kind)),
    [persist, tree],
  );

  const unionKind = useCallback(
    async (unionId: string, kind: UnionKind) => persist(setUnionKind(tree, unionId, kind)),
    [persist, tree],
  );

  const focus = useCallback(
    async (personId: string) => persist(setFocus(tree, personId)),
    [persist, tree],
  );

  const edit = useCallback(
    async (id: string, patch: Partial<Person>) => persist(updatePerson(tree, id, patch)),
    [persist, tree],
  );

  const remove = useCallback(
    async (id: string) => {
      const next = removePerson(tree, id);
      if (next.people.length === 0) {
        await clearTree();
        setTree(emptyTree());
        setError(null);
        return;
      }
      await persist(next);
    },
    [persist, tree],
  );

  const exportJson = useCallback(() => serializeTreeJson(tree), [tree]);

  const importJson = useCallback(
    async (text: string) => persist(parseTreeJson(text)),
    [persist],
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
    sibling,
    unlinked,
    link,
    unionKind,
    focus,
    edit,
    remove,
    exportJson,
    importJson,
  };
}
