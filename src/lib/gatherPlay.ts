import { CARD } from "./layout";
import {
  frameAt,
  gatherCameraAt,
  trackPose,
  type GatherCamera,
  type GatherChoreography,
  type GatherFrame,
  type GatherRole,
  type GatherTrack,
} from "./gatherChoreography";

/**
 * Play a gather plan on the compositor.
 *
 * Cards, the lines layer, the ripple, and the camera each get one Web
 * Animation of transform and opacity. Nothing samples layout per frame, and
 * React does not re-render the tree to move it. `paint` only starts a clip
 * that a render replaced.
 */

const ACTORS = ".portrait-card[data-person-id]:not(.is-carried):not(.is-placing), .sky-avatar[data-person-id]";
const FADE = ".couple-tint, .partner-status, .sky-label";
const CARD_CLIP = "gather-card";
const LINES_CLIP = "gather-lines";
const FADE_CLIP = "gather-fade";
const GLOW_CLIP = "gather-glow";
const RIPPLE_CLIP = "gather-ripple";
const CAMERA_CLIP = "gather-camera";

const Z: Record<GatherRole, number> = {
  focus: 6,
  partner: 5,
  child: 4,
  parent: 4,
  other: 3,
  dim: 1,
};

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type GatherSession = {
  plan: GatherChoreography;
  started: number;
  phase: "lines-out" | "flight";
  stop: () => void;
  sample: () => GatherFrame;
  paint: () => void;
};

function px(n: number) {
  return (Math.round(n * 100) / 100).toString();
}

function cancelClip(el: Element, id: string) {
  for (const anim of el.getAnimations()) {
    if (anim.id === id) anim.cancel();
  }
}

function playing(el: Element, id: string) {
  return el.getAnimations().some((anim) => anim.id === id && anim.playState !== "finished");
}

function playClip(el: Element, frames: Keyframe[], duration: number, elapsed: number, id: string) {
  if (playing(el, id) || duration <= 0 || frames.length === 0) return;
  cancelClip(el, id);
  const anim = el.animate(frames, { duration, easing: "linear", fill: "both" });
  anim.id = id;
  const time = Math.min(Math.max(0, elapsed), duration);
  if (time > 0) anim.currentTime = time;
}

function cancelGatherClips(root: ParentNode) {
  const nodes = root instanceof Element ? [root, ...root.querySelectorAll("*")] : [...root.querySelectorAll("*")];
  for (const node of nodes) {
    for (const anim of node.getAnimations()) {
      if (anim.id.startsWith("gather-") && anim.id !== CAMERA_CLIP) anim.cancel();
    }
  }
}

function cardFrames(track: GatherTrack, direction: GatherChoreography["direction"]) {
  const steps = 8;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const travel = i / steps;
    const pose = trackPose(track, travel, direction);
    frames.push({
      offset: travel,
      transform: `translate(${px(pose.x - track.toX)}px, ${px(pose.y - track.toY)}px) scale(${px(pose.scale)})`,
      opacity: pose.opacity,
    });
  }
  return frames;
}

function lineFrames(plan: GatherChoreography, focusId: string) {
  const focus = plan.tracks.find((track) => track.id === focusId);
  const from = { x: focus?.fromX ?? 0, y: (focus?.fromY ?? 0) + CARD.h / 2 };
  const to = { x: focus?.toX ?? from.x, y: (focus?.toY ?? from.y - CARD.h / 2) + CARD.h / 2 };
  const steps = 10;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const frame = frameAt(plan, (i / steps) * plan.duration);
    const incoming = frame.phase === "lines-in" || frame.phase === "settled" || (frame.phase === "crossfade" && frame.lineDraw >= 0.5);
    const origin = incoming ? to : from;
    const scale = plan.reduced ? 1 : 1 - 0.16 * frame.lineHide;
    frames.push({
      offset: i / steps,
      opacity: 1 - frame.lineHide,
      transform: `translate(${px(origin.x)}px, ${px(origin.y)}px) scale(${px(scale)}) translate(${px(-origin.x)}px, ${px(-origin.y)}px)`,
    });
  }
  return frames;
}

function fadeFrames(plan: GatherChoreography) {
  const steps = 10;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const frame = frameAt(plan, (i / steps) * plan.duration);
    frames.push({ offset: i / steps, opacity: 1 - frame.lineHide });
  }
  return frames;
}

