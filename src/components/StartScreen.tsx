"use client";

import { FormEvent, useState } from "react";
import { ExamplePreview } from "./ExamplePreview";

type Props = {
  onStart: (name: string) => Promise<void>;
  onTryExample: () => Promise<void>;
};

export function StartScreen({ onStart, onTryExample }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onStart(name);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hero">
      <h2>Who are you starting with?</h2>
      <p className="lede">One name is enough. Add a parent, partner, or child whenever you are ready.</p>
      <form onSubmit={handleSubmit}>
        <div className="start-row">
          <label className="sr-only" htmlFor="start-name">
            First name
          </label>
          <input
            id="start-name"
            name="givenName"
            autoComplete="given-name"
            placeholder="e.g. Alex"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
            Start
          </button>
        </div>
      </form>
      <p className="privacy">Stays on this device. No account.</p>
      <ExamplePreview onTry={() => onTryExample()} />
    </section>
  );
}
