// The two signatures of the protocol: the device key's on every request
// but `info`, and the account key's on a statement. The layouts are in
// sync-protocol.md, "Signed requests" and "The statements". The keys are
// in crypto-design.md, "Sync keys". The server only checks signatures;
// it holds no private key.

import { LayoutError, Reader, Writer, ascii, sameBytes, sha256 } from "./bytes";

/** `SHKSYNC`, the first seven bytes of a statement and of a signed request. */
const MAGIC = ascii("SHKSYNC");
const LAYOUT_VERSION = 0x01;

export const STATEMENT_JOIN = 0x01;
export const STATEMENT_NEW_ACCOUNT_KEY = 0x02;
const SIGNED_REQUEST = 0x10;

export const METHOD_GET = 0x01;
export const METHOD_POST = 0x02;

/** A device's public key on the wire: `04`, then X and Y, 32 bytes each. */
export const DEVICE_PUBLIC_KEY_LENGTH = 65;
export const ACCOUNT_PUBLIC_KEY_LENGTH = 32;
export const SIGNATURE_LENGTH = 64;

/** The device ID: the first 16 bytes of the SHA-256 of the device's public key. */
export async function deviceIdOf(publicKey: Uint8Array): Promise<Uint8Array> {
  return (await sha256(publicKey)).subarray(0, 16);
}

/** The bytes a device key signs for one request. */
export function requestBytes(fields: {
  serverId: Uint8Array;
  deviceId: Uint8Array;
  time: bigint;
  method: number;
  pathAndQuery: string;
  bodyHash: Uint8Array;
}): Uint8Array {
  const path = ascii(fields.pathAndQuery);
  if (path.byteLength > 0xffff) throw new LayoutError("path too long");
  const writer = new Writer()
    .bytes(MAGIC)
    .u8(LAYOUT_VERSION)
    .u8(SIGNED_REQUEST)
    .bytes(fields.serverId)
    .bytes(fields.deviceId);
  const time = new Uint8Array(8);
  new DataView(time.buffer).setBigInt64(0, fields.time);
  return writer.bytes(time).u8(fields.method).u16(path.byteLength).bytes(path).bytes(fields.bodyHash).finish();
}

/** Whether a device key signed these bytes: ECDSA, P-256, SHA-256, r and s of 32 bytes each. */
export async function deviceSigned(
  publicKey: Uint8Array,
  bytes: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (publicKey.byteLength !== DEVICE_PUBLIC_KEY_LENGTH || publicKey[0] !== 0x04) return false;
  if (signature.byteLength !== SIGNATURE_LENGTH) return false;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("raw", publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
  } catch {
    return false;
  }
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, bytes);
}

/** Whether an account key signed these bytes: Ed25519, as RFC 8032 defines it. */
export async function accountSigned(
  publicKey: Uint8Array,
  bytes: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (publicKey.byteLength !== ACCOUNT_PUBLIC_KEY_LENGTH || signature.byteLength !== SIGNATURE_LENGTH) {
    return false;
  }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
  } catch {
    return false;
  }
  return crypto.subtle.verify({ name: "Ed25519" }, key, signature, bytes);
}

/** A statement, read but not yet checked against the server. */
export interface Statement {
  readonly type: number;
  readonly serverId: Uint8Array;
  /** The key ID of the recovery key whose account key signs it. */
  readonly signerKeyId: Uint8Array;
  readonly time: bigint;
  readonly address: string;
  /** A join: the device's public key. */
  readonly devicePublicKey: Uint8Array | null;
  /** A new account key: its public key, and the key ID of its recovery key. */
  readonly newAccountKey: Uint8Array | null;
  readonly newKeyId: Uint8Array | null;
}

/** Reads a statement of either type. Any other layout is a `LayoutError`. */
export function readStatement(bytes: Uint8Array): Statement {
  const reader = new Reader(bytes);
  if (!sameBytes(reader.take(7), MAGIC)) throw new LayoutError("not a statement");
  if (reader.u8() !== LAYOUT_VERSION) throw new LayoutError("statement version");
  const type = reader.u8();
  const serverId = reader.take(16);
  const signerKeyId = reader.take(4);
  const time = new DataView(reader.take(8).slice().buffer).getBigInt64(0);
  const addressLength = reader.u8();
  if (addressLength < 9) throw new LayoutError("address too short");
  const addressBytes = reader.take(addressLength);
  if (addressBytes.some((byte) => byte < 0x21 || byte > 0x7e)) throw new LayoutError("address not ASCII");
  const address = String.fromCharCode(...addressBytes);
  let devicePublicKey: Uint8Array | null = null;
  let newAccountKey: Uint8Array | null = null;
  let newKeyId: Uint8Array | null = null;
  if (type === STATEMENT_JOIN) {
    devicePublicKey = reader.take(DEVICE_PUBLIC_KEY_LENGTH);
  } else if (type === STATEMENT_NEW_ACCOUNT_KEY) {
    newAccountKey = reader.take(ACCOUNT_PUBLIC_KEY_LENGTH);
    newKeyId = reader.take(4);
  } else {
    throw new LayoutError("statement type");
  }
  reader.end();
  return { type, serverId, signerKeyId, time, address, devicePublicKey, newAccountKey, newKeyId };
}
