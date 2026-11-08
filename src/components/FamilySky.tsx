"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { KinKind, LinkRole, ParentRole, Person, TreeData, UnionKind } from "@/lib/types";
import { displayName, kinKindLabel } from "@/lib/types";
import { CARD, ageLabel, lineageIds } from "@/lib/layout";
import { GeneratedAvatar } from "./GeneratedAvatar";
import { centerTransform, fitContentScale, superellipsePath, type Camera } from "@/lib/graphView";
import { skyFromPersonalMap } from "@/lib/familySkyFocus";
import { PERSONAL_MAP_MS, layoutPersonalMap, type PersonalMap } from "@/lib/personalMap";
import { gatheredPersonId } from "@/lib/personInteraction";
import { usePersonInteraction } from "./PersonHoldMenu";
import { DEFAULT_LINE_FILTER, lineFilterAllows, lineFilterAllowsCouples, type LineFilter } from "@/lib/kinFilter";
import {
  SKY_ZOOM,
  bucketAt,
  bucketBox,
  cameraToFit,
  layoutFamilySky,
  overviewZoom,
  rowGesture,
  visibleBuckets,
  labelAnchor,
  legibleLabels,
  skyBounds,
  skyMinScale,
  zoomLevel,
  type Box,
  type FamilySky as FamilySkyLayout,
  type RowGesture,
  type SkyBucket,
  type SkyCard,
  type ZoomLevel,
} from "@/lib/familySky";
import { coupleBarGeometry, curvesPath, forkGuides, glideMotion } from "@/lib/skyGlide";
import { bindSkyGlide, clearSkyGlide, stepSkyGlide } from "@/lib/skyGlideDom";
import { routePersonLink } from "@/lib/familySkyRoute";
import type { UnitLinkKind } from "@/lib/familyUnits";
import {
  commitUnlink,
  coupleUnlinkMark,
  curveUnlinkMark,
  forkUnlinkMark,
  skyUnlinkEnabled,
  type SkyUnlinkMark,
} from "@/lib/skyUnlink";
import { LinkRolePicker } from "./LinkRolePicker";
import type { PersonMark } from "@/lib/access";

type Props = {
  tree: TreeData;
  highlightedId?: string;
  onHighlight: (person?: Person) => void;
  onOpen: (person: Person) => void;
  fitKey?: string | number | boolean;
  lineFilter?: LineFilter;
  /** While true (say, a sheet covers the sky), keep showing the last layout; the change glides in afterwards. */
  hold?: boolean;
  /** Edit in place: drag a dot onto someone to link them, drag a person into another family to move them, tap a line to unlink. */
  editMode?: boolean;
  onLink?: (personId: string, otherId: string, role: LinkRole, kind?: UnionKind, parentRole?: ParentRole, kin?: KinKind) => void | Promise<void>;
  /** Same unlink handler as the classic graph. */
  onUnlink?: (personId: string, otherId: string, role: Exclude<LinkRole, "sibling">) => void | Promise<void>;
  /** Move a person into the family unit rooted at `unitRootId`. */
  onMoveToUnit?: (personId: string, unitRootId: string) => void | Promise<void>;
  /** Persist a place along the family row. `x` is pixels to the right of the automatic place. */
  onPlace?: (personId: string, x: number) => void | Promise<void>;
  /**
   * Arranging a visibility lens. Touches include, hide, or dim. They do not
   * gather, drag, or open the editor.
   */
  lens?: {
    active: boolean;
    phase: "working" | "arrange" | "preview";
    marks: Record<string, PersonMark>;
    resolvedIds: string[];
    caption: string;
    onPerson: (personId: string) => void;
    onBranch: (rootId: string) => void;
  };
};

type Port = "parent" | "partner" | "child";

function portPoint(x: number, y: number, port: Port, side: "left" | "right" = "right") {
  if (port === "parent") return { x, y };
  if (port === "child") return { x, y: y + CARD.h };
  return { x: x + (side === "left" ? -CARD.w / 2 : CARD.w / 2), y: y + CARD.h / 2 };
}

type PinchStart = Camera & { dist: number; midX: number; midY: number };

const AVATAR_R = 44;

const DASH: Record<UnitLinkKind, string | undefined> = {
  blood: undefined,
  adopted: "7 5",
  step: "2 6",
  foster: "8 4 2 4",
  partner: undefined,
};

