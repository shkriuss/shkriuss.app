import { DataError } from "./errors.ts";
import { type RandomBytes, randomBytes, toHex } from "./random.ts";

/** The fixed id of the one record in the `settings` store (data model §2.5). */
export const SETTINGS_ID = "00000000-0000-7000-8000-000000000000";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The largest time a UUIDv7 holds: 48 bits of milliseconds. */
const MAX_UUID_TIME = 2 ** 48 - 1;

/** Whether `value` is a record id: a lowercase UUIDv7 with hyphens (data model §2.1). */
export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && UUID_V7.test(value);
}

/**
 * A new record id: a UUIDv7 (RFC 9562, section 5.7), whose first 48 bits are the time in
 * milliseconds and whose other bits, apart from the version and variant, are random.
 */
export function newRecordId(now: number = Date.now(), random: RandomBytes = randomBytes): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_UUID_TIME) {
    throw new DataError("invalid", "A UUIDv7 holds times from 0 to 2^48 - 1 milliseconds.");
  }
  const bytes = new Uint8Array(16);
  bytes.set(random(10), 6);
  const view = new DataView(bytes.buffer);
  // The time, big-endian, in bytes 0 to 5.
  view.setUint16(0, Math.floor(now / 2 ** 32));
  view.setUint32(2, now % 2 ** 32);
  // Version 7 in the high nibble of byte 6, and the variant 0b10 in the top bits of byte 8.
  view.setUint8(6, 0x70 | (view.getUint8(6) & 0x0f));
  view.setUint8(8, 0x80 | (view.getUint8(8) & 0x3f));
  const hex = toHex(bytes);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
