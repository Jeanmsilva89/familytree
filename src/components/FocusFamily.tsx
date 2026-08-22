"use client";

import { useEffect, useMemo, useState } from "react";
import type { Person, TreeData, UnionKind } from "@/lib/types";
import { ageFromBirthDate, displayName, initials } from "@/lib/types";
import { buildGenerationLanes, type GenerationGroup, type GenerationLane } from "@/lib/generations";
import { highlightedCoupleIds } from "@/lib/graphView";
import { unionsFor } from "@/lib/tree";
import { PeopleList } from "./PeopleList";

type Props = {
  tree: TreeData;
  onFocus: (personId: string) => void;
  onOpen: (person: Person) => void;
  onAddParent: (childId: string, name: string) => Promise<void>;
  onAddPartner: (personId: string, name: string, kind: UnionKind) => Promise<void>;
  onAddChild: (parentIds: string[], name: string, unionId?: string) => Promise<void>;
  onAddSibling: (personId: string, name: string) => Promise<string | void>;
  onRemove: (id: string) => Promise<void>;
};

function promptName(label: string): string | null {
  const value = window.prompt(label);
  if (!value || !value.trim()) return null;
  return value.trim();
}

const LANE_WORDS: Record<string, string> = {
  grandparents: "Grandparents",
  parents: "Parents",
  focus: "Family",
  children: "Kids",
  grandchildren: "Kids",
};

function PersonChip({
  person,
  focused,
  flash,
  onFocus,
  onOpen,
  onRemove,
}: {
  person: Person;
  focused?: boolean;
  flash?: boolean;
  onFocus: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const age = ageFromBirthDate(person.birthDate);
  const cls = ["focus-card", focused ? "is-focus" : "", flash ? "is-flash" : ""].filter(Boolean).join(" ");
  const label = displayName(person);
  return (
    <article className={cls} data-person-id={person.id}>
      <button type="button" className="focus-face" onClick={onFocus} aria-label={`Focus ${label}`}>
        <span className="avatar" aria-hidden>
          {person.photo ? <img src={person.photo} alt="" /> : initials(person)}
        </span>
        <span className="focus-name">{label}</span>
        {age ? <span className="hint">{age}</span> : null}
      </button>
      <div className="card-actions">
        <button type="button" className="icon-btn" aria-label={`Edit and Remove ${label}`} aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
          {"⋮"}
        </button>
        {menu ? (
          <div className="card-menu" role="menu">
            <button type="button" className="btn ghost" role="menuitem" onClick={() => { setMenu(false); onOpen(); }} aria-label={`Edit ${label}`}>Edit</button>
            <button type="button" className="btn ghost" role="menuitem" onClick={() => { setMenu(false); onRemove(); }} aria-label={`Remove ${label}`}>Remove</button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
