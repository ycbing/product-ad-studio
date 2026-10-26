import { randomUUID, createHash } from "node:crypto";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pool, transaction } from "../lib/db";
import { validateSources } from "../lib/models";
import { storagePath, prepareStorage } from "../lib/storage";
import { probe, exec, mediaBinary } from "../lib/media";
import { speech } from "./speech";
const root = process.cwd();
const workerId = randomUUID();
let stopping = false;
let activeChild: ReturnType<typeof spawn> | null = null;
process.on("SIGTERM", () => {
  stopping = true;
  activeChild?.kill("SIGTERM");
});
process.on("SIGINT", () => {
  stopping = true;
  activeChild?.kill("SIGTERM");
});
async function update(job: any, progress: number, stage: string) {
  await pool.query(
    "UPDATE jobs SET progress=$1,stage=$2,updated_at=now() WHERE id=$3 AND worker_id=$4",
    [progress, stage, job.id, workerId],
  );
}
async function render(job: any) {
  const p = job.snapshot.project;
  const assets = job.snapshot.assets;
  validateSources(p.shots, assets);
  const dir = path.join(root, ".local/jobs", job.id);
  for (const name of [
    "src",
    "public/media",
    "public/voice",
    "public/music",
    "scripts",
    "catalog",
  ])
    await mkdir(path.join(dir, name), { recursive: true });
  const assetRows = (
    await pool.query(
      "SELECT * FROM assets WHERE project_id=$1 AND owner_id=$2",
      [job.project_id, job.owner_id],
    )
  ).rows;
  const selected =
    job.kind === "voice"
      ? p.shots.filter((s: any) => s.id === job.shot_id)
      : p.shots;
  const shots = [];
  let voiceArtifact: string | null = null;
  for (let i = 0; i < selected.length; i++) {
    const s = selected[i];
    await update(
      job,
      5 + Math.round((i / selected.length) * 25),
      `准备镜头 ${i + 1} / ${selected.length}`,
    );
    const a = assetRows.find((a: any) => a.id === s.assetId);
    if (!a) throw Error("原始素材不存在");
    const ext = path.extname(a.storage_key);
    const source = `media/${a.id}${ext}`;
    await copyFile(
      storagePath(a.storage_key),
      path.join(dir, "public", source),
    );
    const audio =
      p.ttsEnabled || job.kind === "voice"
        ? await speech(s.caption, job)
        : null;
    if (audio && audio.seconds + 0.12 > s.seconds)
      throw Error(
        `镜头 ${p.shots.findIndex((x: any) => x.id === s.id) + 1} 的配音需要 ${(audio.seconds + 0.12).toFixed(1)} 秒，请增加镜头时长或缩短文案`,
      );
    let voice: string | null = null;
    if (audio) {
      voice = `voice/${audio.hash}.wav`;
      await copyFile(audio.file, path.join(dir, "public", voice));
      voiceArtifact = audio.file;
    }
    shots.push({
      ...s,
      source,
      kind: a.metadata.kind,
      audio: voice,
      voiceSeconds: audio?.seconds ?? 0,
    });
  }
  let produced: string;
  let checks: any = {};
  let width = 0,
    height = 0,
    duration = 0;
  if (job.kind === "voice") {
    if (!voiceArtifact) throw Error("此镜头没有旁白文字");
    produced = voiceArtifact;
    duration = Number((await probe(produced)).format.duration);
  } else {
    const music = p.musicEnabled !== false ? "music/demo.wav" : null;
    if (music)
      await copyFile(
        path.join(root, "renderer/public/music-real.wav"),
        path.join(dir, "public", music),
      );
    const props = {
      format: "9:16",
      productName: p.product.name,
      brand: p.product.brand || "",
      price: p.product.price || "",
      offer: p.product.offer || "",
      cta: p.product.cta || "",
      music,
      shots,
    };
    await writeFile(
      path.join(dir, "inputs.json"),
      JSON.stringify({ template: "web-product", props }),
    );
    await writeFile(
      path.join(dir, "assets.json"),
      JSON.stringify({
        assets: assets.map((a: any) => ({
          id: a.id,
          sha256: a.sha256,
          source: a.source,
        })),
      }),
    );
    await writeFile(
      path.join(dir, "catalog/web-product.json"),
      JSON.stringify({
        compositionId: "WebStory",
        defaultFormat: "9:16",
        sample: { from: 0, to: shots.reduce((n, s) => n + s.seconds, 0) },
      }),
    );
    for (const name of ["web-entry.tsx", "web-story.tsx", "web-schema.ts"])
      await copyFile(
        path.join(root, "renderer/src", name),
        path.join(dir, "src", name === "web-entry.tsx" ? "index.tsx" : name),
      );
    for (const name of ["render.mjs", "render-support.mjs"])
      await copyFile(
        path.join(root, "renderer/scripts", name),
        path.join(dir, "scripts", name),
      );
    await copyFile(
      path.join(root, "renderer/tsconfig.json"),
      path.join(dir, "tsconfig.json"),
    );
    await copyFile(
      path.join(root, "package.json"),
      path.join(dir, "package.json"),
    );
    await copyFile(
      path.join(root, "package-lock.json"),
      path.join(dir, "package-lock.json"),
    );
    await update(job, 35, "渲染视频");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.join(dir, "scripts/render.mjs"),
          "--project",
          dir,
          "--mode",
          job.kind,
          "--scale",
          job.kind === "sample" ? "0.5" : "1",
        ],
        { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      activeChild = child;
      let errors = "";
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        errors = (errors + text).slice(-4000);
        const percent = /Rendering (\d+)%/.exec(text);
        if (percent)
          void update(
            job,
            35 + Math.round(Number(percent[1]) * 0.55),
            "渲染视频",
          );
      });
      child.stdout.on("data", () => {});
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(Error("渲染超过 10 分钟，请检查素材或减少并发"));
      }, 600000);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        activeChild = null;
        code === 0
          ? resolve()
          : reject(Error("渲染失败：" + errors.slice(-1600)));
      });
    });
    const report = JSON.parse(
      await readFile(path.join(dir, "out", `${job.kind}.report.json`), "utf8"),
    );
    if (report.status !== "rendered") throw Error("渲染期间输入发生变化");
    produced = path.join(dir, report.output);
    width = report.width;
    height = report.height;
    duration = report.encodedDurationSeconds;
    const expected = job.kind === "sample" ? [540, 960] : [1080, 1920];
    if (
      width !== expected[0] ||
      height !== expected[1] ||
      Math.abs(duration - shots.reduce((n, s) => n + s.seconds, 0)) > 0.15
    )
      throw Error("成片尺寸或时长检查未通过");
    await update(job, 94, "检查视频与音频");
    const info = await probe(produced);
    if (
      (p.ttsEnabled || music) &&
      !info.streams.some((s: any) => s.codec_type === "audio")
    )
      throw Error("成片缺少音轨");
    checks = {
      format: "passed",
      duration: "passed",
      audio: info.streams.some((s: any) => s.codec_type === "audio")
        ? "present"
        : "disabled",
      visualReview: "not-reviewed",
      fingerprint: report.fingerprint,
    };
    try {
      const ffmpeg = mediaBinary("ffmpeg"),
        ffprobe = mediaBinary("ffprobe");
      const { stdout } = await exec(
        "python3",
        [
          path.join(root, "scripts/check-video.py"),
          produced,
          ffmpeg.file,
          ffprobe.file,
        ],
        { env: { ...ffmpeg.env }, timeout: 90000, maxBuffer: 2 * 1024 * 1024 },
      );
      checks.vvv = JSON.parse(stdout);
    } catch {
      checks.vvv = {
        status: "unavailable",
        message: "可选 VVV Python 检查未完成；基础尺寸、时长和音轨检查已完成",
      };
    }
    if (
      checks.vvv?.checks?.some(
        (c: any) =>
          c.status === "failed" && ["AUDIO", "FORMAT"].includes(c.code),
      )
    )
      throw Error("VVV 检查发现音频或画幅异常，请检查素材后重试");
  }
  const aid = randomUUID(),
    key = `artifacts/${aid}${job.kind === "voice" ? ".wav" : ".mp4"}`;
  await mkdir(storagePath("artifacts"), { recursive: true });
  await copyFile(produced, storagePath(key));
  const hash = createHash("sha256")
    .update(await readFile(produced))
    .digest("hex");
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO artifacts(id,job_id,project_id,owner_id,revision,kind,storage_key,width,height,duration,sha256,checks) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(job_id) DO NOTHING",
      [
        aid,
        job.id,
        job.project_id,
        job.owner_id,
        job.revision,
        job.kind,
        key,
        width,
        height,
        duration,
        hash,
        checks,
      ],
    );
    await c.query(
      "UPDATE jobs SET status='succeeded',progress=100,stage='已完成',lease_until=NULL,updated_at=now() WHERE id=$1",
      [job.id],
    );
    if (job.kind !== "voice")
      await c.query(
        "UPDATE projects SET status=$1,updated_at=now() WHERE id=$2 AND revision=$3 AND deleted_at IS NULL",
        [
          job.kind === "sample" ? "review" : "completed",
          job.project_id,
          job.revision,
        ],
      );
  });
}
await prepareStorage();
console.log("Render worker ready (PostgreSQL queue).");
while (!stopping) {
  await pool.query(
    "UPDATE jobs SET status='failed',stage='任务中断',error='工作进程中断；成功素材已缓存，可检查后重试',retryable=$1,updated_at=now() WHERE status='running' AND lease_until<now()",
    [process.env.TTS_PROVIDER !== "openai"],
  );
  const job = await transaction(async (c) => {
    const row = (
      await c.query(
        "SELECT j.* FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.status='queued' AND p.deleted_at IS NULL ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!row) return null;
    return (
      await c.query(
        "UPDATE jobs SET status='running',stage='准备素材',attempts=attempts+1,worker_id=$1,lease_until=now()+interval '90 seconds',updated_at=now() WHERE id=$2 RETURNING *",
        [workerId, row.id],
      )
    ).rows[0];
  });
  if (!job) {
    await delay(1000);
    continue;
  }
  const heartbeat = setInterval(() => {
    void pool.query(
      "UPDATE jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND worker_id=$2 AND status='running'",
      [job.id, workerId],
    );
  }, 15000);
  try {
    await render(job);
  } catch (error: any) {
    const message = String(error.message).replaceAll(root, "[project]");
    await pool.query(
      "UPDATE jobs SET status='failed',stage='需要处理',error=$1,retryable=$2,lease_until=NULL,updated_at=now() WHERE id=$3",
      [message.slice(0, 2000), error.retryable !== false, job.id],
    );
    console.error("Job failed", job.id, message);
  } finally {
    clearInterval(heartbeat);
  }
}
await pool.end();
