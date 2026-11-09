"use client";

import { useState } from "react";
import type { PartnerStatus } from "@/lib/types";
import { partnerStatusLabel } from "@/lib/types";

type Props = {
  status: PartnerStatus;
  left: number;
  top: number;
};

/**
 * A quiet word for a divorce or a remarriage. The line style is always there.
 * The word appears only after a tap, and it does not cover a person's card.
 */
export function PartnerStatusMark({ status, left, top }: Props) {
  const [open, setOpen] = useState(false);
  if (status !== "divorced" && status !== "remarried") return null;
  const label = partnerStatusLabel(status);
  return (
    <button
      type="button"
      className="partner-status"
      data-status={status}
      data-open={open ? "true" : "false"}
      aria-expanded={open}
      aria-label={label}
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        setOpen((value) => !value);
      }}
    >
      {open ? label : null}
    </button>
  );
}
