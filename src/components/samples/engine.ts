import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ColorManagement,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineSegments,
  LinearSRGBColorSpace,
  Mesh,
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Sphere,
  Vector3,
  WebGLRenderer,
} from "three";
import type { SampleKind, SamplePose, SampleScene } from "@/lib/samples/model";
import { cardPoses, orbitPoses, personPlace, smoothstep } from "@/lib/samples/motion";

/**
 * Sample renderer.
 * Depth sky: disc size and edge grow with circle-of-confusion in the shader.
 * Cards and orbit: the CPU writes from/to once; the GPU lerps position and scale.
 */

const DISC_VERT = `
attribute vec3 aCenter;
attribute float aRadius;
attribute vec3 aColor;
uniform float uFocus;
uniform float uAperture;
varying vec2 vUv;
varying float vCoc;
varying vec3 vColor;
void main() {
  vec4 mvCenter = modelViewMatrix * vec4(aCenter, 1.0);
  float depth = -mvCenter.z;
  float coc = clamp(abs(depth - uFocus) * uAperture, 0.0, 1.0);
  vCoc = coc;
  vColor = aColor;
  vUv = uv;
  vec4 mv = mvCenter;
  mv.xy += position.xy * (aRadius * 2.0 * (1.0 + coc * 0.85));
  gl_Position = projectionMatrix * mv;
}
`;

const DISC_FRAG = `
varying vec2 vUv;
varying float vCoc;
varying vec3 vColor;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float edge = mix(0.06, 0.5, vCoc);
  float alpha = smoothstep(1.0, 1.0 - edge, d);
  float core = exp(-d * d * mix(3.4, 1.15, vCoc));
  vec3 col = mix(vColor, vec3(0.93, 0.97, 0.95), core * 0.5);
  alpha *= mix(0.7, 0.24, vCoc);
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

const CARD_VERT = `
attribute vec3 aFrom;
attribute vec3 aTo;
attribute float aFromScale;
attribute float aToScale;
attribute float aFromAlpha;
attribute float aToAlpha;
attribute vec3 aColor;
uniform float uTime;
uniform float uStart;
uniform float uDur;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vScale;
void main() {
  float t = clamp((uTime - uStart) / max(uDur, 0.0001), 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  vec3 center = mix(aFrom, aTo, t);
  float scale = mix(aFromScale, aToScale, t);
  vScale = scale;
  vAlpha = mix(aFromAlpha, aToAlpha, t);
  vColor = aColor;
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(center, 1.0);
  mv.xy += position.xy * vec2(scale * 0.92, scale * 1.16);
  gl_Position = projectionMatrix * mv;
}
`;

const CARD_FRAG = `
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vScale;
float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float star = smoothstep(0.52, 0.4, vScale);
  float d = length(p);
  float glow = exp(-d * d * 2.4);
  float disc = smoothstep(1.0, 0.45, d);
  vec3 starCol = mix(vColor, vec3(0.95, 0.98, 0.97), glow * 0.65);
  float sd = roundBox(p, vec2(0.9, 0.92), 0.28);
  float card = 1.0 - smoothstep(0.0, 0.045, sd);
  float rim = smoothstep(0.08, 0.0, abs(sd));
  vec2 avatar = p - vec2(0.0, 0.28);
  float face = 1.0 - smoothstep(0.26, 0.32, length(avatar));
  vec3 cardCol = mix(vec3(0.078, 0.188, 0.227), vColor, face);
  cardCol = mix(cardCol, vec3(0.55, 0.78, 0.75), rim * 0.45);
  vec3 col = mix(cardCol, starCol, star);
  float alpha = mix(card, disc * (0.35 + glow), star) * vAlpha;
  if (alpha < 0.03) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

const LINE_VERT = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LINE_FRAG = `
uniform float uOpacity;
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}
`;

export type MountOptions = {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  stage: HTMLElement;
  kind: SampleKind;
  scene: SampleScene;
  onSelect: (name: string, id: string) => void;
};

type Slot = {
  el: HTMLElement;
  id: string;
  x: number;
  y: number;
  a: number;
};

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [f(0), f(8), f(4)];
}

