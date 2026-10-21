/**
 * Small Web Crypto helpers, the same in the browser and in Workers.
 *
 *   hkdf(secret, 'purpose')     a separate 32-byte key for each purpose
 *   seal(key, bytes, 'label')   AES-256-GCM: encrypt and authenticate
 *   open(key, sealed, 'label')  decrypt, or throw if anything was changed
 *   sealBytes / openBytes       the same, as bytes instead of text (for big files)
 *
 * The label is checked along with the data ("additional authenticated data"),
 * so something sealed for one purpose can't be passed off as another.
 */

const encoder = new TextEncoder();

/** base64url (RFC 4648 §5, no padding): safe in URLs, headers and JSON. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export const utf8 = (text: string): Uint8Array<ArrayBuffer> => encoder.encode(text);

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** True if two byte strings are equal (in constant time for equal lengths). */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] as number) ^ (b[index] as number);
  }
  return difference === 0;
}

/**
 * HKDF-SHA-256 (RFC 5869): turns one secret into independent keys, one per
 * `info`. The same inputs always give the same output.
 */
export async function hkdf(
  secret: Uint8Array<ArrayBuffer>,
  info: string | Uint8Array<ArrayBuffer>,
  length = 32,
  salt: Uint8Array<ArrayBuffer> = new Uint8Array(0),
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: typeof info === 'string' ? utf8(info) : info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** Thrown by open() when the key is wrong or the data or label was changed. */
export class SealError extends Error {
  constructor() {
    super('Could not unlock: wrong key, or the data was changed.');
    this.name = 'SealError';
  }
}

const IV_BYTES = 12;

async function aesKey(key: Uint8Array<ArrayBuffer>, usage: KeyUsage): Promise<CryptoKey> {
  if (key.length !== 32) throw new Error('AES-256 needs a 32-byte key');
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, [usage]);
}

/**
 * Encrypts with AES-256-GCM under a fresh random IV. Returns
 * IV ‖ ciphertext ‖ tag. `label` must be given again to open it.
 */
export async function sealBytes(
  key: Uint8Array<ArrayBuffer>,
  plaintext: Uint8Array<ArrayBuffer>,
  label: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(label) },
    await aesKey(key, 'encrypt'),
    plaintext,
  );
  return concat(iv, new Uint8Array(ciphertext));
}

/** Opens what sealBytes() made. Throws SealError if anything doesn't match. */
export async function openBytes(
  key: Uint8Array<ArrayBuffer>,
  sealed: Uint8Array<ArrayBuffer>,
  label: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (sealed.length < IV_BYTES + 16) throw new SealError();
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.slice(0, IV_BYTES), additionalData: utf8(label) },
      await aesKey(key, 'decrypt'),
      sealed.slice(IV_BYTES),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new SealError();
  }
}

/** sealBytes() as base64url text, for JSON. */
export async function seal(
  key: Uint8Array<ArrayBuffer>,
  plaintext: Uint8Array<ArrayBuffer>,
  label: string,
): Promise<string> {
  return toBase64Url(await sealBytes(key, plaintext, label));
}

/** Opens what seal() made. Throws SealError if anything doesn't match. */
export async function open(
  key: Uint8Array<ArrayBuffer>,
  sealed: string,
  label: string,
): Promise<Uint8Array<ArrayBuffer>> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64Url(sealed);
  } catch {
    throw new SealError();
  }
  return openBytes(key, bytes, label);
}
