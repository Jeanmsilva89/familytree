"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";

type Props = {
  label: string;
  placeholder?: string;
  onAdd: (name: string) => void | Promise<void>;
  onCancel: () => void;
};

export function AddNameRow({ label, placeholder = "Name", onAdd, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [name, setName] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await onAdd(trimmed);
    setName("");
  }

  return (
    <form className="inline-add add-name-row" onSubmit={(e) => void submit(e)} aria-label={label}>
      <label className="sr-only" htmlFor={inputId}>{label}</label>
      <input
        ref={inputRef}
        id={inputId}
        className="inline-add-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        autoComplete="name"
        enterKeyHint="done"
      />
      <button type="submit" className="btn primary" disabled={!name.trim()}>Add</button>
      <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
    </form>
  );
}
