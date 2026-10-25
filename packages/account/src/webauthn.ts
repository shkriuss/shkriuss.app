/**
 * Checking a passkey's signature on the account service (docs/adr/0018).
 *
 * Every page on a shkriuss.app subdomain may ask the browser for the
 * account's passkey, and so get its PRF value: only Chromium-based browsers
 * honour the Permissions-Policy that tells app pages not to (audit C-1). So
 * the service hands out a passkey lock only for a signature made on the
 * Account page itself: the browser writes the page's origin into what the
 * passkey signs, and no other page can change that.
 *
 * Shared by the browser code (which makes the challenge and sends the
 * signature) and the Worker (which checks it).
 */
import { fromBase64Url, sha256, utf8 } from '@shkriuss/crypto';

/** What a passkey signed for one request, as the browser gave it (base64url each). */
export interface Assertion {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

/** A passkey's public key (SPKI, base64url) and its COSE algorithm. */
export interface PasskeyKey {
  publicKey: string;
  algorithm: number;
}

/** The algorithms passkeys are made with (COSE): ES256 and RS256. */
export const ALGORITHMS = [-7, -257] as const;

/** What a signature is for: it can't be used for anything else. */
export const PURPOSES = { add: 1, open: 2, remove: 3 } as const;
export type Purpose = keyof typeof PURPOSES;

/**
 * How far a signature's time may be from the service's (a device's clock
 * can be off). It only stops an old signature being used again; it isn't
 * what keeps the lock safe (that's the wrap key, which never leaves the
 * device).
 */
export const CHALLENGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A challenge for the passkey to sign: what it's for, when, and 23 random bytes. */
export function challengeFor(purpose: Purpose, now = Date.now()): Uint8Array<ArrayBuffer> {
  const challenge = new Uint8Array(32);
  challenge[0] = PURPOSES[purpose];
  new DataView(challenge.buffer).setBigUint64(1, BigInt(Math.floor(now)));
  crypto.getRandomValues(challenge.subarray(9));
  return challenge;
}

/** Reads an ECDSA signature (ASN.1 DER, as WebAuthn gives it) as r and s, 32 bytes each. */
function rawEcdsa(der: Uint8Array): Uint8Array<ArrayBuffer> | null {
  let offset = 0;
  const byte = () => der[offset++] ?? -1;
  if (byte() !== 0x30) return null;
  const length = byte();
  if (length < 0 || length >= 0x80 || length !== der.length - 2) return null;
  const raw = new Uint8Array(64);
  for (const at of [0, 32]) {
    if (byte() !== 0x02) return null;
    let size = byte();
    if (size < 1 || size > 33 || offset + size > der.length) return null;
    // A leading zero only keeps the number positive.
    while (size > 32 && der[offset] === 0) {
      offset += 1;
      size -= 1;
    }
    if (size > 32) return null;
    raw.set(der.subarray(offset, offset + size), at + 32 - size);
    offset += size;
  }
  return offset === der.length ? raw : null;
}

async function verifySignature(
  key: PasskeyKey,
  signature: Uint8Array<ArrayBuffer>,
  signed: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const spki = fromBase64Url(key.publicKey);
  if (key.algorithm === -7) {
    const raw = rawEcdsa(signature);
    if (!raw) return false;
    const imported = await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, imported, raw, signed);
  }
  if (key.algorithm === -257) {
    const imported = await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', imported, signature, signed);
  }
  return false;
}

/**
 * Whether `assertion` was signed by the passkey with `key`, on the page at
 * `origin` (with `rpId` its passkeys' domain), for `purpose`, at about `now`.
 * Anything malformed is simply false.
 */
export async function checkAssertion(
  assertion: Assertion,
  key: PasskeyKey,
  expected: { origin: string; rpId: string; purpose: Purpose },
  now = Date.now(),
): Promise<boolean> {
  try {
    const clientData = fromBase64Url(assertion.clientDataJSON);
    const authenticatorData = fromBase64Url(assertion.authenticatorData);
    const client = JSON.parse(new TextDecoder().decode(clientData)) as Record<string, unknown>;
    if (client['type'] !== 'webauthn.get' || client['origin'] !== expected.origin) return false;
    if (client['crossOrigin'] === true) return false;
    const challenge = fromBase64Url(String(client['challenge']));
    if (challenge.length !== 32 || challenge[0] !== PURPOSES[expected.purpose]) return false;
    const time = Number(
      new DataView(challenge.buffer, challenge.byteOffset, challenge.byteLength).getBigUint64(1),
    );
    if (Math.abs(now - time) > CHALLENGE_WINDOW_MS) return false;

    // The page's domain, and the person was there and unlocked the passkey.
    if (authenticatorData.length < 37) return false;
    const rpIdHash = await sha256(utf8(expected.rpId));
    if (!rpIdHash.every((value, index) => authenticatorData[index] === value)) return false;
    const flags = authenticatorData[32] ?? 0;
    if ((flags & 0x01) === 0 || (flags & 0x04) === 0) return false;

    const signed = new Uint8Array(authenticatorData.length + 32);
    signed.set(authenticatorData);
    signed.set(await sha256(clientData), authenticatorData.length);
    return await verifySignature(key, fromBase64Url(assertion.signature), signed);
  } catch {
    return false;
  }
}
