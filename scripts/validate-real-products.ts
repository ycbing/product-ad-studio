/** Real uploads and renders through the production API. No paid AI calls. */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { pool } from "../lib/db";
import type { Asset } from "../lib/models";
import { ownerId } from "../lib/local-access";
const base = process.env.APP_ORIGIN || "http://127.0.0.1:3100";
const assetDir = process.env.REAL_PRODUCTS_ASSET_DIR;
if (!assetDir)
  throw Error(
    "Set REAL_PRODUCTS_ASSET_DIR to the downloaded source directory.",
  );
if (process.env.TEXT_API_KEY)
  throw Error(
    "This visual-validation run requires rule mode; do not invoke a paid text model.",
  );
const runId =
  process.env.VALIDATION_RUN_ID ||
  new Date().toISOString().replace(/[:.]/g, "-");
if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw Error("Invalid validation run ID");
const output = path.join("evidence/real-products", runId);
await mkdir(output, { recursive: true });
try {
  await access(path.join(output, "report.json"));
  throw Error(
    "Report already exists; choose a new run ID to preserve previous results.",
  );
} catch (e: any) {
  if (e.code !== "ENOENT") throw e;
}
const specs = JSON.parse(
  await readFile(
    process.env.REAL_PRODUCTS_FIXTURE || "fixtures/real-products.json",
    "utf8",
  ),
);
const prior = process.env.REAL_PRODUCTS_REUSE_REPORT
  ? JSON.parse(await readFile(process.env.REAL_PRODUCTS_REUSE_REPORT, "utf8"))
  : null;
