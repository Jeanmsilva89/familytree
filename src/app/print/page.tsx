"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PrintToolbar } from "@/components/PrintToolbar";
import { loadTree } from "@/lib/db";
import { buildView } from "@/lib/layout";
import type { TreeData } from "@/lib/types";
import { displayName, emptyTree } from "@/lib/types";

function Birth({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <div>
      <span className="birth-label">Birth date</span>
      <span>{value}</span>
    </div>
  );
}

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
      <PrintToolbar title="Family Tree" />
      <article className="print-tree">
        {!ready ? <p>Loading…</p> : null}
        {ready && tree.people.length === 0 ? (
          <div className="empty-state no-print">
            <p>No tree on this device yet.</p>
            <Link className="btn" href="/">Open Family Tree</Link>
          </div>
        ) : null}
        {view.parentUnits.map((unit) => (
          <section key={unit.id} className="print-unit">
            <p>Parents</p>
            <div className="print-couple">
              {unit.partners.map((p) => (
                <div key={p.id} className="print-person">
                  <strong>{displayName(p)}</strong>
                  <Birth value={p.birthDate} />
                </div>
              ))}
            </div>
          </section>
        ))}
        {view.selfUnits.map((unit) => (
          <section key={unit.id} className="print-unit">
            <p>Family</p>
            <div className="print-couple">
              {unit.partners.map((p) => (
                <div key={p.id} className="print-person">
                  <strong>{displayName(p)}</strong>
                  <Birth value={p.birthDate} />
                </div>
              ))}
            </div>
            {unit.children.length ? (
              <div className="print-kids">
                {unit.children.map((p) => (
                  <div key={p.id} className="print-person">
                    {displayName(p)}
                    <Birth value={p.birthDate} />
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
