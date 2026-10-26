import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';

export function frameRange({ from, to }, { fps, durationInFrames }) {
  const first = Math.round(from * fps);
  const last = Math.round(to * fps) - 1;
  if (![from, to, fps, durationInFrames].every(Number.isFinite) || from < 0 ||
      to <= from || first < 0 || last < first || last >= durationInFrames) {
    throw new Error(`FRAME_RANGE: ${from}..${to}s is outside a ${durationInFrames / fps}s composition.`);
  }
  return [first, last];
}

export async function fingerprint(project) {
  const files = [];
  async function walk(relative) {
    const file = path.join(project, relative);
    let stat;
    try { stat = await lstat(file); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`PROJECT_SYMLINK: ${relative} must be a local project file or directory.`);
    if (stat.isDirectory()) {
      for (const name of await readdir(file)) {
        if (!['.DS_Store', '__pycache__'].includes(name)) await walk(`${relative}/${name}`);
      }
    } else if (stat.isFile()) files.push(relative);
  }
  // vvv.json is metadata, not a render input; keep this list equal to FINGERPRINT_PATHS in vvv_project.py.
  for (const name of ['inputs.json', 'assets.json', 'package.json', 'package-lock.json',
    'tsconfig.json', 'remotion.config.ts', 'src', 'public', 'catalog', 'scripts']) await walk(name);
  const hash = createHash('sha256');
  // UTF-8 byte order, as vvv_project.py sorts; the default sort compares UTF-16 code units.
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  for (const relative of files) {
    hash.update(relative);
    hash.update(Buffer.from([0]));
    hash.update(createHash('sha256').update(await readFile(path.join(project, relative))).digest());
  }
  return hash.digest('hex');
}
