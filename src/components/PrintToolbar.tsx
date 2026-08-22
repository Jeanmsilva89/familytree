"use client";

import Link from "next/link";
import { BrandMark } from "./BrandMark";

export function PrintToolbar({ title }: { title: string }) {
  return (
    <div className="no-print app-shell print-toolbar">
      <Link className="brand" href="/">
        <BrandMark className="brand-mark" />
        <div>
          <h1>Family Tree</h1>
          <p className="privacy">Printable</p>
        </div>
      </Link>
      <p className="print-toolbar-title">{title}</p>
      <button className="btn primary" type="button" onClick={() => window.print()}>
        Print or save PDF
      </button>
      <p>
        <Link href="/printables">← Kid printables</Link>
        {" \u00b7 "}
        <Link href="/">Tree</Link>
      </p>
    </div>
  );
}
