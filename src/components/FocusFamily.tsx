"use client";

import { useEffect, useMemo, useState } from "react";
import type { Person, TreeData, UnionKind } from "@/lib/types";
import { ageFromBirthDate, displayName, initials } from "@/lib/types";
import { buildGenerationLanes, type GenerationGroup, type GenerationLane } from "@/lib/generations";
import { highlightedCoupleIds } from "@/lib/graphView";
import { unionsFor } from "@/lib/tree";
import { AddNameRow } from "./AddNameRow";
import { PeopleList } from "./PeopleList";

type Props = {
  tree: TreeData;
  onFocus: (personId: string) => void;
  onOpen: (person: Person) => void;
  onAddParent: (childId: string, name: string) => Promise<void>;
  onAddPartner: (personId: string, name: string, kind: UnionKind) => Promise<void>;
  onAddChild: (parentIds: string[], name: string, unionId?: string) => Promise<void>;
  onAddSibling: (personId: string, name: string) => Promise<string | void>;
  onRemove: (id: string) => Promise<void>;
};

const LANE_WORDS: Record<string, string> = {
  grandparents: "Grandparents",
  parents: "Parents",
  focus: "Family",
  children: "Kids",
  grandchildren: "Kids",
};

function PersonChip({ person, focused, flash, onFocus, onOpen }: {
  person: Person; focused?: boolean; flash?: boolean;
  onFocus: () => void; onOpen: () => void;
}) {
  const age = ageFromBirthDate(person.birthDate);
  const cls = ["focus-card", focused ? "is-focus" : "", flash ? "is-flash" : ""].filter(Boolean).join(" ");
  const label = displayName(person);
  return (
    <article className={cls} data-person-id={person.id}>
      <button type="button" className="focus-face" onClick={onFocus} aria-label={`Focus ${label}`}>
        <span className="avatar" aria-hidden>{person.photo ? <img src={person.photo} alt="" /> : initials(person)}</span>
        <span className="focus-name">{label}</span>
        {age ? <span className="hint">{age}</span> : null}
      </button>
      <div className="card-actions">
        <button type="button" className="icon-btn" aria-label={`Edit ${label}`} onClick={onOpen}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      </div>
    </article>
  );
}

function CoupleUnit({ people, coupleBar, lit, focusIds, onFocus, onOpen, flashId }: {
  people: Person[]; coupleBar?: boolean; lit?: boolean; focusIds: Set<string>;
  onFocus: (id: string) => void; onOpen: (person: Person) => void; onRemove?: (id: string) => void; flashId?: string;
}) {
  const unit = Boolean(coupleBar && people.length >= 2);
  return (
    <div className={`couple-unit${unit ? " is-unit" : ""}${lit && unit ? " is-lit" : ""}`}>
      {people.map((p) => (
        <PersonChip key={p.id} person={p} focused={focusIds.has(p.id)} flash={flashId === p.id} onFocus={() => onFocus(p.id)} onOpen={() => onOpen(p)} />
      ))}
    </div>
  );
}

function SideGroup({ group, focusIds, onFocus, onOpen, onRemove, flashId }: {
  group: GenerationGroup; focusIds: Set<string>; onFocus: (id: string) => void; onOpen: (person: Person) => void; onRemove: (id: string) => void; flashId?: string;
}) {
  const lit = group.people.some((p) => focusIds.has(p.id));
  return (
    <div className="gen-group">
      {group.label ? <p className="gen-group-label">{group.label}</p> : null}
      <CoupleUnit people={group.people} coupleBar={group.coupleBar} lit={lit} focusIds={focusIds} onFocus={onFocus} onOpen={onOpen} onRemove={onRemove} flashId={flashId} />
    </div>
  );
}

function LaneRow({ lane, focusIds, onFocus, onOpen, onRemove, flashId }: {
  lane: GenerationLane; focusIds: Set<string>; onFocus: (id: string) => void; onOpen: (person: Person) => void; onRemove: (id: string) => void; flashId?: string;
}) {
  const focusCouple = lane.id === "focus";
  return (
    <div className="gen-lane">
      <p className="gen-lane-title">{LANE_WORDS[lane.id] ?? lane.id}</p>
      <div className="gen-stem" aria-hidden />
      <div className="gen-scroll" aria-label={lane.id}>
        {lane.groups ? lane.groups.map((group) => (
          <SideGroup key={group.parentId} group={group} focusIds={focusIds} onFocus={onFocus} onOpen={onOpen} onRemove={onRemove} flashId={flashId} />
        )) : (
          <CoupleUnit people={lane.people} coupleBar={focusCouple ? lane.coupleBar : false} lit={Boolean(lane.coupleBar) && lane.people.some((p) => focusIds.has(p.id))} focusIds={focusIds} onFocus={onFocus} onOpen={onOpen} onRemove={onRemove} flashId={flashId} />
        )}
      </div>
    </div>
  );
}

