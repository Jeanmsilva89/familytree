"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
  canInstall: boolean;
  onInstall: () => void;
};

export function AppMenu({ open, onClose, onExport, onImport, onReset, canInstall, onInstall }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="menu" ref={ref} role="menu" aria-label="Family Tree menu">
      <Link href="/print" role="menuitem" onClick={onClose}>
        Print tree
      </Link>
      <Link href="/printables" role="menuitem" onClick={onClose}>
        Kid printables
      </Link>
      <button type="button" role="menuitem" onClick={onExport}>
        Export GEDCOM
      </button>
      <button type="button" role="menuitem" onClick={onImport}>
        Import GEDCOM
      </button>
      {canInstall ? (
        <button type="button" role="menuitem" onClick={onInstall}>
          Install app
        </button>
      ) : (
        <p className="hint" style={{ padding: "8px 10px" }}>
          Install from your browser menu to use Family Tree like an app.
        </p>
      )}
      <button type="button" role="menuitem" onClick={onReset}>
        Start over
      </button>
    </div>
  );
}
