import { CARD } from "./layout";
import { frameAt, type GatherChoreography, type GatherFrame, type GatherRole } from "./gatherChoreography";

/**
 * Paint one frame of a gather plan onto the world React already committed.
 * Cards move by transform and opacity only. Lines share one opacity and one
 * dash offset on the world, so a frame does not re-render the tree.
 */

const ACTORS = ".portrait-card[data-person-id], .sky-avatar[data-person-id]";

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

function lineMode(frame: GatherFrame) {
  if (frame.done) return "shown";
  if (frame.lineHide > 0.92 && frame.lineDraw < 0.05) return "hidden";
  if (frame.phase === "lines-in" || (frame.phase === "crossfade" && frame.lineDraw > 0.5)) return "in";
  if (frame.lineHide > 0.02) return "out";
  return "out";
}

function applyLines(stage: HTMLElement, world: HTMLElement, frame: GatherFrame) {
  const hide = frame.lineHide;
  world.style.setProperty("--line-opacity", hide >= 1 ? "0" : String(1 - hide));
  world.style.setProperty("--line-off", frame.phase === "lines-in" || frame.lineDraw > 0 ? String(1 - frame.lineDraw) : String(hide));
  stage.dataset.lines = lineMode(frame);
  const svg = world.querySelector("svg.graph-lines");
  if (!(svg instanceof SVGSVGElement)) return;
  if (frame.done) return;
  for (const node of svg.querySelectorAll<SVGGeometryElement>("line, path")) {
    if (node.dataset.gatherSolid || node.classList.contains("graph-hit") || node.classList.contains("graph-wire")) continue;
    if (node.classList.contains("sky-bucket") || node.classList.contains("household-area")) continue;
    if (node.getAttribute("stroke-dasharray")) continue;
    if (node.tagName === "path" && node.getAttribute("fill") !== "none" && !node.classList.contains("sky-link")) continue;
    const len = node.getTotalLength();
    if (!Number.isFinite(len) || len < 1) continue;
    node.dataset.gatherSolid = "1";
    node.style.setProperty("--gather-len", String(Math.ceil(len + 2)));
  }
}

function applyGlow(world: HTMLElement, frame: GatherFrame, focusId: string) {
  const pose = frame.people.find((person) => person.id === focusId);
  const glow = world.querySelector<HTMLElement>("[data-gather-glow]");
  const ripple = world.querySelector<HTMLElement>("[data-gather-ripple]");
  if (!pose || !glow || !ripple) return;
  const cx = pose.x;
  const cy = pose.y + CARD.h / 2;
  glow.style.opacity = String(frame.glow * 0.9);
  glow.style.transform = `translate(${cx}px, ${cy}px) scale(${0.65 + frame.glow * 0.45})`;
  ripple.style.opacity = String(Math.max(0, (1 - frame.ripple) * frame.glow * 0.8));
  ripple.style.transform = `translate(${cx}px, ${cy}px) scale(${0.35 + frame.ripple * 2.15})`;
}

function applyCards(world: HTMLElement, frame: GatherFrame, moving: boolean) {
  const byId = new Map(frame.people.map((person) => [person.id, person]));
  for (const el of world.querySelectorAll<HTMLElement>(ACTORS)) {
    const pose = byId.get(el.dataset.personId ?? "");
    if (!pose) continue;
    if (!moving) {
      el.style.transform = "";
      el.style.opacity = "";
      el.style.zIndex = "";
      continue;
    }
    const dx = pose.x - pose.toX;
    const dy = pose.y - pose.toY;
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${pose.scale})`;
    el.style.opacity = pose.role === "dim" ? String(pose.opacity) : "";
    el.style.zIndex = String(Z[pose.role]);
    el.style.willChange = "transform, opacity";
  }
}

export function clearGatherPaint(stage: HTMLElement, world: HTMLElement) {
  stage.dataset.lines = "shown";
  world.style.removeProperty("--line-opacity");
  world.style.removeProperty("--line-off");
  for (const el of world.querySelectorAll<HTMLElement>(ACTORS)) {
    el.style.transform = "";
    el.style.opacity = "";
    el.style.zIndex = "";
    el.style.willChange = "";
  }
  for (const node of world.querySelectorAll<SVGElement>("[data-gather-solid]")) {
    delete node.dataset.gatherSolid;
    node.style.removeProperty("--gather-len");
  }
  for (const el of world.querySelectorAll<HTMLElement>("[data-gather-glow], [data-gather-ripple]")) {
    el.style.opacity = "0";
    el.style.transform = "";
  }
}

function sessionFor(
  phase: GatherSession["phase"],
  plan: GatherChoreography,
  started: number,
  paint: () => void,
): { session: GatherSession; stop: () => boolean; arm: (raf: number) => void } {
  let raf = 0;
  let stopped = false;
  const session: GatherSession = {
    plan,
    started,
    phase,
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    sample: () => frameAt(plan, performance.now() - started),
    paint,
  };
  return {
    session,
    stop: () => stopped,
    arm(id: number) {
      raf = id;
    },
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
  const paint = () => {
    const frame = frameAt(opts.plan, Math.min(opts.plan.linesOutMs, performance.now() - started));
    applyLines(opts.stage, opts.world, frame);
    applyGlow(opts.world, frame, opts.focusId);
    applyCards(opts.world, frame, false);
  };
  const handle = sessionFor("lines-out", opts.plan, started, paint);
  const tick = (now: number) => {
    if (handle.stop()) return;
    paint();
    if (now - started >= opts.plan.linesOutMs) {
      handle.session.stop();
      opts.onCommit();
      return;
    }
    handle.arm(requestAnimationFrame(tick));
  };
  if (opts.plan.linesOutMs <= 0) {
    opts.onCommit();
    return handle.session;
  }
  paint();
  handle.arm(requestAnimationFrame(tick));
  return handle.session;
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
  let at: number | null = null;
  const paint = () => {
    const elapsed = at ?? performance.now() - opts.started;
    const frame = frameAt(opts.plan, elapsed);
    applyLines(opts.stage, opts.world, frame);
    applyGlow(opts.world, frame, opts.focusId);
    applyCards(opts.world, frame, !frame.done);
    if (frame.done) clearGatherPaint(opts.stage, opts.world);
  };
  const handle = sessionFor("flight", opts.plan, opts.started, paint);
  const tick = (now: number) => {
    if (handle.stop()) return;
    if (now - opts.started >= opts.plan.duration) {
      at = opts.plan.duration;
      paint();
      handle.session.stop();
      opts.onDone();
      return;
    }
    at = null;
    paint();
    handle.arm(requestAnimationFrame(tick));
  };
  paint();
  if (performance.now() - opts.started >= opts.plan.duration) {
    at = opts.plan.duration;
    paint();
    opts.onDone();
    return handle.session;
  }
  handle.arm(requestAnimationFrame(tick));
  return handle.session;
}