function glowFrames(plan: GatherChoreography, focusId: string, kind: "glow" | "ripple") {
  const steps = 12;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const frame = frameAt(plan, (i / steps) * plan.duration);
    const pose = frame.people.find((person) => person.id === focusId);
    const cx = pose?.x ?? 0;
    const cy = (pose?.y ?? 0) + CARD.h / 2;
    const opacity = kind === "glow" ? frame.glow * 0.9 : Math.max(0, (1 - frame.ripple) * frame.glow * 0.8);
    const scale = kind === "glow" ? 0.65 + frame.glow * 0.45 : 0.35 + frame.ripple * 2.15;
    frames.push({
      offset: i / steps,
      opacity,
      transform: `translate(${px(cx)}px, ${cy === 0 ? "0" : px(cy)}px) scale(${px(scale)})`,
    });
  }
  return frames;
}

function armLineMode(stage: HTMLElement, plan: GatherChoreography, started: number) {
  const elapsed = () => performance.now() - started;
  const apply = () => {
    if (stage.dataset.lines === "shown") return;
    const t = elapsed();
    if (t >= plan.duration) return;
    if (t >= plan.travelEnd) stage.dataset.lines = "in";
    else if (t >= plan.travelStart) stage.dataset.lines = "hidden";
    else stage.dataset.lines = plan.reduced ? "hidden" : "out";
  };
  apply();
  const timers: number[] = [];
  const at = (when: number) => {
    const wait = when - elapsed();
    if (wait <= 0) return;
    timers.push(window.setTimeout(apply, wait));
  };
  at(plan.travelStart);
  at(plan.travelEnd);
  return () => {
    for (const timer of timers) window.clearTimeout(timer);
  };
}

export function clearGatherPaint(stage: HTMLElement, world: HTMLElement) {
  stage.classList.remove("is-gathering");
  stage.dataset.lines = "shown";
  cancelGatherClips(world);
  for (const el of world.querySelectorAll<HTMLElement>(ACTORS)) {
    el.style.transform = "";
    el.style.opacity = "";
    el.style.zIndex = "";
    el.style.willChange = "";
  }
  for (const el of world.querySelectorAll<HTMLElement>("[data-gather-glow], [data-gather-ripple]")) {
    el.style.opacity = "";
    el.style.transform = "";
  }
}

function bindPaint(
  phase: GatherSession["phase"],
  plan: GatherChoreography,
  started: number,
  stage: HTMLElement,
  world: HTMLElement,
  focusId: string,
) {
  let stopped = false;
  const clearModes = armLineMode(stage, plan, started);
  const lineFramesCached = lineFrames(plan, focusId);
  const fadeCached = fadeFrames(plan);
  const glowCached = glowFrames(plan, focusId, "glow");
  const rippleCached = glowFrames(plan, focusId, "ripple");
  const cards = new Map(plan.tracks.map((track) => [track.id, cardFrames(track, plan.direction)]));

  const paint = () => {
    if (stopped) return;
    const elapsed = performance.now() - started;
    stage.classList.add("is-gathering");
    const svg = world.querySelector("svg.graph-lines");
    if (svg) playClip(svg, lineFramesCached, plan.duration, elapsed, LINES_CLIP);
    for (const el of world.querySelectorAll(FADE)) playClip(el, fadeCached, plan.duration, elapsed, FADE_CLIP);
    const glow = world.querySelector("[data-gather-glow]");
    const ripple = world.querySelector("[data-gather-ripple]");
    if (glow) playClip(glow, glowCached, plan.duration, elapsed, GLOW_CLIP);
    if (ripple) playClip(ripple, rippleCached, plan.duration, elapsed, RIPPLE_CLIP);
    if (phase !== "flight") return;
    for (const el of world.querySelectorAll<HTMLElement>(ACTORS)) {
      const id = el.dataset.personId ?? "";
      const frames = cards.get(id);
      const track = plan.tracks.find((item) => item.id === id);
      if (!frames || !track || playing(el, CARD_CLIP)) continue;
      const startAt = plan.travelStart + track.delay;
      const local = elapsed - startAt;
      if (local >= track.duration) continue;
      el.style.zIndex = String(Z[track.role]);
      const delay = local < 0 ? -local : 0;
      cancelClip(el, CARD_CLIP);
      const anim = el.animate(frames, { duration: track.duration, delay, easing: "linear", fill: "both" });
      anim.id = CARD_CLIP;
      if (local > 0) anim.currentTime = local;
    }
  };

  return {
    paint,
    stop() {
      stopped = true;
      clearModes();
      cancelGatherClips(world);
    },
    stopped: () => stopped,
  };
}

