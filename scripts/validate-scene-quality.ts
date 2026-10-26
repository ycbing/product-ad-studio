/** Isolated local acceptance run. Annotation confirmation/export acknowledgement are test-only. */
import assert from "node:assert/strict";
import { PIPELINE_VERSION } from "../lib/production-version";
import { pool } from "../lib/db";
import { storagePath } from "../lib/storage";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const base = process.env.APP_ORIGIN || "http://127.0.0.1:3100";
const assetDir = process.env.REAL_PRODUCTS_ASSET_DIR;
if (!assetDir)
  throw Error("Set REAL_PRODUCTS_ASSET_DIR to same-series coffee source files");
if (process.env.TEXT_API_KEY)
  throw Error("This test requires rule mode; no paid model calls");
const run =
  process.env.QUALITY_RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
if (!/^[A-Za-z0-9_-]+$/.test(run)) throw Error("Invalid run ID");
const out = path.join("evidence/scene-quality", run);
await mkdir(out, { recursive: true });
try {
  await readFile(path.join(out, "report.json"));
  throw Error("Choose a new run ID");
} catch (e: any) {
  if (e.code !== "ENOENT") throw e;
}
const report: any = {
  pipelineVersion: PIPELINE_VERSION,
  status: "running",
  annotationIsTestOnly: true,
  exportAcknowledgementIsTestOnly: true,
  continuousHumanReview: false,
  events: [],
  sources: [],
  startedAt: new Date().toISOString(),
};
const checkpoint = () =>
  writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
