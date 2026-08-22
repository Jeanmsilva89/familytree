"use client";

import Link from "next/link";

export function PrintToolbar({
  backHref = "/printables",
  backLabel = "Kid printables",
}: {
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="no-print print-toolbar">
      <p>
        <Link href={backHref}>{"← "}{backLabel}</Link>
        {" · "}
        <Link href="/">Family Tree</Link>
      </p>
      <button className="btn primary" type="button" onClick={() => window.print()}>
        Print or save PDF
      </button>
    </div>
  );
}
