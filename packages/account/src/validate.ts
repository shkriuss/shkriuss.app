/**
 * What the account service accepts (shared by the browser code and the
 * Worker, so both sides agree). Everything it stores is already encrypted on
 * the device, so these checks are about shape and size only.
 */
import { ALGORITHMS, type Assertion, type PasskeyKey } from './webauthn.ts';

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

/** Passkey requests carry a signature and maybe a public key (an RSA one is the biggest). */
export const MAX_PASSKEY_REQUEST_BYTES = 4096;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const isBase64Url = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && BASE64URL.test(value);

/** Checks a passkey's signature, as the browser gave it: { authenticatorData, clientDataJSON, signature }. */
export function checkAssertionShape(value: unknown): Checked<Assertion> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: '"assertion" must be an object.' };
  }
  const { authenticatorData, clientDataJSON, signature, ...rest } = value as Record<
    string,
    unknown
  >;
  if (
    Object.keys(rest).length > 0 ||
    !isBase64Url(authenticatorData, 1024) ||
    !isBase64Url(clientDataJSON, 1500) ||
    !isBase64Url(signature, 700)
  ) {
    return { ok: false, error: '"assertion" must hold a passkey’s signature, and nothing else.' };
  }
  return { ok: true, value: { authenticatorData, clientDataJSON, signature } };
}

/**
 * Checks a new passkey lock: { wrap, publicKey, algorithm, assertion }, the
 * assertion made on the Account page with that passkey right after making it.
 */
export function checkNewLock(
  body: unknown,
): Checked<{ wrap: string; key: PasskeyKey; assertion: Assertion }> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Body must be an object.' };
  }
  const { wrap, publicKey, algorithm, assertion, ...rest } = body as Record<string, unknown>;
  const sealed = checkSealedBody({ wrap }, 'wrap');
  if (!sealed.ok) return sealed;
  if (Object.keys(rest).length > 0) return { ok: false, error: 'Unexpected fields.' };
  if (!isBase64Url(publicKey, 800))
    return { ok: false, error: '"publicKey" must be a public key.' };
  if (!ALGORITHMS.includes(algorithm as (typeof ALGORITHMS)[number])) {
    return { ok: false, error: '"algorithm" must be ES256 (-7) or RS256 (-257).' };
  }
  const signed = checkAssertionShape(assertion);
  if (!signed.ok) return signed;
  return {
    ok: true,
    value: {
      wrap: sealed.value,
      key: { publicKey, algorithm: algorithm as number },
      assertion: signed.value,
    },
  };
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