await checkpoint();
async function call(
  endpoint: string,
  method = "GET",
  body?: any,
  status = 200,
) {
  const r = await fetch(base + "/api/" + endpoint, {
    method,
    headers:
      body instanceof FormData
        ? {}
        : body
          ? { "Content-Type": "application/json" }
          : {},
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert.equal(r.status, status, `${endpoint}: ${JSON.stringify(data)}`);
  return data;
}
let p: any;
let assets: any[] = [];
async function detail() {
  const d = await call("projects/" + p.id);
  p = d.project;
  assets = d.assets;
  return d;
}
async function save(patch: any = {}) {
  p = (
    await call("projects/" + p.id, "PATCH", {
      expectedRevision: p.revision,
      productionMode: p.productionMode,
      sceneGroup: p.sceneGroup,
      product: p.product,
      shots: p.shots,
      ttsEnabled: false,
      musicEnabled: true,
      ...patch,
    })
  ).project;
}
const event = (text: string) => {
  report.events.push(text);
  console.log("PASS", text);
};
const core = (shots: any[]) => shots.map(({ id, ...s }) => s);
async function wait(job: any) {
  let last = "";
  for (let n = 0; n < 600; n++) {
    const d = await detail(),
      j = d.jobs.find((x: any) => x.id === job.id);
    if (j.stage !== last) {
      console.log(j.stage);
      last = j.stage;
    }
    if (j.status === "failed") throw Error(j.error);
    if (j.status === "succeeded") return d;
    await delay(1000);
  }
  throw Error("Render timeout");
}
async function download(url: string, name: string) {
  const r = await fetch(base + url);
  assert(r.ok);
  const bytes = Buffer.from(await r.arrayBuffer());
  await writeFile(path.join(out, name), bytes);
  return createHash("sha256").update(bytes).digest("hex");
}
try {
  p = (await call("projects", "POST", {}, 201)).project;
  report.projectId = p.id;
  await checkpoint();
  assert.equal(p.productionMode, "scene");
  await save({
    product: {
      ...p.product,
      name: "法压壶",
      brand: "",
      benefits: ["玻璃壶身，展示实际注水与倒出"],
      audience: "在家冲煮咖啡的人",
      scene: "木屋厨房与窗边早餐桌",
      cta: "把早晨，还给自己",
    },
    sceneGroup: "黑柄法压壶 · 木屋早晨",
    shots: [],
  });
  await call(`projects/${p.id}/concepts`, "POST", {}, 422);
  event("unreviewed scene refuses generation without photo fallback");
  const spec = JSON.parse(
    await readFile("fixtures/scene-coffee.json", "utf8"),
  )[0];
  for (const sourceIndex of [2, 3, 1, 0]) {
    const source = spec.assets[sourceIndex],
      bytes = await readFile(path.join(assetDir, source.file));
    const form = new FormData();
    form.append("file", new File([bytes], source.file));
    assets = (await call(`projects/${p.id}/assets`, "POST", form, 201)).assets;
    report.sources.push({
      ...source,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await detail();
  assert(!assets.some((a) => a.kind === "image"));
  event(
    "four real videos uploaded out of narrative order; no mandatory poster image",
  );
  const boxes = [
    { left: 42, top: 18, right: 62, bottom: 60 },
    { left: 65, top: 12, right: 91, bottom: 80 },
    { left: 58, top: 12, right: 84, bottom: 80 },
    { left: 53, top: 12, right: 77, bottom: 78 },
    { left: 67, top: 5, right: 91, bottom: 90 },
  ];
  const roles = ["context", "prepare", "action", "detail", "result"];
  for (const a of assets) {
    const indexes = spec.plan
      .map((v: number, i: number) => (spec.assets[v].file === a.name ? i : -1))
      .filter((i: number) => i >= 0);
    const segments = indexes.map((i: number) => ({
      id: randomUUID(),
      role: roles[i],
      start: spec.starts[i],
      end: spec.starts[i] + spec.seconds[i],
      label: [
        "厨房里准备早餐",
        "将热水注入法压壶",
        "窗边倒咖啡",
        "壶嘴、水流与杯口细节",
        "放下壶，端起杯子",
      ][i],
      focusX: spec.focusXs[i],
      focusY: 50,
      zoom: spec.zooms[i],
      subject: boxes[i],
    }));
    const body = {
      expectedRevision: p.revision,
      assetId: a.id,
      continuityKey: p.sceneGroup,
      confirmed: true,
      segments,
    };
    if (a === assets[0]) {
      await call(
        `projects/${p.id}/asset-review`,
        "POST",
        { ...body, confirmed: false },
        400,
      );
      await call(
        `projects/${p.id}/asset-review`,
        "POST",
        { ...body, segments: [{ ...segments[0], end: 999 }] },
        400,
      );
      await call(
        `projects/${p.id}/asset-review`,
        "POST",
        {
          ...body,
          segments: [
            {
              ...segments[0],
              subject: { left: 0, top: 0, right: 100, bottom: 100 },
            },
          ],
        },
        400,
      );
    }
    const old = p.revision;
    const saved = await call(`projects/${p.id}/asset-review`, "POST", body);
    p = saved.project;
    assets = saved.assets;
    await call(
      `projects/${p.id}/asset-review`,
      "POST",
      { ...body, expectedRevision: old },
      409,
    );
  }
  event(
    "annotations validate explicit confirmation, actual duration, crop containment and revision conflicts",
  );
  p = (await call(`projects/${p.id}/concepts`, "POST", {})).project;
  const first = p.concepts;
  p = (await call(`projects/${p.id}/concepts`, "POST", {})).project;
  for (let i = 0; i < 3; i++)
    assert.deepEqual(core(first[i].shots), core(p.concepts[i].shots));
  event(
    "repeated automatic planning yields identical clips, timing, focal points and text placement",
  );
  p = (
    await call(`projects/${p.id}/select`, "POST", {
      expectedRevision: p.revision,
      conceptId: p.concepts[1].id,
      hook: "先给自己\n一杯的时间",
    })
  ).project;
  assert.deepEqual(
    p.shots.map((s: any) => s.role),
    roles,
  );
  let d = await detail();
  assert.equal(d.quality.ready, true);
  const good = p.shots;
  assert.equal(good[4].textMode, "none");
  assert.equal(good[1].textMode, "none");
  event(
    "semantic roles override upload order; text automatically avoids protected action areas",
  );
  const bads = [
    { index: 1, patch: { focusX: 0 }, code: "SUBJECT_CROPPED" },
    {
      index: 1,
      patch: { textMode: "title", textPlacement: "bottom" },
      code: "TEXT_OVER_SUBJECT",
    },
    { index: 1, patch: { trimBefore: 0 }, code: "UNREVIEWED_RANGE" },
    { index: 0, patch: { reviewId: randomUUID() }, code: "REVIEW_STALE" },
  ];
  for (const b of bads) {
    await save({
      shots: good.map((s: any, i: number) =>
        i === b.index ? { ...s, ...b.patch } : s,
      ),
    });
    d = await detail();
    assert(d.quality.blockers.some((x: any) => x.code === b.code));
    await call(
      `projects/${p.id}/jobs`,
      "POST",
      { kind: "sample", expectedRevision: p.revision },
      422,
    );
    assert.equal(d.jobs.length, 0);
    event(`API blocks ${b.code} before allocating a render job`);
  }
  await save({ shots: good });
  const originalProduct = p.product;
  await save({ product: { ...originalProduct, name: "另一款商品" } });
  await call(
    `projects/${p.id}/jobs`,
    "POST",
    { kind: "sample", expectedRevision: p.revision },
    422,
  );
  await save({ product: originalProduct });
  event("changing product identity requires renewed material verification");
  await call(
    `projects/${p.id}/jobs`,
    "POST",
    { kind: "render", expectedRevision: p.revision },
    409,
  );
  report.timeline = p.shots;
  report.revision = p.revision;
  await checkpoint();
  const sample = (
    await call(
      `projects/${p.id}/jobs`,
      "POST",
      { kind: "sample", expectedRevision: p.revision },
      202,
    )
  ).job;
  const repeat = (
    await call(
      `projects/${p.id}/jobs`,
      "POST",
      { kind: "sample", expectedRevision: p.revision },
      202,
    )
  ).job;
  assert.equal(sample.id, repeat.id);
  report.sampleJobId = sample.id;
  await checkpoint();
  event("same-revision duplicate sample request reuses one job");
  d = await wait(sample);
  const s = d.artifacts.find(
    (a: any) => a.kind === "sample" && a.revision === p.revision,
  );
  report.sampleSha256 = await download(s.url, "automatic-scene-sample.mp4");
  await call(`projects/${p.id}/approve`, "POST", {
    expectedRevision: p.revision,
  });
  const render = (
    await call(
      `projects/${p.id}/jobs`,
      "POST",
      { kind: "render", expectedRevision: p.revision },
      202,
    )
  ).job;
  report.renderJobId = render.id;
  await checkpoint();
  d = await wait(render);
  const final = d.artifacts.find(
    (a: any) => a.kind === "render" && a.revision === p.revision,
  );
  assert.equal(final.width, 1080);
  assert.equal(final.height, 1920);
  assert(Math.abs(final.duration - 18.5) < 0.15);
  report.final = {
    ...final,
    sha256: await download(final.url, "automatic-scene-1080p.mp4"),
  };
  event(
    "actual sample and 1080p render complete using automatically planned shots",
  );
  assert.equal(final.pipelineVersion, PIPELINE_VERSION);
  const sampleRow = (
    await pool.query(
      "SELECT checks FROM artifacts WHERE id=$1 AND project_id=$2",
      [s.id, p.id],
    )
  ).rows[0];
  try {
    await pool.query(
      "UPDATE artifacts SET checks=jsonb_set(checks,'{pipelineVersion}',$1::jsonb) WHERE id=$2 AND project_id=$3",
      [JSON.stringify("old-engine"), s.id, p.id],
    );
    const stale = await detail();
    assert.equal(stale.approved, false);
    await call(
      `projects/${p.id}/approve`,
      "POST",
      { expectedRevision: p.revision },
      400,
    );
    await call(
      `projects/${p.id}/jobs`,
      "POST",
      { kind: "render", expectedRevision: p.revision },
      409,
    );
    event(
      "old-engine sample cannot approve or authorize export, even at the same project revision",
    );
  } finally {
    await pool.query(
      "UPDATE artifacts SET checks=$1 WHERE id=$2 AND project_id=$3",
      [sampleRow.checks, s.id, p.id],
    );
  }

  const original = p,
    copy = (await call(`projects/${p.id}/duplicate`, "POST", {}, 201)).project;
  report.copyProjectId = copy.id;
  let copied = await call(`projects/${copy.id}`);
  assert.equal(copied.project.productionMode, "scene");
  assert.equal(copied.quality.ready, true);
  event(
    "duplicated project preserves scene mode, identity and verified framing",
  );
  const a = copied.assets[0];
  // Corrupt only a newly duplicated disposable test source; restore in finally.
  const row = (
    await pool.query(
      "SELECT storage_key FROM assets WHERE id=$1 AND project_id=$2",
      [a.id, copy.id],
    )
  ).rows[0];
  const file = storagePath(row.storage_key),
    originalBytes = await readFile(file);
  try {
    const changed = Buffer.from(originalBytes);
    changed[changed.length - 1] ^= 1;
    await writeFile(file, changed);
    const job = (
      await call(
        `projects/${copy.id}/jobs`,
        "POST",
        { kind: "sample", expectedRevision: copy.revision },
        202,
      )
    ).job;
    let failed: any;
    for (let n = 0; n < 30; n++) {
      const state = await call(`projects/${copy.id}`);
      failed = state.jobs.find((j: any) => j.id === job.id);
      if (failed.status === "failed") break;
      await delay(500);
    }
    assert.equal(failed?.status, "failed");
    assert.match(failed.error, /原始素材内容已改变/);
    assert.equal(failed.retryable, false);
    event(
      "worker rejects changed source bytes before rendering, even when metadata still appears valid",
    );
  } finally {
    await writeFile(file, originalBytes);
  }

  await call(
    `projects/${copy.id}/asset-review`,
    "POST",
    {
      expectedRevision: copy.revision,
      assetId: assets[0].id,
      continuityKey: copy.sceneGroup,
      confirmed: true,
      segments: a.sceneReview.segments,
    },
    400,
  );
  event("annotation route rejects another project's asset ID");
  copied = await call(`projects/${copy.id}/asset-review`, "POST", {
    expectedRevision: copy.revision,
    assetId: a.id,
    continuityKey: a.sceneReview.continuityKey,
    confirmed: true,
    segments: a.sceneReview.segments,
  });
  const changed = await call(`projects/${copy.id}`);
  assert.equal(changed.approved, false);
  assert.equal(changed.quality.ready, false);
  await call(
    `projects/${copy.id}/jobs`,
    "POST",
    { kind: "sample", expectedRevision: changed.project.revision },
    422,
  );
  event(
    "editing annotations invalidates old shots and approval; stale references cannot export",
  );
  await call(`projects/${copy.id}`, "DELETE");
  p = original;
  d = await detail();
  assert(d.approved);
  assert(d.quality.ready);
  report.quality = d.quality;
  report.status = "passed";
  report.finishedAt = new Date().toISOString();
  await checkpoint();
  console.log("REPORT", path.resolve(out, "report.json"));
} catch (e: any) {
  report.status = "failed";
  report.error = e.message;
  await checkpoint();
  await pool.end();
  throw e;
}

await pool.end();
