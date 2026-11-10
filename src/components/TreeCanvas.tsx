"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { KinKind, LinkRole, ParentRole, Person, TreeData, UnionKind } from "@/lib/types";
import { displayName, kinKindLabel } from "@/lib/types";
import { PartnerStatusMark } from "./PartnerStatusMark";
import { CARD, ageLabel, buildGraph, lineageIds, type GraphLayout } from "@/lib/layout";
import { GeneratedAvatar } from "./GeneratedAvatar";
import { bridgePath, centerTransform, coupleTintBox, fitContentScale, pinchCamera, scaleAround, superellipsePath } from "@/lib/graphView";
import { PERSONAL_MAP_MS, graphFromPersonalMap, layoutPersonalMap, morphGraph, placesMatch, type PersonalMap } from "@/lib/personalMap";
import { gatherCameraMs, gatherPoints, interruptGather, planGather } from "@/lib/gatherChoreography";
import { prefersReducedMotion, runFlight, runLinesOut, type GatherSession } from "@/lib/gatherPlay";
import { gatheredPersonId } from "@/lib/personInteraction";
import { usePersonInteraction } from "./PersonHoldMenu";
import { DEFAULT_LINE_FILTER, lineFilterAllows, lineFilterAllowsCouples, type LineFilter } from "@/lib/kinFilter";
import { commitUnlink, coupleUnlinkMark } from "@/lib/skyUnlink";
import { LinkRolePicker } from "./LinkRolePicker";

type Port = "parent" | "partner" | "child";

