import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseRange, storagePath } from "../lib/storage";
import { validateSources, isStale, emptyProduct } from "../lib/models";
import { ruleConcepts } from "../lib/concepts";
import { checkLocalRequest } from "../lib/local-access";
const asset = {
  id: randomUUID(),
  projectId: randomUUID(),
  name: "demo.mp4",
  mime: "video/mp4",
  kind: "video" as const,
  width: 1080,
  height: 1920,
  duration: 6,
  sha256: "abc",
  source: "fixture",
  url: "/api/asset",
};
const product = {
  ...emptyProduct,
  name: "测试商品",
  audience: "测试人群",
  benefits: ["透明外观"],
};
const shots = ruleConcepts(product, [asset])[0].shots;
test("three rule concepts preserve five-shot structure and supplied facts", () => {
  const result = ruleConcepts(product, [asset]);
  assert.equal(result.length, 3);
  assert.ok(result.every((c) => c.source === "rule" && c.shots.length === 5));
  assert.equal(result[0].shots[1].caption, "透明外观");
});
test("rejects media belonging to a different project", () => {
  assert.throws(
    () => validateSources(shots, [{ ...asset, id: randomUUID() }]),
    /素材/,
  );
});
test("rejects video range exceeding actual source duration", () => {
  assert.throws(
    () =>
      validateSources(
        shots.map((s, i) => (i === 0 ? { ...s, trimBefore: 4 } : s)),
        [asset],
      ),
    /素材只有/,
  );
});
test("rejects timelines outside 15–25 seconds", () =>
  assert.throws(() =>
    validateSources(
      shots.map((s) => ({ ...s, seconds: 1 })),
      [asset],
    ),
  ));
test("revision change makes the previous artifact stale", () =>
  assert.equal(isStale({ revision: 2 }, { revision: 1 }), true));
test("supports bounded, open and suffix byte ranges", () => {
  assert.deepEqual(parseRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
});
test("rejects unsatisfiable or multipart ranges", () => {
  assert.throws(() => parseRange("bytes=100-", 100));
  assert.throws(() => parseRange("bytes=0-1,4-5", 100));
});
test("prevents storage traversal outside the local storage root", () =>
  assert.throws(() => storagePath("../../.env.local")));
test("blocks cross-origin requests against the local workspace", () =>
  assert.throws(() =>
    checkLocalRequest(
      new Request("http://127.0.0.1:3100/api/projects", {
        headers: { Origin: "https://example.com" },
      }),
    ),
  ));
