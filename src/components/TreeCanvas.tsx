"use client";

import { useEffect, useMemo, useRef, type PointerEvent } from "react";
import type { Person, TreeData } from "@/lib/types";
import { displayName } from "@/lib/types";
import { CARD, ageLabel, buildGraph, initialsOf, lineageIds, swatchHue } from "@/lib/layout";
import { centerTransform, coupleTintBox, fitContentScale, pinchCamera, scaleAround } from "@/lib/graphView";

type Props = {
  tree: TreeData;
  highlightedId?: string;
  onHighlight: (person?: Person) => void;
  onOpen: (person: Person) => void;
  fitKey?: string | number | boolean;
};

type View = { x: number; y: number; s: number };
type PinchStart = View & { dist: number; midX: number; midY: number };

function kinPath(fromX: number, fromY: number, toX: number, toY: number): string {
  const midY = fromY + Math.max(16, (toY - fromY) * 0.5);
  return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
}

function isFiniteBox(x: number, y: number, w?: number, h?: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (w !== undefined && !Number.isFinite(w)) return false;
  if (h !== undefined && !Number.isFinite(h)) return false;
  return true;
}

export function TreeCanvas({ tree, highlightedId, onHighlight, onOpen, fitKey }: Props) {
  const householdHint = tree.focusPersonId;
  const layout = useMemo(() => buildGraph(tree, householdHint), [tree, householdHint]);
  const household = useMemo(
    () => new Set(layout.householdIds.length ? layout.householdIds : layout.focusId ? [layout.focusId] : []),
    [layout.householdIds, layout.focusId],
  );
  const linked = useMemo(
    () => (highlightedId ? lineageIds(tree, highlightedId) : null),
    [tree, highlightedId],
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ x: 40, y: 24, s: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const pinch = useRef<PinchStart | null>(null);
  const suppressTap = useRef(false);
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

  function stagePoint(clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!stage) return { x: clientX, y: clientY };
    const rect = stage.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function pinchSnapshot(): PinchStart | null {
    const pts = activePoints();
    if (pts.length < 2) return null;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (dist < 8) return null;
    const a = stagePoint(pts[0].x, pts[0].y);
    const b = stagePoint(pts[1].x, pts[1].y);
    return {
      ...viewRef.current,
      dist,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  function fitToView() {
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
  }

  function zoomBy(factor: number) {
    const stage = stageRef.current;
    const cx = (stage?.clientWidth ?? 360) / 2;
    const cy = (stage?.clientHeight ?? 480) / 2;
    viewRef.current = scaleAround(viewRef.current, cx, cy, viewRef.current.s * factor);
    scheduleApply();
  }

  useEffect(() => {
    applyWorld();
  }, []);

  useEffect(() => {
    fitToView();
  }, [layout, tree.people.length, fitKey]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (event.cancelable) event.preventDefault();
      const pt = stagePoint(event.clientX, event.clientY);
      viewRef.current = scaleAround(viewRef.current, pt.x, pt.y, viewRef.current.s * (event.deltaY < 0 ? 1.08 : 0.92));
      scheduleApply();
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  function tapCard(person: Person) {
    if (suppressTap.current) return;
    if (highlightedId === person.id) onOpen(person);
    else onHighlight(person);
  }

  function activePoints() {
    return [...pointers.current.values()];
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (pointers.current.size === 0) suppressTap.current = false;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      drag.current = null;
      suppressTap.current = true;
      stageRef.current?.setPointerCapture(event.pointerId);
      pinch.current = pinchSnapshot();
      return;
    }
    if ((event.target as HTMLElement).closest(".portrait-card, .graph-zoom")) return;
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
      const pts = activePoints();
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (dist < 8) return;
      const a = stagePoint(pts[0].x, pts[0].y);
      const b = stagePoint(pts[1].x, pts[1].y);
      viewRef.current = pinchCamera(pinch.current, dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      suppressTap.current = true;
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
      if (moved < 8 && !suppressTap.current && !(event.target as HTMLElement).closest(".portrait-card, .graph-zoom")) {
        onHighlight(undefined);
      }
    }
    if (pointers.current.size === 0) drag.current = null;
  }

  const stageW = Number.isFinite(layout.width) ? layout.width : 320;
  const stageH = Number.isFinite(layout.height) ? layout.height : 240;
  const cards = layout.cards.filter((card) => isFiniteBox(card.x, card.y));
  const edges = layout.edges.filter((edge) => isFiniteBox(edge.fromX, edge.fromY) && isFiniteBox(edge.toX, edge.toY));

  function lineWeight(lit: boolean) {
    if (!linked) return { width: 1.6, opacity: 0.4 };
    if (lit) return { width: 2.6, opacity: 0.9 };
    return { width: 1.2, opacity: 0.12 };
  }

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
          {edges.map((edge, i) => {
            const kinLit = Boolean(
              linked &&
                linked.has(edge.childId) &&
                edge.parentIds.some((id) => linked.has(id)),
            );
            const w = lineWeight(kinLit);
            return (
              <path
                key={`k${i}`}
                d={kinPath(edge.fromX, edge.fromY, edge.toX, edge.toY)}
                fill="none"
                stroke="var(--graph-kin)"
                strokeWidth={w.width}
                strokeOpacity={w.opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
          {layout.couples.filter((c) => c.bar).map((couple) => {
            const pair = couple.partnerIds.map((id) => cards.find((card) => card.id === id)).filter(Boolean);
            if (pair.length < 2 || !Number.isFinite(couple.cy)) return null;
            const left = pair.reduce((a, b) => (a!.x < b!.x ? a : b));
            const right = pair.reduce((a, b) => (a!.x > b!.x ? a : b));
            if (!left || !right) return null;
            const x1 = left.x + CARD.w / 2 + 1;
            const x2 = right.x - CARD.w / 2 - 1;
            if (x2 <= x1 || !isFiniteBox(x1, couple.cy, x2)) return null;
            const barLit = Boolean(linked && couple.partnerIds.every((id) => linked.has(id)));
            const w = lineWeight(barLit);
            return (
              <line
                key={couple.id}
                x1={x1}
                y1={couple.cy}
                x2={x2}
                y2={couple.cy}
                stroke="var(--graph-spouse)"
                strokeWidth={w.width + 0.4}
                strokeOpacity={w.opacity}
                strokeLinecap="round"
              />
            );
          })}
        </svg>

        {layout.couples.filter((c) => c.bar).map((couple) => {
          const pair = couple.partnerIds.map((id) => cards.find((card) => card.id === id)).filter(Boolean) as typeof cards;
          if (pair.length < 2) return null;
          const box = coupleTintBox(pair);
          if (!box || !isFiniteBox(box.left, box.top, box.width, box.height)) return null;
          const isHome = pair.every((c) => household.has(c.person.id));
          return (
            <div
              key={`${couple.id}-tint`}
              className={`couple-tint${isHome ? " is-home" : ""}`}
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            />
          );
        })}

        {cards.map((card) => {
          const isHome = household.has(card.person.id);
          const connected = Boolean(linked?.has(card.person.id));
          const selected = card.person.id === highlightedId;
          const active = selected || connected || isHome;
          const dim = Boolean(linked && !connected);
          const age = ageLabel(card.person.birthDate);
          const left = card.x - CARD.w / 2;
          if (!isFiniteBox(left, card.y, CARD.w, CARD.h)) return null;
          const photo = card.person.photo;
          return (
            <button
              key={card.id}
              type="button"
              className={`portrait-card${photo ? " has-photo" : ""}${isHome ? " is-home" : ""}${active ? " is-active" : ""}${dim ? " is-dim" : ""}`}
              style={{ left, top: card.y, width: CARD.w, height: CARD.h }}
              onClick={(event) => {
                event.stopPropagation();
                tapCard(card.person);
              }}
              aria-pressed={selected}
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
      <div className="graph-zoom" role="group" aria-label="Zoom">
        <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.15)}>+</button>
        <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.15)}>−</button>
        <button type="button" className="icon-btn" aria-label="Recenter" onClick={fitToView}>⌂</button>
      </div>
    </div>
  );
}
