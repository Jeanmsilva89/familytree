"use client";

import type { Person, TreeData } from "@/lib/types";
import { displayName } from "@/lib/types";
import { buildView } from "@/lib/layout";

type Props = {
  tree: TreeData;
  selectedId?: string;
  onSelect: (person: Person) => void;
};

function PersonButton({
  person,
  selected,
  onSelect,
  caption,
}: {
  person: Person;
  selected: boolean;
  onSelect: (person: Person) => void;
  caption?: string;
}) {
  return (
    <button
      type="button"
      className={`person-card${selected ? " active" : ""}`}
      onClick={() => onSelect(person)}
      aria-pressed={selected}
    >
      <strong>{displayName(person)}</strong>
      {caption ? <span>{caption}</span> : person.birthDate ? <span>{person.birthDate}</span> : null}
    </button>
  );
}

export function TreeCanvas({ tree, selectedId, onSelect }: Props) {
  const view = buildView(tree, selectedId ?? tree.focusPersonId);
  return (
    <div className="canvas" aria-label="Living family graph">
      {view.parentUnits.map((unit) => (
        <section key={unit.id} className="unit" aria-label="Parents">
          <p className="unit-label">Parents</p>
          <div className="people-row">
            {unit.partners.map((person) => (
              <PersonButton key={person.id} person={person} selected={selectedId === person.id} onSelect={onSelect} caption="parent" />
            ))}
          </div>
        </section>
      ))}
      {view.selfUnits.map((unit) => (
        <section key={unit.id} className={`unit${unit.partners.some((p) => p.id === selectedId) ? " selected" : ""}`}>
          <p className="unit-label">
            {unit.partners.length > 1
              ? unit.union?.kind === "married"
                ? "Couple - married"
                : unit.union?.kind === "separated"
                  ? "Couple - two households"
                  : "Couple"
              : "Family"}
          </p>
          <div className="people-row">
            {unit.partners.map((person) => (
              <PersonButton
                key={person.id}
                person={person}
                selected={selectedId === person.id}
                onSelect={onSelect}
                caption={person.id === view.focus?.id ? "you started here" : "partner"}
              />
            ))}
          </div>
          {unit.children.length > 0 ? (
            <div className="kids-row" style={{ marginTop: 12 }}>
              {unit.children.map((person) => (
                <PersonButton key={person.id} person={person} selected={selectedId === person.id} onSelect={onSelect} caption="child" />
              ))}
            </div>
          ) : null}
        </section>
      ))}
      {view.loneChildren.length > 0 ? (
        <section className="unit" aria-label="Children">
          <p className="unit-label">Kids</p>
          <div className="kids-row">
            {view.loneChildren.map((person) => (
              <PersonButton key={person.id} person={person} selected={selectedId === person.id} onSelect={onSelect} caption="child" />
            ))}
          </div>
        </section>
      ) : null}
      {view.others.length > 0 ? (
        <section className="unit" aria-label="More people">
          <p className="unit-label">Also on this tree</p>
          <div className="people-row">
            {view.others.map((person) => (
              <PersonButton key={person.id} person={person} selected={selectedId === person.id} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
