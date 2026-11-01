/**
 * Deep check: a more thorough check by an AI model that runs on this device
 * (GECToR Large, from Grammarly's researchers; docs/adr/0012). It's
 * downloaded only when the person asks (381 MB), then works offline.
 *
 * This file describes the downloaded files, the messages between the page
 * and the model's worker (scripts/deep-check.worker.ts), and the settings.
 * The model's steps are in sentences.ts (text → words), bpe.ts (words →
 * numbers), gector.ts (the model's answers → corrected words) and
 * changes.ts (corrected words → changes to the text).
 */

/** Where the build puts the files (scripts/deep-check-files.ts). */
export const DEEP_CHECK_PATH = '/on-demand/deep-check/';
export const MANIFEST_URL = `${DEEP_CHECK_PATH}manifest.json`;
/** The cache the downloaded files are saved in (kept by the service worker). */
export const DEEP_CHECK_CACHE = 'deep-check';

/** Only suggest a change when the model is at least this sure (tested: docs/adr/0012). */
export const MIN_PROBABILITY = 0.7;
/** The model corrects a sentence, then looks again, up to this many times. */
export const MAX_PASSES = 5;

export interface DeepCheckFile {
  /** Path on this site, e.g. "/on-demand/deep-check/labels.5afe93088eb6.txt". */
  path: string;
  bytes: number;
  /** SHA-256 of the content, as hex. */
  sha256: string;
}

/** Everything Deep check downloads (manifest.json, written by the build). */
export interface DeepCheckManifest {
  version: 1;
  /** onnxruntime-web: the JavaScript, its WebAssembly loader, and the WebAssembly. */
  runtime: DeepCheckFile;
  loader: DeepCheckFile;
  wasm: DeepCheckFile;
  /** The model's word pieces (vocab.json, merges.txt), labels and verb forms. */
  vocab: DeepCheckFile;
  merges: DeepCheckFile;
  labels: DeepCheckFile;
  verbs: DeepCheckFile;
  /** The model, in parts of up to 24 MiB (Cloudflare serves up to 25 MiB per file). */
  model: DeepCheckFile[];
}

const FILE_KEYS = ['runtime', 'loader', 'wasm', 'vocab', 'merges', 'labels', 'verbs'] as const;

export const manifestFiles = (manifest: DeepCheckManifest): DeepCheckFile[] => [
  ...FILE_KEYS.map((key) => manifest[key]),
  ...manifest.model,
];

export const downloadBytes = (manifest: DeepCheckManifest): number =>
  manifestFiles(manifest).reduce((total, file) => total + file.bytes, 0);

function isFile(value: unknown): value is DeepCheckFile {
  if (typeof value !== 'object' || value === null) return false;
  const { path, bytes, sha256 } = value as Record<string, unknown>;
  return (
    typeof path === 'string' &&
    path.startsWith(DEEP_CHECK_PATH) &&
    !path.includes('..') &&
    Number.isSafeInteger(bytes) &&
    (bytes as number) > 0 &&
    typeof sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(sha256)
  );
}

export function isManifest(value: unknown): value is DeepCheckManifest {
  if (typeof value !== 'object' || value === null) return false;
  const manifest = value as Record<string, unknown>;
  return (
    manifest['version'] === 1 &&
    FILE_KEYS.every((key) => isFile(manifest[key])) &&
    Array.isArray(manifest['model']) &&
    manifest['model'].length > 0 &&
    manifest['model'].every(isFile)
  );
}

/** "labels.txt" + its SHA-256 → "labels.5afe93088eb6.txt": a new name whenever it changes. */
export function hashedName(name: string, sha256: string): string {
  const dot = name.lastIndexOf('.');
  const short = sha256.slice(0, 12);
  return dot > 0 ? `${name.slice(0, dot)}.${short}${name.slice(dot)}` : `${name}.${short}`;
}

/** Byte ranges splitting `bytes` into parts of at most `partBytes`. */
export function parts(bytes: number, partBytes: number): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (let start = 0; start < bytes; start += partBytes) {
    ranges.push({ start, end: Math.min(bytes, start + partBytes) });
  }
  return ranges;
}

/** "381 MB" (decimal megabytes, like phones show). */
export const megabytes = (bytes: number): string => `${Math.round(bytes / 1_000_000)} MB`;

/** Messages from the page to the Deep check worker. */
export type ToDeepCheck =
  | { type: 'start'; manifest: DeepCheckManifest }
  /** Correct these sentences (each a list of words, as the model reads them). */
  | { type: 'check'; id: number; sentences: string[][] };

/** Messages from the Deep check worker to the page. */
export type FromDeepCheck =
  | { type: 'ready'; threads: number }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'checked'; id: number; corrected: string[][] }
  /** Files missing from this device, the model didn't start, or it failed while checking. */
  | { type: 'failed'; reason: 'files' | 'start' | 'check' };
