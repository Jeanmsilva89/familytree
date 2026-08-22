"use client";

import { useEffect, useState } from "react";
import { PrintToolbar } from "@/components/PrintToolbar";
import { loadTree } from "@/lib/db";
import { buildView } from "@/lib/layout";
import type { TreeData } from "@/lib/types";
import { displayName, emptyTree } from "@/lib/types";

export default function PuzzlePage() {
  const [tree, setTree] = useState<TreeData>(emptyTree());

  useEffect(() => {
    loadTree().then(setTree);
  }, []);

  const view = buildView(tree);
  const unit = view.selfUnits[0];
  const pieces = [
    ...(unit?.partners ?? []).map((p) => displayName(p)),
    ...(unit?.children ?? []).map((p) => displayName(p)),
  ].slice(0, 4);

  return (
    <div className="print-page">
      <PrintToolbar />
      <h1>Who belongs together?</h1>
      {pieces.length === 0 ? (
        <p>No names on this device yet.</p>
      ) : (
        <>
          <p>Cut on the dashed lines. Mix the pieces, then put the couple and kids back together.</p>
          <div className="puzzle">
            {pieces.map((label, idx) => (
              <div key={`${label}-${idx}`} className="slot">
                <strong>{label}</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
