import { randomUUID, createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  pool,
  transaction,
  projectRow,
  assetRow,
  jobRow,
  artifactRow,
} from "./db";
import { ownerId, checkLocalRequest } from "./local-access";
import {
  emptyProduct,
  projectPatch,
  validateSources,
  assertReady,
} from "./models";
import { PIPELINE_VERSION, productionJobKey } from "./production-version";
import { sceneQuality, assertSceneReady } from "./scene-quality";
import { reviewInputSchema, productIdentity } from "./scene-model";
import { visibleSource, contains } from "../renderer/src/scene-framing";
import { makeConcepts } from "./concepts";
import { prepareStorage, storagePath, serveFile } from "./storage";
import { probe } from "./media";
class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function body(req: Request) {
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 100_000)
    throw new HttpError("请求内容过大", 413);
  return JSON.parse(raw || "{}");
}
async function project(id: string) {
  z.string().uuid().parse(id);
  const { rows } = await pool.query(
    "SELECT * FROM projects WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
    [id, ownerId()],
  );
  if (!rows[0]) throw new HttpError("项目不存在", 404);
  return projectRow(rows[0]);
}
async function assets(id: string) {
  return (
    await pool.query(
      "SELECT * FROM assets WHERE project_id=$1 AND owner_id=$2 ORDER BY created_at",
      [id, ownerId()],
    )
  ).rows.map(assetRow);
}
export async function handle(req: Request, parts: string[]) {
  try {
    checkLocalRequest(req);
    const method = req.method;
    const [group, id, action] = parts;
    if (group === "capabilities" && method === "GET")
      return json({
        mode: "local-owner",
        text: !!(process.env.TEXT_API_KEY && process.env.TEXT_MODEL),
        voice:
          process.env.TTS_PROVIDER === "openai" && !!process.env.TTS_API_KEY
            ? "api"
            : process.env.TTS_PROVIDER === "system" &&
                process.platform === "darwin"
              ? "system"
              : "none",
        message: "本机单用户开发版；规则剧情明确标识，渲染为真实输出",
      });
    if (group === "projects" && !id && method === "GET")
      return json({
        projects: (
          await pool.query(
            "SELECT p.*, (SELECT id FROM assets WHERE project_id=p.id AND metadata->>'kind'='image' ORDER BY created_at LIMIT 1) AS cover_id FROM projects p WHERE p.owner_id=$1 AND p.deleted_at IS NULL ORDER BY p.updated_at DESC",
            [ownerId()],
          )
        ).rows.map(projectRow),
      });
    if (group === "projects" && !id && method === "POST") {
      const pid = randomUUID();
      const document = {
        productionMode: "scene",
        sceneGroup: "",
        product: { ...emptyProduct },
        concepts: [],
        selectedConceptId: null,
        shots: [],
        ttsEnabled: process.env.TTS_PROVIDER !== "none",
      };
      await pool.query(
        "INSERT INTO projects(id,owner_id,document) VALUES($1,$2,$3)",
        [pid, ownerId(), document],
      );
      return json({ project: await project(pid) }, 201);
    }
    if (group === "projects" && id) {
      const p = await project(id);
      if (!action && method === "GET") {
        const [aa, jj, rr, approval, usage] = await Promise.all([
          assets(id),
          pool.query(
            "SELECT * FROM jobs WHERE project_id=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 20",
            [id, ownerId()],
          ),
          pool.query(
            "SELECT * FROM artifacts WHERE project_id=$1 AND owner_id=$2 ORDER BY created_at DESC",
            [id, ownerId()],
          ),
          pool.query(
            "SELECT 1 FROM approvals ap JOIN artifacts a ON a.id=ap.artifact_id WHERE ap.project_id=$1 AND ap.revision=$2 AND ap.owner_id=$3 AND a.checks->>'pipelineVersion'=$4",
            [id, p.revision, ownerId(), PIPELINE_VERSION],
          ),
          pool.query(
            "SELECT provider,operation,units,cost,created_at FROM usage_events WHERE project_id=$1 AND owner_id=$2 ORDER BY created_at DESC",
            [id, ownerId()],
          ),
        ]);
        return json({
          project: p,
          quality: sceneQuality(p, aa),
          assets: aa,
          jobs: jj.rows.map(jobRow),
          artifacts: rr.rows.map(artifactRow),
          approved: !!approval.rowCount,
          usage: usage.rows,
        });
      }
      if (!action && method === "PATCH") {
        const data = projectPatch.parse(await body(req));
        if (data.shots.length && data.shots.length !== 5)
          throw new HttpError("项目需要五个镜头");
        if (data.shots.length) validateSources(data.shots, await assets(id));
        const doc = {
          productionMode:
            data.productionMode ?? p.productionMode ?? "presentation",
          sceneGroup: data.sceneGroup ?? p.sceneGroup ?? "",
          product: data.product,
          shots: data.shots,
          concepts: p.concepts,
          selectedConceptId: p.selectedConceptId,
          ttsEnabled: data.ttsEnabled,
          musicEnabled: data.musicEnabled,
        };
        const result = await pool.query(
          "UPDATE projects SET document=$1,revision=revision+1,status='draft',updated_at=now() WHERE id=$2 AND owner_id=$3 AND revision=$4 RETURNING *",
          [doc, id, ownerId(), data.expectedRevision],
        );
        if (!result.rows[0])
          throw new HttpError("项目已在其他页面更新，请刷新后重试", 409);
        return json({ project: projectRow(result.rows[0]) });
      }
      if (!action && method === "DELETE") {
        await transaction(async (c) => {
          await c.query(
            "UPDATE projects SET deleted_at=now() WHERE id=$1 AND owner_id=$2",
            [id, ownerId()],
          );
          await c.query(
            "UPDATE jobs SET status='cancelled',stage='项目已删除',updated_at=now() WHERE project_id=$1 AND status='queued'",
            [id],
          );
        });
        return json({ ok: true });
      }
      if (action === "duplicate" && method === "POST") {
        const pid = randomUUID();
        const { copyFile } = await import("node:fs/promises");
        await transaction(async (c) => {
          const aa = await assets(id);
          const ids = new Map<string, string>();
          await c.query(
            "INSERT INTO projects(id,owner_id,document) VALUES($1,$2,$3)",
            [
              pid,
              ownerId(),
              {
                product: { ...p.product },
                productionMode: p.productionMode ?? "presentation",
                sceneGroup: p.sceneGroup ?? "",
                musicEnabled: p.musicEnabled !== false,
                concepts: [],
                selectedConceptId: null,
                shots: [],
                ttsEnabled: p.ttsEnabled,
              },
            ],
          );
          for (const a of aa) {
            const r = (
              await c.query(
                "SELECT storage_key,metadata FROM assets WHERE id=$1",
                [a.id],
              )
            ).rows[0];
            const newid = randomUUID();
            const key = `assets/${newid}${path.extname(r.storage_key)}`;
            await copyFile(storagePath(r.storage_key), storagePath(key));
            ids.set(a.id, newid);
            await c.query(
              "INSERT INTO assets(id,project_id,owner_id,storage_key,metadata) VALUES($1,$2,$3,$4,$5)",
              [newid, pid, ownerId(), key, r.metadata],
            );
          }
          await c.query("UPDATE projects SET document=$1 WHERE id=$2", [
            {
              product: { ...p.product },
              productionMode: p.productionMode ?? "presentation",
              sceneGroup: p.sceneGroup ?? "",
              musicEnabled: p.musicEnabled !== false,
              concepts: [],
              selectedConceptId: null,
              shots: p.shots.map((s: any) => ({
                ...s,
                id: randomUUID(),
                assetId: ids.get(s.assetId) ?? null,
              })),
              ttsEnabled: p.ttsEnabled,
            },
            pid,
          ]);
        });
        return json({ project: await project(pid) }, 201);
      }
      if (action === "assets" && method === "POST") {
        const declared = Number(req.headers.get("content-length") || 0);
        if (declared > 110 * 1024 * 1024) throw new HttpError("文件过大", 413);
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new HttpError("请选择文件");
        if (file.size > 100 * 1024 * 1024)
          throw new HttpError("视频不得超过 100 MB", 413);
        const current = await assets(id);
        if (current.length >= 10) throw new HttpError("每个项目最多 10 份素材");
        const bytes = Buffer.from(await file.arrayBuffer());
        let metadata: any;
        let ext: string;
        let isVideo = false;
        try {
          const info = await sharp(bytes, {
            limitInputPixels: 60_000_000,
          }).metadata();
          if (!["jpeg", "png", "webp"].includes(info.format ?? ""))
            throw Error();
          if (file.size > 15 * 1024 * 1024)
            throw new HttpError("图片不得超过 15 MB", 413);
          ext = info.format === "jpeg" ? ".jpg" : "." + info.format;
          metadata = {
            name: file.name.slice(0, 120),
            mime: "image/" + (info.format === "jpeg" ? "jpeg" : info.format),
            kind: "image",
            width: info.width,
            height: info.height,
            duration: null,
          };
        } catch (e) {
          if (e instanceof HttpError) throw e;
          if (bytes.subarray(4, 8).toString() !== "ftyp")
            throw new HttpError("只支持真实 JPEG、PNG、WebP 图片或 MP4 视频");
          ext = ".mp4";
          isVideo = true;
        }
        await prepareStorage();
        await mkdir(storagePath("assets"), { recursive: true });
        const aid = randomUUID();
        const key = `assets/${aid}${ext}`;
        await writeFile(storagePath(key), bytes, { flag: "wx" });
        if (isVideo) {
          const info = await probe(storagePath(key));
          const video = info.streams.find((s: any) => s.codec_type === "video");
          if (!video || Number(info.format.duration) < 1)
            throw new HttpError("视频无法读取或不足一秒");
          metadata = {
            name: file.name.slice(0, 120),
            mime: "video/mp4",
            kind: "video",
            width: video.width,
            height: video.height,
            duration: Number(info.format.duration),
          };
        }
        metadata = {
          ...metadata,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          source: "用户上传 · 原始商品素材",
        };
        await pool.query(
          "INSERT INTO assets(id,project_id,owner_id,storage_key,metadata) VALUES($1,$2,$3,$4,$5)",
          [aid, id, ownerId(), key, metadata],
        );
        return json({ assets: await assets(id) }, 201);
      }
      if (action === "asset-review" && method === "POST") {
        const data = reviewInputSchema.parse(await body(req));
        await transaction(async (c) => {
          const locked = (
            await c.query(
              "SELECT * FROM projects WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
              [id, ownerId()],
            )
          ).rows[0];
          if (!locked || locked.revision !== data.expectedRevision)
            throw new HttpError("项目已更新，请刷新后重新标注", 409);
          const asset = (
            await c.query(
              "SELECT * FROM assets WHERE id=$1 AND project_id=$2 AND owner_id=$3",
              [data.assetId, id, ownerId()],
            )
          ).rows[0];
          if (!asset || asset.metadata.kind !== "video")
            throw new HttpError("请选择本项目的实拍视频");
          for (const segment of data.segments) {
            if (segment.end > asset.metadata.duration + 0.001)
              throw new HttpError("标注片段超出实际视频时长");
            if (
              !contains(
                visibleSource(
                  asset.metadata.width,
                  asset.metadata.height,
                  segment.focusX,
                  segment.focusY,
                  segment.zoom,
                ),
                segment.subject,
              )
            )
              throw new HttpError(
                "竖屏裁切无法容纳保护区域，请调整焦点、减少放大或换竖屏素材",
              );
          }
          const review = {
            id: randomUUID(),
            sha256: asset.metadata.sha256,
            productIdentity: productIdentity(locked.document.product),
            continuityKey: data.continuityKey,
            confirmed: true,
            segments: data.segments,
          };
          await c.query(
            "UPDATE assets SET metadata=metadata || $1::jsonb WHERE id=$2 AND project_id=$3 AND owner_id=$4",
            [
              JSON.stringify({ sceneReview: review }),
              data.assetId,
              id,
              ownerId(),
            ],
          );
          await c.query(
            "UPDATE projects SET revision=revision+1,status='draft',document=document || $1::jsonb,updated_at=now() WHERE id=$2 AND owner_id=$3",
            [
              JSON.stringify({ concepts: [], selectedConceptId: null }),
              id,
              ownerId(),
            ],
          );
        });
        return json({ project: await project(id), assets: await assets(id) });
      }
      if (action === "concepts" && method === "POST") {
        assertReady(p.product);
        const aa = await assets(id);
        if (p.productionMode !== "scene" && !aa.some((a) => a.kind === "image"))
          throw new HttpError("请至少上传一张商品图片");
        const result = await makeConcepts(
          p.product,
          aa,
          p.productionMode ?? "presentation",
          p.sceneGroup,
        );
        const updated = await transaction(async (c) => {
          const row = (
            await c.query(
              "UPDATE projects SET document=document || $1::jsonb,revision=revision+1,status='draft',updated_at=now() WHERE id=$2 AND owner_id=$3 AND revision=$4 RETURNING *",
              [
                JSON.stringify({ concepts: result.concepts }),
                id,
                ownerId(),
                p.revision,
              ],
            )
          ).rows[0];
          if (!row)
            throw new HttpError("项目已变更，生成结果未覆盖新内容", 409);
          await c.query(
            "INSERT INTO usage_events(id,project_id,owner_id,provider,operation,request_id,units,cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              randomUUID(),
              id,
              ownerId(),
              result.usage.provider,
              "concepts",
              result.usage.requestId,
              result.usage.units,
              result.usage.cost,
            ],
          );
          return projectRow(row);
        });
        return json({ project: updated });
      }
      if (action === "select" && method === "POST") {
        const { conceptId, expectedRevision, hook } = await body(req);
        const concept = p.concepts.find((c: any) => c.id === conceptId);
        if (!concept) throw new HttpError("剧情方案不存在");
        const row = (
          await pool.query(
            "UPDATE projects SET document=document || $1::jsonb,revision=revision+1,status='draft',updated_at=now() WHERE id=$2 AND owner_id=$3 AND revision=$4 RETURNING *",
            [
              JSON.stringify({
                selectedConceptId: conceptId,
                concepts: p.concepts.map((c: any) =>
                  c.id === conceptId ? { ...c, hook: hook ?? c.hook } : c,
                ),
                shots: concept.shots.map((s: any, i: number) =>
                  i === 0
                    ? {
                        ...s,
                        headline: z
                          .string()
                          .min(1)
                          .max(48)
                          .parse(hook ?? concept.hook),
                      }
                    : s,
                ),
              }),
              id,
              ownerId(),
              expectedRevision,
            ],
          )
        ).rows[0];
        if (!row) throw new HttpError("项目已更新，请刷新", 409);
        return json({ project: projectRow(row) });
      }
      if (action === "jobs" && method === "POST") {
        const data = z
          .object({
            kind: z.enum(["sample", "render", "voice"]),
            expectedRevision: z.number().int(),
            shotId: z.string().uuid().optional(),
          })
          .parse(await body(req));
        const job = await transaction(async (c) => {
          const locked = (
            await c.query(
              "SELECT * FROM projects WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
              [id, ownerId()],
            )
          ).rows[0];
          const current = projectRow(locked);
          if (current.revision !== data.expectedRevision)
            throw new HttpError("请先保存最新修改", 409);
          assertReady(current.product);
          const aa = (
            await c.query(
              "SELECT * FROM assets WHERE project_id=$1 AND owner_id=$2 ORDER BY created_at",
              [id, ownerId()],
            )
          ).rows.map(assetRow);
          validateSources(current.shots, aa);
          if (data.kind !== "voice") assertSceneReady(current, aa);
          if (
            data.kind === "voice" &&
            !current.shots.some((s: any) => s.id === data.shotId)
          )
            throw new HttpError("镜头不存在");
          if (data.kind === "render") {
            const ap = await c.query(
              "SELECT 1 FROM approvals ap JOIN artifacts a ON a.id=ap.artifact_id WHERE ap.project_id=$1 AND ap.revision=$2 AND ap.owner_id=$3 AND a.checks->>'pipelineVersion'=$4",
              [id, current.revision, ownerId(), PIPELINE_VERSION],
            );
            if (!ap.rowCount)
              throw new HttpError("请先观看并确认当前版本样片", 409);
          }
          const key = productionJobKey(
            id,
            current.revision,
            data.kind,
            data.shotId,
          );
          const jobid = randomUUID();
          const inserted = await c.query(
            "INSERT INTO jobs(id,project_id,owner_id,revision,kind,shot_id,snapshot,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(idempotency_key) DO NOTHING RETURNING *",
            [
              jobid,
              id,
              ownerId(),
              current.revision,
              data.kind,
              data.shotId ?? null,
              {
                pipelineVersion: PIPELINE_VERSION,
                project: current,
                assets: aa,
              },
              key,
            ],
          );
          return (
            inserted.rows[0] ??
            (
              await c.query("SELECT * FROM jobs WHERE idempotency_key=$1", [
                key,
              ])
            ).rows[0]
          );
        });
        return json({ job: jobRow(job) }, 202);
      }
      if (action === "approve" && method === "POST") {
        const { expectedRevision } = await body(req);
        await transaction(async (c) => {
          const locked = (
            await c.query(
              "SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE",
              [id, ownerId()],
            )
          ).rows[0];
          if (locked.revision !== expectedRevision)
            throw new HttpError("样片已过期，请重新渲染", 409);
          assertSceneReady(projectRow(locked), await assets(id));
          const artifact = (
            await c.query(
              "SELECT id FROM artifacts WHERE project_id=$1 AND owner_id=$2 AND revision=$3 AND kind='sample' AND checks->>'pipelineVersion'=$4 ORDER BY created_at DESC LIMIT 1",
              [id, ownerId(), expectedRevision, PIPELINE_VERSION],
            )
          ).rows[0];
          if (!artifact) throw new HttpError("请先生成并观看当前样片");
          await c.query(
            "INSERT INTO approvals(project_id,revision,owner_id,artifact_id) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,revision) DO UPDATE SET artifact_id=EXCLUDED.artifact_id,created_at=now()",
            [id, expectedRevision, ownerId(), artifact.id],
          );
        });
        return json({ approved: true });
      }
    }
    if (group === "jobs" && id && action === "retry" && method === "POST") {
      const row = (
        await pool.query(
          "UPDATE jobs SET status='queued',stage='等待重试',progress=0,error=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='failed' AND retryable AND attempts<3 RETURNING *",
          [id, ownerId()],
        )
      ).rows[0];
      if (!row)
        throw new HttpError("该任务不可直接重试，请检查错误或创建新版本");
      return json({ job: jobRow(row) });
    }
    if (
      (group === "assets" || group === "artifacts") &&
      id &&
      method === "GET"
    ) {
      z.string().uuid().parse(id);
      const table = group === "assets" ? "assets" : "artifacts";
      const row = (
        await pool.query(
          `SELECT t.* FROM ${table} t JOIN projects p ON p.id=t.project_id WHERE t.id=$1 AND t.owner_id=$2 AND p.deleted_at IS NULL`,
          [id, ownerId()],
        )
      ).rows[0];
      if (!row) throw new HttpError("文件不存在", 404);
      return serveFile(
        req,
        row.storage_key,
        group === "assets"
          ? row.metadata.mime
          : row.kind === "voice"
            ? "audio/wav"
            : "video/mp4",
        group === "assets"
          ? row.metadata.name
          : row.kind === "voice"
            ? "voice.wav"
            : "product-ad.mp4",
      );
    }
    throw new HttpError("接口不存在", 404);
  } catch (error: any) {
    const status = error.status ?? (error instanceof z.ZodError ? 400 : 500);
    if (status === 500) console.error("API failure:", error.message);
    return json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues.map((x: any) => x.message).join("；")
            : status === 500 &&
                /password|connection|ECONN|relation/i.test(error.message)
              ? "数据库不可用，请运行数据库迁移并检查服务"
              : error.message || "请求失败",
      },
      status,
    );
  }
}
