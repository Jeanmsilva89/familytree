"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadTree } from "@/lib/db";
import { buildView } from "@/lib/layout";
import type { TreeData } from "@/lib/types";
import { displayName, emptyTree } from "@/lib/types";
import { BrandMark } from "@/components/BrandMark";

export default function PrintTreePage() {
  const [tree, setTree] = useState<TreeData>(emptyTree());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadTree().then((data) => {
      setTree(data);
      setReady(true);
    });
  }, []);

  const view = buildView(tree);

  return (
    <div className="print-page">
      <div className="no-print app-shell print-toolbar">
        <Link className="brand" href="/">
          <BrandMark className="brand-mark" />
          <div>
            <h1>Family Tree</h1>
            <p className="privacy">Print</p>
          </div>
        </Link>
        <p className="print-toolbar-title">Print your tree</p>
        <button className="btn primary" type="button" onClick={() => window.print()}>
          Print or save PDF
        </button>
        <p className="hint">Use your browser’s print dialog to save a PDF. Nothing is uploaded.</p>
        <p>
          <Link href="/">← Back to tree</Link>
        </p>
      </div>
      <article className="print-tree">
        <h1>Family Tree</h1>
        {!ready ? <p>Loading…</p> : null}
        {ready && tree.people.length === 0 ? <p>No tree on this device yet.</p> : null}
        {view.parentUnits.map((unit) => (
          <section key={unit.id} className="print-unit">
            <p>Parents</p>
            <div className="print-couple">
              {unit.partners.map((p) => (
                <div key={p.id} className="print-person">
                  <strong>{displayName(p)}</strong>
                </div>
              ))}
            </div>
          </section>
        ))}
        {view.selfUnits.map((unit) => (
          <section key={unit.id} className="print-unit">
            <div className="print-couple">
              {unit.partners.map((p) => (
                <div key={p.id} className="print-person">
                  <strong>{displayName(p)}</strong>
                  {p.birthDate ? <div>{p.birthDate}</div> : null}
                </div>
              ))}
            </div>
            {unit.children.length ? (
              <div className="print-kids">
                {unit.children.map((p) => (
                  <div key={p.id} className="print-person">
                    {displayName(p)}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </article>
    </div>
  );
}
