import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { exec, probe } from "../lib/media";
import { pool } from "../lib/db";
import { storagePath } from "../lib/storage";
export class UnsafeRetryError extends Error {
  retryable = false;
}
export async function speech(text: string, job: any) {
  if (!text.trim()) return null;
  const provider = process.env.TTS_PROVIDER || "none";
  if (provider === "none")
    throw Error("尚未配置配音服务，请关闭旁白或配置 TTS_PROVIDER");
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        provider,
        process.env.TTS_API_BASE,
        process.env.TTS_MODEL,
        process.env.TTS_VOICE,
        text,
        190,
      ]),
    )
    .digest("hex");
  const dir = storagePath("voice-cache");
  await mkdir(dir, { recursive: true });
  const output = path.join(dir, key + ".wav");
  const meta = path.join(dir, key + ".json");
  try {
    await access(output);
    const data = JSON.parse(await readFile(meta, "utf8"));
    return { file: output, seconds: data.seconds, hash: key, cached: true };
  } catch {}
  if (provider === "system") {
    if (process.platform !== "darwin")
      throw Error("本机系统配音仅支持 macOS；请配置 API 或关闭旁白");
    const words = path.join(dir, key + ".txt");
    const aiff = path.join(dir, key + ".aiff");
    await writeFile(words, text);
    await exec(
      "/usr/bin/say",
      ["-v", "Tingting", "-r", "190", "-f", words, "-o", aiff],
      { timeout: 60000 },
    );
    await exec(
      "/usr/bin/afconvert",
      ["-f", "WAVE", "-d", "LEI16@22050", aiff, output],
      { timeout: 30000 },
    );
  } else if (provider === "openai") {
    if (
      !process.env.TTS_API_KEY ||
      !process.env.TTS_MODEL ||
      !process.env.TTS_VOICE
    )
      throw Error("请配置配音 API 密钥、模型和音色");
    let response: Response;
    try {
      response = await fetch(
        `${(process.env.TTS_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "")}/audio/speech`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.TTS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.TTS_MODEL,
            voice: process.env.TTS_VOICE,
            input: text,
            response_format: "wav",
          }),
          signal: AbortSignal.timeout(60000),
        },
      );
    } catch {
      throw new UnsafeRetryError(
        "配音请求结果不明，请先检查供应商调用记录，再决定是否创建新任务，避免重复计费",
      );
    }
    if (!response.ok)
      throw new UnsafeRetryError(
        `配音服务返回 ${response.status}，请检查供应商记录与配置`,
      );
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 20 * 1024 * 1024)
      throw new UnsafeRetryError("配音响应过大，请检查供应商");
    await writeFile(output, buffer);
    await pool.query(
      "INSERT INTO usage_events(id,project_id,job_id,owner_id,provider,operation,request_id,units,cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL)",
      [
        randomUUID(),
        job.project_id,
        job.id,
        job.owner_id,
        process.env.TTS_MODEL,
        "speech",
        response.headers.get("x-request-id"),
        { characters: text.length },
      ],
    );
  } else throw Error("不支持的 TTS_PROVIDER");
  const info = await probe(output);
  const seconds = Number(info.format.duration);
  if (!Number.isFinite(seconds) || seconds < 0.1)
    throw Error("配音没有有效音频");
  await writeFile(meta, JSON.stringify({ seconds }));
  if (provider === "system")
    await pool.query(
      "INSERT INTO usage_events(id,project_id,job_id,owner_id,provider,operation,units,cost) VALUES($1,$2,$3,$4,$5,$6,$7,0)",
      [
        randomUUID(),
        job.project_id,
        job.id,
        job.owner_id,
        "macOS-local",
        "speech",
        { characters: text.length },
      ],
    );
  return { file: output, seconds, hash: key, cached: false };
}
