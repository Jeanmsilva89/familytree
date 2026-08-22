"use client";

import Link from "next/link";
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
      <PrintToolbar title="Relationship cards" />
      <div className="cards-grid">
        {tree.people.map((person) => {
          const card = cardLines(tree, person);
          return (
            <article key={person.id} className="rel-card">
              <p className="unit-label">{card.rel}</p>
              <h2>{card.name}</h2>
              {person.birthDate ? <p><span className="birth-label">Birth date</span> {person.birthDate}</p> : <p> </p>}
            </article>
          );
        })}
        {tree.people.length === 0 ? (
          <div className="empty-state no-print">
            <p>No people to print yet.</p>
            <Link className="btn" href="/">Open Family Tree</Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
