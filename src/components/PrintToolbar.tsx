"use client";

import Link from "next/link";

export function PrintToolbar({ title }: { title: string }) {
  return (
    <nav className="no-print print-toolbar" aria-label="Print">
      <p>
        <Link href="/printables">Kid printables</Link>
        {" \u00b7 "}
        <Link href="/">Tree</Link>
      </p>
      <p className="print-toolbar-title">{title}</p>
      <button className="btn primary" type="button" onClick={() => window.print()}>
        Print or save PDF
      </button>
    </nav>
  );
}
