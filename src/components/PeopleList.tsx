"use client";

import { useMemo, useState } from "react";
import type { Person, TreeData } from "@/lib/types";
import { displayName, initials } from "@/lib/types";

type Props = {
  tree: TreeData;
  title?: string;
  excludeId?: string;
  embedded?: boolean;
  onPick: (person: Person) => void;
  onClose: () => void;
};

export function PeopleList({ tree, title = "Everyone", excludeId, embedded, onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tree.people
      .filter((p) => p.id !== excludeId)
      .filter((p) => !needle || displayName(p).toLowerCase().includes(needle));
  }, [tree.people, q, excludeId]);

  const inner = (
    <>
      <h2>{title}</h2>
      <div className="field">
        <label htmlFor="people-search">Search people</label>
        <input id="people-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" autoFocus />
      </div>
      <ul className="people-list">
        {people.map((person) => (
          <li key={person.id}>
            <button type="button" className="people-row" onClick={() => onPick(person)}>
              <span className="avatar" aria-hidden>
                {person.photo ? <img src={person.photo} alt="" /> : initials(person)}
              </span>
              <span>{displayName(person)}</span>
            </button>
          </li>
        ))}
      </ul>
      {people.length === 0 ? <p className="hint">No one matches.</p> : null}
    </>
  );

  if (embedded) return <div className="people-embed">{inner}</div>;

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden />
        <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">Close</button>
        {inner}
      </div>
    </div>
  );
}
