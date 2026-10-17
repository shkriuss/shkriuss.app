/**
 * The account secret and the two ways people see it (docs/adr/0010).
 *
 * - The account secret: 32 random bytes, made on the first device. Every
 *   other key comes from it (with HKDF), so whoever has it has the account.
 * - The recovery key: the same secret written out for people to save, in
 *   14 groups of 4 letters and digits, the last group a typo check.
 * - The account code, e.g. "K7Q2-M9XD": a short fingerprint shown on every
 *   signed-in device, to check they're on the same account. It reveals
 *   nothing about the secret.
 */
import { equalBytes, hkdf, randomBytes, sha256, concat, utf8 } from '@shkriuss/crypto';

export const SECRET_BYTES = 32;

/** Crockford's base32: no I, L, O or U, so letters can't be mistaken for digits. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 256 bits of secret need 52 characters; 4 more are the typo check. */
const SECRET_CHARS = 52;
const CHECK_CHARS = 4;
export const RECOVERY_KEY_CHARS = SECRET_CHARS + CHECK_CHARS;

export function generateSecret(): Uint8Array<ArrayBuffer> {
  return randomBytes(SECRET_BYTES);
}

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let text = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) text += ALPHABET[(value << (5 - bits)) & 31];
  return text;
}

/** Reads base32 back into `length` bytes; null if the leftover bits aren't zero. */
function fromBase32(text: string, length: number): Uint8Array<ArrayBuffer> | null {
  const bytes = new Uint8Array(length);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of text) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      if (index >= length) return null;
      bytes[index] = (value >>> (bits - 8)) & 255;
      index += 1;
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return index === length && value === 0 ? bytes : null;
}

/** People type "O" for 0 and "I" or "L" for 1, in any case, with spaces or dashes. */
function normalize(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

async function checkOf(secret: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await sha256(concat(utf8('shkriuss recovery key v1'), secret));
  return toBase32(digest).slice(0, CHECK_CHARS);
}

const groups = (text: string) => (text.match(/.{1,4}/g) ?? []).join('-');

/** The recovery key for a secret, e.g. "4Q8Z-…-7HJD" (14 groups of 4). */
export async function recoveryKeyOf(secret: Uint8Array<ArrayBuffer>): Promise<string> {
  if (secret.length !== SECRET_BYTES) throw new Error('Not an account secret');
  return groups(toBase32(secret) + (await checkOf(secret)));
}

export type RecoveryKeyResult =
  { ok: true; secret: Uint8Array<ArrayBuffer> } | { ok: false; problem: 'format' | 'typo' };

/**
 * Reads a recovery key as typed or pasted. "format": not the right length or
 * characters; "typo": the right shape, but the check doesn't match.
 */
export async function parseRecoveryKey(text: string): Promise<RecoveryKeyResult> {
  const clean = normalize(text);
  if (clean.length !== RECOVERY_KEY_CHARS || [...clean].some((char) => !ALPHABET.includes(char))) {
    return { ok: false, problem: 'format' };
  }
  const secret = fromBase32(clean.slice(0, SECRET_CHARS), SECRET_BYTES);
  if (!secret || (await checkOf(secret)) !== clean.slice(SECRET_CHARS)) {
    return { ok: false, problem: 'typo' };
  }
  return { ok: true, secret };
}

/** The short code shown on every signed-in device, e.g. "K7Q2-M9XD". */
export async function accountCodeOf(secret: Uint8Array<ArrayBuffer>): Promise<string> {
  return groups(toBase32(await hkdf(secret, 'shkriuss account code v1', 5)));
}

export const sameSecret = (a: Uint8Array, b: Uint8Array): boolean => equalBytes(a, b);

/**
 * The key one app gets when it connects: different for every app, so an app
 * never holds the account secret or another app's key.
 */
export async function appSecretOf(
  secret: Uint8Array<ArrayBuffer>,
  slug: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return hkdf(secret, `shkriuss app v1 ${slug}`);
}
