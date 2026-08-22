"use client";

import Link from "next/link";

export function PrintToolbar({ title }: { title: string }) {
  return (
    <div className="no-print app-shell" style={{ paddingBottom: 8 }}>
      <p>
        <Link href="/printables">← Kid printables</Link>
        {" · "}
        <Link href="/">Tree</Link>
      </p>
      <h1 style={{ fontFamily: "Palatino, serif" }}>{title}</h1>
      <button className="btn primary" type="button" onClick={() => window.print()}>
        Print or save PDF
      </button>
    </div>
  );
}
