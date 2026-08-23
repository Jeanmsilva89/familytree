"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { LinkRole, Person, TreeData, UnionKind } from "@/lib/types";
import { displayName } from "@/lib/types";
import { CARD, ageLabel, buildGraph, initialsOf, lineageIds, swatchHue } from "@/lib/layout";
import { centerTransform, coupleTintBox, fitContentScale, pinchCamera, scaleAround } from "@/lib/graphView";

type Port = "parent" | "partner" | "child";

type Props = {
  tree: TreeData;
  highlightedId?: string;
  onHighlight: (person?: Person) => void;
  onOpen: (person: Person) => void;
  fitKey?: string | number | boolean;
  editMode?: boolean;
  onLink?: (personId: string, otherId: string, role: LinkRole, kind?: UnionKind) => void | Promise<void>;
  onUnlink?: (personId: string, otherId: string, role: Exclude<LinkRole, "sibling">) => void | Promise<void>;
};

type View = { x: number; y: number; s: number };
type PinchStart = View & { dist: number; midX: number; midY: number };
type ConnectDrag = { fromId: string; port: Port; x: number; y: number };

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

function portPoint(x: number, y: number, port: Port, side: "left" | "right" = "right") {
  if (port === "parent") return { x, y };
  if (port === "child") return { x, y: y + CARD.h };
  return { x: x + (side === "left" ? -CARD.w / 2 : CARD.w / 2), y: y + CARD.h / 2 };
}

