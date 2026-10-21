/**
 * What an app's sync server accepts (shared by the browser code and the
 * Worker). The data itself arrives sealed, so these are shape and size checks.
 */

/**
 * Largest sealed copy, in base64url characters (about 1.4 MB of compressed
 * data). Durable Objects store up to 2 MB per value.
 */
export const MAX_SEALED_CHARS = 1_900_000;
/** A request body: the sealed copy plus a little JSON around it. */
export const MAX_REQUEST_BYTES = MAX_SEALED_CHARS + 1024;

export interface PutRequest {
  /** The version this copy was based on, or null to start a new copy. */
  base: number | null;
  data: string;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export function checkPut(body: unknown): Checked<PutRequest> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Body must be an object.' };
  }
  const { base, data, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return { ok: false, error: 'Unknown fields.' };
  if (base !== null && !(Number.isSafeInteger(base) && (base as number) >= 1)) {
    return { ok: false, error: '"base" must be a version number or null.' };
  }
  if (
    typeof data !== 'string' ||
    data.length < 40 ||
    data.length > MAX_SEALED_CHARS ||
    !/^[A-Za-z0-9_-]+$/.test(data)
  ) {
    return { ok: false, error: '"data" must be a sealed copy.' };
  }
  return { ok: true, value: { base: base as number | null, data } };
}

// ---------- Files (docs/adr/0014-syncing-photos.md) ----------

/** A file's id: letters, digits and . _ -, starting with a letter or digit. */
export const FILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
/** Largest sealed file, in bytes. Durable Objects store up to 2 MB per value. */
export const MAX_FILE_BYTES = 1_500_000;
/**
 * Per account, at most this many files, adding up to at most this many bytes.
 * They're kept with the account's copy, and on Cloudflare's free plan each
 * account's storage holds at most 1 GB.
 */
export const MAX_FILES = 5000;
export const MAX_FILES_BYTES = 800_000_000;

/** The account's files, as the server lists them: id → [size in bytes, when it was added (ms)]. */
export type FileIndex = Record<string, [size: number, at: number]>;

/** Whether one more file (or a new version of one) fits within the account's limits. */
export function roomFor(files: FileIndex, id: string, size: number): boolean {
  const others = Object.entries(files).filter(([other]) => other !== id);
  const used = others.reduce((sum, [, [bytes]]) => sum + bytes, 0);
  return others.length < MAX_FILES && used + size <= MAX_FILES_BYTES;
}

/** GET /api/sync/files: the files, the copy's version (0 if none), and the server's time. */
export interface FileList {
  version: number;
  now: number;
  files: FileIndex;
}
