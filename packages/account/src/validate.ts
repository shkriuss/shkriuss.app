/**
 * What the account service accepts (shared by the browser code and the
 * Worker, so both sides agree). Everything it stores is already encrypted on
 * the device, so these checks are about shape and size only.
 */

/** A device link lasts this long, and works once. */
export const LINK_LIFETIME_MS = 10 * 60 * 1000;

/** A link id: 16 random bytes, base64url. */
export const LINK_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * Sealed values (@shkriuss/crypto seal()): a 32-byte secret sealed is
 * 12 + 32 + 16 bytes, 80 characters. Allow a little room, nothing more.
 */
export const MAX_SEALED_CHARS = 120;
const SEALED_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Request bodies are tiny; anything bigger is refused before it's read. */
export const MAX_REQUEST_BYTES = 1024;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Checks a body of the form { [field]: "<sealed value>" }. */
export function checkSealedBody(body: unknown, field: 'data' | 'wrap'): Checked<string> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Body must be an object.' };
  }
  const keys = Object.keys(body);
  const value = (body as Record<string, unknown>)[field];
  if (keys.length !== 1 || typeof value !== 'string') {
    return { ok: false, error: `Body must be { "${field}": "…" } and nothing else.` };
  }
  if (value.length < 40 || value.length > MAX_SEALED_CHARS || !SEALED_PATTERN.test(value)) {
    return { ok: false, error: `"${field}" must be a sealed value.` };
  }
  return { ok: true, value };
}
