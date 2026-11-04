"use client";

import { useMemo } from "react";
import type { Person, TreeData } from "@/lib/types";
import { deriveFamilyUnits, movesWith, unitOfPerson } from "@/lib/familyUnits";

type Choice = { unitOf: string | null } | "auto";

type Props = {
  tree: TreeData;
  person: Person;
  onChange: (personId: string, choice: Choice) => void | Promise<void>;
};

const AUTO = "auto";
const OWN = "own";

/** "Family unit" select: automatic (maternal rule), another unit, or a unit of their own. */
export function FamilyUnitPicker({ tree, person, onChange }: Props) {
  const { units, current, automatic, along } = useMemo(() => {
    const units = deriveFamilyUnits(tree);
    const others = (tree.familyUnitOverrides ?? []).filter((o) => o.personId !== person.id);
    const automatic = unitOfPerson(deriveFamilyUnits(tree, others), person.id);
    const override = [...(tree.familyUnitOverrides ?? [])].reverse().find((o) => o.personId === person.id);
    const applied = override && !units.ignoredOverrides.includes(override) ? override : undefined;
    let current = AUTO;
    if (applied?.unitOf === null) current = OWN;
    else if (applied?.unitOf) current = unitOfPerson(units, applied.unitOf)?.rootId ?? AUTO;
    const along = movesWith(tree, person.id).map((id) => tree.people.find((p) => p.id === id)!);
    return { units, current, automatic, along };
  }, [tree, person.id]);
  const names = along.slice(0, 3).map((p) => p.givenName || "?");
  if (along.length > 3) names.push(`${along.length - 3} more`);

  return (
    <label className="field family-unit-field">
      Family unit
      <select
        value={current}
        onChange={(event) => {
          const value = event.target.value;
          void onChange(person.id, value === AUTO ? "auto" : { unitOf: value === OWN ? null : value });
        }}
      >
        <option value={AUTO}>Automatic{automatic ? ` · ${automatic.label}` : ""}</option>
        {units.units
          .filter((unit) => unit.rootId !== person.id || current !== AUTO)
          .map((unit) => (
            <option key={unit.id} value={unit.rootId}>
              {unit.label}
            </option>
          ))}
        <option value={OWN}>Own family unit</option>
      </select>
      {along.length && current === AUTO ? (
        <small className="family-unit-note">
          Moving {person.givenName || "them"} also moves {names.slice(0, -1).join(", ")}
          {names.length > 1 ? " and " : ""}
          {names[names.length - 1]}.
        </small>
      ) : null}
    </label>
  );
}
