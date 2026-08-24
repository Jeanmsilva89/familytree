"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useNarrow } from "@/hooks/useNarrow";
import { useTree } from "@/hooks/useTree";
import { parseGedcom, serializeGedcom } from "@/lib/gedcom";
import type { Person } from "@/lib/types";
import { displayName } from "@/lib/types";
import { DEFAULT_LINE_FILTER, type LineFilter } from "@/lib/kinFilter";
import { BrandMark } from "./BrandMark";
import { AppMenu } from "./AppMenu";
import { FocusFamily } from "./FocusFamily";
import { GraphLineFilter } from "./GraphLineFilter";
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
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphEdit, setGraphEdit] = useState(false);
  const [lineFilter, setLineFilter] = useState<LineFilter>(DEFAULT_LINE_FILTER);
  const [graphAddName, setGraphAddName] = useState<string | null>(null);
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
    if (!("serviceWorker" in navigator)) return;
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        void registration.update();
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(() => undefined);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_KEY);
    if (stored === "family" || stored === "graph") {
      setMobileView(stored);
      if (stored === "graph") setGraphOpen(true);
      return;
    }
    setMobileView(window.matchMedia("(max-width: 719px)").matches ? "family" : "graph");
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (sheetPerson) {
        setSheetPerson(undefined);
        return;
      }
      if (graphOpen) {
        setGraphOpen(false);
        setGraphEdit(false);
        setMobileView("family");
        window.localStorage.setItem(VIEW_KEY, "family");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetPerson, graphOpen]);

  const chooseView = (next: "family" | "graph") => {
    setMobileView(next);
    window.localStorage.setItem(VIEW_KEY, next);
    if (next === "graph") {
      setGraphOpen(true);
      return;
    }
    setGraphOpen(false);
    setGraphEdit(false);
  };

  const closeVisualize = () => {
    setGraphOpen(false);
    setGraphEdit(false);
    chooseView("family");
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

  const lookingId = highlighted?.id ?? treeState.tree.focusPersonId;
  const looking = treeState.tree.people.find((p) => p.id === lookingId);
  const lookingName = looking?.givenName?.trim() || (looking ? displayName(looking) : "");

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
        onVisualize={() => { setMenuOpen(false); chooseView("graph"); }}
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
            setGraphOpen(false);
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
            <button type="button" role="tab" aria-selected={graphOpen || mobileView === "graph"} className={graphOpen || mobileView === "graph" ? "btn primary" : "btn ghost"} onClick={() => chooseView("graph")}>Visualize</button>
          </div>
          {lookingName ? <p className="looking-at" aria-live="polite">Looking at {lookingName}</p> : null}
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
            onLinkExisting={treeState.link}
          />
        </>
      )}

      {graphOpen ? (
        <div className="graph-overlay">
          <div className="graph-toolbar">
            <button
              type="button"
              className="btn"
              onClick={closeVisualize}
            >
              Close
            </button>
            <button
              type="button"
              className={graphEdit ? "btn primary" : "btn"}
              aria-pressed={graphEdit}
              onClick={() => setGraphEdit((v) => !v)}
            >
              {graphEdit ? "Done" : "Edit"}
            </button>
            <button type="button" className="btn" onClick={exportGedcom}>
              Export
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setGraphAddName("")}
            >
              Add person
            </button>
            {treeState.tree.people.some((person) => typeof person.graphX === "number") ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  for (const person of treeState.tree.people) {
                    if (typeof person.graphX === "number") void treeState.edit(person.id, { graphX: undefined });
                  }
                }}
              >
                Reset layout
              </button>
            ) : null}
            <GraphLineFilter value={lineFilter} onChange={setLineFilter} />
          </div>
          <TreeCanvas
            tree={treeState.tree}
            highlightedId={highlighted?.id}
            onHighlight={setHighlighted}
            onOpen={setSheetPerson}
            fitKey={graphOpen}
            editMode={graphEdit}
            onLink={treeState.link}
            onUnlink={treeState.unlink}
            onPlace={(id, x) => treeState.edit(id, { graphX: Math.round(x) })}
            lineFilter={lineFilter}
          />
          {graphAddName != null ? (
            <form
              className="graph-add"
              onSubmit={async (event) => {
                event.preventDefault();
                const next = await treeState.unlinked(graphAddName);
                setGraphAddName(null);
                if (next) {
                  setHighlighted(next);
                  setSheetPerson(next);
                  setGraphEdit(true);
                }
              }}
            >
              <p>New person</p>
              <label className="field">
                Given name
                <input
                  value={graphAddName}
                  onChange={(e) => setGraphAddName(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <div className="actions">
                <button className="btn primary" type="submit">Add</button>
                <button className="btn ghost" type="button" onClick={() => setGraphAddName(null)}>Cancel</button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {peopleOpen ? (
        <PeopleList
          tree={treeState.tree}
          onClose={() => setPeopleOpen(false)}
          onPick={(person) => { void treeState.focus(person.id); setHighlighted(person); setSheetPerson(person); setPeopleOpen(false); }}
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
        onUpdateLink={treeState.updateLink}
        onUnlink={treeState.unlink}
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