export function TreeCanvas({
  tree,
  highlightedId,
  onHighlight,
  onOpen,
  fitKey,
  editMode = false,
  onLink,
  onUnlink,
}: Props) {
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
  const connectRef = useRef<ConnectDrag | null>(null);
  const [wire, setWire] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [partnerPick, setPartnerPick] = useState<{ fromId: string; toId: string } | null>(null);

  const cards = layout.cards.filter((card) => isFiniteBox(card.x, card.y));
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

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

  function worldPoint(clientX: number, clientY: number) {
    const pt = stagePoint(clientX, clientY);
    const { x, y, s } = viewRef.current;
    return { x: (pt.x - x) / s, y: (pt.y - y) / s };
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

  function cardAt(wx: number, wy: number) {
    return cards.find(
      (card) =>
        wx >= card.x - CARD.w / 2 - 12 &&
        wx <= card.x + CARD.w / 2 + 12 &&
        wy >= card.y - 12 &&
        wy <= card.y + CARD.h + 12,
    );
  }

  function startConnect(fromId: string, port: Port, clientX: number, clientY: number) {
    const pt = worldPoint(clientX, clientY);
    connectRef.current = { fromId, port, x: pt.x, y: pt.y };
    setPartnerPick(null);
    setWire({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
    suppressTap.current = true;
  }

  async function finishConnect(clientX: number, clientY: number) {
    const start = connectRef.current;
    connectRef.current = null;
    setWire(null);
    if (!start || !onLink) return;
    const pt = worldPoint(clientX, clientY);
    const target = cardAt(pt.x, pt.y);
    if (!target || target.id === start.fromId) return;
    if (start.port === "partner") {
      setPartnerPick({ fromId: start.fromId, toId: target.id });
      return;
    }
    await onLink(start.fromId, target.id, start.port);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (editMode && target.closest(".graph-port")) {
      const portEl = target.closest(".graph-port") as HTMLElement;
      const fromId = portEl.dataset.personId;
      const port = portEl.dataset.port as Port | undefined;
      if (fromId && port) {
        event.stopPropagation();
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        stageRef.current?.setPointerCapture(event.pointerId);
        startConnect(fromId, port, event.clientX, event.clientY);
      }
      return;
    }
    if (editMode && target.closest(".graph-hit, .graph-pick")) return;
    if (pointers.current.size === 0) suppressTap.current = false;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      drag.current = null;
      suppressTap.current = true;
      stageRef.current?.setPointerCapture(event.pointerId);
      pinch.current = pinchSnapshot();
      return;
    }
    if (target.closest(".portrait-card, .graph-zoom, .graph-port, .graph-pick")) return;
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
    if (connectRef.current) {
      const origin = byId.get(connectRef.current.fromId);
      const from = origin
        ? portPoint(origin.x, origin.y, connectRef.current.port)
        : { x: connectRef.current.x, y: connectRef.current.y };
      const pt = worldPoint(event.clientX, event.clientY);
      setWire({ x1: from.x, y1: from.y, x2: pt.x, y2: pt.y });
      return;
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
    const connecting = Boolean(connectRef.current);
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (connecting) {
      void finishConnect(event.clientX, event.clientY);
      drag.current = null;
      return;
    }
    const start = drag.current;
    if (start && start.id === event.pointerId) {
      const moved = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
      drag.current = null;
      if (moved < 8 && !suppressTap.current && !(event.target as HTMLElement).closest(".portrait-card, .graph-zoom, .graph-pick")) {
        onHighlight(undefined);
        setPartnerPick(null);
      }
    }
    if (pointers.current.size === 0) drag.current = null;
  }

  const stageW = Number.isFinite(layout.width) ? layout.width : 320;
  const stageH = Number.isFinite(layout.height) ? layout.height : 240;
  const edges = layout.edges.filter((edge) => isFiniteBox(edge.fromX, edge.fromY) && isFiniteBox(edge.toX, edge.toY));

  function lineWeight(lit: boolean) {
    if (!linked) return { width: 1.6, opacity: 0.4 };
    if (lit) return { width: 2.6, opacity: 0.9 };
    return { width: 1.2, opacity: 0.12 };
  }

  async function unlinkKin(childId: string, parentIds: string[]) {
    if (!onUnlink || !parentIds.length) return;
    const child = tree.people.find((p) => p.id === childId);
    const parent = tree.people.find((p) => p.id === parentIds[0]);
    if (!confirm(`Remove the parent link from ${displayName(parent ?? { givenName: "this person", id: "", createdAt: "", updatedAt: "" })} to ${displayName(child ?? { givenName: "this person", id: "", createdAt: "", updatedAt: "" })}?`)) {
      return;
    }
    await onUnlink(childId, parentIds[0], "parent");
  }

  async function unlinkCouple(partnerIds: string[]) {
    if (!onUnlink || partnerIds.length < 2) return;
    const a = tree.people.find((p) => p.id === partnerIds[0]);
    const b = tree.people.find((p) => p.id === partnerIds[1]);
    if (!confirm(`Unlink ${displayName(a ?? { givenName: "this couple", id: "", createdAt: "", updatedAt: "" })} and ${displayName(b ?? { givenName: "them", id: "", createdAt: "", updatedAt: "" })} as partners?`)) {
      return;
    }
    await onUnlink(partnerIds[0], partnerIds[1], "partner");
  }

  return (
    <div
      ref={stageRef}
      className={`graph-stage${editMode ? " is-edit" : ""}`}
      aria-label={editMode ? "Family graph, edit mode" : "Family graph"}
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
              <g key={`k${i}`}>
                <path
                  d={kinPath(edge.fromX, edge.fromY, edge.toX, edge.toY)}
                  fill="none"
                  stroke="var(--graph-kin)"
                  strokeWidth={w.width}
                  strokeOpacity={w.opacity}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {editMode ? (
                  <path
                    className="graph-hit"
                    d={kinPath(edge.fromX, edge.fromY, edge.toX, edge.toY)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={18}
                    pointerEvents="stroke"
                    onClick={(event) => {
                      event.stopPropagation();
                      void unlinkKin(edge.childId, edge.parentIds);
                    }}
                  />
                ) : null}
              </g>
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
              <g key={couple.id}>
                <line
                  x1={x1}
                  y1={couple.cy}
                  x2={x2}
                  y2={couple.cy}
                  stroke="var(--graph-spouse)"
                  strokeWidth={w.width + 0.4}
                  strokeOpacity={w.opacity}
                  strokeLinecap="round"
                />
                {editMode ? (
                  <line
                    className="graph-hit"
                    x1={x1}
                    y1={couple.cy}
                    x2={x2}
                    y2={couple.cy}
                    stroke="transparent"
                    strokeWidth={18}
                    pointerEvents="stroke"
                    onClick={(event) => {
                      event.stopPropagation();
                      void unlinkCouple(couple.partnerIds);
                    }}
                  />
                ) : null}
              </g>
            );
          })}
          {wire ? (
            <line
              className="graph-wire"
              x1={wire.x1}
              y1={wire.y1}
              x2={wire.x2}
              y2={wire.y2}
              stroke="var(--accent)"
              strokeWidth={2.2}
              strokeDasharray="6 5"
              strokeLinecap="round"
            />
          ) : null}
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

        {editMode
          ? cards.flatMap((card) => {
              const ports: { port: Port; side?: "left" | "right"; label: string }[] = [
                { port: "parent", label: `Link a parent of ${card.person.givenName}` },
                { port: "partner", side: "left", label: `Link a partner of ${card.person.givenName}` },
                { port: "partner", side: "right", label: `Link a partner of ${card.person.givenName}` },
                { port: "child", label: `Link a child of ${card.person.givenName}` },
              ];
              return ports.map((item) => {
                const pt = portPoint(card.x, card.y, item.port, item.side);
                return (
                  <button
                    key={`${card.id}-${item.port}-${item.side ?? "c"}`}
                    type="button"
                    className={`graph-port is-${item.port}`}
                    data-person-id={card.id}
                    data-port={item.port}
                    aria-label={item.label}
                    style={{ left: pt.x - 11, top: pt.y - 11 }}
                  />
                );
              });
            })
          : null}
      </div>
      {editMode ? (
        <p className="graph-edit-hint">Drag a dot onto someone to link them. Tap a line to remove it.</p>
      ) : null}
      {partnerPick ? (
        <div className="graph-pick" role="dialog" aria-label="How they fit">
          <p>
            {displayName(tree.people.find((p) => p.id === partnerPick.fromId) ?? { givenName: "This person", id: "", createdAt: "", updatedAt: "" })}
            {" + "}
            {displayName(tree.people.find((p) => p.id === partnerPick.toId) ?? { givenName: "them", id: "", createdAt: "", updatedAt: "" })}
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              await onLink?.(partnerPick.fromId, partnerPick.toId, "partner", "married");
              setPartnerPick(null);
            }}
          >
            Married
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await onLink?.(partnerPick.fromId, partnerPick.toId, "partner", "partnered");
              setPartnerPick(null);
            }}
          >
            Partnered
          </button>
          <button type="button" className="btn ghost" onClick={() => setPartnerPick(null)}>Cancel</button>
        </div>
      ) : null}
      <div className="graph-zoom" role="group" aria-label="Zoom">
        <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.15)}>+</button>
        <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.15)}>−</button>
        <button type="button" className="icon-btn" aria-label="Recenter" onClick={fitToView}>⌂</button>
      </div>
    </div>
  );
}
