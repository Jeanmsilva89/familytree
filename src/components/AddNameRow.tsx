"use client";

import { FormEvent, useState } from "react";

type Props = {
  label: string;
  onAdd: (name: string) => Promise<void> | void;
  onCancel?: () => void;
};

export function AddNameRow({ label, onAdd, onCancel }: Props) {
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

  return (
    <form className="add-name-row" onSubmit={submit}>
      <input aria-label={label} placeholder={label} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
      <button className="btn primary" type="submit" disabled={busy}>Add</button>
      {onCancel ? <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button> : null}
    </form>
  );
}
