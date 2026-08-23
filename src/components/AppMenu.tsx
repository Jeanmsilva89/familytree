"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AddNameRow } from "./AddNameRow";
import { useTheme, type ThemePreference } from "@/lib/theme";

type Props = {
  open: boolean;
  onClose: () => void;
  onPeople: () => void;
  onVisualize: () => void;
  onAddSomeone: (name: string) => void | Promise<void>;
  onExport: () => void;
  onImport: () => void;
  onExportJson: () => void;
  onImportJson: () => void;
  onReset: () => void;
  canInstall: boolean;
  onInstall: () => void;
};

const THEMES: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export function AppMenu({
  open, onClose, onPeople, onVisualize, onAddSomeone, onExport, onImport, onExportJson, onImportJson, onReset, canInstall, onInstall,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);
  const { preference, setPreference } = useTheme();

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
      <button type="button" role="menuitem" onClick={onPeople}>People</button>
      <button type="button" role="menuitem" onClick={onVisualize}>Visualize tree</button>
      <Link href="/print" role="menuitem" onClick={onClose}>Print</Link>
      <Link href="/printables" role="menuitem" onClick={onClose}>Printables</Link>
      <button type="button" role="menuitem" onClick={onReset}>Start over</button>
      {adding ? (
        <AddNameRow
          label="Name of the person to add"
          onAdd={async (name) => { await onAddSomeone(name); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" role="menuitem" onClick={() => setAdding(true)}>Add someone</button>
      )}
      <div className="theme-control">
        <span>Theme</span>
        <div className="theme-picks" role="group" aria-label="Theme">
          {THEMES.map((item) => (
            <button key={item.id} type="button" className={preference === item.id ? "is-on" : undefined} aria-pressed={preference === item.id} onClick={() => setPreference(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <details>
        <summary>Move data</summary>
        <button type="button" role="menuitem" onClick={onExport}>Export Kin GEDCOM</button>
        <button type="button" role="menuitem" onClick={onImport}>Import GEDCOM</button>
        <button type="button" role="menuitem" onClick={onExportJson}>Export backup JSON</button>
        <button type="button" role="menuitem" onClick={onImportJson}>Import backup JSON</button>
      </details>
      {canInstall ? (
        <button type="button" role="menuitem" onClick={onInstall}>Install</button>
      ) : (
        <p className="hint" style={{ padding: "8px 10px" }}>Install from your browser menu to use Family Tree like an app.</p>
      )}
    </div>
  );
}
