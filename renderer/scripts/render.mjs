import { bundle } from '@remotion/bundler';
import { getVideoMetadata, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fingerprint, frameRange } from './render-support.mjs';

const { values } = parseArgs({ options: {
  project: { type: 'string' }, mode: { type: 'string', default: 'sample' },
  from: { type: 'string' }, to: { type: 'string' }, scale: { type: 'string', default: '0.5' },
  frame: { type: 'string', default: '0' },
}});
const project = path.resolve(values.project ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const mode = values.mode;

async function main() {
  if (!['sample', 'render', 'still'].includes(mode)) throw new Error('MODE: Expected sample, render or still.');
  const scale = Number(values.scale);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 2) throw new Error('SCALE: Expected 0 < scale <= 2.');
  const input = JSON.parse(await readFile(path.join(project, 'inputs.json'), 'utf8'));
  if (typeof input.template !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(input.template)) throw new Error('TEMPLATE: Unknown template.');
  const catalog = JSON.parse(await readFile(path.join(project, 'catalog', `${input.template}.json`), 'utf8')
    .catch(() => { throw new Error(`TEMPLATE: Unknown template ${input.template}.`); }));
  const revision = await fingerprint(project);
  console.error(`Bundling ${input.template}…`);
  const serveUrl = await bundle({ entryPoint: path.join(project, 'src', 'index.tsx'),
    publicDir: path.join(project, 'public'), outDir: path.join(project, 'build') });
  const composition = await selectComposition({ serveUrl, id: catalog.compositionId, inputProps: input.props });
  // A format can declare its own sample window (for example a shorter vertical cut).
  const sample = catalog.formats?.[input.props?.format ?? catalog.defaultFormat]?.sample ?? catalog.sample;
  const range = mode === 'sample'
    ? frameRange({ from: Number(values.from ?? sample.from), to: Number(values.to ?? sample.to) }, composition)
    : [0, composition.durationInFrames - 1];
  const stillFrame = Number(values.frame);
  if (mode === 'still' && (!Number.isInteger(stillFrame) || stillFrame < 0 || stillFrame >= composition.durationInFrames)) {
    throw new Error(`FRAME: Expected an integer in 0..${composition.durationInFrames - 1}.`);
  }
  const bounds = mode === 'still' ? [stillFrame, stillFrame] : range;
  const filename = `${mode}-${revision.slice(0, 12)}-${bounds[0]}-${bounds[1]}-${scale}.${mode === 'still' ? 'png' : 'mp4'}`;
  const output = path.join(project, 'out', filename);
  await mkdir(path.dirname(output), { recursive: true });
  const settings = { serveUrl, composition, inputProps: composition.props, scale,
    timeoutInMilliseconds: 120000 };
  if (mode === 'still') {
    await renderStill({ ...settings, output, frame: stillFrame, imageFormat: 'png' });
  } else {
    let lastUpdate = 0;
    await renderMedia({ ...settings, outputLocation: output, codec: 'h264', pixelFormat: 'yuv420p',
      // Remotion 4.0.534's parallel pre-encoder receives unrounded scaled dimensions.
      // Use the regular encoder for fractional pixels; it applies the renderer's sizing rules.
      disallowParallelEncoding: !Number.isInteger(composition.width * scale) ||
        !Number.isInteger(composition.height * scale),
      concurrency: Math.min(4, availableParallelism()), frameRange: range,
      onProgress: ({ progress }) => {
        if (Date.now() - lastUpdate > 5000 || progress === 1) {
          lastUpdate = Date.now();
          console.error(`Rendering ${Math.round(progress * 100)}%`);
        }
      } });
  }
  const artifact = await stat(output);
  if (!artifact.isFile() || artifact.size === 0) throw new Error('OUTPUT_MISSING: Render did not write a nonempty file.');
  let media;
  if (mode === 'still') {
    const png = await readFile(output);
    if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error('OUTPUT_INVALID: Expected a PNG file.');
    }
    media = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  } else {
    media = await getVideoMetadata(output);
    if (media.width <= 0 || media.height <= 0 || media.durationInSeconds <= 0) {
      throw new Error('OUTPUT_INVALID: Video metadata is invalid.');
    }
  }
  const changed = revision !== await fingerprint(project);
  const report = {
    status: changed ? 'source-changed-during-render' : 'rendered', mode,
    template: input.template, format: input.props?.format ?? catalog.defaultFormat,
    compositionId: composition.id, fingerprint: revision,
    output: `out/${filename}`, sourceFrameRange: bounds, rangeEnd: 'inclusive',
    sourceTimeRange: { from: bounds[0] / composition.fps, to: (bounds[1] + 1) / composition.fps },
    fps: composition.fps, width: media.width, height: media.height, bytes: artifact.size,
    encodedDurationSeconds: media.durationInSeconds ?? null,
    frames: bounds[1] - bounds[0] + 1,
    durationSeconds: (bounds[1] - bounds[0] + 1) / composition.fps,
    fullDurationSeconds: composition.durationInFrames / composition.fps,
    visualReview: 'not-reviewed', createdAt: new Date().toISOString(),
  };
  await writeFile(path.join(project, 'out', `${mode}.report.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (changed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack ?? error);
  const [, code = 'RENDER_FAILED', message = error.message] = /^([A-Z][A-Z0-9_]+): ([\s\S]*)$/.exec(error.message) ?? [];
  // What the agent does next, so it recovers without relaying the error to the user.
  const next = { action: 'fix', hint: 'Run vvv.py doctor --project on this project; if every check passes, fix the source or inputs.json from the message and render again.' };
  console.log(JSON.stringify({ status: 'failed', code, message, mode, next }));
  process.exitCode = 1;
});
