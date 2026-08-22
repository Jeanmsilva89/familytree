"use client";

import { useEffect, useMemo, useState } from "react";
import type { Person, TreeData, UnionKind } from "@/lib/types";
import { ageFromBirthDate, displayName, initials } from "@/lib/types";
import { buildGenerationLanes, type GenerationGroup, type GenerationLane } from "@/lib/generations";
import { highlightedCoupleIds } from "@/lib/graphView";
import { unionsFor } from "@/lib/tree";
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

function promptName(label: string): string | null {
  const value = window.prompt(label);
  if (!value || !value.trim()) return null;
  return value.trim();
}

function PersonChip({
  person,
  focused,
  flash,
  onFocus,
  onOpen,
  onRemove,
}: {
  person: Person;
  focused?: boolean;
  flash?: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const age = ageFromBirthDate(person.birthDate);
  const name = displayName(person);
  const cls = ["focus-card", focused ? "is-focus" : "", flash ? "is-flash" : ""].filter(Boolean).join(" ");
  return (
    <article className={cls} data-person-id={person.id}>
      <button type="button" className="focus-face" onClick={onFocus} aria-label={`Focus ${name}`}>
        <span className="avatar" aria-hidden>
          {person.photo ? <img src={person.photo} alt="" /> : initials(person)}
        </span>
        <span className="focus-name">{name}</span>
        {age ? <span className="hint">{age}</span> : null}
      </button>
      <div className="card-actions">
        <button type="button" className="icon-btn" onClick={onOpen} aria-label={`Edit ${name}`}>
          Edit
        </button>
        <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Remove ${name}`}>
          X
        </button>
      </div>
    </article>
  );
}

function CoupleUnit({
  people,
  coupleBar,
  lit,
  focusIds,
  onFocus,
  onOpen,
  onRemove,
  flashId,
}: {
  people: Person[];
  coupleBar?: boolean;
  lit?: boolean;
  focusIds: Set<string>;
  onFocus: (id: string) => void;
  onOpen: (person: Person) => void;
  onRemove: (id: string) => void;
  flashId?: string;
}) {
  const unit = Boolean(coupleBar && people.length >= 2);
  return (
    <div className={`couple-unit${unit ? " is-unit" : ""}${lit && unit ? " is-lit" : ""}`}>
      {people.map((p) => (
        <PersonChip
          key={p.id}
          person={p}
          focused={focusIds.has(p.id)}
          flash={flashId === p.id}
          onFocus={() => onFocus(p.id)}
          onOpen={() => onOpen(p)}
          onRemove={() => onRemove(p.id)}
        />
      ))}
    </div>
  );
}

function SideGroup({
  group,
  focusIds,
  onFocus,
  onOpen,
  onRemove,
  flashId,
}: {
  group: GenerationGroup;
  focusIds: Set<string>;
  onFocus: (id: string) => void;
  onOpen: (person: Person) => void;
  onRemove: (id: string) => void;
  flashId?: string;
}) {
  const lit = group.people.some((p) => focusIds.has(p.id));
  return (
    <div className="gen-group">
      {group.label ? <p className="gen-group-label">{group.label}</p> : null}
      <CoupleUnit
        people={group.people}
        coupleBar={group.coupleBar}
        lit={lit}
        focusIds={focusIds}
        onFocus={onFocus}
        onOpen={onOpen}
        onRemove={onRemove}
        flashId={flashId}
      />
    </div>
  );
}

function LaneRow({
  lane,
  focusIds,
  onFocus,
  onOpen,
  onRemove,
  flashId,
}: {
  lane: GenerationLane;
  focusIds: Set<string>;
  onFocus: (id: string) => void;
  onOpen: (person: Person) => void;
  onRemove: (id: string) => void;
  flashId?: string;
}) {
  const focusCouple = lane.id === "focus";
  return (
    <div className="gen-lane">
      <div className="gen-stem" aria-hidden />
      <h2 className="gen-lane-title">{lane.title}</h2>
      <div className="gen-scroll" aria-label={lane.title}>
        {lane.groups
          ? lane.groups.map((group) => (
              <SideGroup
                key={group.parentId}
                group={group}
                focusIds={focusIds}
                onFocus={onFocus}
                onOpen={onOpen}
                onRemove={onRemove}
                flashId={flashId}
              />
            ))
          : (
              <CoupleUnit
                people={lane.people}
                coupleBar={focusCouple ? lane.coupleBar : false}
                lit={focusCouple && Boolean(lane.coupleBar)}
                focusIds={focusIds}
                onFocus={onFocus}
                onOpen={onOpen}
                onRemove={onRemove}
                flashId={flashId}
              />
            )}
      </div>
    </div>
  );
}

export function FocusFamily({
  tree,
  onFocus,
  onOpen,
  onAddParent,
  onAddPartner,
  onAddChild,
  onAddSibling,
  onRemove,
}: Props) {
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | undefined>();
  const focus = tree.people.find((p) => p.id === tree.focusPersonId) ?? tree.people[0];
  const lanes = useMemo(() => buildGenerationLanes(tree, focus?.id), [tree, focus?.id]);
  const unions = useMemo(() => (focus ? unionsFor(tree, focus.id) : []), [tree, focus]);
  const primaryUnion = unions[0];
  const childParents = primaryUnion?.partnerIds ?? (focus ? [focus.id] : []);
  const hasParents = lanes.some((l) => l.id === "parents");
  const focusIds = useMemo(
    () => highlightedCoupleIds(tree, focus?.id),
    [tree, focus?.id],
  );

  useEffect(() => {
    if (!flashId) return;
    const node = document.querySelector(`[data-person-id="${flashId}"]`);
    node?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    const timer = window.setTimeout(() => setFlashId(undefined), 1600);
    return () => window.clearTimeout(timer);
  }, [flashId, tree]);

  async function confirmRemove(person: Person) {
    if (!confirm(`Remove ${displayName(person)} from this tree?`)) return;
    await onRemove(person.id);
  }

  if (!focus) return null;

  return (
    <section className="focus-family" aria-label="Family around the focus person">
      <div className="focus-toolbar">
        <button type="button" className="btn" onClick={() => setPeopleOpen(true)}>
          People
        </button>
      </div>

      <div className="gen-stack">
        {lanes.map((lane) => (
          <LaneRow
            key={lane.id}
            lane={lane}
            focusIds={focusIds}
            onFocus={onFocus}
            onOpen={onOpen}
            onRemove={(id) => {
              const person = tree.people.find((p) => p.id === id);
              if (person) void confirmRemove(person);
            }}
            flashId={flashId}
          />
        ))}
      </div>

      <div className="actions focus-actions">
        <button type="button" className="btn" onClick={async () => {
          const name = promptName("Parent's name");
          if (name) await onAddParent(focus.id, name);
        }}>Add parent</button>
        <button type="button" className="btn" onClick={async () => {
          const name = promptName("Partner's name");
          if (name) await onAddPartner(focus.id, name, "partnered");
        }}>Add partner</button>
        <button type="button" className="btn" onClick={async () => {
          const name = promptName("Child's name");
          if (name) await onAddChild(childParents, name, primaryUnion?.id);
        }}>Add child</button>
        <button type="button" className="btn" onClick={async () => {
          if (!hasParents) { window.alert("Add a parent first"); return; }
          const name = promptName("Sibling's name");
          if (!name) return;
          const addedId = await onAddSibling(focus.id, name);
          if (addedId) setFlashId(addedId);
        }}>Add sibling</button>
      </div>

      {peopleOpen ? (
        <PeopleList tree={tree} onClose={() => setPeopleOpen(false)} onPick={(person) => { onFocus(person.id); setPeopleOpen(false); }} />
      ) : null}
    </section>
  );
}
