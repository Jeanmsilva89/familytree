"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PrintToolbar } from "@/components/PrintToolbar";
import { loadTree } from "@/lib/db";
import { relationshipToFocus } from "@/lib/relationships";
import type { TreeData } from "@/lib/types";
import { displayName, emptyTree } from "@/lib/types";

export default function MatchPage() {
  const [tree, setTree] = useState<TreeData>(emptyTree());

  useEffect(() => {
    loadTree().then(setTree);
  }, []);

  const names = tree.people.map(displayName);
  const rels = tree.people.map((p) => relationshipToFocus(tree, p));

  return (
    <div className="print-page">
      <PrintToolbar title="Match the lines" />
      <p>Draw a line from each name to how they fit in this family.</p>
      <div className="match-row">
        <div>
          <h2>Names</h2>
          {names.map((name) => (
            <div key={name} className="match-item">
              {name}
            </div>
          ))}
        </div>
        <div>
          <h2>How they fit</h2>
          {[...new Set(rels)].map((rel) => (
            <div key={rel} className="match-item">
              {rel}
            </div>
          ))}
        </div>
      </div>
      {tree.people.length === 0 ? (
        <div className="empty-state no-print">
          <p>No people to match yet.</p>
          <Link className="btn" href="/">Open Family Tree</Link>
        </div>
      ) : null}
    </div>
  );
}
