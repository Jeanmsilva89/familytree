"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent, type TouchEvent, type WheelEvent } from "react";
import type { Person, TreeData } from "@/lib/types";
import { displayName } from "@/lib/types";
import {
  CARD,
  ageLabel,
  buildGraph,
  initialsOf,
  lineageIds,
} from "@/lib/layout";

type Props = {
  tree: TreeData;
  highlightedId?: string;
  onHighlight: (person?: Person) => void;
  onOpen: (person: Person) => void;
};

function curve(fromX: number, fromY: number, toX: number, toY: number): string {
  const midY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
}

export function TreeCanvas({ tree, highlightedId, onHighlight, onOpen }: Props) {
  const layout = useMemo(() => buildGraph(tree, highlightedId ?? tree.focusPersonId), [tree, highlightedId]);
  const linked = useMemo(
    () => (highlightedId ? lineageIds(tree, highlightedId) : null),
    [tree, highlightedId],
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 40, y: 24, s: 1 });
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const pinch = useRef<{ dist: number; s: number } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onHighlight(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onHighlight]);

  function tapCard(person: Person) {
    if (highlightedId === person.id) onOpen(person);
    else onHighlight(person);
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const next = Math.min(2.2, Math.max(0.55, view.s * (event.deltaY < 0 ? 1.08 : 0.92)));
    setView((v) => ({ ...v, s: next }));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".portrait-card")) return;
    stageRef.current?.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    setView((v) => ({
      ...v,
      x: drag.current!.vx + (event.clientX - drag.current!.x),
      y: drag.current!.vy + (event.clientY - drag.current!.y),
    }));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const moved =
      Math.abs(event.clientX - drag.current.x) + Math.abs(event.clientY - drag.current.y);
    drag.current = null;
    if (moved < 8 && !(event.target as HTMLElement).closest(".portrait-card")) {
      onHighlight(undefined);
    }
  }

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinch.current = { dist, s: view.s };
    }
  }

  function onTouchMove(event: TouchEvent) {
    if (event.touches.length === 2 && pinch.current) {
      const [a, b] = [event.touches[0], event.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const next = Math.min(2.2, Math.max(0.55, (pinch.current.s * dist) / pinch.current.dist));
      setView((v) => ({ ...v, s: next }));
    }
  }

  return (
    <div
      ref={stageRef}
      className="graph-stage"
      aria-label="Family graph"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
    >
      <div
        className="graph-world"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
        }}
      >
        <svg className="graph-lines" width={layout.width} height={layout.height} aria-hidden>
          {layout.edges.map((edge, i) => (
            <path
              key={i}
              d={curve(edge.fromX, edge.fromY, edge.toX, edge.toY)}
              fill="none"
              stroke="var(--line-ink)"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          ))}
          {layout.couples
            .filter((c) => c.bar)
            .map((couple) => {
              const [a, b] = couple.partnerIds
                .map((id) => layout.cards.find((card) => card.id === id))
                .filter(Boolean);
              if (!a || !b) return null;
              const left = a.x < b.x ? a : b;
              const right = a.x < b.x ? b : a;
              const x1 = left.x + CARD.w / 2 + 2;
              const x2 = right.x - CARD.w / 2 - 2;
              return (
                <line
                  key={couple.id}
                  x1={x1}
                  y1={couple.cy}
                  x2={x2}
                  y2={couple.cy}
                  stroke="var(--ink)"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              );
            })}
        </svg>

        {layout.couples
          .filter((c) => c.partnerIds.length >= 2)
          .map((couple) => {
            const cards = couple.partnerIds
              .map((id) => layout.cards.find((card) => card.id === id))
              .filter(Boolean) as typeof layout.cards;
            if (cards.length < 2) return null;
            const minX = Math.min(...cards.map((c) => c.x)) - CARD.w / 2 - 8;
            const maxX = Math.max(...cards.map((c) => c.x)) + CARD.w / 2 + 8;
            const y = Math.min(...cards.map((c) => c.y)) - 8;
            return (
              <div
                key={`${couple.id}-tint`}
                className="couple-tint"
                style={{ left: minX, top: y, width: maxX - minX, height: CARD.h + 16 }}
              />
            );
          })}

        {layout.cards.map((card) => {
          const active = highlightedId === card.person.id;
          const dim = linked ? !linked.has(card.person.id) : false;
          const age = ageLabel(card.person.birthDate);
          return (
            <button
              key={card.id}
              type="button"
              className={`portrait-card${active ? " is-active" : ""}${dim ? " is-dim" : ""}`}
              style={{ left: card.x - CARD.w / 2, top: card.y, width: CARD.w, height: CARD.h }}
              onClick={(event) => {
                event.stopPropagation();
                tapCard(card.person);
              }}
              aria-pressed={active}
            >
              <span className="swatch" aria-hidden>
                {initialsOf(card.person)}
              </span>
              <span className="fade">
                <strong>{displayName(card.person)}</strong>
                {age ? <em>{age}</em> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
