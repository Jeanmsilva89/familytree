"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  unlinkExisting,
  updatePerson,
} from "@/lib/tree";
import type { LinkRole, ParentRole, Person, TreeData, UnionKind } from "@/lib/types";
import { emptyTree } from "@/lib/types";

export function useTree() {
  const [tree, setTree] = useState<TreeData>(emptyTree());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  useEffect(() => {
    let cancelled = false;
    loadTree()
      .then((loaded) => {
        if (cancelled) return;
        treeRef.current = loaded;
        setTree(loaded);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not open local storage.");
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: TreeData) => {
    treeRef.current = next;
    setTree(next);
    setError(null);
    try {
      await saveTree(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }, []);

  const mutate = useCallback(
    async (fn: (current: TreeData) => TreeData) => persist(fn(treeRef.current)),
    [persist],
  );

  const start = useCallback(async (name: string) => persist(startWithName(name)), [persist]);

  const loadExample = useCallback(async () => persist(cloneExample()), [persist]);

  const reset = useCallback(async () => {
    await clearTree();
    treeRef.current = emptyTree();
    setTree(emptyTree());
  }, []);

  const replace = useCallback(async (next: TreeData) => persist(next), [persist]);

  const partner = useCallback(
    async (personId: string, name: string, kind: UnionKind = "partnered") =>
      mutate((current) => addPartner(current, personId, name, kind)),
    [mutate],
  );

  const child = useCallback(
    async (parentIds: string[], name: string, unionId?: string) =>
      mutate((current) => addChild(current, parentIds, name, unionId)),
    [mutate],
  );

  const parent = useCallback(
    async (childId: string, name: string) => mutate((current) => addParent(current, childId, name)),
    [mutate],
  );

  const sibling = useCallback(
    async (personId: string, name: string) => {
      const before = new Set(treeRef.current.people.map((p) => p.id));
      const next = addSibling(treeRef.current, personId, name);
      await persist(next);
      return next.people.find((p) => !before.has(p.id))?.id;
    },
    [persist],
  );

  const unlinked = useCallback(
    async (name: string) => mutate((current) => addUnlinkedPerson(current, name)),
    [mutate],
  );

  const link = useCallback(
    async (personId: string, otherId: string, role: LinkRole, kind?: UnionKind, parentRole?: ParentRole) =>
      mutate((current) => linkExisting(current, personId, otherId, role, kind, parentRole)),
    [mutate],
  );

  const unlink = useCallback(
    async (personId: string, otherId: string, role: Exclude<LinkRole, "sibling">) =>
      mutate((current) => unlinkExisting(current, personId, otherId, role)),
    [mutate],
  );

  const unionKind = useCallback(
    async (unionId: string, kind: UnionKind) => mutate((current) => setUnionKind(current, unionId, kind)),
    [mutate],
  );

  const focus = useCallback(
    async (personId: string) => mutate((current) => setFocus(current, personId)),
    [mutate],
  );

  const edit = useCallback(
    async (id: string, patch: Partial<Person>) => mutate((current) => updatePerson(current, id, patch)),
    [mutate],
  );

  const remove = useCallback(
    async (id: string) => {
      const next = removePerson(treeRef.current, id);
      if (next.people.length === 0) {
        await clearTree();
        treeRef.current = emptyTree();
        setTree(emptyTree());
        setError(null);
        return;
      }
      await persist(next);
    },
    [persist],
  );

  const exportJson = useCallback(() => serializeTreeJson(tree), [tree]);

  const importJson = useCallback(async (text: string) => persist(parseTreeJson(text)), [persist]);

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
    unlink,
    unionKind,
    focus,
    edit,
    remove,
    exportJson,
    importJson,
  };
}
