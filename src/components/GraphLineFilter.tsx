"use client";

import { KIN_KIND_OPTIONS } from "@/lib/types";
import {
  genealogyOnlyFilter,
  toggleLineKind,
  type LineFilter,
} from "@/lib/kinFilter";

type Props = {
  value: LineFilter;
  onChange: (next: LineFilter) => void;
};

export function GraphLineFilter({ value, onChange }: Props) {
  return (
    <div className="graph-filter" role="group" aria-label="Which lines to show">
      <button
        type="button"
        className={value.genealogyOnly ? "chip is-on" : "chip"}
        aria-pressed={value.genealogyOnly}
        onClick={() => onChange(genealogyOnlyFilter(!value.genealogyOnly, value))}
      >
        Genealogy only
      </button>
      {KIN_KIND_OPTIONS.map((option) => {
        const on = !value.genealogyOnly && value[option.value];
        return (
          <button
            key={option.value}
            type="button"
            className={on ? "chip is-on" : "chip"}
            aria-pressed={on}
            onClick={() => onChange(toggleLineKind(value, option.value))}
          >
            {option.label}
          </button>
        );
      })}
      <button
        type="button"
        className={!value.genealogyOnly && value.couples ? "chip is-on" : "chip"}
        aria-pressed={!value.genealogyOnly && value.couples}
        onClick={() => onChange(toggleLineKind(value, "couples"))}
      >
        Couples
      </button>
    </div>
  );
}
