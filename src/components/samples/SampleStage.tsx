"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { SAMPLE_SCENE } from "@/lib/samples/fixtureScene";
import type { SampleKind, SampleScene } from "@/lib/samples/model";
import { orbitPoses } from "@/lib/samples/motion";

const COPY: Record<SampleKind, { title: string; hint: string }> = {
  depth: { title: "Depth sky", hint: "Pinch a household" },
  cards: { title: "Floating cards", hint: "Pinch to open" },
  orbit: { title: "Orbit focus", hint: "Hold a person" },
};

const Labels = memo(function Labels({ scene, kind }: { scene: SampleScene; kind: SampleKind }) {
  return (
    <div className="smp-overlay" data-overlay>
      {scene.families.map((family) => (
        <div key={family.id} className="smp-family" data-family-id={family.id}>
          {family.label}
        </div>
      ))}
      {scene.people.map((person) => (
        <div
          key={person.id}
          className="smp-person"
          data-person-id={person.id}
          data-name={person.name}
          data-unit-id={person.unitId}
          style={{ "--hue": String(person.hue) } as CSSProperties}
        >
          {kind === "depth" ? <i>{person.initials}</i> : null}
          <strong>{person.givenName}</strong>
        </div>
      ))}
    </div>
  );
});

function Fallback({
  kind,
  scene,
  onSelect,
}: {
  kind: SampleKind;
  scene: SampleScene;
  onSelect: (name: string) => void;
}) {
  const [focus, setFocus] = useState(scene.focusPersonId);
  const hold = useRef(0);
  const poses = kind === "orbit" ? orbitPoses(scene, focus) : null;
  const ringOf = new Map(poses?.map((pose) => [pose.id, pose.ring]));

  const groups =
    kind === "orbit"
      ? (["center", "partner", "near", "outer"] as const).map((ring) => ({
          id: ring,
          label: ring === "center" ? "Center" : ring === "partner" ? "Beside" : ring === "near" ? "Close" : "Further",
          ids: scene.people.filter((person) => ringOf.get(person.id) === ring).map((person) => person.id),
        }))
      : [...scene.families]
          .sort((a, b) => a.generation - b.generation || a.label.localeCompare(b.label))
          .map((family) => ({ id: family.id, label: family.label, ids: family.memberIds }));

  return (
    <div className="smp-fallback" data-overlay>
      {groups.map((group) =>
        group.ids.length ? (
          <section key={group.id} data-family-id={group.id}>
            <h2>{group.label}</h2>
            <div className="smp-row">
              {group.ids.map((id) => {
                const person = scene.people.find((item) => item.id === id);
                if (!person) return null;
                return (
                  <button
                    key={id}
                    type="button"
                    data-person-id={id}
                    data-name={person.name}
                    data-ring={ringOf.get(id) ?? undefined}
                    style={{ "--hue": String(person.hue) } as CSSProperties}
                    onPointerDown={() => {
                      window.clearTimeout(hold.current);
                      if (kind !== "orbit") return;
                      hold.current = window.setTimeout(() => setFocus(id), 460);
                    }}
                    onPointerUp={() => window.clearTimeout(hold.current)}
                    onPointerLeave={() => window.clearTimeout(hold.current)}
                    onClick={() => onSelect(person.name)}
                  >
                    <i>{person.initials}</i>
                    <strong>{person.givenName}</strong>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}

export function SampleStage({ kind }: { kind: SampleKind }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"pending" | "webgl" | "fallback">("pending");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState("");
  const copy = COPY[kind];
  const scene = SAMPLE_SCENE;

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setReason("reduced-motion");
      setMode("fallback");
      return;
    }
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") || probe.getContext("webgl");
    if (!gl) {
      setReason("no-webgl");
      setMode("fallback");
      return;
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    setMode("webgl");
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || mode !== "fallback") return;
    stage.dataset.renderer = "fallback";
    stage.dataset.reason = reason;
    stage.dataset.ready = "true";
    stage.dataset.motion = "idle";
    stage.dataset.lines = "shown";
    stage.dataset.level = "near";
    stage.dataset.layout = kind === "orbit" ? "orbit" : "world";
  }, [mode, reason, kind]);

  useEffect(() => {
    if (mode !== "webgl") return;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const overlay = stage?.querySelector("[data-overlay]");
    if (!stage || !canvas || !(overlay instanceof HTMLElement)) return;
    let dispose = () => {};
    let dead = false;
    void import("./engine")
      .then(({ mountSample }) => {
        if (dead) return;
        dispose = mountSample({
          canvas,
          overlay,
          stage,
          kind,
          scene,
          onSelect: (name) => setSelected(name),
        });
      })
      .catch(() => {
        setReason("no-webgl");
        setMode("fallback");
      });
    return () => {
      dead = true;
      dispose();
    };
  }, [mode, kind, scene]);

  return (
    <div
      ref={stageRef}
      className="smp-stage"
      data-sample={kind}
      data-renderer={mode === "webgl" ? "webgl" : mode === "fallback" ? "fallback" : "pending"}
    >
      <header className="smp-bar">
        <a href="/samples">Samples</a>
        <h1>{copy.title}</h1>
      </header>
      <div className="smp-view">
        {mode === "webgl" ? (
          <>
            <canvas ref={canvasRef} aria-hidden="true" />
            <Labels scene={scene} kind={kind} />
          </>
        ) : null}
        {mode === "fallback" ? <Fallback kind={kind} scene={scene} onSelect={setSelected} /> : null}
      </div>
      <p className="smp-caption" data-selected-name={selected} aria-live="polite">
        {selected || copy.hint}
      </p>
    </div>
  );
}
