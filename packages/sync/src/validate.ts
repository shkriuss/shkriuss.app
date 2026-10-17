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
