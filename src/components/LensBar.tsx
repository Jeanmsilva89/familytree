"use client";

import { useState } from "react";
import type { TreeLink } from "@/lib/access";

type Props = {
  people: { id: string; label: string; name: string }[];
  invites: TreeLink[];
  looking: "owner" | string;
  preview: boolean;
  onLookOwner: () => void;
  onLookPerson: (personId: string) => void;
  onLookGuest: (inviteId: string) => void;
  onPreview: (next: boolean) => void;
  onAccept: (inviteId: string) => void;
  onRevoke: (inviteId: string) => void;
  onAddGuest: (name: string) => void;
};

export function LensBar({
  people,
  invites,
  looking,
  preview,
  onLookOwner,
  onLookPerson,
  onLookGuest,
  onPreview,
  onAccept,
  onRevoke,
  onAddGuest,
}: Props) {
  const [naming, setNaming] = useState(false);
  const [guestName, setGuestName] = useState("");
  const arranging = looking !== "owner";

  return (
    <div className="lens-bar" role="group" aria-label="Who is looking">
      <button
        type="button"
        className={looking === "owner" ? "chip is-on" : "chip"}
        aria-pressed={looking === "owner"}
        onClick={onLookOwner}
      >
        You
      </button>
      {people.map((person) => (
        <button
          key={person.id}
          type="button"
          className={looking === person.id ? "chip is-on" : "chip"}
          aria-pressed={looking === person.id}
          aria-label={`Look as ${person.name}`}
          onClick={() => onLookPerson(person.id)}
        >
          {person.label}
        </button>
      ))}
      {invites.map((invite) => {
        const label = invite.guestLabel?.trim() || "Guest";
        const selected = looking === invite.id;
        return (
          <span key={invite.id} className="invite-card" data-invite-id={invite.id} data-invite-status={invite.status}>
            <button
              type="button"
              className={selected ? "chip is-on" : "chip"}
              aria-pressed={selected}
              aria-label={`Look as ${label}, ${invite.status}`}
              onClick={() => onLookGuest(invite.id)}
            >
              {label}
              <small>{invite.status}</small>
            </button>
            {invite.status === "pending" ? (
              <button type="button" className="chip invite-step" aria-label={`Accept invite for ${label}`} onClick={() => onAccept(invite.id)}>
                Accept
              </button>
            ) : null}
            {invite.status === "accepted" ? (
              <button type="button" className="chip invite-step" aria-label={`Revoke invite for ${label}`} onClick={() => onRevoke(invite.id)}>
                Revoke
              </button>
            ) : null}
          </span>
        );
      })}
      {arranging ? (
        <button
          type="button"
          className={preview ? "chip is-on" : "chip"}
          aria-pressed={preview}
          onClick={() => onPreview(!preview)}
        >
          Preview
        </button>
      ) : null}
      {naming ? (
        <form
          className="lens-name"
          onSubmit={(event) => {
            event.preventDefault();
            const name = guestName.trim();
            if (!name) return;
            onAddGuest(name);
            setGuestName("");
            setNaming(false);
          }}
        >
          <input
            aria-label="Guest name"
            placeholder="Guest name"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            autoFocus
          />
          <button type="submit" className="chip">Add card</button>
          <button type="button" className="chip" onClick={() => setNaming(false)}>Cancel</button>
        </form>
      ) : (
        <button type="button" className="chip" onClick={() => setNaming(true)}>
          Invite card
        </button>
      )}
    </div>
  );
}
