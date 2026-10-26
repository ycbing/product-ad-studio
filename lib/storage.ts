import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
export const root = process.cwd();
export const storageRoot = path.join(root, ".local/storage");
export function storagePath(key: string) {
  const resolved = path.resolve(storageRoot, key);
  if (!resolved.startsWith(storageRoot + path.sep))
    throw new Error("无效文件路径");
  return resolved;
}
export async function prepareStorage() {
  await mkdir(storageRoot, { recursive: true });
}
export function parseRange(value: string | null, size: number) {
  if (!value) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2])) throw new Error("Invalid range");
  let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  if (!Number.isSafeInteger(start) || start >= size || start < 0 || end < start)
    throw new Error("Invalid range");
  return { start, end };
}
export async function serveFile(
  request: Request,
  key: string,
  mime: string,
  name?: string,
) {
  const file = storagePath(key);
  const info = await stat(file);
  let range;
  try {
    range = parseRange(request.headers.get("range"), info.size);
  } catch {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${info.size}` },
    });
  }
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (name && new URL(request.url).searchParams.has("download"))
    headers["Content-Disposition"] =
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
    headers["Content-Length"] = String(range.end - range.start + 1);
  } else headers["Content-Length"] = String(info.size);
  return new Response(
    Readable.toWeb(createReadStream(file, range ?? {})) as ReadableStream,
    { status: range ? 206 : 200, headers },
  );
}
