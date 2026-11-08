"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearAccess, loadAccess, saveAccess } from "@/lib/access/store";
import { emptyAccess, type AccessState } from "@/lib/access";

export function useAccess() {
  const [access, setAccess] = useState<AccessState>(emptyAccess());
  const [ready, setReady] = useState(false);
  const accessRef = useRef(access);
  const generation = useRef(0);
  accessRef.current = access;

  useEffect(() => {
    let cancelled = false;
    loadAccess()
      .then((loaded) => {
        if (cancelled || generation.current !== 0) return;
        accessRef.current = loaded;
        setAccess(loaded);
        setReady(true);
      })
      .catch(() => {
        if (cancelled || generation.current !== 0) return;
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const replace = useCallback(async (next: AccessState) => {
    generation.current += 1;
    accessRef.current = next;
    setAccess(next);
    await saveAccess(next);
  }, []);

  const update = useCallback(async (fn: (current: AccessState) => AccessState) => {
    await replace(fn(accessRef.current));
  }, [replace]);

  const clear = useCallback(async () => {
    generation.current += 1;
    const next = emptyAccess();
    accessRef.current = next;
    setAccess(next);
    await clearAccess();
  }, []);

  return { access, ready, replace, update, clear };
}