/** Retract the lines that are on screen. Calls `onCommit` when travel should begin. */
export function runLinesOut(opts: {
  stage: HTMLElement;
  world: HTMLElement;
  plan: GatherChoreography;
  focusId: string;
  onCommit: () => void;
}): GatherSession {
  const started = performance.now();
  const bound = bindPaint("lines-out", opts.plan, started, opts.stage, opts.world, opts.focusId);
  let timer = 0;
  const session: GatherSession = {
    plan: opts.plan,
    started,
    phase: "lines-out",
    stop() {
      bound.stop();
      if (timer) window.clearTimeout(timer);
    },
    sample: () => frameAt(opts.plan, performance.now() - started),
    paint: bound.paint,
  };
  if (opts.plan.linesOutMs <= 0) {
    opts.stage.dataset.lines = "hidden";
    opts.onCommit();
    return session;
  }
  bound.paint();
  timer = window.setTimeout(() => {
    if (bound.stopped()) return;
    opts.stage.dataset.lines = "hidden";
    opts.onCommit();
  }, opts.plan.linesOutMs);
  return session;
}

/** Travel and the line draw-in. The destination layout is already mounted. */
export function runFlight(opts: {
  stage: HTMLElement;
  world: HTMLElement;
  plan: GatherChoreography;
  started: number;
  focusId: string;
  onDone: () => void;
}): GatherSession {
  const bound = bindPaint("flight", opts.plan, opts.started, opts.stage, opts.world, opts.focusId);
  let timer = 0;
  const finish = () => {
    if (bound.stopped()) return;
    clearGatherPaint(opts.stage, opts.world);
    opts.onDone();
  };
  const session: GatherSession = {
    plan: opts.plan,
    started: opts.started,
    phase: "flight",
    stop() {
      bound.stop();
      if (timer) window.clearTimeout(timer);
    },
    sample: () => frameAt(opts.plan, performance.now() - opts.started),
    paint: bound.paint,
  };
  bound.paint();
  const remaining = opts.plan.duration - (performance.now() - opts.started);
  if (remaining <= 0) finish();
  else timer = window.setTimeout(finish, remaining);
  return session;
}

function parseTransform(value: string): GatherCamera | null {
  const match = /matrix\(([^)]+)\)/.exec(value);
  if (!match) return null;
  const parts = match[1].split(",").map((part) => Number(part.trim()));
  if (parts.length < 6 || !parts[0]) return null;
  return { x: parts[4], y: parts[5], s: parts[0] };
}

/** The camera glide, one transform on the world. Returns the view if it was still running. */
export function takeGatherCamera(world: HTMLElement): GatherCamera | null {
  const anim = world.getAnimations().find((item) => item.id === CAMERA_CLIP && item.playState === "running");
  if (!anim) return null;
  const view = parseTransform(getComputedStyle(world).transform);
  anim.cancel();
  return view;
}

export function gatherCameraRunning(world: HTMLElement) {
  return world.getAnimations().some((anim) => anim.id === CAMERA_CLIP && anim.playState === "running");
}

/** Ease the camera on the compositor. `onDone` runs after the transform is released. */
export function playGatherCamera(
  world: HTMLElement,
  from: GatherCamera,
  to: GatherCamera,
  view: { cx: number; cy: number },
  ms: number,
  onDone: () => void,
) {
  for (const anim of world.getAnimations()) {
    if (anim.id === CAMERA_CLIP) anim.cancel();
  }
  if (ms <= 0) {
    onDone();
    return;
  }
  const steps = 12;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const cam = gatherCameraAt(from, to, view, i / steps);
    frames.push({
      offset: i / steps,
      transform: `translate(${px(cam.x)}px, ${px(cam.y)}px) scale(${px(cam.s)})`,
    });
  }
  const anim = world.animate(frames, { duration: ms, easing: "linear", fill: "both" });
  anim.id = CAMERA_CLIP;
  anim.onfinish = () => {
    anim.cancel();
    onDone();
  };
}

/** Zoom and focus glide: the same one-layer clip, from samples chosen up front. */
export function playSkyCamera(
  world: HTMLElement,
  frames: { offset: number; transform: string }[],
  ms: number,
  onDone: () => void,
) {
  for (const anim of world.getAnimations()) {
    if (anim.id === CAMERA_CLIP) anim.cancel();
  }
  if (ms <= 0 || frames.length < 2) {
    onDone();
    return;
  }
  const anim = world.animate(
    frames.map((frame) => ({ offset: frame.offset, transform: frame.transform })),
    { duration: ms, easing: "linear", fill: "both" },
  );
  anim.id = CAMERA_CLIP;
  anim.onfinish = () => {
    anim.cancel();
    onDone();
  };
}
