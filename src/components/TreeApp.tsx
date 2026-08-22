"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useNarrow } from "@/hooks/useNarrow";
import { useTree } from "@/hooks/useTree";
import { parseGedcom, serializeGedcom } from "@/lib/gedcom";
import type { Person } from "@/lib/types";
import { BrandMark } from "./BrandMark";
import { AppMenu } from "./AppMenu";
import { FocusFamily } from "./FocusFamily";
import { PeopleList } from "./PeopleList";
import { PersonSheet } from "./PersonSheet";
import { StartScreen } from "./StartScreen";
import { TreeCanvas } from "./TreeCanvas";

type BeforeInstallPrompt = Event & { prompt: () => Promise<void> };

const VIEW_KEY = "familytree-mobile-view";

export function TreeApp() {
  const treeState = useTree();
  const narrow = useNarrow();
  const [highlighted, setHighlighted] = useState<Person | undefined>();
  const [sheetPerson, setSheetPerson] = useState<Person | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPrompt | null>(null);
  const [mobileView, setMobileView] = useState<"family" | "graph">("family");
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_KEY);
    if (stored === "family" || stored === "graph") {
      setMobileView(stored);
      return;
    }
    setMobileView(window.matchMedia("(max-width: 719px)").matches ? "family" : "graph");
  }, []);

  const chooseView = (next: "family" | "graph") => {
    setMobileView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  };

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

  const exportJson = useCallback(() => {
    const text = treeState.exportJson();
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "family-tree.json";
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  }, [treeState]);

  if (!treeState.ready) {
    return (
      <div className="app-shell tree-shell">
        <p>Opening your tree on this device…</p>
      </div>
    );
  }

  return (
    <div className={narrow ? "app-shell tree-shell is-narrow" : "app-shell tree-shell is-wide"}>
      <header className="topbar">
        <Link className="brand" href="/">
          <BrandMark className="brand-mark" />
          <div>
            <h1>Family Tree</h1>
            <p className="privacy">On this device</p>
          </div>
        </Link>
        <button type="button" className="icon-btn" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
          ☰
        </button>
      </header>

      <AppMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onPeople={() => { setPeopleOpen(true); setMenuOpen(false); }}
        onAddSomeone={async (name) => { await treeState.unlinked(name); setMenuOpen(false); }}
        onExport={exportGedcom}
        onImport={() => { fileRef.current?.click(); setMenuOpen(false); }}
        onExportJson={exportJson}
        onImportJson={() => { jsonRef.current?.click(); setMenuOpen(false); }}
        onReset={async () => {
          if (confirm("Clear the tree saved on this device?")) {
            await treeState.reset();
            setHighlighted(undefined);
            setSheetPerson(undefined);
            setMenuOpen(false);
          }
        }}
        canInstall={Boolean(installEvent)}
        onInstall={async () => { await installEvent?.prompt(); setInstallEvent(null); setMenuOpen(false); }}
      />

      {treeState.error ? <p className="error">{treeState.error}</p> : null}

      {!treeState.started ? (
        <StartScreen onStart={treeState.start} onTryExample={treeState.loadExample} />
      ) : (
        <>
          <div className="view-toggle" role="tablist" aria-label="Tree view">
            <button type="button" role="tab" aria-selected={mobileView === "family"} className={mobileView === "family" ? "btn primary" : "btn ghost"} onClick={() => chooseView("family")}>Family</button>
            <button type="button" role="tab" aria-selected={mobileView === "graph"} className={mobileView === "graph" ? "btn primary" : "btn ghost"} onClick={() => chooseView("graph")}>Graph</button>
          </div>
          {mobileView === "family" ? (
            <FocusFamily
              tree={treeState.tree}
              onFocus={(id) => {
                void treeState.focus(id);
                const person = treeState.tree.people.find((p) => p.id === id);
                if (person) setHighlighted(person);
              }}
              onOpen={setSheetPerson}
              onAddParent={treeState.parent}
              onAddPartner={treeState.partner}
              onAddChild={treeState.child}
              onAddSibling={treeState.sibling}
              onRemove={treeState.remove}
            />
          ) : (
            <>
              <TreeCanvas
                tree={treeState.tree}
                highlightedId={highlighted?.id ?? treeState.tree.focusPersonId}
                onHighlight={(person) => { setHighlighted(person); if (person) void treeState.focus(person.id); }}
                onOpen={setSheetPerson}
              />
              <p className="hint graph-hint">Tap once to see a line. Tap again to open. Drag the graph.</p>
            </>
          )}
        </>
      )}

      {peopleOpen ? (
        <PeopleList
          tree={treeState.tree}
          onClose={() => setPeopleOpen(false)}
          onPick={(person) => { void treeState.focus(person.id); setSheetPerson(person); setPeopleOpen(false); }}
        />
      ) : null}

      <PersonSheet
        tree={treeState.tree}
        person={sheetPerson}
        onClose={() => setSheetPerson(undefined)}
        onAddParent={treeState.parent}
        onAddPartner={treeState.partner}
        onAddChild={treeState.child}
        onAddSibling={treeState.sibling}
        onLinkExisting={treeState.link}
        onSetUnionKind={treeState.unionKind}
        onEdit={treeState.edit}
        onRemove={treeState.remove}
      />

      <input ref={fileRef} className="sr-only" type="file" accept=".ged,.gedcom,text/plain" aria-label="Import GEDCOM file" onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        await treeState.replace(parseGedcom(await file.text()));
      }} />
      <input ref={jsonRef} className="sr-only" type="file" accept="application/json,.json" aria-label="Import backup JSON" onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        await treeState.importJson(await file.text());
      }} />
    </div>
  );
}
