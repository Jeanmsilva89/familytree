"use client";

import { useMemo, useState } from "react";
import type { Person, TreeData, Union, UnionKind } from "@/lib/types";
import { ageFromBirthDate, displayName, initials } from "@/lib/types";
import { kidsUnderUnion, parentsOf, unionsFor } from "@/lib/tree";
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
  large,
  onFocus,
  onOpen,
}: {
  person: Person;
  large?: boolean;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const age = ageFromBirthDate(person.birthDate);
  return (
    <article className={large ? "focus-card is-focus" : "focus-card"}>
      <button type="button" className="focus-face" onClick={onFocus} aria-label={`Focus ${displayName(person)}`}>
        <span className="avatar lg" aria-hidden>
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
  const parents = useMemo(() => (focus ? parentsOf(tree, focus.id) : []), [tree, focus]);
  const unions = useMemo(() => (focus ? unionsFor(tree, focus.id) : []), [tree, focus]);
  const primaryUnion: Union | undefined = unions[0];
  const partners = useMemo(() => {
    if (!focus) return [];
    const ids = new Set(unions.flatMap((u) => u.partnerIds).filter((id) => id !== focus.id));
    return tree.people.filter((p) => ids.has(p.id));
  }, [tree, unions, focus]);
  const children = useMemo(() => {
    if (!focus) return [];
    if (primaryUnion) return kidsUnderUnion(tree, primaryUnion);
    return tree.people.filter((p) =>
      tree.childLinks.some((l) => l.childId === p.id && l.parentIds.includes(focus.id)),
    );
  }, [tree, focus, primaryUnion]);

  if (!focus) return null;

  const showBar = primaryUnion && (primaryUnion.kind === "partnered" || primaryUnion.kind === "married");
  const childParents = primaryUnion?.partnerIds ?? [focus.id];

  return (
    <section className="focus-family" aria-label="Family around the focus person">
      <div className="focus-toolbar">
        <button type="button" className="btn" onClick={() => setPeopleOpen(true)}>
          People
        </button>
        <button type="button" className="btn ghost" onClick={() => setPeopleOpen(true)}>
          Everyone
        </button>
      </div>

      <div className="focus-row" aria-label="Parents">
        {parents.map((p) => (
          <PersonChip key={p.id} person={p} onFocus={() => onFocus(p.id)} onOpen={() => onOpen(p)} />
        ))}
        {parents.length === 0 ? <p className="hint">No parents yet.</p> : null}
      </div>

      <div className={`focus-couple ${showBar ? "has-bar" : ""}`} aria-label="Focus and partners">
        <PersonChip person={focus} large onFocus={() => onOpen(focus)} onOpen={() => onOpen(focus)} />
        {partners.map((p) => (
          <PersonChip key={p.id} person={p} onFocus={() => onFocus(p.id)} onOpen={() => onOpen(p)} />
        ))}
      </div>

      <div className="focus-row kids" aria-label="Children">
        {children.map((p) => (
          <PersonChip key={p.id} person={p} onFocus={() => onFocus(p.id)} onOpen={() => onOpen(p)} />
        ))}
        {children.length === 0 ? <p className="hint">No children yet.</p> : null}
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
          if (parents.length === 0) {
            window.alert("Add a parent first");
            return;
          }
          const name = promptName("Sibling's name");
          if (name) await onAddSibling(focus.id, name);
        }}>Add sibling</button>
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
