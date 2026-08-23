"use client";

import { FormEvent, useId, useMemo, useState, type KeyboardEvent } from "react";
import type { Person } from "@/lib/types";
import { displayName, initials, matchPeople } from "@/lib/types";

type SuggestProps = {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  people?: Person[];
  excludeId?: string;
  onPick?: (person: Person) => void;
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
};

export function NameAutocomplete({
  id,
  label,
  value,
  onChange,
  people = [],
  excludeId,
  onPick,
  placeholder,
  autoFocus,
  required,
}: SuggestProps) {
  const listId = useId();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [active, setActive] = useState(-1);
  const matches = useMemo(
    () => (onPick ? matchPeople(people, value, excludeId) : []),
    [onPick, people, value, excludeId],
  );

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!matches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (event.key === "Enter" && active >= 0 && matches[active] && onPick) {
      event.preventDefault();
      onPick(matches[active]);
    } else if (event.key === "Escape") {
      setActive(-1);
    }
  }

  return (
    <div className="suggest">
      <input
        id={inputId}
        aria-label={label}
        aria-autocomplete="list"
        aria-controls={matches.length ? listId : undefined}
        aria-expanded={matches.length > 0}
        aria-activedescendant={active >= 0 && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        role="combobox"
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => {
          setActive(-1);
          onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        required={required}
        autoComplete="off"
      />
      {matches.length ? (
        <ul id={listId} className="suggest-list" role="listbox" aria-label="People on this tree">
          {matches.map((person, i) => (
            <li key={person.id} role="presentation">
              <button
                type="button"
                id={`${listId}-${person.id}`}
                role="option"
                aria-selected={i === active}
                className={`people-row${i === active ? " is-active" : ""}`}
                onClick={() => onPick?.(person)}
              >
                <span className="avatar" aria-hidden>
                  {person.photo ? <img src={person.photo} alt="" /> : initials(person)}
                </span>
                <span>{displayName(person)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {matches.length ? <p className="suggest-hint">Already on this tree — tap to link.</p> : null}
    </div>
  );
}

type Props = {
  label: string;
  onAdd: (name: string) => Promise<void> | void;
  onCancel?: () => void;
  people?: Person[];
  excludeId?: string;
  onPickExisting?: (person: Person) => Promise<void> | void;
};

export function AddNameRow({ label, onAdd, onCancel, people, excludeId, onPickExisting }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next || busy) return;
    setBusy(true);
    try {
      await onAdd(next);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  async function pick(person: Person) {
    if (busy || !onPickExisting) return;
    setBusy(true);
    try {
      await onPickExisting(person);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-name-row" onSubmit={submit}>
      <NameAutocomplete
        label={label}
        value={name}
        onChange={setName}
        people={people}
        excludeId={excludeId}
        onPick={onPickExisting ? pick : undefined}
        autoFocus
        required
      />
      <button className="btn primary" type="submit" disabled={busy}>Add</button>
      {onCancel ? <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button> : null}
    </form>
  );
}
