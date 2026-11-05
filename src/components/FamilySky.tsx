"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { KinKind, LinkRole, ParentRole, Person, TreeData, UnionKind } from "@/lib/types";
import { displayName, kinKindLabel } from "@/lib/types";
import { CARD, ageLabel, initialsOf, lineageIds, swatchHue } from "@/lib/layout";
import { centerTransform, fitContentScale, superellipsePath, type Camera } from "@/lib/graphView";
import { skyFromPersonalMap } from "@/lib/familySkyFocus";
import { PERSONAL_MAP_MS, layoutPersonalMap, type PersonalMap } from "@/lib/personalMap";
import { DEFAULT_LINE_FILTER, lineFilterAllows, lineFilterAllowsCouples, type LineFilter } from "@/lib/kinFilter";
import {
  SKY_ZOOM,
  bucketAt,
  bucketBox,
  cameraToFit,
  layoutFamilySky,
  morphSky,
  overviewZoom,
  visibleBuckets,
  labelAnchor,
  legibleLabels,
  skyBounds,
  skyMinScale,
  zoomLevel,
  type Box,
  type Curve,
  type FamilySky as FamilySkyLayout,
  type SkyBucket,
  type ZoomLevel,
} from "@/lib/familySky";
import { routePersonLink } from "@/lib/familySkyRoute";
import type { UnitLinkKind } from "@/lib/familyUnits";
import { LinkRolePicker } from "./LinkRolePicker";