export function FocusFamily({ tree, onFocus, onOpen, onAddParent, onAddPartner, onAddChild, onAddSibling, onRemove }: Props) {
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | undefined>();
  const [adding, setAdding] = useState<"parent" | "partner" | "child" | "sibling" | null>(null);
  const [removeId, setRemoveId] = useState<string | undefined>();
  const [viewId, setViewId] = useState(tree.focusPersonId);
  useEffect(() => {
    if (tree.focusPersonId) setViewId(tree.focusPersonId);
  }, [tree.focusPersonId]);
  const handleFocus = (id: string) => {
    setViewId(id);
    onFocus(id);
  };
  const focus = tree.people.find((p) => p.id === viewId) ?? tree.people.find((p) => p.id === tree.focusPersonId) ?? tree.people[0];
  const lanes = useMemo(() => buildGenerationLanes(tree, focus?.id), [tree, focus?.id]);
  const unions = useMemo(() => (focus ? unionsFor(tree, focus.id) : []), [tree, focus]);
  const primaryUnion = unions[0];
  const childParents = primaryUnion?.partnerIds ?? (focus ? [focus.id] : []);
  const hasParents = lanes.some((l) => l.id === "parents");
  const focusIds = useMemo(() => highlightedCoupleIds(tree, focus?.id), [tree, focus?.id]);
  const removePerson = removeId ? tree.people.find((p) => p.id === removeId) : undefined;

  useEffect(() => {
    if (!flashId) return;
    const node = document.querySelector(`[data-person-id="${flashId}"]`);
    node?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    const timer = window.setTimeout(() => setFlashId(undefined), 1600);
    return () => window.clearTimeout(timer);
  }, [flashId, tree]);

  if (!focus) return null;

  const addLabel = adding === "parent" ? "Parent's name" : adding === "partner" ? "Partner's name" : adding === "sibling" ? "Sibling's name" : "Child's name";

  async function submitAdd(name: string) {
    if (!adding) return;
    if (adding === "parent") await onAddParent(focus.id, name);
    if (adding === "partner") await onAddPartner(focus.id, name, "partnered");
    if (adding === "child") await onAddChild(childParents, name, primaryUnion?.id);
    if (adding === "sibling") {
      const addedId = await onAddSibling(focus.id, name);
      if (addedId) setFlashId(addedId);
    }
    setAdding(null);
  }

  return (
    <section className="focus-family" aria-label="Family around the focus person">
      <div className="focus-toolbar">
        <button type="button" className="btn" onClick={() => setPeopleOpen(true)}>People</button>
      </div>
      <div className="gen-stack">
        {lanes.map((lane) => (
          <LaneRow key={lane.id} lane={lane} focusIds={focusIds} onFocus={handleFocus} onOpen={onOpen} onRemove={(id) => setRemoveId(id)} flashId={flashId} />
        ))}
      </div>
      {removePerson ? (
        <div className="remove-confirm" role="alertdialog">
          <p className="error">Remove {displayName(removePerson)} from this tree?</p>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => setRemoveId(undefined)}>Cancel</button>
            <button type="button" className="btn danger" onClick={async () => { await onRemove(removePerson.id); setRemoveId(undefined); }}>Remove</button>
          </div>
        </div>
      ) : null}
      <div className="actions focus-actions">
        <button type="button" className="btn" onClick={() => setAdding("parent")}>Add parent</button>
        <button type="button" className="btn" onClick={() => setAdding("partner")}>Add partner</button>
        <button type="button" className="btn" onClick={() => setAdding("child")}>Add child</button>
        <button type="button" className="btn" onClick={() => setAdding("sibling")}>Add sibling</button>
      </div>
      {adding === "sibling" && !hasParents ? <p className="error">Add a parent first</p> : null}
      {adding && !(adding === "sibling" && !hasParents) ? (
        <AddNameRow label={addLabel} onAdd={submitAdd} onCancel={() => setAdding(null)} />
      ) : null}
      {peopleOpen ? (
        <PeopleList tree={tree} onClose={() => setPeopleOpen(false)} onPick={(person) => { handleFocus(person.id); setPeopleOpen(false); }} />
      ) : null}
    </section>
  );
}
