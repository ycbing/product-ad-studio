import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
const base = "http://127.0.0.1:3100/api/";
const events: any[] = [];
let id = "";
let project: any;
let latest: any;
async function call(url: string, method = "GET", data?: any, status = 200) {
  const response = await fetch(base + url, {
    method,
    headers:
      data instanceof FormData
        ? {}
        : data
          ? { "Content-Type": "application/json" }
          : {},
    body:
      data instanceof FormData ? data : data ? JSON.stringify(data) : undefined,
  });
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}
async function detail() {
  latest = await call("projects/" + id);
  project = latest.project;
  return latest;
}
async function waitJob(jid: string) {
  let previous = "";
  for (let i = 0; i < 300; i++) {
    const d = await detail();
    const j = d.jobs.find((j: any) => j.id === jid);
    if (j?.stage !== previous) {
      console.log(j?.stage ?? "等待");
      previous = j?.stage;
    }
    if (j?.status === "failed") throw Error(j.error);
    if (j?.status === "succeeded") return d;
    await delay(1000);
  }
  throw Error("Timed out waiting for render");
}
try {
  project = (await call("projects", "POST", {}, 201)).project;
  id = project.id;
  console.log("Created isolated acceptance-test project", id);
  let form = new FormData();
  form.append(
    "file",
    new File(["not an image"], "fake.png", { type: "image/png" }),
  );
  await call(`projects/${id}/assets`, "POST", form, 400);
  events.push("fake MIME rejected");
  for (const file of [
    "public/demo/cover.png",
    "renderer/public/footage/shelf.mp4",
  ]) {
    form = new FormData();
    form.append(
      "file",
      new File([await readFile(file)], file.split("/").pop()!),
    );
    await call(`projects/${id}/assets`, "POST", form, 201);
  }
  await detail();
  events.push("real image and MP4 uploaded with probed metadata");
  let payload = {
    expectedRevision: project.revision,
    product: {
      ...project.product,
      name: "验收测试商品",
      price: "测试价格（非售价）",
      offer: "测试字段，仅用于验收",
      benefits: ["透明罐身，内容可见"],
      audience: "测试用户",
      cta: "查看商品详情",
    },
    shots: [],
    ttsEnabled: false,
    musicEnabled: true,
  };
  project = (await call("projects/" + id, "PATCH", payload)).project;
  await call("projects/" + id, "PATCH", payload, 409);
  events.push("optimistic revision conflict rejected");
  project = (await call(`projects/${id}/concepts`, "POST", {})).project;
  assert.equal(project.concepts.length, 3);
  assert.equal(project.concepts[0].source, "rule");
  project = (
    await call(`projects/${id}/select`, "POST", {
      conceptId: project.concepts[0].id,
      expectedRevision: project.revision,
      hook: "透明罐身，装得明白",
    })
  ).project;
  events.push("three explicitly marked rule concepts and edited hook saved");
  project = (
    await call("projects/" + id, "PATCH", {
      expectedRevision: project.revision,
      product: project.product,
      shots: project.shots.map((s: any, i: number) => ({
        ...s,
        seconds: 3,
        ...(i === 2
          ? {
              assetId: latest.assets.find((a: any) => a.kind === "image").id,
              fit: "contain",
            }
          : {}),
      })),
      ttsEnabled: false,
      musicEnabled: true,
    })
  ).project;
  await call(
    `projects/${id}/jobs`,
    "POST",
    { kind: "render", expectedRevision: project.revision },
    409,
  );
  events.push("full export blocked before sample approval");
  const requests = await Promise.all(
    Array.from({ length: 5 }, () =>
      call(
        `projects/${id}/jobs`,
        "POST",
        { kind: "sample", expectedRevision: project.revision },
        202,
      ),
    ),
  );
  assert.equal(new Set(requests.map((x) => x.job.id)).size, 1);
  events.push("five concurrent requests share exactly one job");
  await waitJob(requests[0].job.id);
  let sample = latest.artifacts.find((a: any) => a.kind === "sample");
  assert.equal(sample.width, 540);
  assert.equal(sample.height, 960);
  events.push("real mixed-image-and-video low-resolution render completed");
  // Simulated acknowledgement in a disposable test project; not a claim of artistic/user approval.
  await call(
    `projects/${id}/approve`,
    "POST",
    { expectedRevision: project.revision - 1 },
    409,
  );
  await call(`projects/${id}/approve`, "POST", {
    expectedRevision: project.revision,
  });
  events.push(
    "current-revision confirmation gate exercised with simulated test-owner acknowledgement",
  );
  const result = await call(
    `projects/${id}/jobs`,
    "POST",
    { kind: "render", expectedRevision: project.revision },
    202,
  );
  await waitJob(result.job.id);
  const artifact = latest.artifacts.find((a: any) => a.kind === "render");
  assert.equal(artifact.width, 1080);
  assert.equal(artifact.height, 1920);
  assert.ok(Math.abs(artifact.duration - 15) < 0.15);
  events.push("real 1080p export completed");
  const range = await fetch("http://127.0.0.1:3100" + artifact.url, {
    headers: { Range: "bytes=0-100" },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 101);
  const invalid = await fetch("http://127.0.0.1:3100" + artifact.url, {
    headers: { Range: "bytes=999999999-" },
  });
  assert.equal(invalid.status, 416);
  events.push("video range playback and invalid ranges verified");
  await mkdir("evidence", { recursive: true });
  const download = await fetch(
    "http://127.0.0.1:3100" + artifact.url + "?download=1",
  );
  assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
  await writeFile(
    "evidence/web-pipeline-1080p.mp4",
    Buffer.from(await download.arrayBuffer()),
  );
  project = (
    await call("projects/" + id, "PATCH", {
      expectedRevision: project.revision,
      product: project.product,
      shots: project.shots.map((s: any, i: number) =>
        i === 0 ? { ...s, headline: "修改后的商品开场" } : s,
      ),
      ttsEnabled: false,
      musicEnabled: true,
    })
  ).project;
  await detail();
  assert.equal(latest.approved, false);
  assert.notEqual(sample.revision, project.revision);
  await call(
    `projects/${id}/jobs`,
    "POST",
    { kind: "render", expectedRevision: project.revision },
    409,
  );
  events.push("editing invalidates old sample approval and blocks export");
  await call("projects/" + id, "DELETE");
  await call("projects/" + id, "GET", undefined, 404);
  const hidden = await fetch("http://127.0.0.1:3100" + artifact.url);
  assert.equal(hidden.status, 404);
  events.push("deleted project and its files are inaccessible");
  await writeFile(
    "evidence/integration.json",
    JSON.stringify(
      {
        status: "passed",
        createdAt: new Date().toISOString(),
        testProjectId: id,
        events,
      },
      null,
      2,
    ),
  );
  console.log("PASS", events);
} catch (error) {
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/integration.json",
    JSON.stringify(
      { status: "failed", testProjectId: id, events, error: String(error) },
      null,
      2,
    ),
  );
  throw error;
}