const report: any = {
  parentRun: prior?.runId ?? null,
  templateRevision: "scene-first-v3",
  runId,
  createdAt: new Date().toISOString(),
  status: "running",
  pipeline:
    "real HTTP upload → saved project → rule concepts → custom storyboard → sample → test acknowledgement → full render",
  audio:
    "Same original synthesized music; narration disabled for this visual comparison. No paid AI calls.",
  approvalIsTestOnly: true,
  humanContinuousReview: false,
  results: [],
};
async function checkpoint() {
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
async function call(
  endpoint: string,
  method = "GET",
  body?: any,
  expected = 200,
) {
  const response = await fetch(base + "/api/" + endpoint, {
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
  const value = await response.json();
  if (response.status !== expected)
    throw Error(
      `${method} ${endpoint}: ${response.status} ${JSON.stringify(value)}`,
    );
  return value;
}
async function wait(projectId: string, jobId: string) {
  let previous = "";
  for (let i = 0; i < 600; i++) {
    const detail = await call("projects/" + projectId);
    const j = detail.jobs.find((j: any) => j.id === jobId);
    if (j?.stage !== previous) {
      console.log(projectId.slice(0, 8), j?.stage);
      previous = j?.stage;
    }
    if (j?.status === "failed") throw Error(j.error);
    if (j?.status === "succeeded") return detail;
    await delay(1000);
  }
  throw Error("Render timeout");
}
async function download(url: string, target: string) {
  const r = await fetch(base + url);
  if (!r.ok) throw Error("Artifact download failed");
  await writeFile(target, Buffer.from(await r.arrayBuffer()));
}
for (const spec of specs) {
  const result: any = {
    slug: spec.slug,
    name: spec.name,
    identity: spec.identity,
    test: spec.test,
    outputLicense: spec.outputLicense,
    sources: [],
    status: "preparing",
  };
  report.results.push(result);
  await checkpoint();
  try {
    let p: any;
    const uploaded: Asset[] = [];
    const previous = prior?.results.find((r: any) => r.slug === spec.slug);
    if (previous) {
      const d = await call("projects/" + previous.projectId);
      assert.equal(
        d.project.revision,
        previous.revision,
        "Project changed after validation; preserve user edits and use a new run.",
      );
      p = d.project;
      result.projectId = p.id;
      result.sources = previous.sources;
      for (const source of spec.assets) {
        const asset = d.assets.find((a: any) => a.name === source.file);
        assert(asset);
        assert.equal(
          asset.sha256,
          previous.sources.find((s: any) => s.file === source.file).sha256,
        );
        uploaded.push(asset);
      }
      console.log("RECHECK", spec.name);
      await checkpoint();
    } else {
      console.log("START", spec.name);
      p = (await call("projects", "POST", {}, 201)).project;
      result.projectId = p.id;
      await checkpoint();
      for (const source of spec.assets) {
        const bytes = await readFile(path.join(assetDir, source.file));
        const form = new FormData();
        form.append("file", new File([bytes], source.file));
        const data = await call(`projects/${p.id}/assets`, "POST", form, 201);
        const a = data.assets.find((a: any) => a.name === source.file);
        assert(a);
        const provenance = {
          source: source.page,
          rights: {
            author: source.author,
            license: source.license,
            licenseUrl: source.licenseUrl,
            changes:
              "Reframed, rescaled and overlaid with demonstration text; no generative alteration of the product.",
            note: source.note ?? "",
          },
        };
        await pool.query(
          "UPDATE assets SET metadata=metadata || $1::jsonb WHERE id=$2 AND project_id=$3 AND owner_id=$4",
          [JSON.stringify(provenance), a.id, p.id, ownerId()],
        );
        uploaded.push(a);
        result.sources.push({
          ...source,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
          width: a.width,
          height: a.height,
          duration: a.duration,
        });
      }
    }
    p = (
      await call("projects/" + p.id, "PATCH", {
        expectedRevision: p.revision,
        productionMode: "presentation",
        product: {
          name: "验证 · " + spec.name,
          benefits: spec.benefits,
          audience: spec.audience,
          scene: spec.scene,
          price: "",
          offer: "",
          brand: spec.brand,
          cta: "以实际商品说明为准",
          forbidden: "不虚构价格、性能、认证或品牌背书",
        },
        shots: [],
        ttsEnabled: false,
        musicEnabled: true,
      })
    ).project;
    p = (await call(`projects/${p.id}/concepts`, "POST", {})).project;
    assert(p.concepts.every((c: any) => c.source === "rule"));
    p = (
      await call(`projects/${p.id}/select`, "POST", {
        expectedRevision: p.revision,
        conceptId: p.concepts[0].id,
        hook: spec.headlines[0],
      })
    ).project;
    const shots = spec.plan.map((assetIndex: number, i: number) => ({
      id: randomUUID(),
      headline: spec.headlines[i],
      caption: spec.captions[i],
      seconds: spec.seconds?.[i] ?? 3,
      textMode: spec.textModes?.[i],
      zoom: spec.zooms?.[i] ?? 1,
      sourceVolume: 0,
      assetId: uploaded[assetIndex].id,
      trimBefore: spec.starts?.[i] ?? 0,
      focusX: spec.focusXs?.[i] ?? spec.focusX ?? 50,
      focusY: 50,
      description: `${spec.test}；${spec.identity}`,
      fit: uploaded[assetIndex].kind === "video" ? "cover" : "contain",
      allowGenerated: false,
    }));
    p = (
      await call("projects/" + p.id, "PATCH", {
        expectedRevision: p.revision,
        product: p.product,
        shots,
        ttsEnabled: false,
        musicEnabled: true,
      })
    ).project;
    result.revision = p.revision;
    result.expectedSeconds = shots.reduce(
      (n: number, s: any) => n + s.seconds,
      0,
    );
    const sampleJob = (
      await call(
        `projects/${p.id}/jobs`,
        "POST",
        { kind: "sample", expectedRevision: p.revision },
        202,
      )
    ).job;
    result.sampleJobId = sampleJob.id;
    result.status = "rendering-sample";
    await checkpoint();
    const sampleDetail = await wait(p.id, sampleJob.id);
    const sample = sampleDetail.artifacts.find(
      (a: any) => a.kind === "sample" && a.revision === p.revision,
    );
    assert.equal(sample.width, 540);
    assert.equal(sample.height, 960);
    await download(sample.url, path.join(output, spec.slug + "-sample.mp4"));
    // Controlled validation acknowledgement, not a claim of human/commercial approval.
    await call(`projects/${p.id}/approve`, "POST", {
      expectedRevision: p.revision,
    });
    const renderJob = (
      await call(
        `projects/${p.id}/jobs`,
        "POST",
        { kind: "render", expectedRevision: p.revision },
        202,
      )
    ).job;
    result.renderJobId = renderJob.id;
    result.status = "rendering-full";
    await checkpoint();
    const finalDetail = await wait(p.id, renderJob.id);
    const final = finalDetail.artifacts.find(
      (a: any) => a.kind === "render" && a.revision === p.revision,
    );
    assert.equal(final.width, 1080);
    assert.equal(final.height, 1920);
    assert(Math.abs(final.duration - result.expectedSeconds) < 0.15);
    await download(final.url, path.join(output, spec.slug + "-1080p.mp4"));
    const row = (
      await pool.query(
        "SELECT checks,sha256 FROM artifacts WHERE id=$1 AND owner_id=$2",
        [final.id, ownerId()],
      )
    ).rows[0];
    result.status = "rendered";
    result.width = final.width;
    result.height = final.height;
    result.duration = final.duration;
    result.sha256 = row.sha256;
    result.checks = row.checks;
    result.video = spec.slug + "-1080p.mp4";
    result.sample = spec.slug + "-sample.mp4";
    const credits = [
      "# " + spec.name + " — 原始素材与授权",
      "",
      `Identity: ${spec.identity}`,
      `Output terms: ${spec.outputLicense}`,
      "",
      "This is an unofficial visual-validation sample, not an advertisement commissioned or endorsed by the brand.",
      "Original synthesized music is CC0. Narration is disabled.",
      "",
    ];
    for (const s of result.sources)
      credits.push(
        `- ${s.file}: ${s.author}; ${s.license}. Source: ${s.page}; license: ${s.licenseUrl}. Changes: rescaled/reframed with text overlay; original product pixels preserved. SHA-256: ${s.sha256}`,
      );
    if (spec.factsSource)
      credits.push("", `Product facts: ${spec.factsSource}`);
    await writeFile(
      path.join(output, spec.slug + "-sources.md"),
      credits.join("\n") + "\n",
    );
    console.log("PASS", spec.slug, final.width, final.height, final.duration);
    await checkpoint();
  } catch (error: any) {
    result.status = "failed";
    result.error = error.message;
    console.error("FAIL", spec.slug, error.message);
    await checkpoint();
  }
}
report.status = report.results.every((r: any) => r.status === "rendered")
  ? "rendered-all"
  : "partial-failure";
await checkpoint();
await pool.end();
console.log("REPORT", path.resolve(output, "report.json"));
if (report.status !== "rendered-all") process.exitCode = 1;
