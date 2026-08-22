"use client";

import Link from "next/link";

type Props = {
  title?: string;
  backHref?: string;
  backLabel?: string;
};

export function PrintToolbar({
  title,
  backHref = "/printables",
  backLabel = "\u2190 Kid printables",
}: Props) {
  return (
    <div className="no-print print-toolbar">
      <p>
        <Link href={backHref}>{backLabel}</Link>
        {" \u00b7 "}
        <Link href="/">Tree</Link>
      </p>
      {title ? <h1 className="print-toolbar-title">{title}</h1> : null}
      <button className="btn primary" type="button" onClick={() => window.print()}>
        Print or save PDF
      </button>
    </div>
  );
}
