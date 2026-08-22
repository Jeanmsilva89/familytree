"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTree } from "@/hooks/useTree";
import { parseGedcom, serializeGedcom } from "@/lib/gedcom";
import type { Person } from "@/lib/types";
import { BrandMark } from "./BrandMark";
import { AppMenu } from "./AppMenu";
import { PersonSheet } from "./PersonSheet";
import { StartScreen } from "./StartScreen";
import { TreeCanvas } from "./TreeCanvas";

type BeforeInstallPrompt = Event & { prompt: () => Promise<void> };

export function TreeApp() {
  const treeState = useTree();
  const [selected, setSelected] = useState<Person | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPrompt | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  const exportGedcom = useCallback(() => {
    const text = serializeGedcom(treeState.tree);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "family.ged";
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  }, [treeState.tree]);

  const importGedcom = useCallback(() => {
    fileRef.current?.click();
    setMenuOpen(false);
  }, []);

  if (!treeState.ready) {
    return (
      <div className="app-shell">
        <p>Opening your tree on this device.</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <BrandMark className="brand-mark" />
          <div>
            <h1>Family Tree</h1>
            <p className="privacy">Stays on this device. No account.</p>
          </div>
        </Link>
        <button
          type="button"
          className="icon-btn"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          Menu
        </button>
      </header>

      <AppMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onExport={exportGedcom}
        onImport={importGedcom}
        onReset={async () => {
          if (confirm("Clear the tree saved on this device?")) {
            await treeState.reset();
            setSelected(undefined);
            setMenuOpen(false);
          }
        }}
        canInstall={Boolean(installEvent)}
        onInstall={async () => {
          await installEvent?.prompt();
          setInstallEvent(null);
          setMenuOpen(false);
        }}
      />

      {treeState.error ? <p className="error">{treeState.error}</p> : null}

      {!treeState.started ? (
        <StartScreen onStart={treeState.start} onTryExample={treeState.loadExample} />
      ) : (
        <>
          <TreeCanvas
            tree={treeState.tree}
            selectedId={selected?.id}
            onSelect={(person) => setSelected(person)}
          />
          <p className="hint" style={{ marginTop: 16 }}>
            Tap a person to add a parent, partner, or child. Dates and bios stay optional.
          </p>
        </>
      )}

      <PersonSheet
        tree={treeState.tree}
        person={selected}
        onClose={() => setSelected(undefined)}
        onAddParent={treeState.parent}
        onAddPartner={treeState.partner}
        onAddChild={treeState.child}
        onEdit={treeState.edit}
        onRemove={treeState.remove}
      />

      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept=".ged,.gedcom,text/plain"
        aria-label="Import GEDCOM file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const text = await file.text();
          await treeState.replace(parseGedcom(text));
        }}
      />
    </div>
  );
}