function familyTint(hue: number): [number, number, number] {
  const tone = hsl(hue, 0.32, 0.62);
  return [0.49 * 0.62 + tone[0] * 0.38, 0.8 * 0.62 + tone[1] * 0.38, 0.76 * 0.62 + tone[2] * 0.38];
}

function quad(count: number) {
  const geo = new InstancedBufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.instanceCount = count;
  geo.boundingSphere = new Sphere(new Vector3(), 40);
  return geo;
}

function inst(geo: InstancedBufferGeometry, name: string, size: number, count: number) {
  const attr = new InstancedBufferAttribute(new Float32Array(count * size), size);
  attr.setUsage(DynamicDrawUsage);
  geo.setAttribute(name, attr);
  return attr;
}

export function mountSample(options: MountOptions): () => void {
  const { canvas, overlay, stage, kind, scene, onSelect } = options;
  const previous = ColorManagement.enabled;
  ColorManagement.enabled = false;
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x0b1822, 1);
  const glScene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 80);
  const view = new Vector3();
  const rig = { yaw: 0.45, pitch: 0.4, dist: 12, tx: 0, ty: 0, tz: 0 };
  let width = 1;
  let height = 1;
  let level: "far" | "near" = kind === "cards" ? "far" : "near";
  let focusFamily = scene.families[0]?.id ?? "";
  let disposed = false;
  let pointerDown = false;
  let frame = 0;

  const peopleEls = scene.people.map((person) => {
    const el = overlay.querySelector(`[data-person-id="${person.id}"]`);
    if (!(el instanceof HTMLElement)) throw new Error(`missing label ${person.id}`);
    return { el, id: person.id, x: -9999, y: -9999, a: -1 } satisfies Slot;
  });
  const familyEls = scene.families.map((family) => {
    const el = overlay.querySelector(`[data-family-id="${family.id}"]`);
    if (!(el instanceof HTMLElement)) throw new Error(`missing family ${family.id}`);
    return { el, id: family.id, x: -9999, y: -9999, a: -1 } satisfies Slot;
  });
  const world = scene.people.map((person) => personPlace(scene, person.id) ?? { x: 0, y: 0, z: 0 });

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const family of scene.families) {
    cx += family.x;
    cy += family.y;
    cz += family.z;
  }
  const nFam = Math.max(1, scene.families.length);
  rig.tx = cx / nFam;
  rig.ty = cy / nFam;
  rig.tz = cz / nFam;

  const discCount = scene.families.length;
  const discGeo = quad(discCount);
  const discCenter = inst(discGeo, "aCenter", 3, discCount);
  const discRadius = inst(discGeo, "aRadius", 1, discCount);
  const discColor = inst(discGeo, "aColor", 3, discCount);
  scene.families.forEach((family, index) => {
    const center = discCenter.array as Float32Array;
    const radius = discRadius.array as Float32Array;
    const color = discColor.array as Float32Array;
    center[index * 3] = family.x;
    center[index * 3 + 1] = family.y;
    center[index * 3 + 2] = family.z;
    radius[index] = family.radius;
    const tint = familyTint(family.hue);
    color[index * 3] = tint[0];
    color[index * 3 + 1] = tint[1];
    color[index * 3 + 2] = tint[2];
  });
  const discMat = new ShaderMaterial({
    vertexShader: DISC_VERT,
    fragmentShader: DISC_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: { uFocus: { value: 8 }, uAperture: { value: 0.28 } },
  });
  discMat.toneMapped = false;
  const discs = new Mesh(discGeo, discMat);
  discs.frustumCulled = false;
  if (kind === "depth") glScene.add(discs);

  const count = scene.people.length;
  const cardGeo = quad(count);
  const aFrom = inst(cardGeo, "aFrom", 3, count);
  const aTo = inst(cardGeo, "aTo", 3, count);
  const aFromScale = inst(cardGeo, "aFromScale", 1, count);
  const aToScale = inst(cardGeo, "aToScale", 1, count);
  const aFromAlpha = inst(cardGeo, "aFromAlpha", 1, count);
  const aToAlpha = inst(cardGeo, "aToAlpha", 1, count);
  const aColor = inst(cardGeo, "aColor", 3, count);
  scene.people.forEach((person, index) => {
    const color = aColor.array as Float32Array;
    const tone = hsl(person.hue, 0.42, 0.58);
    color[index * 3] = tone[0];
    color[index * 3 + 1] = tone[1];
    color[index * 3 + 2] = tone[2];
  });
  const cardMat = new ShaderMaterial({
    vertexShader: CARD_VERT,
    fragmentShader: CARD_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uStart: { value: 0 }, uDur: { value: 1 } },
  });
  cardMat.toneMapped = false;
  const cards = new Mesh(cardGeo, cardMat);
  cards.frustumCulled = false;
  if (kind !== "depth") glScene.add(cards);

  const linePositions = new Float32Array(96 * 2 * 3);
  const lineGeo = new BufferGeometry();
  const lineAttr = new BufferAttribute(linePositions, 3);
  lineAttr.setUsage(DynamicDrawUsage);
  lineGeo.setAttribute("position", lineAttr);
  lineGeo.setDrawRange(0, 0);
  lineGeo.boundingSphere = new Sphere(new Vector3(), 40);
  const lineMat = new ShaderMaterial({
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: { uOpacity: { value: 0.45 }, uColor: { value: new Color("#7dcdc4") } },
  });
  lineMat.toneMapped = false;
  const lines = new LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false;
  if (kind === "orbit") glScene.add(lines);

  const live: SamplePose[] = scene.people.map((person) => ({
    id: person.id,
    x: 0,
    y: 0,
    z: 0,
    scale: 1,
    alpha: 1,
  }));
  let animStart = 0;
  let animDur = 1;
  let gpuUntil = 0;
  type Phase = { mode: "out" | "wait" | "in"; t0: number; poses: SamplePose[] } | null;
  let phase: Phase = null;
  type Dolly = { sx: number; sy: number; sz: number; sd: number; ex: number; ey: number; ez: number; ed: number; t0: number; dur: number } | null;
  let dolly: Dolly = null;

  function setAttr(name: string, value: string) {
    if (stage.dataset[name] !== value) stage.dataset[name] = value;
  }

  function fillLive(time: number) {
    const t = smoothstep((time - animStart) / Math.max(animDur, 0.0001));
    const from = aFrom.array as Float32Array;
    const to = aTo.array as Float32Array;
    const fromS = aFromScale.array as Float32Array;
    const toS = aToScale.array as Float32Array;
    const fromA = aFromAlpha.array as Float32Array;
    const toA = aToAlpha.array as Float32Array;
    for (let i = 0; i < count; i += 1) {
      const pose = live[i];
      pose.x = from[i * 3] + (to[i * 3] - from[i * 3]) * t;
      pose.y = from[i * 3 + 1] + (to[i * 3 + 1] - from[i * 3 + 1]) * t;
      pose.z = from[i * 3 + 2] + (to[i * 3 + 2] - from[i * 3 + 2]) * t;
      pose.scale = fromS[i] + (toS[i] - fromS[i]) * t;
      pose.alpha = fromA[i] + (toA[i] - fromA[i]) * t;
    }
  }

  function writeTargets(poses: SamplePose[], time: number, duration: number, bake: boolean) {
    const from = aFrom.array as Float32Array;
    const to = aTo.array as Float32Array;
    const fromS = aFromScale.array as Float32Array;
    const toS = aToScale.array as Float32Array;
    const fromA = aFromAlpha.array as Float32Array;
    const toA = aToAlpha.array as Float32Array;
    if (bake) fillLive(time);
    for (let i = 0; i < count; i += 1) {
      if (bake) {
        from[i * 3] = live[i].x;
        from[i * 3 + 1] = live[i].y;
        from[i * 3 + 2] = live[i].z;
        fromS[i] = live[i].scale;
        fromA[i] = live[i].alpha;
      }
      const pose = poses[i];
      to[i * 3] = pose.x;
      to[i * 3 + 1] = pose.y;
      to[i * 3 + 2] = pose.z;
      toS[i] = pose.scale;
      toA[i] = pose.alpha;
      if (!bake) {
        from[i * 3] = pose.x;
        from[i * 3 + 1] = pose.y;
        from[i * 3 + 2] = pose.z;
        fromS[i] = pose.scale;
        fromA[i] = pose.alpha;
      }
      if (pose.ring) peopleEls[i].el.dataset.ring = pose.ring;
      else delete peopleEls[i].el.dataset.ring;
    }
    aFrom.needsUpdate = true;
    aTo.needsUpdate = true;
    aFromScale.needsUpdate = true;
    aToScale.needsUpdate = true;
    aFromAlpha.needsUpdate = true;
    aToAlpha.needsUpdate = true;
    animStart = time;
    animDur = duration;
    cardMat.uniforms.uStart.value = time;
    cardMat.uniforms.uDur.value = duration;
    gpuUntil = time + duration;
  }

  function writeLines(poses: SamplePose[], keepOuter: boolean) {
    const byId = new Map(poses.map((pose) => [pose.id, pose]));
    let cursor = 0;
    for (const link of scene.links) {
      const a = byId.get(link.fromId);
      const b = byId.get(link.toId);
      if (!a || !b) continue;
      if (!keepOuter && (a.ring === "outer" || b.ring === "outer")) continue;
      if (a.alpha < 0.2 || b.alpha < 0.2) continue;
      linePositions[cursor++] = a.x;
      linePositions[cursor++] = a.y;
      linePositions[cursor++] = a.z;
      linePositions[cursor++] = b.x;
      linePositions[cursor++] = b.y;
      linePositions[cursor++] = b.z;
      if (cursor >= linePositions.length) break;
    }
    lineGeo.setDrawRange(0, cursor / 3);
    lineAttr.needsUpdate = true;
  }

  function place(slot: Slot, x: number, y: number, alpha: number) {
    const shown = alpha < 0.04 ? 0 : alpha;
    if (Math.abs(slot.x - x) < 0.5 && Math.abs(slot.y - y) < 0.5 && Math.abs(slot.a - shown) < 0.02) return;
    slot.x = x;
    slot.y = y;
    slot.a = shown;
    slot.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    slot.el.style.opacity = shown === 0 ? "0" : shown.toFixed(3);
  }

  function project(x: number, y: number, z: number) {
    view.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    const depth = -view.z;
    if (depth < 0.15) return { x: -9999, y: -9999, depth, ok: false };
    view.applyMatrix4(camera.projectionMatrix);
    return {
      x: (view.x * 0.5 + 0.5) * width,
      y: (-view.y * 0.5 + 0.5) * height,
      depth,
      ok: true,
    };
  }

  function pxPerUnit(depth: number) {
    const fov = (camera.fov * Math.PI) / 180;
    return height / (2 * Math.tan(fov / 2) * Math.max(depth, 0.25));
  }

  function resize() {
    width = Math.max(1, canvas.clientWidth);
    height = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    setAttr("dpr", String(renderer.getPixelRatio()));
  }

  function fitDist() {
    const points =
      kind === "orbit"
        ? scene.people.map((person) => {
            const place = personPlace(scene, person.id) ?? { x: 0, y: 0, z: 0 };
            return { x: place.x, y: place.y, z: place.z, padX: 0.9, padY: 1.15 };
          })
        : scene.families.map((family) => ({
            x: family.x,
            y: family.y,
            z: family.z,
            padX: kind === "depth" ? family.radius + 0.55 : 1.05,
            padY: kind === "depth" ? family.radius * 0.7 + 0.55 : 0.85,
          }));
    const originY = rig.ty * Math.cos(rig.pitch) + rig.tz * Math.sin(rig.pitch);
    let halfX = 0.2;
    let halfY = 0.2;
    for (const point of points) {
      const sy = point.y * Math.cos(rig.pitch) + point.z * Math.sin(rig.pitch);
      halfX = Math.max(halfX, Math.abs(point.x - rig.tx) + point.padX);
      halfY = Math.max(halfY, Math.abs(sy - originY) + point.padY);
    }
    const v = (camera.fov * Math.PI) / 180;
    const h = 2 * Math.atan(Math.tan(v / 2) * Math.max(0.2, camera.aspect));
    return Math.max(halfY / Math.tan(v / 2), halfX / Math.tan(h / 2)) * 1.08;
  }

  function applyCamera() {
    const cp = Math.cos(rig.pitch);
    camera.position.set(
      rig.tx + rig.dist * Math.sin(rig.yaw) * cp,
      rig.ty + rig.dist * Math.sin(rig.pitch),
      rig.tz + rig.dist * Math.cos(rig.yaw) * cp,
    );
    camera.lookAt(rig.tx, rig.ty, rig.tz);
  }

  function commitView() {
    setAttr("dist", rig.dist.toFixed(2));
    setAttr("yaw", rig.yaw.toFixed(3));
  }

  function dollyTo(x: number, y: number, z: number, dist: number, dur: number) {
    const now = performance.now() / 1000;
    dolly = { sx: rig.tx, sy: rig.ty, sz: rig.tz, sd: rig.dist, ex: x, ey: y, ez: z, ed: dist, t0: now, dur };
    setAttr("motion", "move");
  }

  function familyOnScreen() {
    let best = scene.families[0];
    let score = Infinity;
    for (const family of scene.families) {
      const point = project(family.x, family.y, family.z);
      if (!point.ok) continue;
      const d = Math.hypot(point.x - width / 2, point.y - height / 2);
      const bias = family.memberIds.length > 1 ? 0 : 120;
      if (d + bias < score) {
        score = d + bias;
        best = family;
      }
    }
    return best;
  }

  function nearestFamily(x: number, y: number, z: number) {
    let best = scene.families[0];
    let score = Infinity;
    for (const family of scene.families) {
      const d = Math.hypot(family.x - x, family.y - y, family.z - z);
      if (d < score) {
        score = d;
        best = family;
      }
    }
    return best;
  }

  function openFamily(id: string) {
    const family = scene.families.find((item) => item.id === id);
    if (!family) return;
    focusFamily = id;
    const dist = kind === "depth" ? 5.4 : nearCut * 0.72;
    dollyTo(family.x, family.y, family.z, dist, 0.72);
  }

  function selectPerson(id: string) {
    const person = scene.people.find((item) => item.id === id);
    if (!person) return;
    for (const slot of peopleEls) {
      if (slot.id === id) slot.el.dataset.selected = "true";
      else delete slot.el.dataset.selected;
    }
    onSelect(person.name, person.id);
  }

  function local(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function hit(clientX: number, clientY: number): { kind: "person" | "family"; id: string } | null {
    const point = local(clientX, clientY);
    let best: { kind: "person" | "family"; id: string; d: number } | null = null;
    const consider = (slot: Slot, slotKind: "person" | "family", radius: number, minA: number) => {
      if (slot.a < minA) return;
      const d = Math.hypot(slot.x - point.x, slot.y - point.y);
      if (d > radius) return;
      if (!best || d < best.d) best = { kind: slotKind, id: slot.id, d };
    };
    for (const slot of peopleEls) consider(slot, "person", 58, 0.45);
    if (!best) for (const slot of familyEls) consider(slot, "family", 64, 0.3);
    return best;
  }

  const limits = kind === "depth" ? [4.2, 72] : kind === "cards" ? [5.2, 72] : [7, 64];
  let nearCut = kind === "depth" ? 8.2 : 9;
  let farCut = kind === "depth" ? 10.4 : 12;
  function clampDist(value: number) {
    return Math.min(limits[1], Math.max(limits[0], value));
  }

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch0 = 0;
  let dist0 = 0;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let downT = 0;
  let held = false;
  let holdTimer = 0;

  function onDown(event: PointerEvent) {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    pointerDown = true;
    if (pointers.size >= 2) {
      window.clearTimeout(holdTimer);
      const pts = [...pointers.values()];
      pinch0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      dist0 = rig.dist;
      return;
    }
    lastX = downX = event.clientX;
    lastY = downY = event.clientY;
    downT = performance.now();
    held = false;
    if (kind === "orbit") {
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => {
        if (Math.hypot(lastX - downX, lastY - downY) > 12 || phase) return;
        const found = hit(downX, downY);
        if (found?.kind !== "person") return;
        held = true;
        beginOrbit(found.id);
      }, 460);
    }
  }

  function onMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const pts = [...pointers.values()];
      const span = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      rig.dist = clampDist(dist0 * (pinch0 / span));
      return;
    }
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > 8) window.clearTimeout(holdTimer);
    rig.yaw -= dx * 0.005;
    rig.pitch = Math.min(1.05, Math.max(-0.2, rig.pitch + dy * 0.0035));
  }

  function onUp(event: PointerEvent) {
    const startX = downX;
    const startY = downY;
    const elapsed = performance.now() - downT;
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      pointerDown = false;
      window.clearTimeout(holdTimer);
      commitView();
      const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (!held && moved < 10 && elapsed < 420) {
        const found = hit(event.clientX, event.clientY);
        if (found?.kind === "person") selectPerson(found.id);
        else if (found?.kind === "family" && kind !== "orbit") openFamily(found.id);
      }
    } else if (pointers.size === 1) {
      const only = [...pointers.values()][0];
      lastX = downX = only.x;
      lastY = downY = only.y;
    }
  }

  function beginOrbit(id: string) {
    if (phase) return;
    const poses = orbitPoses(scene, id);
    const now = performance.now() / 1000;
    phase = { mode: "out", t0: now, poses };
    setAttr("lines", "out");
    setAttr("motion", "move");
    setAttr("layout", "orbit");
    selectPerson(id);
    const pose = poses.find((item) => item.id === id);
    if (pose) dollyTo(pose.x, pose.y, pose.z, 13.2, 0.64);
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    rig.dist = clampDist(rig.dist * Math.exp(event.deltaY * 0.0014));
    commitView();
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas);
  if (kind === "depth") {
    rig.pitch = 0.66;
    rig.yaw = 0.42;
  } else if (kind === "cards") {
    rig.pitch = 0.34;
    rig.yaw = 0.28;
  } else {
    rig.pitch = 0.46;
    rig.yaw = 0.22;
  }
  resize();
  const fitted = fitDist();
  if (kind === "depth") {
    rig.dist = clampDist(fitted);
    setAttr("level", "far");
    level = "far";
  } else if (kind === "cards") {
    rig.dist = clampDist(fitted);
    nearCut = rig.dist * 0.62;
    farCut = rig.dist * 0.84;
    writeTargets(cardPoses(scene, "far"), performance.now() / 1000, 0.01, false);
    setAttr("level", "far");
  } else {
    rig.dist = clampDist(fitted);
    const poses = cardPoses(scene, "near");
    writeTargets(poses, performance.now() / 1000, 0.01, false);
    writeLines(poses, true);
    setAttr("level", "near");
    setAttr("layout", "sky");
    setAttr("lines", "shown");
  }
  for (const family of familyEls) family.el.style.opacity = kind === "orbit" ? "0" : "1";
  const home = { x: rig.tx, y: rig.ty, z: rig.tz, dist: rig.dist };
  applyCamera();
  commitView();
  setAttr("renderer", "webgl");
  setAttr("motion", kind === "depth" ? "orbit" : "idle");

  let last = performance.now();
  let ready = false;

  function tick(now: number) {
    if (disposed) return;
    const time = now / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (dolly) {
      const k = smoothstep((time - dolly.t0) / dolly.dur);
      rig.tx = dolly.sx + (dolly.ex - dolly.sx) * k;
      rig.ty = dolly.sy + (dolly.ey - dolly.sy) * k;
      rig.tz = dolly.sz + (dolly.ez - dolly.sz) * k;
      rig.dist = dolly.sd + (dolly.ed - dolly.sd) * k;
      if (k >= 1) {
        dolly = null;
        commitView();
      }
    } else if (kind === "depth" && !pointerDown) {
      rig.yaw += dt * 0.055;
    }
    if (kind === "cards") {
      const next = level === "far" ? (rig.dist < nearCut ? "near" : "far") : rig.dist > farCut ? "far" : "near";
      if (next !== level) {
        level = next;
        setAttr("level", level);
        writeTargets(cardPoses(scene, level), time, 0.7, true);
        setAttr("motion", "move");
        gpuUntil = time + 0.7;
        if (level === "near") {
          const family = familyOnScreen();
          focusFamily = family.id;
          dollyTo(family.x, family.y, family.z, Math.max(limits[0], nearCut * 0.48), 0.7);
        } else {
          dollyTo(home.x, home.y, home.z, home.dist, 0.7);
        }
      }
    }
    if (kind === "depth") {
      const next = level === "far" ? (rig.dist < nearCut ? "near" : "far") : rig.dist > farCut ? "far" : "near";
      if (next !== level) {
        level = next;
        setAttr("level", level);
        if (level === "near") focusFamily = nearestFamily(rig.tx, rig.ty, rig.tz).id;
      }
    }
    if (phase?.mode === "out" && time - phase.t0 >= 0.16) {
      writeTargets(phase.poses, time, 0.64, true);
      writeLines(phase.poses, false);
      lineMat.uniforms.uOpacity.value = 0;
      setAttr("lines", "hidden");
      phase = { mode: "wait", t0: time, poses: phase.poses };
    } else if (phase?.mode === "out") {
      lineMat.uniforms.uOpacity.value = Math.max(0, 1 - (time - phase.t0) / 0.16) * 0.45;
    }
    if (phase?.mode === "wait" && time >= gpuUntil && !dolly) {
      phase = { mode: "in", t0: time, poses: phase.poses };
      setAttr("lines", "in");
    }
    if (phase?.mode === "in") {
      const k = Math.min(1, (time - phase.t0) / 0.28);
      lineMat.uniforms.uOpacity.value = k * 0.72;
      if (k >= 1) {
        setAttr("lines", "shown");
        phase = null;
      }
    }
    const moving = Boolean(dolly) || time < gpuUntil || Boolean(phase) || (kind === "depth" && !pointerDown);
    if (kind === "depth") setAttr("motion", dolly ? "move" : "orbit");
    else setAttr("motion", moving ? "move" : "idle");

    applyCamera();
    view.copy(camera.position);
    view.x -= rig.tx;
    view.y -= rig.ty;
    view.z -= rig.tz;
    const focusDepth = Math.hypot(view.x, view.y, view.z);
    discMat.uniforms.uFocus.value = focusDepth;
    cardMat.uniforms.uTime.value = time;
    renderer.render(glScene, camera);

    if (kind === "depth") {
      const showPeople = level === "near";
      for (let i = 0; i < scene.families.length; i += 1) {
        const family = scene.families[i];
        const point = project(family.x, family.y, family.z);
        const coc = Math.min(1, Math.abs(point.depth - focusDepth) * 0.28);
        const lift = point.ok ? family.radius * pxPerUnit(point.depth) * 0.55 : 0;
        const alpha = !point.ok || (showPeople && family.id === focusFamily) ? 0 : coc < 0.22 ? 1 : 0.78;
        place(familyEls[i], point.x, point.y - lift, alpha);
      }
      for (let i = 0; i < count; i += 1) {
        const person = scene.people[i];
        const spot = world[i];
        const point = project(spot.x, spot.y, spot.z);
        const alpha = showPeople && person.unitId === focusFamily && point.ok ? 1 : 0;
        place(peopleEls[i], point.x, point.y, alpha);
      }
    } else {
      fillLive(time);
      for (let i = 0; i < count; i += 1) {
        const pose = live[i];
        const point = project(pose.x, pose.y, pose.z);
        const name = kind === "cards" ? pose.scale > 0.55 && pose.alpha > 0.45 : pose.alpha > 0.2;
        const drop = name ? pose.scale * pxPerUnit(point.depth) * 0.32 : 0;
        place(peopleEls[i], point.x, point.y + drop, point.ok && name ? pose.alpha : 0);
      }
      if (kind === "cards") {
        for (let i = 0; i < scene.families.length; i += 1) {
          const family = scene.families[i];
          const point = project(family.x, family.y, family.z);
          const lift = point.ok ? 18 : 0;
          place(familyEls[i], point.x, point.y + lift, level === "far" && point.ok ? 1 : 0);
        }
      }
    }

    if (!ready) {
      ready = true;
      setAttr("ready", "true");
    }
    frame = requestAnimationFrame(tick);
  }

  renderer.compile(glScene, camera);
  applyCamera();
  renderer.render(glScene, camera);
  frame = requestAnimationFrame(tick);

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    window.clearTimeout(holdTimer);
    resizeObserver.disconnect();
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
    canvas.removeEventListener("wheel", onWheel);
    discGeo.dispose();
    cardGeo.dispose();
    lineGeo.dispose();
    discMat.dispose();
    cardMat.dispose();
    lineMat.dispose();
    renderer.dispose();
    ColorManagement.enabled = previous;
  };
}
