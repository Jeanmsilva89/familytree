import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cameraForPress, panCamera, panFromPointer, shouldCapturePan, skyCameraAt, skyCameraFrames } from "./skyMotion";

describe("sky pan", () => {
  const start = { x: 40, y: 80, s: 0.27 };

  it("moves the sky by the pointer distance", () => {
    const next = panCamera(start, 180, -24);
    assert.equal(next.x - start.x, 180);
    assert.equal(next.y - start.y, -24);
    assert.equal(next.s, start.s);
  });

  it("a pan that starts at the screen edge moves the sky by the finger distance", () => {
    const next = panFromPointer(start, { x: 6, y: 480 }, { x: 186, y: 450 });
    assert.equal(next.x - start.x, 180);
    assert.equal(next.y - start.y, -30);
    assert.equal(next.s, start.s);
  });

  it("a pan that starts on a person uses the same 1:1 distance", () => {
    const onPerson = panFromPointer(start, { x: 24, y: 360 }, { x: 164, y: 360 });
    const onSky = panFromPointer(start, { x: 120, y: 360 }, { x: 260, y: 360 });
    assert.equal(onPerson.x - start.x, onSky.x - start.x);
    assert.equal(onPerson.x - start.x, 140);
  });

  it("keeps a press-and-hold inside the slop, and a longer drag is a pan", () => {
    assert.equal(shouldCapturePan(0, 0), false);
    assert.equal(shouldCapturePan(6, 0), false);
    assert.equal(shouldCapturePan(4, -6), false);
    assert.equal(shouldCapturePan(0, -10), false);
    assert.equal(shouldCapturePan(0, -11), true);
    assert.equal(shouldCapturePan(8, 8), true);
  });

  it("a press tremor of 1 to 6px does not move the sky, and a real pan keeps the full finger distance", () => {
    const origin = { x: 180, y: 420 };
    const tremor = [
      [1, -2],
      [2, -4],
      [3, -5],
      [4, -6],
      [2, -3],
      [1, -2],
      [0, -1],
    ];
    let panning = false;
    for (const [dx, dy] of tremor) {
      const step = cameraForPress(start, origin, { x: origin.x + dx, y: origin.y + dy }, panning);
      panning = step.panning;
      assert.equal(step.panning, false);
      assert.equal(step.camera.x, start.x);
      assert.equal(step.camera.y, start.y);
      assert.equal(step.camera.s, start.s);
    }

    const crossed = cameraForPress(start, origin, { x: origin.x, y: origin.y - 12 }, false);
    assert.equal(crossed.panning, true);
    assert.equal(crossed.camera.x, start.x);
    assert.equal(crossed.camera.y - start.y, -12);
    assert.equal(crossed.camera.s, start.s);

    const back = cameraForPress(start, origin, { x: origin.x + 3, y: origin.y - 2 }, crossed.panning);
    assert.equal(back.panning, true);
    assert.equal(back.camera.x - start.x, 3);
    assert.equal(back.camera.y - start.y, -2);
  });
});

describe("sky camera glide", () => {
  const from = { x: 10, y: 20, s: 0.25 };
  const to = { x: -80, y: 40, s: 1 };
  const view = { cx: 195, cy: 420 };

  it("samples one transform list, and the labels counter-scale with it", () => {
    const frames = skyCameraFrames(from, to, view, 8);
    assert.equal(frames.length, 9);
    assert.equal(frames[0].offset, 0);
    assert.equal(frames[0].x, from.x);
    assert.equal(frames[0].y, from.y);
    assert.equal(frames[0].s, from.s);
    assert.equal(frames[0].labelScale, 1 / from.s);
    assert.equal(frames[0].transform, "translate(10px, 20px) scale(0.25)");
    const last = frames[frames.length - 1];
    assert.equal(last.offset, 1);
    assert.equal(last.x, to.x);
    assert.equal(last.y, to.y);
    assert.equal(last.s, to.s);
    assert.equal(last.labelScale, 1);
    for (let i = 1; i < frames.length; i += 1) assert.ok(frames[i].s >= frames[i - 1].s);
  });

  it("lands on the requested camera", () => {
    const mid = skyCameraAt(from, to, view, 0.5);
    assert.ok(mid.s > from.s && mid.s < to.s);
    assert.equal(mid.labelScale, 1 / mid.s);
    const end = skyCameraAt(from, to, view, 1);
    assert.deepEqual({ x: end.x, y: end.y, s: end.s }, to);
  });
});
