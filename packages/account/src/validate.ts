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

/** The tag of the key that replaced an account key (successorTag): 32 bytes, base64url. */
export const SUCCESSOR_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The token that cancels a device link: 32 random bytes, base64url. */
const CANCEL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Checks a new device link's body: { data: "<sealed value>", cancel: "<token>" }
 * (pages from before cancelling was added send no cancel token).
 */
export function checkLinkBody(body: unknown): Checked<{ data: string; cancel: string | null }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Body must be an object.' };
  }
  const { cancel, ...rest } = body as Record<string, unknown>;
  const data = checkSealedBody(rest, 'data');
  if (!data.ok) return data;
  if (cancel === undefined) return { ok: true, value: { data: data.value, cancel: null } };
  if (typeof cancel !== 'string' || !CANCEL_PATTERN.test(cancel)) {
    return { ok: false, error: '"cancel" must be a token.' };
  }
  return { ok: true, value: { data: data.value, cancel } };
}

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
