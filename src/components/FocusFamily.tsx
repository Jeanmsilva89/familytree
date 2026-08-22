"use client";

import { useMemo, useState } from "react";
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
  onAddSibling: (personId: string, name: string) => Promise<void>;
};

function promptName(label: string): string | null {
  const value = window.prompt(label);
  if (!value || !value.trim()) return null;
  return value.trim();
}

function PersonChip({
  person,
  focused,
  onFocus,
  onOpen,
}: {
  person: Person;
  focused?: boolean;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const age = ageFromBirthDate(person.birthDate);
  return (
    <article className={focused ? "focus-card is-focus" : "focus-card"}>
      <button type="button" className="focus-face" onClick={onFocus} aria-label={`Focus ${displayName(person)}`}>
        <span className="avatar" aria-hidden>
          {person.photo ? <img src={person.photo} alt="" /> : initials(person)}
        </span>
        <span className="focus-name">{displayName(person)}</span>
        {age ? <span className="hint">{age}</span> : null}
      </button>
      <button type="button" className="btn ghost" onClick={onOpen} aria-label={`Edit ${displayName(person)}`}>
        Edit
      </button>
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
}: {
  people: Person[];
  coupleBar?: boolean;
  lit?: boolean;
  focusIds: Set<string>;
  onFocus: (id: string) => void;
  onOpen: (person: Person) => void;
}) {
  const unit = Boolean(coupleBar && people.length >= 2);
  return (
    <div className={`couple-unit${unit ? " is-unit" : ""}${lit && unit ? " is-lit" : ""}`}>
      {people.map((p) => (
        <PersonChip
          key={p.id}
          person={p}
          focused={focusIds.has(p.id)}
          onFocus={() => onFocus(p.id)}
          onOpen={() => onOpen(p)}
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
}: {
  group: GenerationGroup;
  focusIds: Set<string>;
  onFocus: (id: string) => void;
  onOpen: (person: Person) => void;
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
      />
    </div>
  );
}

function LaneRow({
  lane,
  focusIds,
  onFocus,
  onOpen,
}: {
  lane: GenerationLane;
  focusIds: Set<string>;
  onFocus: (id: string) => void;
  onOpen: (person: Person) => void;
}) {
  const focusCouple = lane.id === "focus";
  return (
    <div className="gen-lane">
      <div className="gen-stem" aria-hidden />
      <div className="gen-scroll" aria-label={lane.id}>
        {lane.groups
          ? lane.groups.map((group) => (
              <SideGroup
                key={group.parentId}
                group={group}
                focusIds={focusIds}
                onFocus={onFocus}
                onOpen={onOpen}
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
}: Props) {
  const [peopleOpen, setPeopleOpen] = useState(false);
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
          if (name) await onAddSibling(focus.id, name);
        }}>Add sibling</button>
      </div>

      {peopleOpen ? (
        <PeopleList tree={tree} onClose={() => setPeopleOpen(false)} onPick={(person) => { onFocus(person.id); setPeopleOpen(false); }} />
      ) : null}
    </section>
  );
}
