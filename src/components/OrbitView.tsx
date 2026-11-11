"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { GeneratedAvatar } from "@/components/GeneratedAvatar";
import { buildGraph } from "@/lib/layoutGraph";
import { ageLabel, CARD } from "@/lib/layout";
import { DEFAULT_LINE_FILTER, type LineFilter } from "@/lib/kinFilter";
import { HOLD_MS, HOLD_SLOP_PX } from "@/lib/personInteraction";
import {
  canOrbitFocus,
  fitGeneration,
  initialOrbit,
  isFixtureTree,
  layoutOrbit,
  ORBIT_GLIDE_MS,
  ORBIT_LINES_MS,
  orbitSegments,
  reduceOrbit,
  type OrbitLayout,
  type OrbitSeat,
  type OrbitState,
  type SeenPerson,
} from "@/lib/orbitView";
import { displayName, type Person, type TreeData } from "@/lib/types";
import type { OrbitLineBox } from "@/components/orbit/lines";

const PAD = { top: 188, right: 16, bottom: 36, left: 16 };

type Mark = {
  personId: string;
  draw: "shown" | "ghost";
  presence: "shown" | "dimmed";
  details: "open" | "withheld";
};

type Props = {
  tree: TreeData;
  seen?: ReadonlyMap<string, SeenPerson>;
  marks?: Record<string, Mark>;
  arranging?: boolean;
  editMode?: boolean;
  lineFilter?: LineFilter;
  onHighlight?: (person?: Person) => void;
  onOpen: (person: Person) => void;
  onArrange?: (personId: string) => void;
};

type Camera = { x: number; y: number; s: number };
type LineApi = {
  setSegments: (segments: { x1: number; y1: number; x2: number; y2: number }[], box: OrbitLineBox) => void;
  dispose: () => void;
};

function generationCamera(cards: { id: string; x: number; y: number }[], focusId: string | undefined, view: { w: number; h: number }): Camera {
  const centers = cards.map((card) => ({ id: card.id, x: card.x, y: card.y + CARD.h / 2 }));
  if (view.w < 40 || !centers.length) return { x: PAD.left, y: PAD.top, s: 1 };
  const boxOf = (group: { id: string; x: number; y: number }[]) =>
    group.flatMap((card) => [
      card,
      { id: `${card.id}-nw`, x: card.x - CARD.w / 2 - 12, y: card.y - CARD.h / 2 - 12 },
      { id: `${card.id}-se`, x: card.x + CARD.w / 2 + 12, y: card.y + CARD.h / 2 + 12 },
    ]);
  const fitted = fitGeneration(boxOf(centers), view, PAD);
  if (fitted.scale >= 0.42) return { x: fitted.ox, y: fitted.oy, s: fitted.scale };
  const focus = centers.find((card) => card.id === focusId) ?? centers[0];
  const near = centers.filter((card) => Math.hypot(card.x - focus.x, card.y - focus.y) < 820);
  const local = fitGeneration(boxOf(near.length > 1 ? near : centers), view, PAD);
  return { x: local.ox, y: local.oy, s: local.scale };
}

