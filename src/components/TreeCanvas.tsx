"use client";

import { useEffect, useMemo, useRef, type PointerEvent } from "react";
import type { Person, TreeData } from "@/lib/types";
import { displayName } from "@/lib/types";
import { CARD, ageLabel, buildGraph, initialsOf, lineageIds, swatchHue } from "@/lib/layout";
import { centerTransform, fitContentScale, highlightedCoupleIds } from "@/lib/graphView";

type Props = {
  tree: TreeData;
  highlightedId?: string;
  onHighlight: (person?: Person) => void;
  onOpen: (person: Person) => void;
};

type View = { x: number; y: number; s: number };

function gutterPath(fromX: number, fromY: number, toX: number, toY: number): string {
  const midY = fromY + Math.max(16, (toY - fromY) * 0.45);
  return `M ${fromX} ${fromY} L ${fromX} ${midY} L ${toX} ${midY} L ${toX} ${toY}`;
}

function clampScale(s: number) {
  return Math.min(2.2, Math.max(0.55, s));
}

function isFiniteBox(x: number, y: number, w?: number, h?: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (w !== undefined && !Number.isFinite(w)) return false;
  if (h !== undefined && !Number.isFinite(h)) return false;
  return true;
}

export function TreeCanvas({ tree, highlightedId, onHighlight, onOpen }: Props) {
  const focusId = highlightedId ?? tree.focusPersonId;
  const layout = useMemo(() => buildGraph(tree, focusId), [tree, focusId]);
  const linked = useMemo(() => (focusId ? lineageIds(tree, focusId) : null), [tree, focusId]);
  const coupleLit = useMemo(() => highlightedCoupleIds(tree, focusId), [tree, focusId]);
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ x: 40, y: 24, s: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const pinch = useRef<{ dist: number; s: number } | null>(null);
  const raf = useRef<number | null>(null);

  function applyWorld() {
    const el = worldRef.current;
    if (!el) return;
    const { x, y, s } = viewRef.current;
    el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  }

  function scheduleApply() {
    if (raf.current != null) return;
    raf.current = window.requestAnimationFrame(() => {
      raf.current = null;
      applyWorld();
    });
  }

  useEffect(() => {
    applyWorld();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const card = layout.cards.find((c) => c.id === focusId);
    if (!stage || !card) return;
    const vw = stage.clientWidth || 360;
    const vh = stage.clientHeight || 480;
    const couple = layout.couples.find((c) => c.bar && c.partnerIds.includes(focusId ?? ""));
    const unitIds = new Set(couple?.partnerIds ?? [focusId]);
    const kids = layout.cards.filter((c) => c.gen === -1);
    const unit = layout.cards.filter((c) => unitIds.has(c.id));
    const pack = [...unit, ...kids];
    const xs = pack.map((c) => c.x);
    const ys = pack.map((c) => c.y);
    const minX = Math.min(...xs) - CARD.w / 2;
    const maxX = Math.max(...xs) + CARD.w / 2;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + CARD.h;
    const narrow = vw < 720;
    const scale = narrow
      ? fitContentScale(vw, vh, Math.max(maxX - minX, CARD.w * 2), Math.max(maxY - minY, CARD.h * 2))
      : viewRef.current.s || 1;
    viewRef.current = centerTransform(vw, vh, card.x, card.y + CARD.h / 2, scale);
    applyWorld();
  }, [focusId, layout]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onHighlight(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onHighlight]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (event.cancelable) event.preventDefault();
      viewRef.current.s = clampScale(viewRef.current.s * (event.deltaY < 0 ? 1.08 : 0.92));
      scheduleApply();
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  function tapCard(person: Person) {
    if (highlightedId === person.id) onOpen(person);
    else onHighlight(person);
  }

  function activePoints() {
    return [...pointers.current.values()];
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      drag.current = null;
      const [a, b] = activePoints();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < 8) {
        pinch.current = null;
        return;
      }
      pinch.current = { dist, s: viewRef.current.s };
      return;
    }
    if ((event.target as HTMLElement).closest(".portrait-card")) return;
    stageRef.current?.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      vx: viewRef.current.x,
      vy: viewRef.current.y,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = activePoints();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < 8) return;
      viewRef.current.s = clampScale((pinch.current.s * dist) / pinch.current.dist);
      scheduleApply();
      return;
    }
    if (pinch.current) return;
    if (!drag.current || drag.current.id !== event.pointerId) return;
    viewRef.current.x = drag.current.vx + (event.clientX - drag.current.x);
    viewRef.current.y = drag.current.vy + (event.clientY - drag.current.y);
    scheduleApply();
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (start && start.id === event.pointerId) {
      const moved = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
      drag.current = null;
      if (moved < 8 && !(event.target as HTMLElement).closest(".portrait-card")) {
        onHighlight(undefined);
      }
    }
    if (pointers.current.size === 0) drag.current = null;
  }

  const stageW = Number.isFinite(layout.width) ? layout.width : 320;
  const stageH = Number.isFinite(layout.height) ? layout.height : 240;
  const cards = layout.cards.filter((card) => isFiniteBox(card.x, card.y));
  const edges = layout.edges.filter((edge) => isFiniteBox(edge.fromX, edge.fromY) && isFiniteBox(edge.toX, edge.toY));

  return (
    <div
      ref={stageRef}
      className="graph-stage"
      aria-label="Family graph"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div ref={worldRef} className="graph-world" style={{ width: stageW, height: stageH, transform: "translate(40px, 24px) scale(1)" }}>
        <svg className="graph-lines" width={stageW} height={stageH} aria-hidden>
          {edges.map((edge, i) => (
            <path key={i} d={gutterPath(edge.fromX, edge.fromY, edge.toX, edge.toY)} fill="none" stroke="var(--line-ink)" strokeWidth="2.4" strokeLinecap="round" />
          ))}
          {layout.couples.filter((c) => c.bar).map((couple) => {
            const [a, b] = couple.partnerIds.map((id) => cards.find((card) => card.id === id)).filter(Boolean);
            if (!a || !b || !Number.isFinite(couple.cy)) return null;
            const left = a.x < b.x ? a : b;
            const right = a.x < b.x ? b : a;
            const x1 = left.x + CARD.w / 2 + 2;
            const x2 = right.x - CARD.w / 2 - 2;
            if (!isFiniteBox(x1, couple.cy, x2)) return null;
            return <line key={couple.id} x1={x1} y1={couple.cy} x2={x2} y2={couple.cy} stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />;
          })}
        </svg>

        {layout.couples.filter((c) => c.bar && c.partnerIds.length >= 2).map((couple) => {
          const pair = couple.partnerIds.map((id) => cards.find((card) => card.id === id)).filter(Boolean) as typeof cards;
          if (pair.length < 2) return null;
          const minX = Math.min(...pair.map((c) => c.x)) - CARD.w / 2 - 8;
          const maxX = Math.max(...pair.map((c) => c.x)) + CARD.w / 2 + 8;
          const y = Math.min(...pair.map((c) => c.y)) - 8;
          const width = maxX - minX;
          if (!isFiniteBox(minX, y, width, CARD.h + 16)) return null;
          return <div key={`${couple.id}-tint`} className="couple-tint" style={{ left: minX, top: y, width, height: CARD.h + 16 }} />;
        })}

        {cards.map((card) => {
          const active = coupleLit.has(card.person.id);
          const dim = linked ? !linked.has(card.person.id) : false;
          const age = ageLabel(card.person.birthDate);
          const left = card.x - CARD.w / 2;
          if (!isFiniteBox(left, card.y, CARD.w, CARD.h)) return null;
          return (
            <button
              key={card.id}
              type="button"
              className={`portrait-card${active ? " is-active" : ""}${dim ? " is-dim" : ""}`}
              style={{ left, top: card.y, width: CARD.w, height: CARD.h }}
              onClick={(event) => {
                event.stopPropagation();
                tapCard(card.person);
              }}
              aria-pressed={active}
            >
              <span className="swatch" style={{ ["--swatch-hue" as string]: String(swatchHue(card.person)) }} aria-hidden>
                {initialsOf(card.person)}
              </span>
              <span className="identity">
                <strong title={displayName(card.person)}>{displayName(card.person)}</strong>
                {age ? <em>{age}</em> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
