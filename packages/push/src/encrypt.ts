/**
 * Web Push message encryption (RFC 8291, "aes128gcm" from RFC 8188).
 *
 * The phone encrypts each notification itself, to its own push subscription,
 * before sending it to our server. So the server (and Google's, Apple's or a
 * UnifiedPush push service) only ever carries text it can't read. Only the
 * browser that created the subscription holds the private key to open it.
 *
 * decryptPayload() is what the browser does on arrival; it's here for tests.
 */
import { concat } from './base64.ts';

const encoder = new TextEncoder();
const RECORD_SIZE = 4096;
/** salt (16) + record size (4) + key length (1) + server public key (65). */
const HEADER_BYTES = 86;
/** Push services accept bodies up to 4096 bytes: header, text, end marker, 16-byte tag. */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - HEADER_BYTES - 1 - 16;
/**
 * Each message's text is padded to a multiple of this many bytes (RFC 8188:
 * zeros after the end marker, which the browser takes off), so the size the
 * server and push services see shows little of how long the text is
 * (audit 3 D-6). Most reminders take one step: 358 bytes sent.
 */
export const PADDED_TO = 256;

/** The two keys a push subscription hands out (PushSubscription.getKey()). */
export interface PushTarget {
  /** The browser's public key (65 bytes, uncompressed P-256). */
  p256dh: Uint8Array<ArrayBuffer>;
  /** The shared authentication secret (16 bytes). */
  auth: Uint8Array<ArrayBuffer>;
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

const ecdh = { name: 'ECDH', namedCurve: 'P-256' } as const;

/** The content key and nonce, from the ECDH secret (RFC 8291 §3.3–3.4). */
async function contentKeys(
  ecdhSecret: Uint8Array<ArrayBuffer>,
  auth: Uint8Array<ArrayBuffer>,
  receiverPublic: Uint8Array<ArrayBuffer>,
  senderPublic: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
): Promise<{ key: CryptoKey; nonce: Uint8Array<ArrayBuffer> }> {
  const keyInfo = concat(encoder.encode('WebPush: info\0'), receiverPublic, senderPublic);
  const ikm = await hkdf(auth, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, nonce };
}

/**
 * Encrypts a message for one push subscription. Returns the HTTP body to
 * send. Tests can pass fixed keys and salt, and `paddedTo: 1` for no padding.
 */
export async function encryptPayload(
  plaintext: Uint8Array<ArrayBuffer>,
  target: PushTarget,
  options: { senderKeys?: CryptoKeyPair; salt?: Uint8Array<ArrayBuffer>; paddedTo?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('Notification too long');
  // A new key pair and salt for every message (tests pass fixed ones).
  const sender =
    options.senderKeys ?? (await crypto.subtle.generateKey(ecdh, false, ['deriveBits']));
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const receiver = await crypto.subtle.importKey('raw', target.p256dh, ecdh, true, []);
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiver }, sender.privateKey, 256),
  );
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const { key, nonce } = await contentKeys(secret, target.auth, target.p256dh, senderPublic, salt);
  // One record: the text, then 0x02 ("last record"), then zeros up to a
  // multiple of PADDED_TO bytes, as far as push services take.
  const paddedTo = options.paddedTo ?? PADDED_TO;
  const record = new Uint8Array(
    Math.min(Math.ceil((plaintext.length + 1) / paddedTo) * paddedTo, MAX_PLAINTEXT_BYTES + 1),
  );
  record.set(plaintext);
  record[plaintext.length] = 2;
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record),
  );
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE);
  return concat(salt, recordSize, new Uint8Array([senderPublic.length]), senderPublic, ciphertext);
}

/** Opens a message as the receiving browser would (used in tests). */
export async function decryptPayload(
  body: Uint8Array<ArrayBuffer>,
  receiver: {
    privateKey: CryptoKey;
    publicKey: Uint8Array<ArrayBuffer>;
    auth: Uint8Array<ArrayBuffer>;
  },
): Promise<Uint8Array<ArrayBuffer>> {
  const salt = body.slice(0, 16);
  const keyLength = body[20] ?? 0;
  const senderPublic = body.slice(21, 21 + keyLength);
  const ciphertext = body.slice(21 + keyLength);
  const sender = await crypto.subtle.importKey('raw', senderPublic, ecdh, true, []);
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, receiver.privateKey, 256),
  );
  const { key, nonce } = await contentKeys(
    secret,
    receiver.auth,
    receiver.publicKey,
    senderPublic,
    salt,
  );
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext),
  );
  // Remove padding (zeros) and the 0x02 end marker.
  let end = record.length - 1;
  while (end >= 0 && record[end] === 0) end -= 1;
  if (record[end] !== 2) throw new Error('Bad padding');
  return record.slice(0, end);
}
