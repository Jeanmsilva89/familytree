import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from "three";

export type OrbitLine = { x1: number; y1: number; x2: number; y2: number };

export type OrbitLineBox = { minX: number; minY: number; width: number; height: number };

/**
 * Relationship lines for the orbit view. One draw when the seats change.
 * The canvas is faded with CSS; this module does not run an animation loop.
 */
export function mountOrbitLines(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1, 0, 1, -10, 10);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(0), 3));
  const material = new LineBasicMaterial({ color: 0x7dcdc4, transparent: true, opacity: 0.8 });
  scene.add(new LineSegments(geometry, material));

  function setSegments(segments: readonly OrbitLine[], box: OrbitLineBox) {
    const data = new Float32Array(Math.max(1, segments.length) * 6);
    segments.forEach((line, index) => {
      const offset = index * 6;
      data[offset] = line.x1;
      data[offset + 1] = line.y1;
      data[offset + 3] = line.x2;
      data[offset + 4] = line.y2;
    });
    geometry.setAttribute("position", new BufferAttribute(data, 3));
    geometry.setDrawRange(0, segments.length * 2);
    const width = Math.max(1, box.width);
    const height = Math.max(1, box.height);
    camera.left = box.minX;
    camera.right = box.minX + width;
    camera.top = box.minY;
    camera.bottom = box.minY + height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
  }

  return {
    setSegments,
    dispose() {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