type Props = {
  tree: TreeData;
  highlightedId?: string;
  onHighlight: (person?: Person) => void;
  onOpen: (person: Person) => void;
  fitKey?: string | number | boolean;
  editMode?: boolean;
  onLink?: (personId: string, otherId: string, role: LinkRole, kind?: UnionKind, parentRole?: ParentRole, kin?: KinKind) => void | Promise<void>;
  onUnlink?: (personId: string, otherId: string, role: Exclude<LinkRole, "sibling">) => void | Promise<void>;
  onPlace?: (personId: string, x: number) => void | Promise<void>;
  lineFilter?: LineFilter;
  canGather?: boolean;
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
  onPlace,
  lineFilter = DEFAULT_LINE_FILTER,
  canGather = true,
}: Props) {
  const interaction = usePersonInteraction({
    people: tree.people,
    selectedId: highlightedId,
    editMode,
    canGather,
    onSelect: onHighlight,
    onOpen,
  });
  const householdHint = tree.focusPersonId;
  const baseLayout = useMemo(() => buildGraph(tree, householdHint), [tree, householdHint]);
  const gatheredId = gatheredPersonId(interaction.focus, editMode);
  const personal = useMemo(
    () => (canGather && gatheredId ? layoutPersonalMap(tree, gatheredId) : null),
    [canGather, gatheredId, tree],
  );
  const targetLayout = useMemo(
    () => (personal ? graphFromPersonalMap(tree, personal) : baseLayout),
    [personal, tree, baseLayout],
  );
  const [shown, setShown] = useState(baseLayout);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [animating, setAnimating] = useState(false);
  const gatherSession = useRef<GatherSession | null>(null);
  const pendingFlight = useRef<{
    plan: ReturnType<typeof planGather>;
    started: number;
    focusId: string;
    to: GraphLayout;
    map: PersonalMap | null;
  } | null>(null);
  const prevPersonalId = useRef<string | null>(null);
  const skipCamera = useRef(false);
  const mapShown = Boolean(personal) && placesMatch(shown, targetLayout);
  const viewTween = useRef<number | null>(null);
  const framed = useRef(false);
  const layout = shown;
  const household = useMemo(
    () => new Set(layout.householdIds.length ? layout.householdIds : layout.focusId ? [layout.focusId] : []),
    [layout.householdIds, layout.focusId],
  );
  const rings = useMemo(
    () => new Map(mapShown && personal ? personal.seats.map((seat) => [seat.id, seat.ring]) : []),
    [mapShown, personal],
  );
  const linked = useMemo(() => {
    if (mapShown && personal) return new Set(personal.seats.filter((seat) => seat.ring !== "dim").map((seat) => seat.id));
    return highlightedId ? lineageIds(tree, highlightedId) : null;
  }, [mapShown, personal, tree, highlightedId]);
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ x: 40, y: 24, s: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const pinch = useRef<PinchStart | null>(null);
  const suppressTap = useRef(false);
  const raf = useRef<number | null>(null);
  const connectRef = useRef<ConnectDrag | null>(null);
  const cardMove = useRef<{ id: string; pointerId: number; originX: number; startX: number } | null>(null);
  const [wire, setWire] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [partnerPick, setPartnerPick] = useState<{ fromId: string; toId: string } | null>(null);
  const [dragX, setDragX] = useState<{ id: string; x: number } | null>(null);

  const cards = layout.cards
    .filter((card) => isFiniteBox(card.x, card.y))
    .map((card) => (dragX && card.id === dragX.id ? { ...card, x: dragX.x } : card));
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

  function stageInset(stage: HTMLDivElement, vh: number) {
    const stageTop = stage.getBoundingClientRect().top;
    const bar = stage.parentElement?.querySelector(".graph-toolbar");
    return bar ? Math.max(0, Math.min(vh / 3, bar.getBoundingClientRect().bottom - stageTop)) : 0;
  }

  function stopViewTween() {
    if (viewTween.current != null) cancelAnimationFrame(viewTween.current);
    viewTween.current = null;
  }

  function easeInOut(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeOut(t: number) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateCamera(target: View, ms = PERSONAL_MAP_MS, ease: (t: number) => number = easeInOut) {
    stopViewTween();
    const from = { ...viewRef.current };
    const stage = stageRef.current;
    const vw = stage?.clientWidth || 360;
    const vh = stage?.clientHeight || 480;
    const inset = stage ? stageInset(stage, vh) : 0;
    const cx = vw / 2;
    const cy = inset + (vh - inset) / 2;
    const fromWorld = { x: (cx - from.x) / (from.s || 1), y: (cy - from.y) / (from.s || 1) };
    const toWorld = { x: (cx - target.x) / target.s, y: (cy - target.y) / target.s };
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = ease(t);
      const s = Math.exp(Math.log(from.s || 1) + (Math.log(target.s) - Math.log(from.s || 1)) * k);
      const wx = fromWorld.x + (toWorld.x - fromWorld.x) * k;
      const wy = fromWorld.y + (toWorld.y - fromWorld.y) * k;
      viewRef.current = { x: cx - wx * s, y: cy - wy * s, s };
      applyWorld();
      viewTween.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    viewTween.current = requestAnimationFrame(step);
  }

  function frameOf(
    next: GraphLayout,
    map: PersonalMap | null,
    animate: boolean,
    ms = PERSONAL_MAP_MS,
    ease: (t: number) => number = easeInOut,
  ) {
    const stage = stageRef.current;
    if (!stage || next.cards.length === 0) return;
    const vw = stage.clientWidth || 360;
    const vh = stage.clientHeight || 480;
    const inset = stageInset(stage, vh);
    const lit = map ? new Set(map.seats.filter((seat) => seat.ring !== "dim").map((seat) => seat.id)) : null;
    const framedCards = lit ? next.cards.filter((card) => lit.has(card.id)) : next.cards;
    const use = framedCards.length ? framedCards : next.cards;
    const areas = !map && lineFilter.households ? next.areas : [];
    const minX = Math.min(...use.map((card) => card.x - CARD.w / 2), ...areas.map((area) => area.cx - area.rx));
    const maxX = Math.max(...use.map((card) => card.x + CARD.w / 2), ...areas.map((area) => area.cx + area.rx));
    const minY = Math.min(...use.map((card) => card.y), ...areas.map((area) => area.cy - area.ry));
    const maxY = Math.max(...use.map((card) => card.y + CARD.h), ...areas.map((area) => area.cy + area.ry));
    let view: View;
    if (map) {
      const centerSeats = map.seats.filter((seat) => seat.ring === "center");
      const cx = centerSeats.reduce((sum, seat) => sum + seat.x, 0) / Math.max(centerSeats.length, 1);
      const cy = centerSeats.reduce((sum, seat) => sum + seat.y, 0) / Math.max(centerSeats.length, 1) + CARD.h / 2;
      const halfW = Math.max(cx - minX, maxX - cx, CARD.w);
      const halfH = Math.max(cy - minY, maxY - cy, CARD.h);
      const scale = fitContentScale(vw, vh - inset, halfW * 2, halfH * 2);
      view = centerTransform(vw, vh - inset, cx, cy, scale);
    } else {
      const scale = fitContentScale(vw, vh - inset, Math.max(maxX - minX, CARD.w), Math.max(maxY - minY, CARD.h));
      view = centerTransform(vw, vh - inset, (minX + maxX) / 2, (minY + maxY) / 2, scale);
    }
    view = { ...view, y: view.y + inset };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate && !reduce) animateCamera(view, ms, ease);
    else {
      stopViewTween();
      viewRef.current = view;
      applyWorld();
    }
    stage.dataset.framed = "true";
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
    return () => {
      if (viewTween.current != null) cancelAnimationFrame(viewTween.current);
      gatherSession.current?.stop();
    };
  }, []);

  function seatsOf(layout: GraphLayout, focusId: string, map: PersonalMap | null) {
    const ring = new Map(map?.seats.map((seat) => [seat.id, seat.ring]));
    return gatherPoints(layout.cards, tree, focusId, ring);
  }

  useLayoutEffect(() => {
    const to = targetLayout;
    const from = shownRef.current;
    const nextId = personal?.focusId ?? null;
    const previousId = prevPersonalId.current;
    if (previousId === nextId) {
      if (gatherSession.current || pendingFlight.current) return;
      if (placesMatch(from, to)) {
        setAnimating(false);
        return;
      }
      if (prefersReducedMotion()) {
        shownRef.current = to;
        setShown(to);
        setAnimating(false);
        return;
      }
      setAnimating(true);
      const start = performance.now();
      let raf = 0;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / PERSONAL_MAP_MS);
        const next = t >= 1 ? to : morphGraph(from, to, easeInOut(t), tree);
        shownRef.current = next;
        setShown(next);
        if (t < 1) raf = requestAnimationFrame(step);
        else setAnimating(false);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }

    const focusId = nextId ?? previousId;
    const map = personal ?? (focusId ? layoutPersonalMap(tree, focusId) : null);
    const stage = stageRef.current;
    const world = worldRef.current;
    if (!focusId || !map || !stage || !world) {
      prevPersonalId.current = nextId;
      shownRef.current = to;
      setShown(to);
      return;
    }

    skipCamera.current = true;
    const reduced = prefersReducedMotion();
    const active = gatherSession.current;
    const sampled = active?.sample();
    active?.stop();
    const direction = nextId ? "gather" : "release";
    const plan = active && sampled
      ? interruptGather(active.plan, sampled.elapsed, {
          to: seatsOf(to, focusId, map),
          direction,
          reducedMotion: reduced,
        })
      : planGather({
          from: seatsOf(from, focusId, map),
          to: seatsOf(to, focusId, map),
          direction,
          reducedMotion: reduced,
        });
    const commit = (started: number) => {
      prevPersonalId.current = nextId;
      pendingFlight.current = { plan, started, focusId, to, map };
      shownRef.current = to;
      setShown(to);
      setAnimating(true);
      frameOf(to, nextId ? map : null, !reduced, gatherCameraMs(reduced), easeOut);
    };
    if (plan.linesOutMs <= 0) {
      commit(performance.now());
      return;
    }
    setAnimating(true);
    let session: GatherSession | null = null;
    session = runLinesOut({
      stage,
      world,
      plan,
      focusId,
      onCommit: () => {
        if (session) commit(session.started);
      },
    });
    gatherSession.current = session;
    return () => session?.stop();
    // The camera and the seat list are read when the focus changes, not on every card frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLayout, tree, personal]);

  useLayoutEffect(() => {
    const pending = pendingFlight.current;
    if (!pending || !placesMatch(shown, pending.to)) return;
    pendingFlight.current = null;
    const stage = stageRef.current;
    const world = worldRef.current;
    if (!stage || !world) return;
    const session = runFlight({
      stage,
      world,
      plan: pending.plan,
      started: pending.started,
      focusId: pending.focusId,
      onDone: () => {
        if (gatherSession.current === session) gatherSession.current = null;
        setAnimating(false);
      },
    });
    gatherSession.current = session;
    return () => session.stop();
  }, [shown]);

  useLayoutEffect(() => {
    applyWorld();
    gatherSession.current?.paint();
  });

  useEffect(() => {
    const animate = framed.current;
    framed.current = true;
    if (skipCamera.current) {
      skipCamera.current = false;
      return;
    }
    frameOf(targetLayout, personal, animate);
    // Framing follows the settled layout, not each animation frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLayout, personal, fitKey]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".graph-pick, .graph-filter, .graph-toolbar, .graph-zoom")) return;
      if (event.cancelable) event.preventDefault();
      stopViewTween();
      const pt = stagePoint(event.clientX, event.clientY);
      viewRef.current = scaleAround(viewRef.current, pt.x, pt.y, viewRef.current.s * (event.deltaY < 0 ? 1.08 : 0.92));
      scheduleApply();
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  function tapCard(person: Person) {
    if (suppressTap.current) {
      suppressTap.current = false;
      interaction.dropSwallow();
      return;
    }
    interaction.tap(person.id);
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
    setPartnerPick({ fromId: start.fromId, toId: target.id });
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
    if (editMode && onPlace && target.closest(".portrait-card") && !target.closest(".graph-port")) {
      const cardEl = target.closest(".portrait-card") as HTMLElement;
      const id = cardEl.dataset.personId;
      const card = id ? byId.get(id) : undefined;
      if (id && card) {
        event.stopPropagation();
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        stageRef.current?.setPointerCapture(event.pointerId);
        cardMove.current = { id, pointerId: event.pointerId, originX: card.x, startX: event.clientX };
        setPartnerPick(null);
      }
      return;
    }
    if (editMode && target.closest(".graph-hit, .graph-pick")) return;
    if (pointers.current.size === 0) suppressTap.current = false;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      drag.current = null;
      suppressTap.current = true;
      interaction.cancelHold();
      stopViewTween();
      stageRef.current?.setPointerCapture(event.pointerId);
      pinch.current = pinchSnapshot();
      return;
    }
    if (target.closest(".portrait-card, .graph-zoom, .graph-port, .graph-pick")) return;
    stageRef.current?.setPointerCapture(event.pointerId);
    stopViewTween();
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
    if (cardMove.current && cardMove.current.pointerId === event.pointerId) {
      const dx = (event.clientX - cardMove.current.startX) / (viewRef.current.s || 1);
      if (Math.abs(dx) > 4) suppressTap.current = true;
      setDragX({ id: cardMove.current.id, x: cardMove.current.originX + dx });
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
    if (cardMove.current && cardMove.current.pointerId === event.pointerId) {
      const originX = cardMove.current.originX;
      const id = cardMove.current.id;
      const nextX = dragX && dragX.id === id ? dragX.x : originX;
      cardMove.current = null;
      setDragX(null);
      if (Math.abs(nextX - originX) > 8) {
        suppressTap.current = true;
        void onPlace?.(id, nextX);
      }
      drag.current = null;
      return;
    }
    const start = drag.current;
    if (start && start.id === event.pointerId) {
      const moved = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
      drag.current = null;
      if (moved < 8 && !suppressTap.current && !(event.target as HTMLElement).closest(".portrait-card, .graph-zoom, .graph-pick")) {
        interaction.clear();
        setPartnerPick(null);
      }
    }
    if (pointers.current.size === 0) drag.current = null;
  }

  const stageW = Number.isFinite(layout.width) ? layout.width : 320;
  const stageH = Number.isFinite(layout.height) ? layout.height : 240;
  const forks = layout.forks ?? [];
  const areas = (layout.areas ?? []).filter((a) => isFiniteBox(a.cx, a.cy, a.rx, a.ry));
  const bridges = (layout.bridges ?? []).filter(
    (b) => isFiniteBox(b.fromX, b.fromY) && isFiniteBox(b.toX, b.toY),
  );
  const forkedKids = new Set(forks.flatMap((fork) => fork.childIds));
  const edges = layout.edges.filter(
    (edge) =>
      !forkedKids.has(edge.childId) &&
      isFiniteBox(edge.fromX, edge.fromY) &&
      isFiniteBox(edge.toX, edge.toY),
  );

  function lineWeight(lit: boolean) {
    if (!linked) return { width: 1.6, opacity: 0.4 };
    if (lit) return { width: 2.6, opacity: 0.9 };
    return { width: 1.2, opacity: 0.12 };
  }

  function kinStyle(kin: KinKind, lit: boolean, splitDotted: boolean) {
    const dash =
      kin === "step" ? "2 6" :
      kin === "adopted" ? "7 5" :
      kin === "foster" ? "8 4 2 4" :
      splitDotted ? "5 7" : undefined;
    const quiet = kin !== "blood";
    if (lit) return { width: quiet ? 1.6 : splitDotted ? 1.8 : 2.2, opacity: quiet ? 0.55 : 0.88, dash };
    if (!linked) return { width: quiet ? 1.3 : splitDotted ? 1.5 : 1.7, opacity: quiet ? 0.32 : splitDotted ? 0.5 : 0.42, dash };
    return { width: quiet ? 1.15 : splitDotted ? 1.4 : 1.5, opacity: quiet ? 0.2 : splitDotted ? 0.38 : 0.22, dash };
  }

  async function unlinkKin(childId: string, parentIds: string[]) {
    if (!onUnlink || !parentIds.length) return;
    await commitUnlink(tree.people, { mark: "fork", kind: "blood", parentId: parentIds[0], childId }, onUnlink);
  }

  async function unlinkCouple(partnerIds: string[]) {
    const mark = coupleUnlinkMark(partnerIds);
    if (!onUnlink || !mark) return;
    await commitUnlink(tree.people, mark, onUnlink);
  }

  return (
    <div
      ref={stageRef}
      className={`graph-stage${editMode ? " is-edit" : ""}${mapShown ? " is-personal" : ""}`}
      data-layout={mapShown ? "personal" : "tree"}
      data-animating={animating ? "true" : "false"}
      aria-label={mapShown ? "Personal map" : editMode ? "Family graph, edit mode" : "Family graph"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div ref={worldRef} className="graph-world" style={{ width: stageW, height: stageH }}>
        <div className="gather-glow" data-gather-glow aria-hidden="true" />
        <div className="gather-ripple" data-gather-ripple aria-hidden="true" />
        <svg className="graph-lines" width={stageW} height={stageH} aria-hidden>
          {lineFilter.households ? (
            <g className="household-layer">
              {areas.map((area) => {
                const lit = Boolean(linked && area.memberIds.some((id) => linked.has(id)));
                return (
                  <path
                    key={area.id}
                    className={`household-area${area.isHome ? " is-home" : ""}${lit ? " is-lit" : ""}${linked && !lit ? " is-dim" : ""}`}
                    d={superellipsePath(area)}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              {bridges.map((bridge) => {
                if (!lineFilterAllows(lineFilter, bridge.kin)) return null;
                const lit = Boolean(linked && linked.has(bridge.personId));
                return (
                  <g key={bridge.id} className={`household-bridge${lit ? " is-lit" : ""}${linked && !lit ? " is-dim" : ""}`}>
                    <path d={bridgePath(bridge)} />
                    <circle cx={bridge.toX} cy={bridge.toY} r={4.5} />
                  </g>
                );
              })}
            </g>
          ) : null}
          {forks.map((fork) => {
            const parents = fork.parentDrops.filter((drop) => lineFilterAllows(lineFilter, drop.kin));
            const kids = fork.childDrops.filter((drop) => lineFilterAllows(lineFilter, drop.kin));
            if (!parents.length || !kids.length) return null;
            const lit = Boolean(
              linked &&
                (parents.some((drop) => linked.has(drop.parentId)) || kids.some((drop) => linked.has(drop.childId))),
            );
            const joinXs = parents.map((drop) => drop.x);
            const railXs = kids.map((drop) => drop.x);
            const stemX = joinXs.reduce((sum, n) => sum + n, 0) / joinXs.length;
            const joinLeft = Math.min(...joinXs);
            const joinRight = Math.max(...joinXs);
            const railLeft = Math.min(...railXs, stemX);
            const railRight = Math.max(...railXs, stemX);
            const forkKin = kids.every((drop) => drop.kin === kids[0].kin) ? kids[0].kin : fork.kin;
            const barStyle = kinStyle(forkKin, lit, fork.dotted && forkKin === "blood");
            return (
              <g key={fork.id} className={fork.dotted ? "graph-fork is-split" : "graph-fork"}>
                {parents.map((drop) => {
                  const w = kinStyle(drop.kin, lit, fork.dotted && drop.kin === "blood");
                  return (
                    <line
                      key={`pd-${drop.parentId}`}
                      x1={drop.x}
                      y1={drop.y0}
                      x2={drop.x}
                      y2={fork.joinY}
                      stroke="var(--graph-kin)"
                      strokeWidth={w.width}
                      strokeOpacity={w.opacity}
                      strokeDasharray={w.dash}
                      strokeLinecap="round"
                    />
                  );
                })}
                {joinRight - joinLeft > 6 ? (
                  <line
                    x1={joinLeft}
                    y1={fork.joinY}
                    x2={joinRight}
                    y2={fork.joinY}
                    stroke="var(--graph-kin)"
                    strokeWidth={barStyle.width}
                    strokeOpacity={barStyle.opacity}
                    strokeDasharray={barStyle.dash}
                    strokeLinecap="round"
                  />
                ) : null}
                <line
                  x1={stemX}
                  y1={fork.joinY}
                  x2={stemX}
                  y2={fork.railY}
                  stroke="var(--graph-kin)"
                  strokeWidth={barStyle.width}
                  strokeOpacity={barStyle.opacity}
                  strokeDasharray={barStyle.dash}
                  strokeLinecap="round"
                />
                {forkKin !== "blood" ? (
                  <text
                    className="graph-kin-label"
                    x={stemX}
                    y={(fork.joinY + fork.railY) / 2}
                    textAnchor="middle"
                    fill="var(--graph-kin)"
                    fillOpacity={Math.min(0.55, barStyle.opacity + 0.12)}
                    fontSize="11"
                  >
                    {kinKindLabel(forkKin)}
                  </text>
                ) : null}
                {railRight - railLeft > 6 ? (
                  <line
                    x1={railLeft}
                    y1={fork.railY}
                    x2={railRight}
                    y2={fork.railY}
                    stroke="var(--graph-kin)"
                    strokeWidth={barStyle.width}
                    strokeOpacity={barStyle.opacity}
                    strokeDasharray={barStyle.dash}
                    strokeLinecap="round"
                  />
                ) : null}
                {kids.map((drop) => {
                  const w = kinStyle(drop.kin, lit, false);
                  return (
                    <g key={drop.childId}>
                      <line
                        x1={drop.x}
                        y1={fork.railY}
                        x2={drop.x}
                        y2={drop.y1}
                        stroke="var(--graph-kin)"
                        strokeWidth={w.width}
                        strokeOpacity={w.opacity}
                        strokeDasharray={w.dash}
                        strokeLinecap="round"
                      />
                      {editMode ? (
                        <line
                          className="graph-hit"
                          x1={drop.x}
                          y1={fork.railY}
                          x2={drop.x}
                          y2={drop.y1}
                          stroke="transparent"
                          strokeWidth={18}
                          pointerEvents="stroke"
                          onClick={(event) => {
                            event.stopPropagation();
                            void unlinkKin(drop.childId, fork.parentIds);
                          }}
                        />
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}
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
          {layout.couples.filter((c) => c.bar && lineFilterAllowsCouples(lineFilter)).map((couple) => {
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
            const married = couple.kind === "married";
            return (
              <g key={couple.id}>
                <line
                  data-couple={couple.id}
                  data-status={couple.status}
                  x1={x1}
                  y1={couple.cy}
                  x2={x2}
                  y2={couple.cy}
                  stroke="var(--graph-spouse)"
                  strokeWidth={w.width + (married ? 1.6 : 0.4)}
                  strokeOpacity={w.opacity}
                  strokeLinecap="round"
                />
                {couple.status === "remarried" ? (
                  <line
                    data-status="remarried"
                    data-couple={couple.id}
                    x1={x1}
                    y1={couple.cy + 4}
                    x2={x2}
                    y2={couple.cy + 4}
                    stroke="var(--graph-spouse)"
                    strokeWidth={1}
                    strokeOpacity={Math.min(0.7, w.opacity)}
                    strokeLinecap="round"
                  />
                ) : null}
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
          {lineFilter.households
            ? areas.map((area) => (
                <text
                  key={`${area.id}-label`}
                  className={`household-label${area.isHome ? " is-home" : ""}`}
                  x={area.cx}
                  y={area.cy - area.ry + 15}
                  textAnchor="middle"
                >
                  {area.label}
                </text>
              ))
            : null}
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
          {lineFilterAllowsCouples(lineFilter)
            ? tree.unions.filter((union) => union.kind === "divorced").map((union) => {
                const pair = union.partnerIds
                  .map((id) => cards.find((card) => card.id === id))
                  .filter((card): card is (typeof cards)[number] => Boolean(card));
                if (pair.length < 2) return null;
                const [a, b] = pair;
                const x1 = a.x;
                const y1 = a.y + CARD.h + 6;
                const x2 = b.x;
                const y2 = b.y + CARD.h + 6;
                if (!isFiniteBox(x1, y1, x2, y2)) return null;
                return (
                  <line
                    key={`${union.id}-divorced`}
                    data-status="divorced"
                    data-couple={union.id}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="var(--graph-spouse)"
                    strokeWidth={1.15}
                    strokeOpacity={0.4}
                    strokeDasharray="2 7"
                    strokeLinecap="round"
                  />
                );
              })
            : null}
        </svg>

        {layout.couples.filter((c) => c.bar).map((couple) => {
          const pair = couple.partnerIds.map((id) => cards.find((card) => card.id === id)).filter(Boolean) as typeof cards;
          if (pair.length < 2) return null;
          const box = coupleTintBox(pair);
          if (!box || !isFiniteBox(box.left, box.top, box.width, box.height)) return null;
          const isHome = pair.every((c) => household.has(c.person.id));
          const left = pair.reduce((a, b) => (a.x < b.x ? a : b));
          const right = pair.reduce((a, b) => (a.x > b.x ? a : b));
          return (
            <div key={`${couple.id}-tint`}>
              <div
                data-couple={couple.id}
                data-status={couple.status}
                className={`couple-tint${isHome ? " is-home" : ""}${couple.kind === "married" ? " is-married" : ""}${couple.status === "remarried" ? " is-remarried" : ""}`}
                style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
              />
              {!editMode && couple.status === "remarried" ? (
                <PartnerStatusMark status="remarried" left={(left.x + right.x) / 2} top={left.y - 8} />
              ) : null}
            </div>
          );
        })}

        {!editMode && lineFilterAllowsCouples(lineFilter)
          ? tree.unions.filter((union) => union.kind === "divorced").map((union) => {
              const pair = union.partnerIds
                .map((id) => cards.find((card) => card.id === id))
                .filter((card): card is (typeof cards)[number] => Boolean(card));
              if (pair.length < 2) return null;
              const [a, b] = pair;
              return (
                <PartnerStatusMark
                  key={`${union.id}-status`}
                  status="divorced"
                  left={(a.x + b.x) / 2}
                  top={Math.max(a.y, b.y) + CARD.h + 6}
                />
              );
            })
          : null}

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
              data-person-id={card.id}
              data-ring={rings.get(card.id)}
              className={`portrait-card${photo ? " has-photo" : ""}${isHome ? " is-home" : ""}${active ? " is-active" : ""}${dim ? " is-dim" : ""}${editMode ? " is-movable" : ""}`}
              style={{ left, top: card.y, width: CARD.w, height: CARD.h }}
              onClick={(event) => {
                event.stopPropagation();
                tapCard(card.person);
              }}
              {...interaction.bindPerson(card.person.id)}
              aria-pressed={selected}
            >
              {photo ? <img className="portrait-photo" src={photo} alt="" /> : (
                <GeneratedAvatar person={card.person} className="swatch" />
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
        <p className="graph-edit-hint">Drag a card to move it. Drag a dot onto someone to link them. Tap a line to remove it.</p>
      ) : null}
      {partnerPick ? (
        <div
          className="graph-pick"
          role="dialog"
          aria-label="How they fit"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <LinkRolePicker
            from={
              tree.people.find((p) => p.id === partnerPick.fromId) ?? {
                givenName: "This person",
                id: "",
                createdAt: "",
                updatedAt: "",
              }
            }
            to={
              tree.people.find((p) => p.id === partnerPick.toId) ?? {
                givenName: "them",
                id: "",
                createdAt: "",
                updatedAt: "",
              }
            }
            onPick={async (role, kind, parentRole, kin) => {
              await onLink?.(partnerPick.fromId, partnerPick.toId, role, kind, parentRole, kin);
              setPartnerPick(null);
            }}
            onCancel={() => setPartnerPick(null)}
          />
        </div>
      ) : null}
      <div className="graph-zoom" role="group" aria-label="Zoom">
        <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.15)}>+</button>
        <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.15)}>−</button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Recenter"
          onClick={() => {
            if (personal) {
              interaction.clear();
              return;
            }
            frameOf(baseLayout, null, true);
          }}
        >
          ⌂
        </button>
      </div>
      {interaction.menu}
    </div>
  );
}