export function OrbitView({
  tree,
  seen,
  marks,
  arranging = false,
  editMode = false,
  lineFilter = DEFAULT_LINE_FILTER,
  onHighlight,
  onOpen,
  onArrange,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const linesRef = useRef<LineApi | null>(null);
  const stateRef = useRef<OrbitState>(initialOrbit());
  const [state, setState] = useState<OrbitState>(initialOrbit);
  const [shownLayout, setShownLayout] = useState<OrbitLayout>("rows");
  const [view, setView] = useState({ w: 0, h: 0 });
  const [userCam, setUserCam] = useState<Camera | null>(null);
  const [renderer, setRenderer] = useState<"pending" | "webgl" | "fallback">("pending");
  const [reduced, setReduced] = useState(false);
  const peopleRef = useRef(tree.people);
  const rowCamRef = useRef<Camera>({ x: 0, y: 0, s: 1 });
  const onOpenRef = useRef(onOpen);
  const onHighlightRef = useRef(onHighlight);
  const onArrangeRef = useRef(onArrange);
  peopleRef.current = tree.people;
  onOpenRef.current = onOpen;
  onHighlightRef.current = onHighlight;
  onArrangeRef.current = onArrange;

  const seenKey = seen
    ? [...seen.values()].map((row) => `${row.id}:${row.presence}:${row.details}`).sort().join("|")
    : "";
  const seenRef = useRef(seen);
  seenRef.current = seen;
  const stableSeen = useMemo(() => (seenKey ? seenRef.current : undefined), [seenKey]);

  const dispatch = useCallback((event: Parameters<typeof reduceOrbit>[1]) => {
    const decision = reduceOrbit(stateRef.current, event);
    stateRef.current = decision.state;
    setState(decision.state);
    const effect = decision.effect;
    if (effect.type === "open-editor" || effect.type === "select") {
      const personId = effect.personId;
      const person = peopleRef.current.find((item) => item.id === personId);
      if (person) {
        if (effect.type === "open-editor") onOpenRef.current(person);
        else onHighlightRef.current?.(person);
      }
    } else if (effect.type === "clear") {
      onHighlightRef.current?.(undefined);
    }
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => {
      setView({ w: stage.clientWidth, h: stage.clientHeight });
    });
    observer.observe(stage);
    setView({ w: stage.clientWidth, h: stage.clientHeight });
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (stateRef.current.motion === "glide") return;
      const rect = stage.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setUserCam((current) => {
        const base = current ?? rowCamRef.current;
        const next = Math.min(1.8, Math.max(0.35, base.s * Math.exp(-event.deltaY * 0.0011)));
        const wx = (px - base.x) / base.s;
        const wy = (py - base.y) / base.s;
        return { s: next, x: px - wx * next, y: py - wy * next };
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      stage.removeEventListener("wheel", onWheel);
    };
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(reducedMotion);
    if (reducedMotion) {
      setRenderer("fallback");
      return;
    }
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") || probe.getContext("webgl");
    if (!gl) {
      setRenderer("fallback");
      return;
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    let dead = false;
    let dispose = () => {};
    void import("./orbit/lines")
      .then(({ mountOrbitLines }) => {
        if (dead || !canvasRef.current) return;
        const api = mountOrbitLines(canvasRef.current);
        linesRef.current = api;
        dispose = () => {
          api.dispose();
          if (linesRef.current === api) linesRef.current = null;
        };
        setRenderer("webgl");
      })
      .catch(() => setRenderer("fallback"));
    return () => {
      dead = true;
      dispose();
    };
  }, []);

  useEffect(() => {
    if (state.motion !== "glide") {
      setShownLayout(state.layout);
      return;
    }
    const frame = requestAnimationFrame(() => setShownLayout(state.layout));
    return () => cancelAnimationFrame(frame);
  }, [state.layout, state.motion]);

  useEffect(() => {
    if (state.lines !== "out") return;
    const node = inkRef.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dispatch({ type: "lines-gone" });
    };
    const timer = window.setTimeout(finish, reduced ? 32 : ORBIT_LINES_MS + 50);
    const onEnd = (event: TransitionEvent) => {
      if (event.target === node && event.propertyName === "opacity") finish();
    };
    node?.addEventListener("transitionend", onEnd);
    return () => {
      done = true;
      window.clearTimeout(timer);
      node?.removeEventListener("transitionend", onEnd);
    };
  }, [dispatch, reduced, state.lines]);

  useEffect(() => {
    if (state.motion !== "glide") return;
    const stage = stageRef.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dispatch({ type: "cards-settled" });
    };
    const timer = window.setTimeout(finish, reduced ? 40 : ORBIT_GLIDE_MS + 80);
    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName === "transform") finish();
    };
    stage?.addEventListener("transitionend", onEnd);
    return () => {
      done = true;
      window.clearTimeout(timer);
      stage?.removeEventListener("transitionend", onEnd);
    };
  }, [dispatch, reduced, state.focusId, state.layout, state.motion]);

  useEffect(() => {
    if (state.lines !== "in") return;
    const node = inkRef.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dispatch({ type: "lines-back" });
    };
    const timer = window.setTimeout(finish, reduced ? 32 : ORBIT_LINES_MS + 50);
    const onEnd = (event: TransitionEvent) => {
      if (event.target === node && event.propertyName === "opacity") finish();
    };
    node?.addEventListener("transitionend", onEnd);
    return () => {
      done = true;
      window.clearTimeout(timer);
      node?.removeEventListener("transitionend", onEnd);
    };
  }, [dispatch, reduced, state.lines]);

  const graph = useMemo(() => buildGraph(tree), [tree]);
  const rowCam = useMemo(
    () => userCam ?? generationCamera(graph.cards, tree.focusPersonId, view),
    [graph.cards, tree.focusPersonId, userCam, view],
  );
  rowCamRef.current = rowCam;
  const seats = useMemo(() => {
    if (!state.focusId || view.w < 40) return null;
    const raw = layoutOrbit(tree, state.focusId, stableSeen);
    if (!raw) return null;
    const cx = (PAD.left + view.w - PAD.right) / 2;
    const cy = (PAD.top + view.h - PAD.bottom) / 2;
    const center = { x: (cx - rowCam.x) / rowCam.s, y: (cy - rowCam.y) / rowCam.s };
    return raw.map((seat) => ({
      ...seat,
      x: center.x + seat.x,
      y: center.y - CARD.h / 2 + seat.y,
    }));
  }, [rowCam.s, rowCam.x, rowCam.y, stableSeen, state.focusId, tree, view.h, view.w]);

  const drawnIds = useMemo(() => {
    if (!stableSeen) return new Set(tree.people.map((person) => person.id));
    return new Set(stableSeen.keys());
  }, [stableSeen, tree.people]);

  const activeSeats = useMemo((): OrbitSeat[] => {
    if (shownLayout === "orbit" && seats) return seats.filter((seat) => drawnIds.has(seat.id));
    return graph.cards
      .filter((card) => drawnIds.has(card.id))
      .map((card) => ({ id: card.id, ring: "outer" as const, x: card.x, y: card.y, scale: 1, opacity: 1 }));
  }, [drawnIds, graph.cards, seats, shownLayout]);

  const segments = useMemo(
    () => orbitSegments(tree, activeSeats, lineFilter),
    [activeSeats, lineFilter, tree],
  );

  const box = useMemo((): OrbitLineBox => {
    const xs = activeSeats.flatMap((seat) => [seat.x - CARD.w, seat.x + CARD.w]);
    const ys = activeSeats.flatMap((seat) => [seat.y - 24, seat.y + CARD.h + 24]);
    for (const line of segments) {
      xs.push(line.x1, line.x2);
      ys.push(line.y1, line.y2);
    }
    if (!xs.length) return { minX: 0, minY: 0, width: 1, height: 1 };
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { minX, minY, width: Math.max(1, Math.max(...xs) - minX), height: Math.max(1, Math.max(...ys) - minY) };
  }, [activeSeats, segments]);

  useEffect(() => {
    if (renderer !== "webgl" || state.lines === "out" || state.lines === "hidden") return;
    linesRef.current?.setSegments(segments, box);
  }, [box, renderer, segments, state.lines]);

  const down = useRef<{ id: number; x: number; y: number; personId: string | null; moved: boolean } | null>(null);
  const holdTimer = useRef(0);
  const last = useRef({ x: 0, y: 0 });

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const personNode = (event.target as Element).closest?.("[data-person-id]");
    const personId = personNode?.getAttribute("data-person-id") ?? null;
    down.current = { id: event.pointerId, x: event.clientX, y: event.clientY, personId, moved: false };
    last.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    window.clearTimeout(holdTimer.current);
    if (!personId || arranging || editMode) return;
    holdTimer.current = window.setTimeout(() => {
      const start = down.current;
      if (!start || start.moved || start.personId !== personId) return;
      dispatch({
        type: "hold",
        personId,
        allowed: canOrbitFocus(personId, { tree, seen: stableSeen, editMode, arranging }),
      });
    }, HOLD_MS);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = down.current;
    if (!start || start.id !== event.pointerId) return;
    if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) > HOLD_SLOP_PX) {
      start.moved = true;
      window.clearTimeout(holdTimer.current);
    }
    if (!start.moved || stateRef.current.motion === "glide") return;
    const dx = event.clientX - last.current.x;
    const dy = event.clientY - last.current.y;
    last.current = { x: event.clientX, y: event.clientY };
    setUserCam((current) => {
      const base = current ?? rowCam;
      return { x: base.x + dx, y: base.y + dy, s: base.s };
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const start = down.current;
    window.clearTimeout(holdTimer.current);
    if (!start || start.id !== event.pointerId) return;
    down.current = null;
    if (!start.moved && start.personId) {
      const personId = start.personId;
      if (arranging) onArrangeRef.current?.(personId);
      else window.setTimeout(() => dispatch({ type: "tap", personId }), 0);
    } else if (!start.moved && stateRef.current.layout === "orbit" && stateRef.current.lines === "shown") {
      dispatch({ type: "clear" });
    }
    window.setTimeout(() => dispatch({ type: "drop-swallow" }), 0);
  };

  const onCardClick = (person: Person) => {
    if (arranging) {
      onArrangeRef.current?.(person.id);
      return;
    }
    dispatch({ type: "tap", personId: person.id });
  };

  const fixture = isFixtureTree(tree);
  const seatOf = new Map(seats?.map((seat) => [seat.id, seat]));
  const rowOf = new Map(graph.cards.map((card) => [card.id, card]));
  const poseOf = new Map(activeSeats.map((seat) => [seat.id, seat]));

  const tints = shownLayout === "orbit"
    ? (() => {
        const focus = state.focusId ? poseOf.get(state.focusId) : undefined;
        const partners = activeSeats.filter((seat) => seat.ring === "partner");
        if (!focus || !partners.length) return [];
        return [{ id: "orbit-couple", ids: [focus.id, ...partners.map((seat) => seat.id)] }];
      })()
    : graph.couples.filter((couple) => couple.bar).map((couple) => ({ id: couple.id, ids: couple.partnerIds }));

  return (
    <div
      ref={stageRef}
      className="orbit-stage"
      data-layout={state.layout}
      data-lines={state.lines}
      data-motion={state.motion}
      data-renderer={renderer}
      data-ready={renderer !== "pending" && view.w > 0 ? "true" : "false"}
      data-fixture={fixture ? "true" : "false"}
      aria-label="Orbit view"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="orbit-camera" style={{ transform: `translate3d(${rowCam.x}px, ${rowCam.y}px, 0) scale(${rowCam.s})` }}>
        <div className="orbit-ink" ref={inkRef}>
          <canvas
            ref={canvasRef}
            className="orbit-webgl"
            aria-hidden="true"
            style={{
              display: renderer === "webgl" ? "block" : "none",
              left: box.minX,
              top: box.minY,
              width: box.width,
              height: box.height,
            }}
          />
          {renderer !== "webgl" ? (
            <svg
              className="orbit-svg"
              aria-hidden="true"
              style={{ left: box.minX, top: box.minY, width: box.width, height: box.height }}
              viewBox={`${box.minX} ${box.minY} ${box.width} ${box.height}`}
            >
              {segments.map((line) => (
                <line
                  key={line.id}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={line.kind === "partner" || line.kind === "divorced" ? "var(--graph-spouse)" : "var(--graph-kin)"}
                  strokeWidth={line.kind === "partner" ? 3 : 1.6}
                  strokeDasharray={
                    line.kind === "step" ? "2 6" :
                    line.kind === "divorced" ? "2 7" :
                    line.kind === "adopted" ? "7 5" :
                    line.kind === "foster" ? "8 4 2 4" :
                    undefined
                  }
                  strokeLinecap="round"
                />
              ))}
            </svg>
          ) : null}
          {tints.map((tint) => {
            const cards = tint.ids.map((id) => poseOf.get(id)).filter((card): card is OrbitSeat => Boolean(card));
            if (cards.length < 2) return null;
            const left = Math.min(...cards.map((card) => card.x - CARD.w / 2)) - 10;
            const right = Math.max(...cards.map((card) => card.x + CARD.w / 2)) + 10;
            const top = Math.min(...cards.map((card) => card.y)) - 10;
            const bottom = Math.max(...cards.map((card) => card.y + CARD.h)) + 10;
            return (
              <div
                key={tint.id}
                className="couple-tint"
                data-couple={tint.id}
                style={{ transform: `translate3d(${left}px, ${top}px, 0)`, width: right - left, height: bottom - top }}
              />
            );
          })}
        </div>
        {graph.cards.map((card) => {
          if (!drawnIds.has(card.id)) return null;
          const person = card.person;
          const row = rowOf.get(card.id);
          const orbit = seatOf.get(card.id);
          const pose = poseOf.get(card.id);
          if (!pose || !row) return null;
          const mark = marks?.[card.id];
          const details = stableSeen?.get(card.id)?.details ?? "open";
          const dimmed = mark?.presence === "dimmed" || stableSeen?.get(card.id)?.presence === "dimmed";
          const ghost = mark?.draw === "ghost";
          const photo = details === "open" ? person.photo : undefined;
          const age = details === "open" ? ageLabel(person.birthDate) : undefined;
          const ring = shownLayout === "orbit" ? orbit?.ring : undefined;
          return (
            <button
              key={card.id}
              type="button"
              className={`portrait-card${photo ? " has-photo" : ""}${dimmed ? " is-lens-dim" : ""}${ghost ? " is-lens-ghost" : ""}`}
              data-person-id={person.id}
              data-name={displayName(person)}
              data-gen={row.gen}
              data-ring={ring}
              data-details={details}
              aria-pressed={state.selectedId === person.id}
              style={{
                "--x": `${pose.x - CARD.w / 2}px`,
                "--y": `${pose.y}px`,
                "--s": String(pose.scale),
                "--a": String(dimmed && shownLayout === "rows" ? Math.min(pose.opacity, 0.32) : pose.opacity),
                width: CARD.w,
                height: CARD.h,
              } as CSSProperties}
              onClick={(event) => {
                event.preventDefault();
                if (event.detail !== 0) return;
                onCardClick(person);
              }}
              onKeyDown={(event) => {
                const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
                if (!menuKey) return;
                event.preventDefault();
                dispatch({
                  type: "hold",
                  personId: person.id,
                  allowed: canOrbitFocus(person.id, { tree, seen: stableSeen, editMode, arranging }),
                });
              }}
            >
              {photo ? <img className="portrait-photo" src={photo} alt="" /> : <GeneratedAvatar person={person} className="swatch" />}
              <span className="identity">
                <strong title={displayName(person)}>{person.givenName || displayName(person)}</strong>
                {details === "open" ? <em>{age ?? "—"}</em> : null}
              </span>
            </button>
          );
        })}
      </div>
      {fixture ? <p className="orbit-note">Fixture</p> : null}
    </div>
  );
}
