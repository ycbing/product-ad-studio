import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { existsSync } from "node:fs";
export const exec = promisify(execFile);
export function mediaBinary(name: "ffmpeg" | "ffprobe") {
  const platform =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "win32"
        ? "win32-msvc"
        : "linux";
  const pkg = `compositor-${platform}-${process.arch}`;
  const folder = path.join(process.cwd(), "node_modules/@remotion", pkg);
  const file = path.join(
    folder,
    name + (process.platform === "win32" ? ".exe" : ""),
  );
  if (existsSync(file))
    return { file, env: { ...process.env, DYLD_LIBRARY_PATH: folder } };
  return { file: name, env: process.env };
}
export async function probe(file: string) {
  const bin = mediaBinary("ffprobe");
  const { stdout } = await exec(
    bin.file,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,width,height",
      "-of",
      "json",
      file,
    ],
    { env: bin.env, timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout);
}