function allows(filter: LineFilter, kind: UnitLinkKind) {
  return kind === "partner" ? lineFilterAllowsCouples(filter) : lineFilterAllows(filter, kind);
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const MORPH_MS = 620;

export function FamilySky({
  tree,
  highlightedId,
  onHighlight,
  onOpen,
  fitKey,
  lineFilter = DEFAULT_LINE_FILTER,
  hold = false,
  editMode = false,
  onLink,
  onUnlink,
  onMoveToUnit,
  onPlace,
  lens,
}: Props) {
  const interaction = usePersonInteraction({
    people: tree.people,
    selectedId: highlightedId,
    editMode,
    onSelect: onHighlight,
    onOpen,
  });
  const clearInteraction = interaction.clear;
  useEffect(() => {
    if (!lens?.active) return;
    clearInteraction();
  }, [clearInteraction, lens?.active]);
  const baseSky = useMemo(() => layoutFamilySky(tree, routePersonLink), [tree]);
  const gatheredId = gatheredPersonId(interaction.focus, editMode);
  const personal = useMemo(
    () => (gatheredId ? layoutPersonalMap(tree, gatheredId) : null),
    [gatheredId, tree],
  );
  const targetSky = useMemo(
    () => (personal ? skyFromPersonalMap(baseSky, tree, personal) : baseSky),
    [baseSky, personal, tree],
  );
  const focusKey = personal?.focusId ?? "";
  const [laid, setLaid] = useState<{
    tree: TreeData;
    sky: FamilySkyLayout;
    focusKey: string;
    personal: boolean;
    from?: FamilySkyLayout;
    fromPersonal?: boolean;
  } | null>(null);
  const fresh = !laid || ((laid.tree !== tree || laid.focusKey !== focusKey) && !(hold && laid.tree !== tree));
  const sky = fresh ? targetSky : laid.sky;
  if (fresh) {
    setLaid({
      tree,
      sky,
      focusKey,
      personal: Boolean(personal),
      from: laid?.sky,
      fromPersonal: laid?.personal,
    });
  }
  // True only at the ends of a layout glide. Frames in between paint through refs, not state.
  const [animating, setAnimating] = useState(false);
  const rings = useMemo(() => new Map(personal?.seats.map((seat) => [seat.id, seat.ring]) ?? []), [personal]);
  const linked = useMemo(() => {
    if (personal) return new Set(personal.seats.filter((seat) => seat.ring !== "dim").map((seat) => seat.id));
    return highlightedId ? lineageIds(tree, highlightedId) : null;
  }, [personal, tree, highlightedId]);
  const stageRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<Camera>({ x: 0, y: 0, s: 0.2 });
  const levelRef = useRef<ZoomLevel>("far");
  const farAtRef = useRef<number>(SKY_ZOOM.far);
  // Close up, only buckets near the screen render their people.
  const shownKeyRef = useRef("");
  const [shownKey, setShownKey] = useState("");
  const labelsRef = useRef<LabelsHandle>(null);
  const [level, setLevel] = useState<ZoomLevel>("far");
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const pinch = useRef<PinchStart | null>(null);
  const suppressTap = useRef(false);
  const raf = useRef<number | null>(null);
  const tween = useRef<number | null>(null);
  // Edit mode: a wire from a dot, or a person being carried to another family.
  const connect = useRef<{ fromId: string; port: Port; pointerId: number } | null>(null);
  const [wire, setWire] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const carry = useRef<{ id: string; pointerId: number; x: number; y: number; dx: number; dy: number } | null>(null);
  const [carried, setCarried] = useState<{ id: string; x: number; y: number; over?: string } | null>(null);
  const gesture = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    originX: number;
    placeX: number;
    mode: RowGesture;
  } | null>(null);
  const [placing, setPlacing] = useState<{ id: string; x: number } | null>(null);
  const [pick, setPick] = useState<{ fromId: string; toId: string } | null>(null);
  // While carrying a person or a wire near the screen edge, the sky pans along.
  const followAfterDrop = useRef<string | null>(null);
  const edgePan = useRef<{ raf: number | null; clientX: number; clientY: number }>({ raf: null, clientX: 0, clientY: 0 });

  const cardOf = useMemo(() => new Map(sky.cards.map((c) => [c.id, c])), [sky]);
  const focusUnit = highlightedId ? sky.units.unitOf[highlightedId] : undefined;
  const focusUnitRef = useRef(focusUnit);
  focusUnitRef.current = focusUnit;
  useEffect(() => {
    // New layout or selection: labels are recomputed on the next frame.
    labelsRef.current?.reset();
    applyWorld();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sky, focusUnit]);

  const glideRef = useRef<{
    motion: ReturnType<typeof glideMotion>;
    to: FamilySkyLayout;
    start: number;
    ms: number;
    k: number;
    raf: number | null;
  } | null>(null);

  function paintGlide(k: number) {
    const glide = glideRef.current;
    const world = worldRef.current;
    if (!glide || !world) return;
    glide.k = k;
    stepSkyGlide(world, glide.to, glide.motion, k, levelRef.current);
    labelsRef.current?.nudge();
  }

  useLayoutEffect(() => {
    const from = laid?.from;
    const to = laid?.sky;
    if (!from || !to) {
      glideRef.current = null;
      return;
    }
    const world = worldRef.current;
    const glideMs = laid.personal || laid.fromPersonal ? PERSONAL_MAP_MS : MORPH_MS;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      glideRef.current = null;
      if (world) {
        // Land on the destination. A glide that was cancelled may have left line coordinates behind.
        stepSkyGlide(world, to, glideMotion(from, to), 1, levelRef.current);
        clearSkyGlide(world);
      }
      setAnimating(false);
      return;
    }
    // Keep the old world where it was on screen, then glide to the new one.
    const v = viewRef.current;
    viewRef.current = { ...v, x: v.x - to.shift.x * v.s, y: v.y - to.shift.y * v.s };
    applyWorld();
    const motion = glideMotion(from, to);
    const glide = { motion, to, start: performance.now(), ms: glideMs, k: 0, raf: null as number | null };
    glideRef.current = glide;
    if (world) {
      bindSkyGlide(world, motion);
      stepSkyGlide(world, to, motion, 0, levelRef.current);
    }
    setAnimating(true);
    const step = (now: number) => {
      if (glideRef.current !== glide) return;
      const t = Math.min(1, (now - glide.start) / glide.ms);
      if (t >= 1) {
        const node = worldRef.current;
        if (node) {
          stepSkyGlide(node, glide.to, glide.motion, 1, levelRef.current);
          clearSkyGlide(node);
        }
        glide.raf = null;
        glideRef.current = null;
        setAnimating(false);
        return;
      }
      paintGlide(easeInOut(t));
      glide.raf = window.requestAnimationFrame(step);
    };
    glide.raf = window.requestAnimationFrame(step);
    return () => {
      if (glide.raf != null) window.cancelAnimationFrame(glide.raf);
      glideRef.current = null;
      if (world) clearSkyGlide(world);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laid]);

  // A camera or zoom update can re-render mid-glide. Put the current frame back
  // before paint so React's destination picture does not flash through.
  useLayoutEffect(() => {
    const glide = glideRef.current;
    const world = worldRef.current;
    if (!glide || !world) return;
    bindSkyGlide(world, glide.motion);
    stepSkyGlide(world, glide.to, glide.motion, glide.k, levelRef.current);
    labelsRef.current?.nudge();
  });

  function stageSize() {
    const stage = stageRef.current;
    const vw = stage?.clientWidth || 360;
    const vh = stage?.clientHeight || 480;
    // Frame below the toolbar that floats over the top of the stage.
    let inset = 0;
    if (stage) {
      const bar = stage.parentElement?.querySelector(".graph-toolbar");
      const top = stage.getBoundingClientRect().top;
      if (bar) inset = Math.max(0, Math.min(vh / 3, bar.getBoundingClientRect().bottom - top));
    }
    return { vw, vh, inset };
  }

  function minScale() {
    const { vw, vh, inset } = stageSize();
    return skyMinScale(vw, vh - inset, sky);
  }

  function clamp(s: number) {
    return Math.min(SKY_ZOOM.max, Math.max(minScale(), s));
  }

  function applyWorld() {
    const el = worldRef.current;
    if (!el) return;
    const { x, y, s } = viewRef.current;
    el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    el.style.setProperty("--inv", String(1 / s));
    const next = zoomLevel(s, levelRef.current, farAtRef.current);
    if (next !== levelRef.current) {
      levelRef.current = next;
      setLevel(next);
    }
    labelsRef.current?.update(viewRef.current, next, stageRef.current?.clientWidth || 360);
    if (next !== "far") {
      const stage = stageRef.current;
      const key = visibleBuckets(sky, viewRef.current, stage?.clientWidth || 360, stage?.clientHeight || 480).join("|");
      if (key !== shownKeyRef.current) {
        shownKeyRef.current = key;
        setShownKey(key);
      }
    }
  }

  function scheduleApply() {
    if (raf.current != null) return;
    raf.current = window.requestAnimationFrame(() => {
      raf.current = null;
      applyWorld();
    });
  }

  function stopTween() {
    if (tween.current != null) window.cancelAnimationFrame(tween.current);
    tween.current = null;
  }

  function animateTo(target: Camera, ms = 420) {
    stopTween();
    const from = { ...viewRef.current };
    const { vw, vh, inset } = stageSize();
    const cx = vw / 2;
    const cy = inset + (vh - inset) / 2;
    // Interpolate the world point at the centre and the log of the scale.
    const fromWorld = { x: (cx - from.x) / from.s, y: (cy - from.y) / from.s };
    const toWorld = { x: (cx - target.x) / target.s, y: (cy - target.y) / target.s };
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = easeOut(t);
      const s = Math.exp(Math.log(from.s) + (Math.log(target.s) - Math.log(from.s)) * k);
      const wx = fromWorld.x + (toWorld.x - fromWorld.x) * k;
      const wy = fromWorld.y + (toWorld.y - fromWorld.y) * k;
      viewRef.current = { x: cx - wx * s, y: cy - wy * s, s };
      applyWorld();
      tween.current = t < 1 ? window.requestAnimationFrame(step) : null;
    };
    tween.current = window.requestAnimationFrame(step);
  }

  function cameraFor(box: Box, maxScale = SKY_ZOOM.max) {
    const { vw, vh, inset } = stageSize();
    const cam = cameraToFit(vw, vh - inset, box, 20, maxScale);
    return { ...cam, y: cam.y + inset };
  }

  /** The star-sky overview: every family at once, drawn as stars. */
  function fitAll(animate = false) {
    const box = skyBounds(sky);
    const { vw, vh, inset } = stageSize();
    const overview = overviewZoom(vw, vh - inset, sky);
    farAtRef.current = overview.farAt;
    const s = clamp(overview.s);
    const target = {
      x: vw / 2 - ((box.minX + box.maxX) / 2) * s,
      y: inset + (vh - inset) / 2 - ((box.minY + box.maxY) / 2) * s,
      s,
    };
    if (animate) animateTo(target);
    else {
      stopTween();
      viewRef.current = target;
      applyWorld();
    }
  }

  /** Frame the lit personal-map rings, with the center couple in the middle. */
  function framePersonal(map: PersonalMap, next: FamilySkyLayout) {
    const { vw, vh, inset } = stageSize();
    const lit = new Set(map.seats.filter((seat) => seat.ring !== "dim").map((seat) => seat.id));
    const gathered = next.cards.filter((card) => lit.has(card.id));
    const cards = gathered.length ? gathered : next.cards;
    if (!cards.length) return;
    const minX = Math.min(...cards.map((card) => card.x - CARD.w / 2));
    const maxX = Math.max(...cards.map((card) => card.x + CARD.w / 2));
    const minY = Math.min(...cards.map((card) => card.y));
    const maxY = Math.max(...cards.map((card) => card.y + CARD.h));
    const center = map.seats.filter((seat) => seat.ring === "center");
    const cx = center.reduce((sum, seat) => sum + seat.x, 0) / Math.max(center.length, 1);
    const cy = center.reduce((sum, seat) => sum + seat.y, 0) / Math.max(center.length, 1) + CARD.h / 2;
    const halfW = Math.max(cx - minX, maxX - cx, CARD.w);
    const halfH = Math.max(cy - minY, maxY - cy, CARD.h);
    const viewH = Math.max(1, vh - inset);
    const scale = clamp(fitContentScale(vw, viewH, halfW * 2, halfH * 2));
    const fitted = centerTransform(vw, viewH, cx, cy, scale);
    const target = { ...fitted, y: fitted.y + inset };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      stopTween();
      viewRef.current = target;
      applyWorld();
      return;
    }
    animateTo(target, PERSONAL_MAP_MS);
  }

  function zoomToBucket(bucket: SkyBucket, focusId?: string) {
    const cam = cameraFor(bucketBox(bucket), 1);
    // Always land close enough to see the family's people, even when a big
    // family does not fit the screen (a phone): centre it and let it overflow.
    const farAt = Math.min(SKY_ZOOM.near * 0.85, Math.max(SKY_ZOOM.far, farAtRef.current));
    const s = clamp(Math.max(cam.s, Math.min(farAt * 1.3, SKY_ZOOM.near * 0.95)));
    if (s === cam.s) return animateTo(cam);
    const { vw, vh, inset } = stageSize();
    // Following someone: keep them in view, as close to the middle as the family allows.
    const card = focusId ? cardOf.get(focusId) : undefined;
    const half = vw / 2 / s;
    const cx = card && half < bucket.rx ? Math.max(bucket.cx - bucket.rx + half, Math.min(bucket.cx + bucket.rx - half, card.x)) : bucket.cx;
    animateTo({ x: vw / 2 - cx * s, y: inset + (vh - inset) / 2 - bucket.cy * s, s });
  }

  function zoomToPerson(personId: string) {
    const card = cardOf.get(personId);
    if (!card) return;
    const s = Math.max(viewRef.current.s, 0.8);
    const { vw, vh, inset } = stageSize();
    animateTo({ x: vw / 2 - card.x * s, y: inset + (vh - inset) / 2 - (card.y + CARD.h / 2) * s, s });
  }

  function zoomBy(factor: number) {
    stopTween();
    const { vw, vh } = stageSize();
    const v = viewRef.current;
    const s = clamp(v.s * factor);
    const wx = (vw / 2 - v.x) / v.s;
    const wy = (vh / 2 - v.y) / v.s;
    viewRef.current = { x: vw / 2 - wx * s, y: vh / 2 - wy * s, s };
    scheduleApply();
  }

  useEffect(() => {
    fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // When the tree changes (for example a family-unit reassignment), follow the
  // selected person to their redrawn bucket; otherwise show every family.
  const firstSky = useRef(true);
  // Camera from before this personal map, so clearing the selection returns there.
  const savedCam = useRef<Camera | null>(null);
  const refitAfter = useRef(false);
  useEffect(() => {
    if (firstSky.current) {
      firstSky.current = false;
      if (!personal) return;
    }
    if (personal) {
      // Save the sky camera once, before framing the map. A later tree change
      // while focused must not overwrite it with the map's own camera.
      if (!savedCam.current && laid?.from && !laid.fromPersonal) savedCam.current = { ...viewRef.current };
      framePersonal(personal, sky);
      return;
    }
    if (savedCam.current || refitAfter.current) {
      const back = savedCam.current;
      const refit = refitAfter.current;
      savedCam.current = null;
      refitAfter.current = false;
      if (refit || !back) fitAll(true);
      else animateTo(back, PERSONAL_MAP_MS);
      return;
    }
    // While editing, stay at this zoom and let the change glide; keep a person
    // who was dropped into a family in view.
    if (editMode) {
      const dropped = followAfterDrop.current;
      followAfterDrop.current = null;
      const card = dropped ? cardOf.get(dropped) : undefined;
      if (card) {
        const { vw, vh, inset } = stageSize();
        const s = viewRef.current.s;
        animateTo({ x: vw / 2 - card.x * s, y: inset + (vh - inset) / 2 - (card.y + CARD.h / 2) * s, s }, MORPH_MS);
      }
      return;
    }
    const unitId = highlightedId ? sky.units.unitOf[highlightedId] : undefined;
    const bucket = unitId ? sky.buckets.find((b) => b.id === unitId) : undefined;
    if (bucket) zoomToBucket(bucket, highlightedId);
    else fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sky, personal]);

  useEffect(() => {
    const onResize = () => applyWorld();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      stopTween();
      if (raf.current != null) window.cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".graph-filter, .graph-toolbar, .graph-zoom")) return;
      if (event.cancelable) event.preventDefault();
      stopTween();
      const rect = stage.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const v = viewRef.current;
      const factor = Math.exp(-Math.max(-60, Math.min(60, event.deltaY)) * 0.0035);
      const s = clamp(v.s * factor);
      const wx = (px - v.x) / v.s;
      const wy = (py - v.y) / v.s;
      viewRef.current = { x: px - wx * s, y: py - wy * s, s };
      scheduleApply();
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sky]);

  function stagePoint(clientX: number, clientY: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: clientX, y: clientY };
  }

  function worldPoint(clientX: number, clientY: number) {
    const pt = stagePoint(clientX, clientY);
    const v = viewRef.current;
    return { x: (pt.x - v.x) / v.s, y: (pt.y - v.y) / v.s };
  }

  function cardAtPoint(wx: number, wy: number) {
    return sky.cards.find((c) => Math.abs(wx - c.x) <= CARD.w / 2 + 8 && wy >= c.y - 8 && wy <= c.y + CARD.h + 8);
  }

  function shownPoint(card: SkyCard) {
    if (carried?.id === card.id) return { x: carried.x, y: carried.y };
    if (placing?.id === card.id) return { x: placing.x, y: card.y };
    return { x: card.x, y: card.y };
  }

  /** Edit mode, close up: start a wire from a dot, or pick up a person. Returns true when handled. */
  function editPointerDown(event: PointerEvent<HTMLDivElement>, target: Element) {
    if (!editMode || levelRef.current !== "near" || pointers.current.size > 0) return false;
    const portEl = target.closest(".graph-port") as HTMLElement | null;
    if (portEl && onLink) {
      const fromId = portEl.dataset.personId;
      const port = portEl.dataset.port as Port | undefined;
      const card = fromId ? cardOf.get(fromId) : undefined;
      if (!fromId || !port || !card) return false;
      event.stopPropagation();
      stageRef.current?.setPointerCapture(event.pointerId);
      connect.current = { fromId, port, pointerId: event.pointerId };
      const from = portPoint(card.x, card.y, port, portEl.dataset.side as "left" | "right" | undefined);
      setWire({ x1: from.x, y1: from.y, x2: from.x, y2: from.y });
      setPick(null);
      suppressTap.current = true;
      return true;
    }
    const cardEl = target.closest(".portrait-card") as HTMLElement | null;
    if (cardEl && (onPlace || onMoveToUnit)) {
      const id = cardEl.dataset.personId;
      const card = id ? cardOf.get(id) : undefined;
      if (!id || !card) return false;
      stageRef.current?.setPointerCapture(event.pointerId);
      gesture.current = {
        id,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        originX: card.x,
        placeX: card.x,
        mode: "pending",
      };
      suppressTap.current = false;
      return true;
    }
    return false;
  }

  /** Follow the pointer with the wire or the carried card. */
  function trackEdit(clientX: number, clientY: number) {
    const pt = worldPoint(clientX, clientY);
    if (connect.current) {
      setWire((w) => (w ? { ...w, x2: pt.x, y2: pt.y } : w));
      return;
    }
    const c = carry.current;
    if (!c) return;
    const over = bucketAt(sky, pt.x, pt.y, viewRef.current.s)?.id;
    setCarried({ id: c.id, x: pt.x - c.dx, y: pt.y - c.dy, over });
  }

  function edgePanStep() {
    const pan = edgePan.current;
    pan.raf = null;
    if (!connect.current && !(carry.current && suppressTap.current)) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { inset } = stageSize();
    const zone = 44;
    const push = (d: number) => (d < zone ? ((zone - d) / zone) * 14 : 0);
    const dx = push(pan.clientX - rect.left) - push(rect.right - pan.clientX);
    const dy = push(pan.clientY - rect.top - inset) - push(rect.bottom - pan.clientY);
    if (!dx && !dy) return;
    viewRef.current = { ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy };
    applyWorld();
    trackEdit(pan.clientX, pan.clientY);
    pan.raf = window.requestAnimationFrame(edgePanStep);
  }

  function beginCarry(id: string, pointerId: number, clientX: number, clientY: number) {
    if (carry.current?.pointerId === pointerId) return;
    const card = cardOf.get(id);
    if (!card) return;
    const pt = worldPoint(clientX, clientY);
    const at = shownPoint(card);
    carry.current = { id, pointerId, x: clientX, y: clientY, dx: pt.x - at.x, dy: pt.y - at.y };
    setPlacing(null);
  }

  function editPointerMove(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (g && g.pointerId === event.pointerId) {
      const scale = viewRef.current.s || 1;
      const dx = (event.clientX - g.x) / scale;
      const dy = (event.clientY - g.y) / scale;
      const pt = worldPoint(event.clientX, event.clientY);
      const over = bucketAt(sky, pt.x, pt.y, scale)?.id;
      const home = cardOf.get(g.id)?.unitId;
      let next = rowGesture(g.mode, { dx, dy }, Boolean(over && home && over !== home));
      if (next === "place" && !onPlace) next = "carry";
      g.mode = next;
      if (next === "pending") return true;
      suppressTap.current = true;
      if (next === "place") {
        carry.current = null;
        setCarried(null);
        g.placeX = g.originX + dx;
        setPlacing({ id: g.id, x: g.placeX });
        return true;
      }
      beginCarry(g.id, event.pointerId, event.clientX, event.clientY);
      trackEdit(event.clientX, event.clientY);
      edgePan.current.clientX = event.clientX;
      edgePan.current.clientY = event.clientY;
      if (edgePan.current.raf == null) edgePan.current.raf = window.requestAnimationFrame(edgePanStep);
      return true;
    }
    const c = carry.current;
    const mine = (connect.current && connect.current.pointerId === event.pointerId) || (c && c.pointerId === event.pointerId);
    if (!mine) return false;
    if (c) suppressTap.current = true;
    trackEdit(event.clientX, event.clientY);
    edgePan.current.clientX = event.clientX;
    edgePan.current.clientY = event.clientY;
    if (edgePan.current.raf == null) edgePan.current.raf = window.requestAnimationFrame(edgePanStep);
    return true;
  }

  function editPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (connect.current && connect.current.pointerId === event.pointerId) {
      const fromId = connect.current.fromId;
      connect.current = null;
      setWire(null);
      const pt = worldPoint(event.clientX, event.clientY);
      const to = cardAtPoint(pt.x, pt.y);
      if (to && to.id !== fromId && event.type !== "pointercancel") setPick({ fromId, toId: to.id });
      return true;
    }
    const g = gesture.current;
    if (g && g.pointerId === event.pointerId) {
      gesture.current = null;
      const mode = g.mode;
      setPlacing(null);
      if (mode === "place") {
        carry.current = null;
        setCarried(null);
        const dx = g.placeX - g.originX;
        if (Math.abs(dx) > 8 && event.type !== "pointercancel") {
          suppressTap.current = true;
          const previous = cardOf.get(g.id)?.person.rowNudge;
          const base = typeof previous === "number" && Number.isFinite(previous) ? previous : 0;
          void onPlace?.(g.id, base + dx);
        }
        return true;
      }
      if (mode === "pending") {
        const card = cardOf.get(g.id);
        if (card && event.type !== "pointercancel") tapCard(card.person);
        suppressTap.current = true;
        return true;
      }
    }
    const c = carry.current;
    if (c && c.pointerId === event.pointerId) {
      carry.current = null;
      const dropped = carried;
      setCarried(null);
      if (!dropped && !suppressTap.current && event.type !== "pointercancel") {
        const card = cardOf.get(c.id);
        if (card) tapCard(card.person);
        suppressTap.current = true;
        return true;
      }
      const from = sky.units.unitOf[c.id];
      const unit = dropped?.over ? sky.units.units.find((u) => u.id === dropped.over) : undefined;
      if (unit && unit.id !== from && event.type !== "pointercancel") {
        followAfterDrop.current = c.id;
        void onMoveToUnit?.(c.id, unit.rootId);
      }
      return true;
    }
    return false;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    // A tap on a relationship mark is an unlink, not a pan or a carry.
    if (editMode && target?.closest(".graph-hit, .sky-unlink")) return;
    if (target && editPointerDown(event, target)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      return;
    }
    stopTween();
    if (pointers.current.size === 0) suppressTap.current = false;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      drag.current = null;
      suppressTap.current = true;
      interaction.cancelHold();
      stageRef.current?.setPointerCapture(event.pointerId);
      const pts = [...pointers.current.values()];
      const a = stagePoint(pts[0].x, pts[0].y);
      const b = stagePoint(pts[1].x, pts[1].y);
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      pinch.current = dist < 8 ? null : { ...viewRef.current, dist, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      return;
    }
    if (target?.closest(".graph-zoom")) return;
    // Capturing on a button would retarget its click to the stage.
    if (!target?.closest(".portrait-card, .sky-avatar, .sky-label")) stageRef.current?.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (editPointerMove(event)) return;
    if (pinch.current && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const a = stagePoint(pts[0].x, pts[0].y);
      const b = stagePoint(pts[1].x, pts[1].y);
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < 8) return;
      const start = pinch.current;
      const wx = (start.midX - start.x) / start.s;
      const wy = (start.midY - start.y) / start.s;
      const s = clamp(start.s * (dist / Math.max(start.dist, 1e-6)));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      viewRef.current = { x: mx - wx * s, y: my - wy * s, s };
      scheduleApply();
      return;
    }
    if (pinch.current) return;
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    if (Math.abs(event.clientX - d.x) + Math.abs(event.clientY - d.y) > 6) suppressTap.current = true;
    viewRef.current = { ...viewRef.current, x: d.vx + (event.clientX - d.x), y: d.vy + (event.clientY - d.y) };
    scheduleApply();
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (editPointerUp(event)) return;
    if (pointers.current.size < 2) pinch.current = null;
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    drag.current = null;
    const moved = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
    if (moved >= 8 || suppressTap.current || event.type === "pointercancel") return;
    const target = event.target as HTMLElement;
    if (target.closest(".portrait-card, .sky-avatar, .sky-label, .graph-zoom")) return;
    const pt = stagePoint(event.clientX, event.clientY);
    const v = viewRef.current;
    const bucket = bucketAt(sky, (pt.x - v.x) / v.s, (pt.y - v.y) / v.s, v.s);
    if (bucket && levelRef.current !== "near") zoomToBucket(bucket);
    else interaction.clear();
  }

  function tapCard(person: Person) {
    if (suppressTap.current) {
      suppressTap.current = false;
      interaction.dropSwallow();
      return;
    }
    interaction.tap(person.id);
  }

  function releaseUnlink(mark: SkyUnlinkMark) {
    if (!onUnlink) return;
    void commitUnlink(tree.people, mark, onUnlink);
  }

  function linkStyle(kind: UnitLinkKind, lit: boolean) {
    const quiet = kind !== "blood";
    if (lit) return { width: 2.4, opacity: 0.92 };
    if (linked) return { width: 1.2, opacity: 0.16 };
    return { width: quiet ? 1.2 : 1.4, opacity: quiet ? 0.38 : 0.46 };
  }

  function kinLine(kind: KinKind, lit: boolean, dotted: boolean) {
    const dash = DASH[kind] ?? (dotted ? "5 7" : undefined);
    const quiet = kind !== "blood";
    if (lit) return { width: quiet ? 1.6 : 2.2, opacity: quiet ? 0.55 : 0.88, dash };
    if (!linked) return { width: quiet ? 1.3 : 1.7, opacity: quiet ? 0.32 : 0.42, dash };
    return { width: 1.2, opacity: quiet ? 0.2 : 0.22, dash };
  }

  const shown = new Set(shownKey.split("|"));
  const lensOn = Boolean(lens?.active);
  function lensShows(personId: string) {
    if (!lensOn || !lens) return true;
    return lens.marks[personId]?.draw === "shown";
  }
  function lensDraws(personId: string) {
    if (!lensOn || !lens) return true;
    return Boolean(lens.marks[personId]);
  }
  const labelSky = !lensOn
    ? sky
    : {
        ...sky,
        buckets: sky.buckets.flatMap((bucket) => {
          if (!bucket.memberIds.some((id) => lensDraws(id))) return [];
          if (lens?.phase !== "preview") return [bucket];
          const named = bucket.headIds.filter((id) => lensShows(id));
          const ids = named.length ? named : bucket.memberIds.filter((id) => lensShows(id));
          const label = ids
            .map((id) => tree.people.find((person) => person.id === id)?.givenName)
            .filter(Boolean)
            .join(" & ");
          return [label ? { ...bucket, label } : bucket];
        }),
      };
  const near = level === "near";
  const mid = level === "mid";
  const far = level === "far";
  const unlinkArmed = skyUnlinkEnabled(editMode, level) && Boolean(onUnlink);
  const peopleCount = tree.people.length;

  return (
    <div
      ref={stageRef}
      className={`graph-stage family-sky is-${level}${editMode ? " is-editing" : ""}${personal ? " is-personal" : ""}${lensOn ? " is-lens" : ""}`}
      aria-label={`Family sky, ${personal ? sky.units.units.length : sky.buckets.length} families, ${level === "far" ? "overview" : level === "mid" ? "families" : "people"}`}
      data-level={level}
      data-layout={personal ? "personal" : "sky"}
      data-lens-phase={lensOn ? lens?.phase : undefined}
      data-resolved={lensOn ? lens?.resolvedIds.join(" ") : undefined}
      data-animating={animating ? "true" : "false"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div ref={worldRef} className="graph-world sky-world" style={{ width: sky.width, height: sky.height }}>
        <svg className="graph-lines" width={sky.width} height={sky.height} aria-hidden>
          <defs>
            <radialGradient id="sky-glow">
              <stop offset="0%" className="sky-glow-core" />
              <stop offset="28%" className="sky-glow-mid" />
              <stop offset="100%" className="sky-glow-edge" />
            </radialGradient>
          </defs>

          {far
            ? sky.unitEdges.map((edge) => {
                const kind = edge.kinds.find((k) => allows(lineFilter, k));
                if (!kind) return null;
                if (lensOn) {
                  const keep = (id: string) => sky.buckets.find((bucket) => bucket.id === id)?.memberIds.some((member) => lensDraws(member));
                  if (!keep(edge.aId) || !keep(edge.bId)) return null;
                }
                return (
                  <line
                    key={edge.id}
                    data-edge-id={edge.id}
                    className={`sky-edge is-${kind}`}
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    strokeDasharray={DASH[kind]}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })
            : null}

          {!far && !personal
            ? sky.buckets.filter((bucket) => !lensOn || bucket.memberIds.some((id) => lensDraws(id))).map((bucket) => {
                const lit = bucket.id === focusUnit;
                const drop = carried?.over === bucket.id && sky.units.unitOf[carried.id] !== bucket.id;
                return (
                  <path
                    key={bucket.id}
                    data-unit-id={bucket.id}
                    data-members={bucket.memberIds.join(" ")}
                    className={`sky-bucket${lit ? " is-lit" : ""}${drop ? " is-drop" : ""}`}
                    d={superellipsePath(bucket, 120)}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })
            : null}

          {/* Links run above the bucket fills and break around any card in their way; the selected person's links come last, on top. */}
          {!far && !personal
            ? [...sky.links]
                .map((link) => ({ link, lit: Boolean(linked && linked.has(link.fromPersonId) && linked.has(link.toPersonId)) }))
                .sort((a, b) => Number(a.lit) - Number(b.lit))
                .map(({ link, lit }) => {
                  if (!allows(lineFilter, link.kind)) return null;
                  if (lensOn && (!lensShows(link.fromPersonId) || !lensShows(link.toPersonId))) return null;
                  const w = linkStyle(link.kind, lit);
                  const d = curvesPath(near ? link.pieces : link.midPieces);
                  const mark = unlinkArmed ? curveUnlinkMark(link) : null;
                  return (
                    <g key={link.id} data-link-id={link.id}>
                      <path
                        className={`sky-link is-${link.kind}${lit ? " is-lit" : ""}`}
                        data-from={link.fromPersonId}
                        data-to={link.toPersonId}
                        d={d}
                        strokeWidth={w.width}
                        strokeOpacity={w.opacity}
                        strokeDasharray={DASH[link.kind]}
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                      />
                      {mark ? (
                        <path
                          className="graph-hit"
                          data-mark="curve"
                          data-kind={link.kind}
                          data-from={link.fromPersonId}
                          data-to={link.toPersonId}
                          d={d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={18}
                          vectorEffect="non-scaling-stroke"
                          onClick={(event) => {
                            event.stopPropagation();
                            releaseUnlink(mark);
                          }}
                        />
                      ) : null}
                    </g>
                  );
                })
            : null}

          {far && !personal
            ? sky.buckets.filter((bucket) => !lensOn || bucket.memberIds.some((id) => lensDraws(id))).map((bucket) => (
                <g key={`${bucket.id}-glow`} data-unit-id={bucket.id} data-members={bucket.memberIds.join(" ")} className={`sky-star${bucket.id === focusUnit ? " is-lit" : ""}`}>
                  <circle cx={bucket.cx} cy={bucket.cy} r={bucket.glow} fill="url(#sky-glow)" />
                  <circle className="sky-star-core" cx={bucket.cx} cy={bucket.cy} r={bucket.glow * 0.16} />
                </g>
              ))
            : null}

          {near || personal
            ? sky.forks.filter((fork) => personal || shown.has(fork.unitId)).map((fork) => {
                const parents = fork.parentDrops.filter((d) => lineFilterAllows(lineFilter, d.kin) && lensShows(d.parentId));
                const kids = fork.childDrops.filter((d) => lineFilterAllows(lineFilter, d.kin) && lensShows(d.childId));
                if (!parents.length || !kids.length) return null;
                const lit = Boolean(
                  linked && (parents.some((d) => linked.has(d.parentId)) || kids.some((d) => linked.has(d.childId))),
                );
                const guides = forkGuides(parents, kids, fork.joinY, fork.railY);
                const forkKin = kids.every((d) => d.kin === kids[0].kin) ? kids[0].kin : fork.kin;
                const bar = kinLine(forkKin, lit, fork.dotted && forkKin === "blood");
                const seg = (key: string, x1: number, y1: number, x2: number, y2: number, w = bar, segName?: string) => (
                  <line
                    key={key}
                    data-seg={segName}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="var(--graph-kin)"
                    strokeWidth={w.width}
                    strokeOpacity={w.opacity}
                    strokeDasharray={w.dash}
                    strokeLinecap="round"
                    visibility={segName === "join" && !guides.joinWide ? "hidden" : segName === "rail" && !guides.railWide ? "hidden" : undefined}
                  />
                );
                return (
                  <g key={fork.id} data-fork-id={fork.id} className="graph-fork">
                    {parents.map((d) => (
                      <g key={`p-${d.parentId}`} data-seg="parent" data-person-id={d.parentId}>
                        {seg(`p-${d.parentId}`, d.x, d.y0, d.x, guides.joinY, kinLine(d.kin, lit, fork.dotted && d.kin === "blood"))}
                      </g>
                    ))}
                    {seg("join", guides.joinL, guides.joinY, guides.joinR, guides.joinY, bar, "join")}
                    {seg("stem", guides.stemX, guides.joinY, guides.stemX, guides.railY, bar, "stem")}
                    {forkKin !== "blood" ? (
                      <text data-seg="kin" className="graph-kin-label" x={guides.stemX} y={(guides.joinY + guides.railY) / 2} textAnchor="middle" fill="var(--graph-kin)" fillOpacity={0.55} fontSize="11">
                        {kinKindLabel(forkKin)}
                      </text>
                    ) : null}
                    {seg("rail", guides.railL, guides.railY, guides.railR, guides.railY, bar, "rail")}
                    {kids.map((d) => {
                      const mark = unlinkArmed ? forkUnlinkMark(fork, d) : null;
                      return (
                        <g key={`c-${d.childId}`} data-seg="child" data-person-id={d.childId}>
                          {seg(`c-${d.childId}`, d.x, guides.railY, d.x, d.y1, kinLine(d.kin, lit, false))}
                          {mark ? (
                            <line
                              className="graph-hit"
                              data-mark="fork"
                              data-kind={mark.kind}
                              data-parent={mark.parentId}
                              data-child={mark.childId}
                              x1={d.x}
                              y1={guides.railY}
                              x2={d.x}
                              y2={d.y1}
                              stroke="transparent"
                              strokeWidth={18}
                              onClick={(event) => {
                                event.stopPropagation();
                                releaseUnlink(mark);
                              }}
                            />
                          ) : null}
                        </g>
                      );
                    })}
                  </g>
                );
              })
            : null}

          {(near || personal) && lineFilterAllowsCouples(lineFilter)
            ? sky.couples.filter((c) => c.bar && (personal || shown.has(c.unitId)) && c.partnerIds.every((id) => lensShows(id))).map((couple) => {
                const geom = coupleBarGeometry(
                  couple.partnerIds.map((id) => cardOf.get(id)).filter((card): card is NonNullable<typeof card> => Boolean(card)),
                  couple.partnerIds,
                  couple.cy,
                );
                if (!geom?.showBar) return null;
                const lit = Boolean(linked && couple.partnerIds.every((id) => linked.has(id)));
                return (
                  <line
                    key={couple.id}
                    data-couple={couple.id}
                    data-partners={couple.partnerIds.join(" ")}
                    x1={geom.x1}
                    y1={geom.y}
                    x2={geom.x2}
                    y2={geom.y}
                    stroke="var(--graph-spouse)"
                    strokeWidth={(lit ? 2.6 : 1.6) + (couple.kind === "married" ? 1.6 : 0.4)}
                    strokeOpacity={lit ? 0.9 : linked ? 0.12 : 0.4}
                    strokeLinecap="round"
                  />
                );
              })
            : null}
          {wire ? (
            <line className="graph-wire" x1={wire.x1} y1={wire.y1} x2={wire.x2} y2={wire.y2} vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>

        {near || personal
          ? sky.couples.filter((c) => c.bar && (personal || shown.has(c.unitId)) && c.partnerIds.every((id) => lensShows(id))).map((couple) => {
              const geom = coupleBarGeometry(
                couple.partnerIds.map((id) => cardOf.get(id)).filter((card): card is NonNullable<typeof card> => Boolean(card)),
                couple.partnerIds,
                couple.cy,
              );
              if (!geom) return null;
              return (
                <div
                  key={`${couple.id}-tint`}
                  data-couple={couple.id}
                  className={`couple-tint${couple.kind === "married" ? " is-married" : ""}`}
                  style={{ left: geom.tint.left, top: geom.tint.top, width: geom.tint.width, height: geom.tint.height }}
                />
              );
            })
          : null}

        {near || personal
          ? sky.cards.filter((card) => (personal || shown.has(card.unitId) || card.id === carried?.id) && lensDraws(card.id)).map((card) => {
              const connected = Boolean(linked?.has(card.id));
              const selected = card.id === highlightedId;
              const dim = Boolean(linked && !connected) && !lensOn;
              const mark = lensOn ? lens?.marks[card.id] : undefined;
              const withheld = mark?.details === "withheld";
              const photo = withheld ? undefined : card.person.photo;
              const age = withheld ? undefined : ageLabel(card.person.birthDate);
              const at = shownPoint(card);
              const lifted = carried?.id === card.id;
              const sliding = !lifted && placing?.id === card.id;
              const lensClass = mark?.draw === "ghost" ? " is-lens-ghost" : mark?.presence === "dimmed" ? " is-lens-dim" : "";
              return (
                <button
                  key={card.id}
                  type="button"
                  data-person-id={card.id}
                  data-ring={rings.get(card.id)}
                  data-lens={mark?.effect}
                  data-draw={mark?.draw}
                  data-details={mark?.details}
                  className={`portrait-card${photo ? " has-photo" : ""}${selected || connected ? " is-active" : ""}${dim ? " is-dim" : ""}${lensClass}${editMode && !lensOn ? " is-movable" : ""}${lifted ? " is-carried" : ""}${sliding ? " is-placing" : ""}`}
                  style={{ left: at.x - CARD.w / 2, top: at.y, width: CARD.w, height: CARD.h }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (lensOn) {
                      lens?.onPerson(card.id);
                      return;
                    }
                    tapCard(card.person);
                  }}
                  {...(lensOn ? {} : interaction.bindPerson(card.id))}
                  aria-pressed={lensOn ? undefined : selected}
                >
                  {photo ? (
                    <img className="portrait-photo" src={photo} alt="" />
                  ) : (
                    <GeneratedAvatar person={card.person} className="swatch" />
                  )}
                  <span className="identity">
                    <strong title={displayName(card.person)}>{card.person.givenName || displayName(card.person)}</strong>
                    {withheld ? null : <em>{age ?? "—"}</em>}
                  </span>
                </button>
              );
            })
          : null}

        {mid && !personal
          ? sky.cards.filter((card) => shown.has(card.unitId) && lensDraws(card.id)).map((card) => {
              const mark = lensOn ? lens?.marks[card.id] : undefined;
              const withheld = mark?.details === "withheld";
              const photo = withheld ? undefined : card.person.photo;
              const dim = Boolean(linked && !linked.has(card.id)) && !lensOn;
              const lensClass = mark?.draw === "ghost" ? " is-lens-ghost" : mark?.presence === "dimmed" ? " is-lens-dim" : "";
              return (
                <button
                  key={card.id}
                  type="button"
                  data-person-id={card.id}
                  data-lens={mark?.effect}
                  data-draw={mark?.draw}
                  data-details={mark?.details}
                  className={`sky-avatar${dim ? " is-dim" : ""}${lensClass}${card.id === highlightedId && !lensOn ? " is-active" : ""}`}
                  style={{ left: card.x - AVATAR_R, top: card.y + CARD.h / 2 - AVATAR_R, width: AVATAR_R * 2, height: AVATAR_R * 2 }}
                  aria-label={lensOn ? displayName(card.person) : `${displayName(card.person)}. Zoom in`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (lensOn) {
                      lens?.onPerson(card.id);
                      return;
                    }
                    if (suppressTap.current) {
                      suppressTap.current = false;
                      interaction.dropSwallow();
                      return;
                    }
                    interaction.selectOnly(card.id);
                    zoomToPerson(card.id);
                  }}
                  {...(lensOn ? {} : interaction.bindPerson(card.id))}
                >
                  {photo ? (
                    <img src={photo} alt="" />
                  ) : (
                    <GeneratedAvatar person={card.person} />
                  )}
                  <em>{card.person.givenName}</em>
                </button>
              );
            })
          : null}

        {near && editMode && onLink
          ? sky.cards
              .filter((card) => shown.has(card.unitId) && card.id !== carried?.id)
              .flatMap((card) => {
                const ports: { port: Port; side?: "left" | "right"; label: string }[] = [
                  { port: "parent", label: `Link a parent of ${card.person.givenName}` },
                  { port: "partner", side: "left", label: `Link a partner of ${card.person.givenName}` },
                  { port: "partner", side: "right", label: `Link a partner of ${card.person.givenName}` },
                  { port: "child", label: `Link a child of ${card.person.givenName}` },
                ];
                return ports.map((item) => {
                  const at = shownPoint(card);
                  const pt = portPoint(at.x, at.y, item.port, item.side);
                  return (
                    <button
                      key={`${card.id}-${item.port}-${item.side ?? "c"}`}
                      type="button"
                      className={`graph-port sky-port is-${item.port}`}
                      data-person-id={card.id}
                      data-port={item.port}
                      data-side={item.side}
                      aria-label={item.label}
                      style={{ left: pt.x, top: pt.y }}
                    />
                  );
                });
              })
          : null}

        {unlinkArmed && (near || personal) && lineFilterAllowsCouples(lineFilter)
          ? sky.couples.filter((c) => c.bar && (personal || shown.has(c.unitId)) && c.partnerIds.every((id) => lensShows(id))).map((couple) => {
              const mark = coupleUnlinkMark(couple.partnerIds);
              const geom = coupleBarGeometry(
                couple.partnerIds.map((id) => cardOf.get(id)).filter((card): card is NonNullable<typeof card> => Boolean(card)),
                couple.partnerIds,
                couple.cy,
              );
              if (!mark || !geom?.showBar) return null;
              const [a, b] = mark.partnerIds.map((id) => tree.people.find((person) => person.id === id));
              return (
                <button
                  key={`${couple.id}-unlink`}
                  type="button"
                  className="sky-unlink"
                  data-couple={couple.id}
                  data-mark="couple"
                  data-partners={mark.partnerIds.join(" ")}
                  aria-label={`Unlink ${displayName(a ?? { givenName: "this couple", id: "", createdAt: "", updatedAt: "" })} and ${displayName(b ?? { givenName: "them", id: "", createdAt: "", updatedAt: "" })}`}
                  style={{ left: geom.unlink.left, top: geom.unlink.top }}
                  onClick={(event) => {
                    event.stopPropagation();
                    releaseUnlink(mark);
                  }}
                />
              );
            })
          : null}

        <SkyLabels
          ref={labelsRef}
          sky={labelSky}
          focusUnit={focusUnit}
          branchTouch={lensOn && lens?.phase !== "working"}
          onPick={(bucket) => {
            if (lensOn && lens?.phase !== "working") {
              const root = bucket.headIds[0];
              if (root) lens?.onBranch(root);
              return;
            }
            if (!suppressTap.current) zoomToBucket(bucket);
          }}
        />
      </div>

      {far && peopleCount > 0 && !editMode && !personal ? <p className="sky-hint">Tap a family to zoom in</p> : null}
      {lensOn ? <p className="graph-edit-hint sky-edit-hint lens-hint">{lens?.caption}</p> : null}
      {editMode && !lensOn ? (
        <p className="graph-edit-hint sky-edit-hint">
          {near
            ? "Drag a person along their row to nudge their place, or into another family to move them. Drag a dot onto someone to link them. Tap a line to remove it."
            : "Zoom in on a family to edit it."}
        </p>
      ) : null}
      {pick ? (
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
            from={tree.people.find((p) => p.id === pick.fromId) ?? { givenName: "This person", id: "", createdAt: "", updatedAt: "" }}
            to={tree.people.find((p) => p.id === pick.toId) ?? { givenName: "them", id: "", createdAt: "", updatedAt: "" }}
            onPick={async (role, kind, parentRole, kin) => {
              await onLink?.(pick.fromId, pick.toId, role, kind, parentRole, kin);
              setPick(null);
            }}
            onCancel={() => setPick(null)}
          />
        </div>
      ) : null}

      <div className="graph-zoom" role="group" aria-label="Zoom">
        <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>+</button>
        <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>−</button>
        <button
          type="button"
          className="icon-btn"
          aria-label="All families"
          onClick={() => {
            if (personal) {
              refitAfter.current = true;
              interaction.clear();
              return;
            }
            fitAll(true);
          }}
        >
          ⌂
        </button>
      </div>
      {interaction.menu}
    </div>
  );
}

type LabelsHandle = { update: (cam: Camera, level: ZoomLevel, vw: number) => void; reset: () => void; nudge: () => void };

type LabelsProps = { sky: FamilySkyLayout; focusUnit?: string; branchTouch?: boolean; onPick: (bucket: SkyBucket) => void };

const EDGE = 8;

/**
 * Bucket labels, kept in their own component so that re-picking which labels
 * fit (as the zoom changes) re-renders only the labels, not the whole sky.
 * A label whose family is on screen but would run off the left or right edge
 * is nudged back inside (through a CSS variable, without a re-render).
 */
const SkyLabels = forwardRef<LabelsHandle, LabelsProps>(function SkyLabels({ sky, focusUnit, branchTouch = false, onPick }, ref) {
  const [state, setState] = useState<{ level: ZoomLevel; ids: string[] }>({ level: "far", ids: [] });
  const last = useRef<{ s: number; level: ZoomLevel; key: string } | null>(null);
  const focusRef = useRef(focusUnit);
  focusRef.current = focusUnit;
  const els = useRef(new Map<string, HTMLButtonElement>());
  const widths = useRef(new Map<string, number>());
  const lastCam = useRef<{ cam: Camera; vw: number } | null>(null);
  const skyRef = useRef(sky);
  skyRef.current = sky;

  function nudge() {
    const seen = lastCam.current;
    if (!seen) return;
    const { cam, vw } = seen;
    const level = last.current?.level ?? "far";
    for (const [id, el] of els.current) {
      const bucket = skyRef.current.buckets.find((b) => b.id === id);
      const w = widths.current.get(id);
      if (!bucket || w === undefined) continue;
      const at = labelAnchor(bucket, level);
      // During a glide the label's left is the moving anchor; otherwise it matches `at`.
      const worldX = el.style.left ? parseFloat(el.style.left) : at.x;
      const sx = cam.x + worldX * cam.s;
      // On screen: nudge inside the edges. Off screen: hide, rather than show a clipped stub.
      let dx = 0;
      const onScreen = sx > 0 && sx < vw;
      if (onScreen) {
        if (sx - w / 2 < EDGE) dx = EDGE - (sx - w / 2);
        else if (sx + w / 2 > vw - EDGE) dx = vw - EDGE - (sx + w / 2);
      }
      el.style.setProperty("--nudge", `${Math.round(dx)}px`);
      el.style.visibility = onScreen ? "" : "hidden";
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      update(cam, level, vw) {
        lastCam.current = { cam, vw };
        const prev = last.current;
        if (!(prev && prev.level === level && Math.abs(Math.log(cam.s / prev.s)) < 0.12)) {
          const ids = legibleLabels(sky, cam.s, level, focusRef.current);
          const key = `${level}:${ids.join("|")}`;
          last.current = { s: cam.s, level, key };
          if (key !== prev?.key) setState({ level, ids });
        }
        nudge();
      },
      reset() {
        last.current = null;
      },
      nudge,
    }),
    [sky],
  );
  // Measure each label once it renders (its on-screen width does not change with zoom).
  useLayoutEffect(() => {
    widths.current.clear();
    for (const [id, el] of els.current) widths.current.set(id, el.offsetWidth);
    nudge();
  });
  const byId = new Map(sky.buckets.map((b) => [b.id, b]));
  return (
    <>
      {state.ids.map((id) => {
        const bucket = byId.get(id);
        if (!bucket) return null;
        const at = labelAnchor(bucket, state.level);
        return (
          <button
            key={`${bucket.id}-label`}
            ref={(el) => {
              if (el) els.current.set(bucket.id, el);
              else els.current.delete(bucket.id);
            }}
            type="button"
            className={`sky-label${bucket.id === focusUnit ? " is-lit" : ""}`}
            data-unit-id={bucket.id}
            data-branch-root={bucket.headIds[0]}
            data-level={state.level}
            style={{ left: at.x, top: at.y }}
            aria-label={branchTouch
              ? `${bucket.label} branch. Include, hide, or dim`
              : `${bucket.label} family, ${bucket.memberIds.length} ${bucket.memberIds.length === 1 ? "person" : "people"}. Zoom in`}
            onClick={(event) => {
              event.stopPropagation();
              onPick(bucket);
            }}
          >
            {bucket.label}
            {state.level === "far" ? <small>{bucket.memberIds.length}</small> : null}
          </button>
        );
      })}
    </>
  );
});