type Props = {
  tree: TreeData;
  highlightedId?: string;
  onHighlight: (person?: Person) => void;
  onOpen: (person: Person) => void;
  fitKey?: string | number | boolean;
  lineFilter?: LineFilter;
  /** While true (say, a sheet covers the sky), keep showing the last layout; the change glides in afterwards. */
  hold?: boolean;
  /** Edit in place: drag a dot onto someone to link them, drag a person into another family to move them. */
  editMode?: boolean;
  onLink?: (personId: string, otherId: string, role: LinkRole, kind?: UnionKind, parentRole?: ParentRole, kin?: KinKind) => void | Promise<void>;
  /** Move a person into the family unit rooted at `unitRootId`. */
  onMoveToUnit?: (personId: string, unitRootId: string) => void | Promise<void>;
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

/** One SVG path for a link's visible pieces (it breaks wherever it would pass under a card). */
function piecesPath(pieces: Curve[]) {
  return pieces.map((q) => `M ${q.x1} ${q.y1} Q ${q.cx} ${q.cy} ${q.x2} ${q.y2}`).join(" ");
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
  onMoveToUnit,
}: Props) {
  // The sky is a pure function of the tree. A selected person (outside edit mode)
  // gathers that same sky into their personal map; `from` is only the previous picture.
  const baseSky = useMemo(() => layoutFamilySky(tree, routePersonLink), [tree]);
  const personal = useMemo(
    () => (editMode || !highlightedId ? null : layoutPersonalMap(tree, highlightedId)),
    [editMode, highlightedId, tree],
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
  // 0 → 1 while the sky glides from the previous layout to this one.
  const [morphK, setMorphK] = useState(1);
  const morphFrom = laid?.from;
  const view = useMemo(
    () => (morphFrom && morphK < 1 ? morphSky(morphFrom, sky, easeInOut(morphK)) : sky),
    [morphFrom, sky, morphK],
  );
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

  const morphRaf = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!laid?.from) return;
    const glideMs = laid.personal || laid.fromPersonal ? PERSONAL_MAP_MS : MORPH_MS;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMorphK(1);
      return;
    }
    // Keep the old world where it was on screen, then glide to the new one.
    const v = viewRef.current;
    viewRef.current = { ...v, x: v.x - sky.shift.x * v.s, y: v.y - sky.shift.y * v.s };
    applyWorld();
    if (morphRaf.current != null) window.cancelAnimationFrame(morphRaf.current);
    const start = performance.now();
    setMorphK(0);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / glideMs);
      setMorphK(t);
      morphRaf.current = t < 1 ? window.requestAnimationFrame(step) : null;
    };
    morphRaf.current = window.requestAnimationFrame(step);
    return () => {
      if (morphRaf.current != null) window.cancelAnimationFrame(morphRaf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laid]);

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

  /** Edit mode, close up: start a wire from a dot, or pick up a person. Returns true when handled. */
  function editPointerDown(event: PointerEvent<HTMLDivElement>, target: HTMLElement) {
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
    if (cardEl && onMoveToUnit) {
      const id = cardEl.dataset.personId;
      const card = id ? cardOf.get(id) : undefined;
      if (!id || !card) return false;
      stageRef.current?.setPointerCapture(event.pointerId);
      const pt = worldPoint(event.clientX, event.clientY);
      carry.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: pt.x - card.x, dy: pt.y - card.y };
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

  function editPointerMove(event: PointerEvent<HTMLDivElement>) {
    const c = carry.current;
    const mine = (connect.current && connect.current.pointerId === event.pointerId) || (c && c.pointerId === event.pointerId);
    if (!mine) return false;
    if (c && !suppressTap.current && Math.abs(event.clientX - c.x) + Math.abs(event.clientY - c.y) < 6) return true;
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
    const c = carry.current;
    if (c && c.pointerId === event.pointerId) {
      carry.current = null;
      const dropped = carried;
      setCarried(null);
      if (!dropped && !suppressTap.current && event.type !== "pointercancel") {
        // Not carried anywhere: an ordinary tap on the card.
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
    const target = event.target as HTMLElement;
    if (editPointerDown(event, target)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      return;
    }
    stopTween();
    if (pointers.current.size === 0) suppressTap.current = false;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      drag.current = null;
      suppressTap.current = true;
      stageRef.current?.setPointerCapture(event.pointerId);
      const pts = [...pointers.current.values()];
      const a = stagePoint(pts[0].x, pts[0].y);
      const b = stagePoint(pts[1].x, pts[1].y);
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      pinch.current = dist < 8 ? null : { ...viewRef.current, dist, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      return;
    }
    if (target.closest(".graph-zoom")) return;
    // Capturing on a button would retarget its click to the stage.
    if (!target.closest(".portrait-card, .sky-avatar, .sky-label")) stageRef.current?.setPointerCapture(event.pointerId);
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
    else onHighlight(undefined);
  }

  function tapCard(person: Person) {
    if (suppressTap.current) return;
    if (highlightedId === person.id) onOpen(person);
    else onHighlight(person);
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
  const near = level === "near";
  const mid = level === "mid";
  const far = level === "far";
  const peopleCount = tree.people.length;

  const viewCardOf = view === sky ? cardOf : new Map(view.cards.map((c) => [c.id, c]));

  return (
    <div
      ref={stageRef}
      className={`graph-stage family-sky is-${level}${editMode ? " is-editing" : ""}${personal ? " is-personal" : ""}`}
      aria-label={`Family sky, ${personal ? sky.units.units.length : view.buckets.length} families, ${level === "far" ? "overview" : level === "mid" ? "families" : "people"}`}
      data-level={level}
      data-layout={personal ? "personal" : "sky"}
      data-animating={morphK < 1 ? "true" : "false"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div ref={worldRef} className="graph-world sky-world" style={{ width: view.width, height: view.height }}>
        <svg className="graph-lines" width={view.width} height={view.height} aria-hidden>
          <defs>
            <radialGradient id="sky-glow">
              <stop offset="0%" className="sky-glow-core" />
              <stop offset="28%" className="sky-glow-mid" />
              <stop offset="100%" className="sky-glow-edge" />
            </radialGradient>
          </defs>

          {far
            ? view.unitEdges.map((edge) => {
                const kind = edge.kinds.find((k) => allows(lineFilter, k));
                if (!kind) return null;
                return (
                  <line
                    key={edge.id}
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
            ? view.buckets.map((bucket) => {
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
            ? [...view.links]
                .map((link) => ({ link, lit: Boolean(linked && linked.has(link.fromPersonId) && linked.has(link.toPersonId)) }))
                .sort((a, b) => Number(a.lit) - Number(b.lit))
                .map(({ link, lit }) => {
                  if (!allows(lineFilter, link.kind)) return null;
                  const w = linkStyle(link.kind, lit);
                  return (
                    <path
                      key={link.id}
                      className={`sky-link is-${link.kind}${lit ? " is-lit" : ""}`}
                      data-from={link.fromPersonId}
                      data-to={link.toPersonId}
                      d={piecesPath(near ? link.pieces : link.midPieces)}
                      strokeWidth={w.width}
                      strokeOpacity={w.opacity}
                      strokeDasharray={DASH[link.kind]}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })
            : null}

          {far && !personal
            ? view.buckets.map((bucket) => (
                <g key={`${bucket.id}-glow`} data-unit-id={bucket.id} data-members={bucket.memberIds.join(" ")} className={`sky-star${bucket.id === focusUnit ? " is-lit" : ""}`}>
                  <circle cx={bucket.cx} cy={bucket.cy} r={bucket.glow} fill="url(#sky-glow)" />
                  <circle className="sky-star-core" cx={bucket.cx} cy={bucket.cy} r={bucket.glow * 0.16} />
                </g>
              ))
            : null}

          {near || personal
            ? view.forks.filter((fork) => personal || shown.has(fork.unitId)).map((fork) => {
                const parents = fork.parentDrops.filter((d) => lineFilterAllows(lineFilter, d.kin));
                const kids = fork.childDrops.filter((d) => lineFilterAllows(lineFilter, d.kin));
                if (!parents.length || !kids.length) return null;
                const lit = Boolean(
                  linked && (parents.some((d) => linked.has(d.parentId)) || kids.some((d) => linked.has(d.childId))),
                );
                const stemX = parents.reduce((s, d) => s + d.x, 0) / parents.length;
                const joinL = Math.min(...parents.map((d) => d.x));
                const joinR = Math.max(...parents.map((d) => d.x));
                const railL = Math.min(...kids.map((d) => d.x), stemX);
                const railR = Math.max(...kids.map((d) => d.x), stemX);
                const forkKin = kids.every((d) => d.kin === kids[0].kin) ? kids[0].kin : fork.kin;
                const bar = kinLine(forkKin, lit, fork.dotted && forkKin === "blood");
                const seg = (key: string, x1: number, y1: number, x2: number, y2: number, w = bar) => (
                  <line
                    key={key}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="var(--graph-kin)"
                    strokeWidth={w.width}
                    strokeOpacity={w.opacity}
                    strokeDasharray={w.dash}
                    strokeLinecap="round"
                  />
                );
                return (
                  <g key={fork.id} className="graph-fork">
                    {parents.map((d) => seg(`p-${d.parentId}`, d.x, d.y0, d.x, fork.joinY, kinLine(d.kin, lit, fork.dotted && d.kin === "blood")))}
                    {joinR - joinL > 6 ? seg("join", joinL, fork.joinY, joinR, fork.joinY) : null}
                    {seg("stem", stemX, fork.joinY, stemX, fork.railY)}
                    {forkKin !== "blood" ? (
                      <text className="graph-kin-label" x={stemX} y={(fork.joinY + fork.railY) / 2} textAnchor="middle" fill="var(--graph-kin)" fillOpacity={0.55} fontSize="11">
                        {kinKindLabel(forkKin)}
                      </text>
                    ) : null}
                    {railR - railL > 6 ? seg("rail", railL, fork.railY, railR, fork.railY) : null}
                    {kids.map((d) => seg(`c-${d.childId}`, d.x, fork.railY, d.x, d.y1, kinLine(d.kin, lit, false)))}
                  </g>
                );
              })
            : null}

          {(near || personal) && lineFilterAllowsCouples(lineFilter)
            ? view.couples.filter((c) => c.bar && (personal || shown.has(c.unitId))).map((couple) => {
                const pair = couple.partnerIds.map((id) => viewCardOf.get(id)).filter(Boolean) as typeof view.cards;
                if (pair.length < 2) return null;
                const [l, r] = pair[0].x < pair[1].x ? [pair[0], pair[1]] : [pair[1], pair[0]];
                const x1 = l.x + CARD.w / 2 + 1;
                const x2 = r.x - CARD.w / 2 - 1;
                if (x2 <= x1) return null;
                const lit = Boolean(linked && couple.partnerIds.every((id) => linked.has(id)));
                return (
                  <line
                    key={couple.id}
                    data-partners={couple.partnerIds.join(" ")}
                    x1={x1}
                    y1={couple.cy}
                    x2={x2}
                    y2={couple.cy}
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
          ? view.couples.filter((c) => c.bar && (personal || shown.has(c.unitId))).map((couple) => {
              const pair = couple.partnerIds.map((id) => viewCardOf.get(id)).filter(Boolean) as typeof view.cards;
              if (pair.length < 2) return null;
              const minX = Math.min(...pair.map((p) => p.x)) - CARD.w / 2 - 10;
              const maxX = Math.max(...pair.map((p) => p.x)) + CARD.w / 2 + 10;
              const top = Math.min(...pair.map((p) => p.y)) - 10;
              return (
                <div
                  key={`${couple.id}-tint`}
                  className={`couple-tint${couple.kind === "married" ? " is-married" : ""}`}
                  style={{ left: minX, top, width: maxX - minX, height: CARD.h + 20 }}
                />
              );
            })
          : null}

        {near || personal
          ? view.cards.filter((card) => personal || shown.has(card.unitId) || card.id === carried?.id).map((card) => {
              const connected = Boolean(linked?.has(card.id));
              const selected = card.id === highlightedId;
              const dim = Boolean(linked && !connected);
              const photo = card.person.photo;
              const age = ageLabel(card.person.birthDate);
              const lifted = carried?.id === card.id ? carried : undefined;
              return (
                <button
                  key={card.id}
                  type="button"
                  data-person-id={card.id}
                  data-ring={rings.get(card.id)}
                  className={`portrait-card${photo ? " has-photo" : ""}${selected || connected ? " is-active" : ""}${dim ? " is-dim" : ""}${editMode ? " is-movable" : ""}${lifted ? " is-carried" : ""}`}
                  style={{ left: (lifted?.x ?? card.x) - CARD.w / 2, top: lifted?.y ?? card.y, width: CARD.w, height: CARD.h }}
                  onClick={(event) => {
                    event.stopPropagation();
                    tapCard(card.person);
                  }}
                  aria-pressed={selected}
                >
                  {photo ? (
                    <img className="portrait-photo" src={photo} alt="" />
                  ) : (
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
            })
          : null}

        {mid && !personal
          ? view.cards.filter((card) => shown.has(card.unitId)).map((card) => {
              const photo = card.person.photo;
              const dim = Boolean(linked && !linked.has(card.id));
              return (
                <button
                  key={card.id}
                  type="button"
                  data-person-id={card.id}
                  className={`sky-avatar${dim ? " is-dim" : ""}${card.id === highlightedId ? " is-active" : ""}`}
                  style={{ left: card.x - AVATAR_R, top: card.y + CARD.h / 2 - AVATAR_R, width: AVATAR_R * 2, height: AVATAR_R * 2 }}
                  aria-label={`${displayName(card.person)}. Zoom in`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (suppressTap.current) return;
                    onHighlight(card.person);
                    zoomToPerson(card.id);
                  }}
                >
                  {photo ? (
                    <img src={photo} alt="" />
                  ) : (
                    <span style={{ ["--swatch-hue" as string]: String(swatchHue(card.person)) }}>{initialsOf(card.person)}</span>
                  )}
                  <em>{card.person.givenName}</em>
                </button>
              );
            })
          : null}

        {near && editMode && onLink
          ? view.cards
              .filter((card) => shown.has(card.unitId) && card.id !== carried?.id)
              .flatMap((card) => {
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

        <SkyLabels
          ref={labelsRef}
          sky={view}
          focusUnit={focusUnit}
          onPick={(bucket) => {
            if (!suppressTap.current) zoomToBucket(bucket);
          }}
        />
      </div>

      {far && peopleCount > 0 && !editMode && !personal ? <p className="sky-hint">Tap a family to zoom in</p> : null}
      {editMode ? (
        <p className="graph-edit-hint sky-edit-hint">
          {near
            ? "Drag a dot onto someone to link them. Drag a person to another family to move them."
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
              onHighlight(undefined);
              return;
            }
            fitAll(true);
          }}
        >
          ⌂
        </button>
      </div>
    </div>
  );
}

type LabelsHandle = { update: (cam: Camera, level: ZoomLevel, vw: number) => void; reset: () => void };

type LabelsProps = { sky: FamilySkyLayout; focusUnit?: string; onPick: (bucket: SkyBucket) => void };

const EDGE = 8;

/**
 * Bucket labels, kept in their own component so that re-picking which labels
 * fit (as the zoom changes) re-renders only the labels, not the whole sky.
 * A label whose family is on screen but would run off the left or right edge
 * is nudged back inside (through a CSS variable, without a re-render).
 */
const SkyLabels = forwardRef<LabelsHandle, LabelsProps>(function SkyLabels({ sky, focusUnit, onPick }, ref) {
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
      const sx = cam.x + at.x * cam.s;
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
            style={{ left: at.x, top: at.y }}
            aria-label={`${bucket.label} family, ${bucket.memberIds.length} ${bucket.memberIds.length === 1 ? "person" : "people"}. Zoom in`}
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
