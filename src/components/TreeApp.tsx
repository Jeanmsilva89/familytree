"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useAccess } from "@/hooks/useAccess";
import { useNarrow } from "@/hooks/useNarrow";
import { useTree } from "@/hooks/useTree";
import {
  acceptInviteCard,
  addGuestCard,
  asInviteId,
  asPersonId,
  canEdit,
  DEVICE_TREE_ID,
  detailToggle,
  ensureDeviceOwner,
  graphForViewer,
  handBranch,
  marksForViewer,
  ownedBranchLabels,
  revokeInviteCard,
  separateAccess,
  exportShareBundle,
  importShareBundle,
  linkSharedPerson,
  parseShareBundleText,
  removeSharedFamily,
  sharedFamilyForPerson,
  summarizeShareBundle,
  toggleDetailGrant,
  touchBranch,
  touchPerson,
  viewerFor,
  type LookingAs,
  type ShareBundle,
} from "@/lib/access";
import { deliverShareFile } from "@/lib/deliverShare";
import { parseGedcom, serializeGedcom } from "@/lib/gedcom";
import type { LinkRole, Person } from "@/lib/types";
import { displayName } from "@/lib/types";
import { parseTreeJson, relatedTree } from "@/lib/tree";
import { DEFAULT_LINE_FILTER, type LineFilter } from "@/lib/kinFilter";
import { BrandMark } from "./BrandMark";
import { AppMenu } from "./AppMenu";
import { FamilySky } from "./FamilySky";
import { FocusFamily } from "./FocusFamily";
import { GraphLineFilter } from "./GraphLineFilter";
import { LensBar } from "./LensBar";
import { PeopleList } from "./PeopleList";
import { PersonSheet } from "./PersonSheet";
import { SharePreview } from "./SharePreview";
import { StartScreen } from "./StartScreen";
import { TreeCanvas } from "./TreeCanvas";
import { previewSeen } from "@/lib/orbitView";

const OrbitView = dynamic(() => import("./OrbitView").then((mod) => mod.OrbitView), { ssr: false });

type BeforeInstallPrompt = Event & { prompt: () => Promise<void> };

const VIEW_KEY = "familytree-mobile-view";

