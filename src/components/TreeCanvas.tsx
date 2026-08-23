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

function familyBranches(
  fromX: number,
  fromY: number,
  targets: { x: number; y: number }[],
): string[] {
  if (!targets.length) return [];
  const top = Math.min(...targets.map((t) => t.y));
  const busY = fromY + Math.max(18, (top - fromY) * 0.4);
  const stem = `M ${fromX} ${fromY} L ${fromX} ${busY}`;
  const xs = targets.map((t) => t.x);
  const minX = Math.min(...xs, fromX);
  const maxX = Math.max(...xs, fromX);
  const bus = maxX - minX > 1 ? [`M ${minX} ${busY} L ${maxX} ${busY}`] : [];
  const drops = targets.map((t) => {
    const rise = Math.max(12, (t.y - busY) * 0.38);
    return `M ${t.x} ${busY} C ${t.x} ${busY + rise}, ${t.x} ${t.y - rise * 0.28}, ${t.x} ${t.y}`;
  });
  return [stem, ...bus, ...drops];
}

function clampScale(s: number) {
  return Math.min(2.2, Math.max(0.45, s));
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
    if (!stage || layout.cards.length === 0) return;
    const vw = stage.clientWidth || 360;
    const vh = stage.clientHeight || 480;
    const xs = layout.cards.map((c) => c.x);
    const ys = layout.cards.map((c) => c.y);
    const minX = Math.min(...xs) - CARD.w / 2;
    const maxX = Math.max(...xs) + CARD.w / 2;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + CARD.h;
    const scale = fitContentScale(vw, vh, Math.max(maxX - minX, CARD.w), Math.max(maxY - minY, CARD.h));
    viewRef.current = centerTransform(vw, vh, (minX + maxX) / 2, (minY + maxY) / 2, scale);
    applyWorld();
  }, [focusId, layout, tree.people.length]);

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
  const branches = (() => {
    const groups = new Map<string, { fromX: number; fromY: number; targets: { x: number; y: number }[] }>();
    for (const edge of edges) {
      const key = `${edge.fromX.toFixed(1)}:${edge.fromY.toFixed(1)}`;
      const group = groups.get(key) ?? { fromX: edge.fromX, fromY: edge.fromY, targets: [] };
      group.targets.push({ x: edge.toX, y: edge.toY });
      groups.set(key, group);
    }
    return [...groups.values()].flatMap((group) =>
      familyBranches(group.fromX, group.fromY, group.targets),
    );
  })();
  const coupleMate = new Set(layout.couples.filter((c) => c.bar).flatMap((c) => c.partnerIds));

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
          {branches.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--graph-line)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>

        {layout.couples.filter((c) => c.bar && c.partnerIds.length >= 2).map((couple) => {
          const pair = couple.partnerIds.map((id) => cards.find((card) => card.id === id)).filter(Boolean) as typeof cards;
          if (pair.length < 2) return null;
          const minX = Math.min(...pair.map((c) => c.x)) - CARD.w / 2 - 5;
          const maxX = Math.max(...pair.map((c) => c.x)) + CARD.w / 2 + 5;
          const y = Math.min(...pair.map((c) => c.y)) - 5;
          const width = maxX - minX;
          const height = CARD.h + 10;
          if (!isFiniteBox(minX, y, width, height)) return null;
          const lit = pair.some((c) => coupleLit.has(c.person.id));
          return <div key={`${couple.id}-tint`} className={`couple-tint${lit ? " is-lit" : ""}`} style={{ left: minX, top: y, width, height }} />;
        })}

        {cards.map((card) => {
          const active = coupleLit.has(card.person.id) || card.person.id === focusId;
          const dim = linked ? !linked.has(card.person.id) : false;
          const age = ageLabel(card.person.birthDate);
          const left = card.x - CARD.w / 2;
          if (!isFiniteBox(left, card.y, CARD.w, CARD.h)) return null;
          const photo = card.person.photo;
          const inCouple = coupleMate.has(card.person.id);
          return (
            <button
              key={card.id}
              type="button"
              className={`portrait-card${photo ? " has-photo" : ""}${active ? " is-active" : ""}${dim ? " is-dim" : ""}${inCouple ? " in-couple" : ""}`}
              style={{ left, top: card.y, width: CARD.w, height: CARD.h }}
              onClick={(event) => {
                event.stopPropagation();
                tapCard(card.person);
              }}
              aria-pressed={active}
            >
              {photo ? <img className="portrait-photo" src={photo} alt="" /> : (
                <span className="swatch" style={{ ["--swatch-hue" as string]: String(swatchHue(card.person)) }} aria-hidden>
                  {initialsOf(card.person)}
                </span>
              )}
              <span className="identity">
                <strong title={displayName(card.person)}>{card.person.givenName || displayName(card.person)}</strong>
                <em>{age ?? "—"}</em>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
