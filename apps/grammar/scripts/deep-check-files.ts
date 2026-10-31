/**
 * Prepares the files Grammar's Deep check downloads when someone asks for it
 * (docs/adr/0012). Runs before every build:
 *
 *   node scripts/deep-check-files.ts [output folder]
 *
 * It writes, to public/on-demand/deep-check/ (or the folder given):
 *
 * - the GECToR Large model, downloaded once from Hugging Face into .cache/
 *   (a pinned version whose checksum must match), split into parts that
 *   Cloudflare can serve (up to 25 MiB each);
 * - onnxruntime-web, which runs the model (from node_modules);
 * - the model's word pieces, labels and verb forms (from deep-check/);
 * - manifest.json, listing every file with its size and checksum.
 *
 * Every file name includes part of its checksum, so a changed file gets a new
 * name, and phones that have Deep check download only what changed.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  DEEP_CHECK_PATH,
  hashedName,
  parts,
  type DeepCheckFile,
  type DeepCheckManifest,
} from '../src/lib/deep-check.ts';
import { downloadFile } from './download.ts';

/** The model: Meyssa/gector-large-2024 (Apache-2.0), a fixed version. */
const MODEL = {
  url: 'https://huggingface.co/Meyssa/gector-large-2024/resolve/93faea4b7a13a0384a37b10779a567dacea5ba41/onnx/model_quantized.onnx',
  bytes: 361_359_853,
  sha256: '919aad79620328f632d501dabe444ada071c0a665b0d05e5c7ce8cce74ee9ae5',
};
/**
 * How long one try at downloading the model may take: 361 MB at a slow
 * 0.6 MB/s. A stalled or never-ending answer stops here, not at the job's
 * time limit (audit 5 H-2).
 */
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
/** Under Cloudflare's 25 MiB limit per file, with room to spare. */
const PART_BYTES = 24 * 1024 * 1024;

const appDir = fileURLToPath(new URL('..', import.meta.url));
const cachedModel = join(appDir, '.cache', `gector-large-${MODEL.sha256.slice(0, 12)}.onnx`);
const outDir = process.argv[2] ?? join(appDir, 'public', DEEP_CHECK_PATH);

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function isModelCached(): Promise<boolean> {
  if (!existsSync(cachedModel)) return false;
  if ((await stat(cachedModel)).size !== MODEL.bytes) return false;
  return (await sha256Of(cachedModel)) === MODEL.sha256;
}

/**
 * Downloads the model to .cache/ (a few tries, as networks fail). The size
 * the server announces must be the model's, no more than that is read, each
 * try has a time limit, and the checksum must match (download.ts).
 */
async function downloadModel(): Promise<void> {
  await mkdir(dirname(cachedModel), { recursive: true });
  console.log(`Downloading the Deep check model (${MODEL.bytes} bytes)…`);
  await downloadFile(MODEL.url, cachedModel, MODEL, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
}

/** Writes a file under its hashed name and describes it. */
async function writeHashed(name: string, content: Uint8Array): Promise<DeepCheckFile> {
  const sha256 = createHash('sha256').update(content).digest('hex');
  const file = hashedName(name, sha256);
  await writeFile(join(outDir, file), content);
  return { path: `${DEEP_CHECK_PATH}${file}`, bytes: content.byteLength, sha256 };
}

async function modelParts(): Promise<DeepCheckFile[]> {
  const handle = await open(cachedModel);
  try {
    const files: DeepCheckFile[] = [];
    for (const [index, { start, end }] of parts(MODEL.bytes, PART_BYTES).entries()) {
      const buffer = new Uint8Array(end - start);
      await handle.read(buffer, 0, buffer.byteLength, start);
      files.push(await writeHashed(`model-${String(index + 1).padStart(2, '0')}.bin`, buffer));
    }
    return files;
  } finally {
    await handle.close();
  }
}

if (!(await isModelCached())) await downloadModel();

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// onnxruntime-web's files (the version in the lockfile).
const runtimeDir = dirname(
  fileURLToPath(import.meta.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm')),
);
const fromRuntime = async (name: string) =>
  writeHashed(name, await readFile(join(runtimeDir, name)));
const fromData = async (name: string) =>
  writeHashed(name, await readFile(join(appDir, 'deep-check', name)));

const manifest: DeepCheckManifest = {
  version: 1,
  runtime: await fromRuntime('ort.wasm.min.mjs'),
  loader: await fromRuntime('ort-wasm-simd-threaded.mjs'),
  wasm: await fromRuntime('ort-wasm-simd-threaded.wasm'),
  vocab: await fromData('vocab.json'),
  merges: await fromData('merges.txt'),
  labels: await fromData('labels.txt'),
  verbs: await fromData('verb-form-vocab.txt'),
  model: await modelParts(),
};
await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const total = Object.values(manifest)
  .flat()
  .reduce((sum, file) => sum + (typeof file === 'object' ? file.bytes : 0), 0);
console.log(`Wrote the Deep check files (${total} bytes) to ${outDir}`);
