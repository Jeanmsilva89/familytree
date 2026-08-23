"use client";

import type { KinKind, LinkRole, ParentRole, Person, UnionKind } from "@/lib/types";
import { UNION_KIND_OPTIONS, displayName } from "@/lib/types";

type Props = {
  from: Person;
  to: Person;
  showSibling?: boolean;
  onPick: (role: LinkRole, kind?: UnionKind, parentRole?: ParentRole, kin?: KinKind) => void | Promise<void>;
  onCancel: () => void;
};

export function LinkRolePicker({ from, to, showSibling, onPick, onCancel }: Props) {
  const fromName = displayName(from);
  const toName = displayName(to);
  return (
    <>
      <p>
        {fromName} and {toName}
      </p>
      <p className="pick-label">Couple</p>
      {UNION_KIND_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === "married" ? "btn primary" : "btn"}
          onClick={() => void onPick("partner", option.value)}
        >
          {option.label}
        </button>
      ))}
      <p className="pick-label">Family</p>
      <button type="button" className="btn" onClick={() => void onPick("parent", undefined, "father")}>
        {`${toName} is ${fromName}’s father`}
      </button>
      <button type="button" className="btn" onClick={() => void onPick("parent", undefined, "mother")}>
        {`${toName} is ${fromName}’s mother`}
      </button>
      <button type="button" className="btn" onClick={() => void onPick("child")}>
        {`${toName} is ${fromName}’s child`}
      </button>
      {showSibling ? (
        <button type="button" className="btn" onClick={() => void onPick("sibling")}>
          {`${toName} is ${fromName}’s sibling`}
        </button>
      ) : null}
      <p className="pick-label">Adopted and step</p>
      <button type="button" className="btn" onClick={() => void onPick("parent", undefined, "father", "step")}>
        {`${toName} is ${fromName}’s stepfather`}
      </button>
      <button type="button" className="btn" onClick={() => void onPick("parent", undefined, "mother", "step")}>
        {`${toName} is ${fromName}’s stepmother`}
      </button>
      <button type="button" className="btn" onClick={() => void onPick("parent", undefined, undefined, "adopted")}>
        {`${toName} adopted ${fromName}`}
      </button>
      <button type="button" className="btn" onClick={() => void onPick("parent", undefined, undefined, "foster")}>
        {`${toName} fostered ${fromName}`}
      </button>
      <button type="button" className="btn" onClick={() => void onPick("child", undefined, undefined, "adopted")}>
        {`${toName} is ${fromName}’s adopted child`}
      </button>
      <button type="button" className="btn" onClick={() => void onPick("child", undefined, undefined, "step")}>
        {`${toName} is ${fromName}’s stepchild`}
      </button>
      <button type="button" className="btn ghost" onClick={onCancel}>
        Cancel
      </button>
    </>
  );
}
