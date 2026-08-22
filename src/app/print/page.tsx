"use client";

import { useEffect, useMemo, useState } from "react";
import { PrintToolbar } from "@/components/PrintToolbar";
import { loadTree } from "@/lib/db";
import { buildGenerationLanes } from "@/lib/generations";
import { displayName, emptyTree } from "@/lib/types";

const LANE_TITLE: Record<string, string> = {
  grandparents: "Grandparents",
  parents: "Parents",
  focus: "This generation",
  children: "Children",
  grandchildren: "Grandchildren",
};

export default function PrintTreePage() {
  const [tree, setTree] = useState(emptyTree());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadTree().then((data) => {
      setTree(data);
      setReady(true);
    });
  }, []);

  const lanes = useMemo(() => buildGenerationLanes(tree, tree.focusPersonId), [tree]);

  return (
    <div className="print-page">
      <PrintToolbar title="Family Tree" backHref="/" backLabel={"\u2190 Back to Family Tree"} />
      <article className="print-tree">
        {!ready ? <p>Loading\u2026</p> : null}
        {ready && tree.people.length === 0 ? <p>No tree on this device yet.</p> : null}
        {lanes.map((lane) => {
          const people = lane.groups ? lane.groups.flatMap((g) => g.people) : lane.people;
          if (!people.length) return null;
          return (
            <section key={lane.id} className="print-unit print-gen">
              <h2>{LANE_TITLE[lane.id] ?? lane.id}</h2>
              <div className="print-couple">
                {people.map((p) => (
                  <div key={p.id} className="print-person">
                    <strong>{displayName(p)}</strong>
                    {p.birthDate ? <span className="birth-label">Born {p.birthDate}</span> : null}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </article>
    </div>
  );
}
