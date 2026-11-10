"use client";

import { useId } from "react";
import { displayName } from "@/lib/types";
import type { ShareSummary } from "@/lib/access";
import { GeneratedAvatar } from "./GeneratedAvatar";

type Props = {
  summary?: ShareSummary;
  error?: string;
  onAdd: () => void;
  onClose: () => void;
};

function countLine(counts: ShareSummary["counts"]): string {
  const people = `${counts.people} ${counts.people === 1 ? "person" : "people"}`;
  const couples = `${counts.unions} ${counts.unions === 1 ? "couple" : "couples"}`;
  const links = `${counts.childLinks} ${counts.childLinks === 1 ? "parent link" : "parent links"}`;
  return `${people} · ${couples} · ${links}`;
}

export function SharePreview({ summary, error, onAdd, onClose }: Props) {
  const titleId = useId();
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="sheet share-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-share-preview="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-head">
          <h2 id={titleId}>Add a shared family</h2>
          <button type="button" className="sheet-close" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {summary ? (
          <>
            <p className="hint">From {summary.ownerName}. This stays on this device.</p>
            <p className="share-counts">{countLine(summary.counts)}</p>
            <ul className="share-people">
              {summary.people.map((person) => {
                const name = displayName({ ...person, id: person.id, createdAt: "", updatedAt: "" });
                return (
                  <li key={person.id} aria-label={name}>
                    <span className="share-face">
                      <GeneratedAvatar person={person} />
                    </span>
                    <span>{person.givenName}</span>
                  </li>
                );
              })}
            </ul>
            {summary.counts.people === 0 ? <p className="hint">No one is in this share.</p> : null}
            <button type="button" className="btn primary" onClick={onAdd}>
              Add to my tree
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
