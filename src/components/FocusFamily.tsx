"use client";

import { useMemo, useState } from "react";
import type { Person, TreeData, UnionKind } from "@/lib/types";
import { ageFromBirthDate, displayName, initials } from "@/lib/types";
import { buildGenerationLanes, type GenerationLane } from "@/lib/generations";
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

function LaneRow({
  lane,
  focusId,
  onFocus,
  onOpen,
}: {
  lane: GenerationLane;
  focusId?: string;
  onFocus: (id: string) => void;
  onOpen: (person: Person) => void;
}) {
  const couple = lane.id === "focus";
  return (
    <div className="gen-lane">
      <div className="gen-stem" aria-hidden />
      <div
        className={`gen-scroll${couple && lane.coupleBar ? " has-bar" : ""}`}
        aria-label={lane.id}
      >
        {lane.groups
          ? lane.groups.map((group) => (
              <div key={group.parentId} className="gen-group">
                {group.people.map((p) => (
                  <PersonChip
                    key={p.id}
                    person={p}
                    focused={p.id === focusId}
                    onFocus={() => onFocus(p.id)}
                    onOpen={() => onOpen(p)}
                  />
                ))}
              </div>
            ))
          : lane.people.map((p) => (
              <PersonChip
                key={p.id}
                person={p}
                focused={p.id === focusId}
                onFocus={() => onFocus(p.id)}
                onOpen={() => onOpen(p)}
              />
            ))}
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
            focusId={focus.id}
            onFocus={onFocus}
            onOpen={onOpen}
          />
        ))}
      </div>

      <div className="actions focus-actions">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const name = promptName("Parent's name");
            if (name) await onAddParent(focus.id, name);
          }}
        >
          Add parent
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const name = promptName("Partner's name");
            if (name) await onAddPartner(focus.id, name, "partnered");
          }}
        >
          Add partner
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const name = promptName("Child's name");
            if (name) await onAddChild(childParents, name, primaryUnion?.id);
          }}
        >
          Add child
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            if (!hasParents) {
              window.alert("Add a parent first");
              return;
            }
            const name = promptName("Sibling's name");
            if (name) await onAddSibling(focus.id, name);
          }}
        >
          Add sibling
        </button>
      </div>

      {peopleOpen ? (
        <PeopleList
          tree={tree}
          onClose={() => setPeopleOpen(false)}
          onPick={(person) => {
            onFocus(person.id);
            setPeopleOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
