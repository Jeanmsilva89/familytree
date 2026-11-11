import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildSampleScene } from "./buildScene";
import { SAMPLE_SCENE } from "./fixtureScene";
import { cardPoses, orbitPoses, poseDistance } from "./motion";

describe("sample scene", () => {
  const scene = buildSampleScene();

  it("is the fixture family", () => {
    assert.match(scene.note, /Fixture/);
    assert.ok(scene.people.length >= 10);
    assert.ok(scene.families.length >= 4);
    for (const person of scene.people) assert.match(person.name, /Fixture$/);
  });

  it("matches the frozen scene the samples render", () => {
    assert.deepEqual(SAMPLE_SCENE, scene);
  });

  it("stacks households on generation layers", () => {
    const layers = new Set(scene.families.map((family) => family.z));
    assert.ok(layers.size >= 3);
    const byName = new Map(scene.people.map((person) => [person.givenName, person]));
    assert.ok(byName.get("Fay")!.generation > byName.get("Eli")!.generation);
    assert.ok(byName.get("Eli")!.generation > byName.get("Ada")!.generation);
    assert.ok(scene.links.some((link) => link.fromId === "fx-stu" && link.toId === "fx-nia" && link.kind === "step"));
  });

  it("collapses people to family stars, then opens them", () => {
    const far = cardPoses(scene, "far");
    const near = cardPoses(scene, "near");
    assert.equal(far.filter((pose) => pose.alpha > 0.5).length, scene.families.length);
    const dee = scene.families.find((family) => family.label.includes("Dee"));
    assert.ok(dee);
    const members = far.filter((pose) => dee.memberIds.includes(pose.id));
    assert.ok(members.every((pose) => pose.x === members[0].x && pose.y === members[0].y));
    const opened = near.filter((pose) => dee.memberIds.includes(pose.id));
    assert.ok(new Set(opened.map((pose) => pose.y)).size > 1);
  });

  it("seats Eli's partner beside him and dials the rest back", () => {
    const poses = orbitPoses(scene, "fx-eli");
    const at = new Map(poses.map((pose) => [pose.id, pose]));
    const dee = at.get("fx-dee")!;
    const fay = at.get("fx-fay")!;
    const ada = at.get("fx-ada")!;
    const cora = at.get("fx-cora")!;
    const wynn = at.get("fx-wynn")!;
    assert.equal(at.get("fx-eli")!.ring, "center");
    assert.equal(dee.ring, "partner");
    assert.ok(Math.abs(dee.y) < 0.05 && dee.x > 1);
    assert.equal(fay.ring, "near");
    assert.ok(fay.y < 0);
    assert.equal(ada.ring, "near");
    assert.ok(ada.y > 0);
    assert.equal(cora.ring, "near");
    assert.equal(wynn.ring, "outer");
    assert.ok(poseDistance(dee) < poseDistance(fay));
    assert.ok(poseDistance(ada) < poseDistance(wynn));
  });

  it("keeps a step-parent near and a partner beside", () => {
    const poses = orbitPoses(scene, "fx-nia");
    const at = new Map(poses.map((pose) => [pose.id, pose]));
    assert.equal(at.get("fx-pal")!.ring, "partner");
    assert.equal(at.get("fx-stu")!.ring, "near");
    assert.equal(at.get("fx-eli")!.ring, "outer");
  });

  it("keeps three.js and the live sky out of the sample shell", () => {
    const stage = readFileSync("src/components/samples/SampleStage.tsx", "utf8");
    const frozen = readFileSync("src/lib/samples/fixtureScene.ts", "utf8");
    const engine = readFileSync("src/components/samples/engine.ts", "utf8");
    assert.doesNotMatch(stage, /from ["']three["']/);
    assert.match(stage, /import\(["']\.\/engine["']\)/);
    assert.doesNotMatch(frozen, /familySky|familyUnits|from ["']three["']/);
    assert.match(engine, /from ["']three["']/);
  });
});
