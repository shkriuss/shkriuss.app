import { DataLayerError } from "./errors.ts";
import { type RandomBytes, randomBytes, toHex } from "./random.ts";

/** The fixed id of the one record in the `settings` store (data model §2.5). */
export const SETTINGS_ID = "00000000-0000-7000-8000-000000000000";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The largest time a UUIDv7 holds: 48 bits of milliseconds. */
const MAX_UUID_TIME = 2 ** 48 - 1;

/** The largest count in the 12 bits after the version, `rand_a` (RFC 9562, section 6.2). */
const MAX_COUNT = 0xfff;

/** Whether `value` is a record id: a lowercase UUIDv7 with hyphens (data model §2.1). */
export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && UUID_V7.test(value);
}

function checkTime(time: number): void {
  if (!Number.isSafeInteger(time) || time < 0 || time > MAX_UUID_TIME) {
    throw new DataLayerError("invalid", "A UUIDv7 holds times from 0 to 2^48 - 1 milliseconds.");
  }
}

/** The time of a record id, from its first 48 bits. */
function timeOf(id: string): number {
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

/** The count of a record id: the 12 bits after the version. */
function countOf(id: string): number {
  return Number.parseInt(id.slice(15, 18), 16);
}

/**
 * A new record id: a UUIDv7 (RFC 9562, section 5.7), whose first 48 bits are the time in
 * milliseconds and whose other bits, apart from the version and variant, are random. Given
 * `after`, the id issued last, the new id is greater than it, as section 6.2 of the RFC allows:
 * within the same millisecond, or while the clock stands before `after`'s time, the 12 bits after
 * the version count on from `after`'s, and once they are used up, the time moves on by a
 * millisecond.
 */
export function newRecordId(
  now: number = Date.now(),
  random: RandomBytes = randomBytes,
  after?: string,
): string {
  checkTime(now);
  const bytes = new Uint8Array(16);
  bytes.set(random(10), 6);
  const view = new DataView(bytes.buffer);
  let time = now;
  let count = view.getUint16(6) & MAX_COUNT;
  if (after !== undefined) {
    if (!isRecordId(after)) {
      throw new DataLayerError("invalid", "Only a record id can come before a new one.");
    }
    const last = timeOf(after);
    if (now <= last) {
      time = last;
      count = countOf(after) + 1;
      if (count > MAX_COUNT) {
        time += 1;
        count = view.getUint16(6) & MAX_COUNT;
      }
      checkTime(time);
    }
  }
  // The time, big-endian, in bytes 0 to 5.
  view.setUint16(0, Math.floor(time / 2 ** 32));
  view.setUint32(2, time % 2 ** 32);
  // Version 7 in the high nibble of byte 6, then the count, and the variant 0b10 in the top bits
  // of byte 8.
  view.setUint16(6, 0x7000 | count);
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

/**
 * Issues record ids that ascend in the order they are issued, each greater than the one before
 * (RFC 9562, section 6.2), so that the records created within one millisecond list in that
 * order. Every id still carries the time, to the millisecond, and 62 random bits.
 */
export function recordIdIssuer(random: RandomBytes = randomBytes): (now: number) => string {
  let last: string | undefined;
  return (now) => {
    last = newRecordId(now, random, last);
    return last;
  };
}
