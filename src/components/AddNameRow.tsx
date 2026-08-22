"use client";

import { FormEvent, useEffect, useRef } from "react";

type Props = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
  autoFocus?: boolean;
};

export function AddNameRow({
  label,
  placeholder = "Name",
  value,
  onChange,
  onSubmit,
  onCancel,
  autoFocus = true,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    await onSubmit();
  }

  return (
    <form className="inline-add" onSubmit={(e) => void submit(e)} aria-label={label}>
      <label className="sr-only" htmlFor="inline-add-name">{label}</label>
      <input
        ref={inputRef}
        id="inline-add-name"
        className="inline-add-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="name"
        enterKeyHint="done"
      />
      <button type="submit" className="btn primary" disabled={!value.trim()}>Add</button>
      <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
    </form>
  );
}
