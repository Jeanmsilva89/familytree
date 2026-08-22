"use client";

import { useEffect, useState } from "react";
import { PrintToolbar } from "@/components/PrintToolbar";
import { loadTree } from "@/lib/db";
import { cardLines } from "@/lib/relationships";
import type { TreeData } from "@/lib/types";
import { emptyTree } from "@/lib/types";

export default function CardsPage() {
  const [tree, setTree] = useState<TreeData>(emptyTree());

  useEffect(() => {
    loadTree().then(setTree);
  }, []);

  return (
    <div className="print-page">
      <PrintToolbar />
      <h1>Relationship cards</h1>
      <div className="cards-grid">
        {tree.people.map((person) => {
          const card = cardLines(tree, person);
          return (
            <article key={person.id} className="rel-card">
              <p className="unit-label">{card.rel}</p>
              <h2>{card.name}</h2>
              {person.birthDate ? <p className="birth-label">Born {person.birthDate}</p> : null}
            </article>
          );
        })}
        {tree.people.length === 0 ? <p>No names on this device yet.</p> : null}
      </div>
    </div>
  );
}