export function TreeApp() {
  const treeState = useTree();
  const accessState = useAccess();
  const narrow = useNarrow();
  const [highlighted, setHighlighted] = useState<Person | undefined>();
  const [sheetPerson, setSheetPerson] = useState<Person | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPrompt | null>(null);
  const [mobileView, setMobileView] = useState<"family" | "graph">("family");
  const [graphOpen, setGraphOpen] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(true);
  const [graphEdit, setGraphEdit] = useState(false);
  const [lineFilter, setLineFilter] = useState<LineFilter>(DEFAULT_LINE_FILTER);
  const [lensOn, setLensOn] = useState(false);
  const [lensPreview, setLensPreview] = useState(false);
  const [lensViewer, setLensViewer] = useState<LookingAs>({ kind: "owner" });
  const [graphAddName, setGraphAddName] = useState<string | null>(null);
  const [relatedRootId, setRelatedRootId] = useState<string | undefined>();
  const [relatedHighlight, setRelatedHighlight] = useState<Person | undefined>();
  const [relatedEdit, setRelatedEdit] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const shareRef = useRef<HTMLInputElement>(null);
  const [shareIncoming, setShareIncoming] = useState<{ bundle: ShareBundle } | { error: string } | null>(null);

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
      if (stored === "graph") {
        setGraphOpen(true);
        setFamilyOpen(false);
      } else {
        setFamilyOpen(true);
        setGraphOpen(false);
      }
      return;
    }
    setMobileView(window.matchMedia("(max-width: 719px)").matches ? "family" : "graph");
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (shareIncoming) {
        setShareIncoming(null);
        return;
      }
      if (sheetPerson) {
        setSheetPerson(undefined);
        return;
      }
      if (relatedRootId) {
        setRelatedRootId(undefined);
        setRelatedHighlight(undefined);
        setRelatedEdit(false);
        return;
      }
      if (graphOpen) {
        setGraphOpen(false);
        setGraphEdit(false);
        setFamilyOpen(true);
        setMobileView("family");
        window.localStorage.setItem(VIEW_KEY, "family");
        return;
      }
      if (familyOpen) {
        setFamilyOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetPerson, relatedRootId, graphOpen, familyOpen, shareIncoming]);

  const accessNow = accessState.access;
  const accessReady = accessState.ready;
  const replaceAccess = accessState.replace;
  useEffect(() => {
    if (!treeState.ready || !accessReady) return;
    const next = ensureDeviceOwner(accessNow, treeState.tree);
    if (next === accessNow) return;
    void replaceAccess(next);
  }, [accessNow, accessReady, replaceAccess, treeState.ready, treeState.tree]);

  useEffect(() => {
    if (!lineFilter.families && lensOn) setLensOn(false);
  }, [lineFilter.families, lensOn]);

  useEffect(() => {
    if (lensViewer.kind === "member" && !treeState.tree.people.some((person) => person.id === lensViewer.personId)) {
      setLensViewer({ kind: "owner" });
    }
    if (lensViewer.kind === "guest" && !accessState.access.links.some((link) => link.id === lensViewer.inviteId)) {
      setLensViewer({ kind: "owner" });
    }
  }, [accessState.access.links, lensViewer, treeState.tree.people]);

  useEffect(() => {
    if (!relatedRootId) return;
    if (treeState.tree.people.some((person) => person.id === relatedRootId)) return;
    setRelatedRootId(undefined);
    setRelatedHighlight(undefined);
    setRelatedEdit(false);
  }, [treeState.tree, relatedRootId]);

  const chooseView = (next: "family" | "graph") => {
    setMobileView(next);
    window.localStorage.setItem(VIEW_KEY, next);
    if (next === "graph") {
      setGraphOpen(true);
      setFamilyOpen(false);
      return;
    }
    setGraphOpen(false);
    setGraphEdit(false);
    setFamilyOpen(true);
  };

  const changeLines = (next: LineFilter) => {
    if (next.families !== lineFilter.families) {
      setHighlighted(undefined);
      setRelatedHighlight(undefined);
    }
    setLineFilter(next);
  };

  const closeVisualize = () => {
    setRelatedRootId(undefined);
    setRelatedHighlight(undefined);
    setRelatedEdit(false);
    setGraphOpen(false);
    setGraphEdit(false);
    setLensOn(false);
    setLensPreview(false);
    setLensViewer({ kind: "owner" });
    chooseView("family");
  };

  const openRelatedTree = (person: Person) => {
    setRelatedRootId(person.id);
    setRelatedHighlight(person);
    setRelatedEdit(false);
    setSheetPerson(undefined);
    setPeopleOpen(false);
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
  const relatedRoot = relatedRootId
    ? treeState.tree.people.find((person) => person.id === relatedRootId)
    : undefined;
  const relatedView = relatedRoot ? relatedTree(treeState.tree, relatedRoot.id) : undefined;
  const relatedName = relatedRoot
    ? relatedRoot.givenName.trim() || displayName(relatedRoot)
    : "";
  const ensuredAccess = ensureDeviceOwner(accessState.access, treeState.tree);
  const lensPhase: "working" | "arrange" | "preview" = lensViewer.kind === "owner" ? "working" : lensPreview ? "preview" : "arrange";
  const lensViewerName = lensViewer.kind === "member"
    ? displayName(treeState.tree.people.find((person) => person.id === lensViewer.personId) ?? { id: "", givenName: "Them", createdAt: "", updatedAt: "" })
    : lensViewer.kind === "guest"
      ? accessState.access.links.find((link) => link.id === lensViewer.inviteId)?.guestLabel?.trim() || "This guest"
      : "you";
  const guestStatus = lensViewer.kind === "guest"
    ? accessState.access.links.find((link) => link.id === lensViewer.inviteId)?.status
    : undefined;
  const lensCaption = lensPhase === "working"
    ? "Your working view. Choose who is looking."
    : lensPhase === "preview"
      ? `Previewing ${lensViewerName}. A branch they own can be edited. Everything else stays as it is.`
      : guestStatus === "pending"
        ? `Arranging ${lensViewerName}'s invite. They see no one until you accept. Hold a person to share details.`
        : guestStatus === "revoked"
          ? `${lensViewerName}'s invite is revoked. They see no one.`
          : `Arranging for ${lensViewerName}. Touch a person, or a family name for their branch. Hold a person to share details.`;
  const lensMarks = Object.fromEntries(
    marksForViewer(treeState.tree, ensuredAccess, lensViewer, lensPreview).map((mark) => [mark.personId as string, mark]),
  );
  const resolvedIds = graphForViewer(treeState.tree, ensuredAccess, lensViewer).people.map((person) => person.personId as string).sort();
  const arrangeFor = (personId: string, kind: "person" | "branch") => {
    void accessState.update((current) => {
      const ready = ensureDeviceOwner(current, treeState.tree);
      const id = asPersonId(personId);
      return kind === "person" ? touchPerson(treeState.tree, ready, lensViewer, id) : touchBranch(treeState.tree, ready, lensViewer, id);
    });
  };
  const shareDetails = (personId: string) => {
    void accessState.update((current) => {
      const ready = ensureDeviceOwner(current, treeState.tree);
      return toggleDetailGrant(treeState.tree, ready, lensViewer, asPersonId(personId));
    });
  };
  const shareAsFile = () => {
    if (lensViewer.kind === "owner") return;
    const access = ensureDeviceOwner(accessState.access, treeState.tree);
    const viewer = viewerFor(access, lensViewer);
    if (!viewer) return;
    void deliverShareFile(exportShareBundle(treeState.tree, access, viewer, new Date().toISOString()));
  };
  const orbitSeen = lensOn && lensPhase === "preview" ? previewSeen(Object.values(lensMarks)) : undefined;
  const lensSky = lensOn && lineFilter.families
    ? {
        active: true as const,
        phase: lensPhase,
        marks: lensMarks,
        resolvedIds,
        caption: lensCaption,
        onPerson: (personId: string) => arrangeFor(personId, "person"),
        onBranch: (personId: string) => arrangeFor(personId, "branch"),
        onShareDetails: lensPhase === "arrange" ? shareDetails : undefined,
        onShareFile: lensPhase === "arrange" ? shareAsFile : undefined,
        shareOf: (personId: string) => detailToggle(ensuredAccess, lensViewer, asPersonId(personId)),
      }
    : undefined;
  const sharedPersonIds = (ensuredAccess.sharedFamilies ?? []).flatMap((family) =>
    family.members.map((member) => member.localPersonId as string),
  );
  const isShared = (personId: string) => sharedPersonIds.includes(personId);
  const addSharedFamily = () => {
    if (!shareIncoming || !("bundle" in shareIncoming)) return;
    const result = importShareBundle(
      treeState.tree,
      ensureDeviceOwner(accessState.access, treeState.tree),
      shareIncoming.bundle,
      { importedAt: new Date().toISOString() },
    );
    void treeState.replace(result.tree);
    void accessState.replace(result.access);
    setShareIncoming(null);
    setLineFilter((current) => ({ ...current, families: true }));
    setLensOn(false);
    setLensPreview(false);
    chooseView("graph");
  };
  const linkImported = (sharedPersonId: string, homePersonId: string, role: LinkRole) => {
    const family = sharedFamilyForPerson(accessState.access, sharedPersonId);
    if (!family) return;
    const result = linkSharedPerson(
      treeState.tree,
      ensureDeviceOwner(accessState.access, treeState.tree),
      family.id,
      sharedPersonId,
      homePersonId,
      role,
    );
    void treeState.replace(result.tree);
    void accessState.replace(result.access);
  };
  const removeImported = (familyId: string) => {
    const result = removeSharedFamily(treeState.tree, accessState.access, familyId);
    void treeState.replace(result.tree);
    void accessState.replace(result.access);
    setSheetPerson(undefined);
  };
  const sheetFamily = sheetPerson ? sharedFamilyForPerson(ensuredAccess, sheetPerson.id) : undefined;
  const acting = Boolean(lensOn && lineFilter.families && lensPhase === "preview");
  const editor = viewerFor(ensuredAccess, acting ? lensViewer : { kind: "owner" });
  const forest = { [DEVICE_TREE_ID]: treeState.tree };
  const allowPerson = (id: string) => Boolean(
    editor && canEdit(forest, ensuredAccess, editor, { kind: "person", treeId: DEVICE_TREE_ID, personId: asPersonId(id) }),
  );
  const allowRelation = (personId: string, otherId: string, role: "parent" | "partner" | "child") => {
    if (!editor) return false;
    const tree = treeState.tree;
    if (role === "partner") {
      const union = tree.unions.find((item) => item.partnerIds.includes(personId) && item.partnerIds.includes(otherId));
      if (!union) return allowPerson(personId) && allowPerson(otherId);
      return canEdit(forest, ensuredAccess, editor, { kind: "union", treeId: DEVICE_TREE_ID, unionId: union.id });
    }
    const link = tree.childLinks.find((item) => (
      role === "parent"
        ? item.childId === personId && item.parentIds.includes(otherId)
        : item.childId === otherId && item.parentIds.includes(personId)
    ));
    if (!link) return allowPerson(personId) && allowPerson(otherId);
    return canEdit(forest, ensuredAccess, editor, { kind: "childLink", treeId: DEVICE_TREE_ID, childLinkId: link.id });
  };
  const branchOwnerMenu = {
    invites: ensuredAccess.links
      .filter((link) => link.status !== "revoked")
      .map((link) => ({ id: link.id as string, label: link.guestLabel?.trim() || "Guest" })),
    holderFor: (personId: string) => {
      const hand = ensuredAccess.branchOwners?.find(
        (item) => item.treeId === DEVICE_TREE_ID && item.branchRootId === personId,
      );
      if (!hand) return null;
      const link = ensuredAccess.links.find((item) => item.id === hand.inviteId);
      return link && link.status !== "revoked" ? (hand.inviteId as string) : null;
    },
    onChoose: (personId: string, inviteId: string | null) => {
      void accessState.update((current) => handBranch(
        ensureDeviceOwner(current, treeState.tree),
        DEVICE_TREE_ID,
        asPersonId(personId),
        inviteId ? asInviteId(inviteId) : null,
      ));
    },
  };
  const ownerLabels = ownedBranchLabels(treeState.tree, ensuredAccess, DEVICE_TREE_ID);

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
        onPeople={() => { setPeopleOpen(true); setFamilyOpen(true); setGraphOpen(false); setMenuOpen(false); }}
        onVisualize={() => { setMenuOpen(false); chooseView("graph"); }}
        onAddSomeone={async (name) => { await treeState.unlinked(name); setMenuOpen(false); }}
        onExport={exportGedcom}
        onImport={() => { fileRef.current?.click(); setMenuOpen(false); }}
        onExportJson={exportJson}
        onImportJson={() => { jsonRef.current?.click(); setMenuOpen(false); }}
        onAddShared={() => { shareRef.current?.click(); setMenuOpen(false); }}
        onReset={async () => {
          if (confirm("Clear the tree saved on this device?")) {
            await treeState.reset();
            await accessState.clear();
            setLensOn(false);
            setLensViewer({ kind: "owner" });
            setHighlighted(undefined);
            setSheetPerson(undefined);
            setGraphOpen(false);
            setFamilyOpen(true);
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
            <button type="button" role="tab" aria-selected={familyOpen && !graphOpen} className={familyOpen && !graphOpen ? "btn primary" : "btn ghost"} onClick={() => chooseView("family")}>Family</button>
            <button type="button" role="tab" aria-selected={graphOpen} className={graphOpen ? "btn primary" : "btn ghost"} onClick={() => chooseView("graph")}>Visualize</button>
          </div>
          {lookingName ? <p className="looking-at" aria-live="polite">Looking at {lookingName}</p> : null}
        </>
      )}

      {treeState.started && familyOpen && !graphOpen ? (
        <div className="family-overlay" aria-hidden={Boolean(relatedView)}>
          <div className="graph-toolbar">
            <button type="button" className="btn" onClick={() => setFamilyOpen(false)}>
              Close
            </button>
            <button type="button" className="btn" onClick={() => setPeopleOpen(true)}>
              People
            </button>
            <button type="button" className="btn" onClick={() => chooseView("graph")}>
              Visualize
            </button>
          </div>
          <FocusFamily
            tree={treeState.tree}
            onFocus={(id) => {
              void treeState.focus(id);
              const person = treeState.tree.people.find((p) => p.id === id);
              if (person) setHighlighted(person);
            }}
            onOpen={setSheetPerson}
            onAddParent={(id, name) => (isShared(id) ? Promise.resolve() : treeState.parent(id, name))}
            onAddPartner={(id, name, kind) => (isShared(id) ? Promise.resolve() : treeState.partner(id, name, kind))}
            onAddChild={(parentIds, name, unionId) => (parentIds.some(isShared) ? Promise.resolve() : treeState.child(parentIds, name, unionId))}
            onAddSibling={(id, name) => (isShared(id) ? Promise.resolve() : treeState.sibling(id, name))}
            onLinkExisting={(personId, otherId, role) => (
              isShared(personId) || isShared(otherId) ? Promise.resolve() : treeState.link(personId, otherId, role)
            )}
          />
        </div>
      ) : null}

      {graphOpen ? (
        <div className="graph-overlay" aria-hidden={Boolean(relatedView)}>
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
              onClick={() => {
                setGraphEdit((value) => !value);
                setLensOn(false);
              }}
            >
              {graphEdit ? "Done" : "Edit"}
            </button>
            {lineFilter.families ? (
              <button
                type="button"
                className={lensOn ? "btn primary" : "btn"}
                aria-pressed={lensOn}
                onClick={() => {
                  setGraphEdit(false);
                  setHighlighted(undefined);
                  setLensPreview(false);
                  setLensViewer({ kind: "owner" });
                  setLensOn((value) => !value);
                }}
              >
                Lens
              </button>
            ) : null}
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
            {treeState.tree.people.some((person) => typeof person.graphX === "number" || typeof person.rowNudge === "number") ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  for (const person of treeState.tree.people) {
                    if (typeof person.graphX === "number" || typeof person.rowNudge === "number") {
                      void treeState.edit(person.id, { graphX: undefined, rowNudge: undefined });
                    }
                  }
                }}
              >
                Reset layout
              </button>
            ) : null}
            <GraphLineFilter value={lineFilter} onChange={changeLines} />
            {lensSky ? (
              <LensBar
                people={treeState.tree.people.map((person) => ({
                  id: person.id,
                  label: person.givenName.trim() || displayName(person),
                  name: displayName(person),
                }))}
                invites={accessState.access.links}
                looking={lensViewer.kind === "owner" ? "owner" : lensViewer.kind === "member" ? lensViewer.personId : lensViewer.inviteId}
                preview={lensPreview}
                onLookOwner={() => { setLensViewer({ kind: "owner" }); setLensPreview(false); }}
                onLookPerson={(personId) => { setLensViewer({ kind: "member", personId: asPersonId(personId) }); setLensPreview(false); }}
                onLookGuest={(inviteId) => { setLensViewer({ kind: "guest", inviteId: asInviteId(inviteId) }); setLensPreview(false); }}
                onPreview={setLensPreview}
                onAccept={(inviteId) => {
                  const id = asInviteId(inviteId);
                  void accessState.update((current) => acceptInviteCard(ensureDeviceOwner(current, treeState.tree), id));
                  setLensViewer({ kind: "guest", inviteId: id });
                  setLensPreview(true);
                }}
                onRevoke={(inviteId) => {
                  const id = asInviteId(inviteId);
                  void accessState.update((current) => revokeInviteCard(current, id));
                  setLensViewer({ kind: "guest", inviteId: id });
                  setLensPreview(true);
                }}
                onAddGuest={(name) => {
                  const owner = ensuredAccess.trees.find((row) => row.treeId === DEVICE_TREE_ID)?.ownerPersonId;
                  if (!owner) return;
                  void accessState.update((current) => addGuestCard(ensureDeviceOwner(current, treeState.tree), name, owner));
                }}
              />
            ) : null}
            {highlighted ? (
              <button type="button" className="btn primary their-tree-btn" onClick={() => openRelatedTree(highlighted)}>
                Their tree
              </button>
            ) : null}
          </div>
          {lineFilter.orbit ? (
            <OrbitView
              tree={treeState.tree}
              seen={orbitSeen}
              marks={lensOn ? lensMarks : undefined}
              arranging={Boolean(lensSky && lensSky.phase === "arrange")}
              editMode={graphEdit && !lensOn}
              lineFilter={lineFilter}
              owners={ownerLabels}
              showOwners={lensOn || graphEdit}
              editScope={acting ? { person: allowPerson } : undefined}
              sharedIds={sharedPersonIds}
              onHighlight={setHighlighted}
              onOpen={setSheetPerson}
              onArrange={lensSky?.onPerson}
              onPlace={(id, x) => {
                if (!allowPerson(id)) return;
                return treeState.edit(id, { graphX: Math.round(x) });
              }}
            />
          ) : lineFilter.families ? (
            <FamilySky
              tree={treeState.tree}
              highlightedId={highlighted?.id}
              onHighlight={setHighlighted}
              onOpen={setSheetPerson}
              fitKey={graphOpen}
              lineFilter={lineFilter}
              hold={Boolean(sheetPerson)}
              editMode={graphEdit && !lensOn}
              lens={lensSky}
              sharedPersonIds={sharedPersonIds}
              branchOwner={branchOwnerMenu}
              editScope={acting ? { person: allowPerson, relation: allowRelation } : undefined}
              owners={ownerLabels}
              onLink={(personId, otherId, role, kind, parentRole, kin) => {
                if (!allowPerson(personId) || !allowPerson(otherId)) return;
                return treeState.link(personId, otherId, role, kind, parentRole, kin);
              }}
              onUnlink={(personId, otherId, role) => {
                if (!allowRelation(personId, otherId, role)) return;
                return treeState.unlink(personId, otherId, role);
              }}
              onMoveToUnit={(personId, unitRootId) => {
                if (!allowPerson(personId)) return;
                return treeState.familyUnit(personId, { unitOf: unitRootId });
              }}
              onPlace={(id, x) => {
                if (!allowPerson(id)) return;
                return treeState.edit(id, { rowNudge: Math.round(x) });
              }}
            />
          ) : (
            <TreeCanvas
              tree={treeState.tree}
              highlightedId={highlighted?.id}
              onHighlight={setHighlighted}
              onOpen={setSheetPerson}
              fitKey={graphOpen}
              editMode={graphEdit}
              onLink={(personId, otherId, role, kind, parentRole, kin) => {
                if (!allowPerson(personId) || !allowPerson(otherId)) return;
                return treeState.link(personId, otherId, role, kind, parentRole, kin);
              }}
              onUnlink={(personId, otherId, role) => {
                if (!allowRelation(personId, otherId, role)) return;
                return treeState.unlink(personId, otherId, role);
              }}
              onPlace={(id, x) => {
                if (!allowPerson(id)) return;
                return treeState.edit(id, { graphX: Math.round(x) });
              }}
              lineFilter={lineFilter}
              canGather
              branchOwner={branchOwnerMenu}
            />
          )}
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

      {relatedView && relatedRoot ? (
        <div className="graph-overlay related-overlay" role="dialog" aria-modal="true" aria-labelledby="related-tree-title">
          <header className="related-chrome">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRelatedRootId(undefined);
                setRelatedHighlight(undefined);
                setRelatedEdit(false);
              }}
            >
              Close
            </button>
            <div className="related-heading">
              <p className="related-kicker">Their tree</p>
              <h2 id="related-tree-title">{relatedName}</h2>
            </div>
            <button
              type="button"
              className={relatedEdit ? "btn primary" : "btn"}
              aria-pressed={relatedEdit}
              onClick={() => setRelatedEdit((v) => !v)}
            >
              {relatedEdit ? "Done" : "Edit"}
            </button>
            <GraphLineFilter value={lineFilter} onChange={changeLines} />
          </header>
          <TreeCanvas
            tree={relatedView}
            highlightedId={relatedHighlight?.id ?? relatedRoot.id}
            onHighlight={(person) => setRelatedHighlight(person)}
            onOpen={setSheetPerson}
            fitKey={`related-${relatedRoot.id}`}
            editMode={relatedEdit}
            onLink={(personId, otherId, role, kind, parentRole, kin) => {
              if (!allowPerson(personId) || !allowPerson(otherId)) return;
              return treeState.link(personId, otherId, role, kind, parentRole, kin);
            }}
            onUnlink={(personId, otherId, role) => {
              if (!allowRelation(personId, otherId, role)) return;
              return treeState.unlink(personId, otherId, role);
            }}
            lineFilter={lineFilter}
            canGather={false}
            branchOwner={branchOwnerMenu}
          />
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
        onDropUnion={treeState.dropUnion}
        onEdit={treeState.edit}
        onRemove={treeState.remove}
        onViewTree={openRelatedTree}
        onSetFamilyUnit={sheetFamily ? undefined : treeState.familyUnit}
        shared={sheetFamily ? {
          ownerName: sheetFamily.ownerName,
          homePeople: treeState.tree.people
            .filter((person) => !isShared(person.id))
            .map((person) => ({ id: person.id, name: displayName(person) })),
          onLink: (homePersonId, role) => {
            if (!sheetPerson) return;
            linkImported(sheetPerson.id, homePersonId, role);
          },
          onRemove: () => removeImported(sheetFamily.id),
        } : undefined}
      />
      {shareIncoming ? (
        <SharePreview
          summary={"bundle" in shareIncoming ? summarizeShareBundle(shareIncoming.bundle) : undefined}
          error={"error" in shareIncoming ? shareIncoming.error : undefined}
          onAdd={addSharedFamily}
          onClose={() => setShareIncoming(null)}
        />
      ) : null}

      <input ref={fileRef} className="sr-only" type="file" accept=".ged,.gedcom,text/plain" aria-label="Import GEDCOM file" onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        await treeState.replace(parseGedcom(await file.text()));
        await accessState.clear();
        setLensOn(false);
        setLensViewer({ kind: "owner" });
      }} />
      <input ref={jsonRef} className="sr-only" type="file" accept="application/json,.json" aria-label="Import backup JSON" onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const split = separateAccess(parseTreeJson(await file.text()));
        await treeState.replace(split.tree);
        if (split.access) await accessState.replace(split.access);
        else await accessState.clear();
        setLensOn(false);
        setLensViewer({ kind: "owner" });
        setLensPreview(false);
      }} />
      <input ref={shareRef} className="sr-only" type="file" accept="application/json,.json" aria-label="Add a shared family file" onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
          setShareIncoming({ bundle: parseShareBundleText(await file.text()) });
        } catch (error) {
          setShareIncoming({ error: error instanceof Error ? error.message : "This share file is not a family bundle." });
        }
      }} />
    </div>
  );
}
