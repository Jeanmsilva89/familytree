"use client";

import { useEffect, useMemo, useState } from "react";
import type { Person, TreeData } from "@/lib/types";
import { displayName, initials } from "@/lib/types";
import { scrollFieldIntoSheet, useBodyScrollLock } from "@/hooks/useVisualViewport";

type Props = {
  tree: TreeData;
  title?: string;
  excludeId?: string;
  embedded?: boolean;
  onPick: (person: Person) => void;
  onClose: () => void;
};

function isPhone() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

export function PeopleList({ tree, title = "Everyone", excludeId, embedded, onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const [autoFocus, setAutoFocus] = useState(false);
  useBodyScrollLock(!embedded);
  useEffect(() => {
    setAutoFocus(!isPhone());
  }, []);
  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tree.people
      .filter((p) => p.id !== excludeId)
      .filter((p) => !needle || displayName(p).toLowerCase().includes(needle));
  }, [tree.people, q, excludeId]);
  const noneOnTree = tree.people.filter((p) => p.id !== excludeId).length === 0;

  const inner = (
    <div
      className={embedded ? "people-embed" : "sheet"}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      onFocusCapture={(event) => scrollFieldIntoSheet(event.target)}
    >
      {embedded ? null : <div className="sheet-handle" aria-hidden />}
      <div className="sheet-head">
        <h2>{title}</h2>
        <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">{embedded ? "Back" : "Close"}</button>
      </div>
      <div className="sheet-search field">
        <label htmlFor="people-search">Search people</label>
        <input
          id="people-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          autoFocus={autoFocus}
        />
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
      {people.length === 0 ? (
        <p className="hint">{noneOnTree ? "No one on this tree yet. Add a name, then come back." : "No names match that search."}</p>
      ) : null}
    </div>
  );

  if (embedded) return inner;
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      {inner}
    </div>
  );
}
