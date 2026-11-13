import { gatherCameraAt } from "./gatherChoreography";
import type { Camera } from "./graphView";

/**
 * Camera motion for the family sky.
 *
 * A pan is the pointer's distance, including when the finger starts on a
 * person or at the screen edge. A zoom or focus glide is one list of
 * transforms for the sky layer, sampled up front, so a frame does not
 * rebuild the sky.
 */

export const PAN_CAPTURE_SLOP = 6;

/** Move the camera by a pointer delta. Scale stays put. */
export function panCamera(start: Camera, dx: number, dy: number): Camera {
  return { x: start.x + dx, y: start.y + dy, s: start.s };
}

/** Where the sky sits after a pointer moves from `origin` to `point`. */
export function panFromPointer(start: Camera, origin: { x: number; y: number }, point: { x: number; y: number }): Camera {
  return panCamera(start, point.x - origin.x, point.y - origin.y);
}

/**
 * A drag past this distance is a pan, not a tap. Capturing then keeps the
 * sky on the finger after it slides off a card or past the screen edge.
 */
export function shouldCapturePan(dx: number, dy: number, slop = PAN_CAPTURE_SLOP): boolean {
  return Math.abs(dx) + Math.abs(dy) > slop;
}

export type SkyCameraSample = Camera & { labelScale: number };

/** One camera sample. `t` is 0 at the start and 1 when the glide lands. */
export function skyCameraAt(from: Camera, to: Camera, view: { cx: number; cy: number }, t: number): SkyCameraSample {
  const cam = t <= 0 ? from : t >= 1 ? to : gatherCameraAt(from, to, view, t);
  return { x: cam.x, y: cam.y, s: cam.s, labelScale: 1 / (cam.s || 1) };
}

export type SkyCameraFrame = SkyCameraSample & { offset: number; transform: string };

function px(n: number) {
  return (Math.round(n * 100) / 100).toString();
}

/** The glide, sampled once. The sky layer plays these transforms. */
export function skyCameraFrames(
  from: Camera,
  to: Camera,
  view: { cx: number; cy: number },
  steps = 24,
): SkyCameraFrame[] {
  const count = Math.max(1, Math.round(steps));
  const frames: SkyCameraFrame[] = [];
  for (let i = 0; i <= count; i += 1) {
    const offset = i / count;
    const sample = skyCameraAt(from, to, view, offset);
    frames.push({
      ...sample,
      offset,
      transform: `translate(${px(sample.x)}px, ${px(sample.y)}px) scale(${px(sample.s)})`,
    });
  }
  return frames;
}
