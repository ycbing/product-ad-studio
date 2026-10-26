import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ruleConcepts } from "../lib/concepts";
import { storyWarnings } from "../lib/story-quality";
import {
  emptyProduct,
  shotSchema,
  validateSources,
  type Asset,
} from "../lib/models";
const p = {
  ...emptyProduct,
  name: "法压壶",
  audience: "家庭用户",
  benefits: ["玻璃壶身"],
};
function asset(duration: number, kind: "video" | "image" = "video"): Asset {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    name: "clip",
    mime: "video/mp4",
    kind,
    width: 3840,
    height: 2160,
    duration: kind === "video" ? duration : null,
    sha256: "test",
    source: "fixture",
    url: "/test",
  };
}
test("single long clip uses different valid in-points rather than repeating frame zero", () => {
  const assets = [asset(24)];
  const shots = ruleConcepts(p, assets)[0].shots;
  validateSources(shots, assets);
  assert.equal(new Set(shots.map((s) => s.trimBefore)).size, 5);
  assert.equal(shots[4].trimBefore, 20);
  assert.deepEqual(
    shots.map((s) => s.textMode),
    ["title", "subtitle", "subtitle", "subtitle", "title"],
  );
});
test("multiple clips remain in range and repeat only at a new in-point", () => {
  const assets = [asset(7), asset(10), asset(5)];
  const shots = ruleConcepts(p, assets)[0].shots;
  validateSources(shots, assets);
  assert.equal(new Set(shots.map((s) => s.assetId)).size, 3);
  assert.equal(shots[3].assetId, assets[2].id);
  assert.equal(shots[3].trimBefore, 0.5);
  assert.equal(shots[4].trimBefore, 1);
});
test("photo-only output is explicitly identified as a photo presentation", () => {
  const assets = [asset(0, "image")];
  assert.match(
    storyWarnings(ruleConcepts(p, assets)[0].shots, assets).join(" "),
    /图文展示片/,
  );
});
test("overlapping reuse is flagged, while distinct cuts are not", () => {
  const assets = [asset(24)];
  const shots = ruleConcepts(p, assets)[0].shots;
  assert.ok(
    !storyWarnings(shots, assets).some((s) => s.includes("同一时间段")),
  );
  assert.ok(
    storyWarnings(
      shots.map((s) => ({ ...s, trimBefore: 0 })),
      assets,
    ).some((s) => s.includes("同一时间段")),
  );
});
test("scene controls survive validation and reject invalid volume or zoom", () => {
  const shot = ruleConcepts(p, [asset(24)])[0].shots[0];
  const configured = {
    ...shot,
    textMode: "none",
    zoom: 1.2,
    sourceVolume: 0.7,
  };
  assert.equal(shotSchema.parse(configured).sourceVolume, 0.7);
  assert.throws(() => shotSchema.parse({ ...configured, sourceVolume: 2 }));
  assert.throws(() => shotSchema.parse({ ...configured, zoom: 0.5 }));
});
