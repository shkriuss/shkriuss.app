import { DataLayerError } from "./errors.ts";
import { type RandomBytes, randomBytes, toHex } from "./random.ts";

/**
 * Hybrid logical clocks (data model §3). Every change carries one HLC, such as
 * `001791052200000:00000:9f86d081884c7d65`: the wall time in milliseconds, a counter for changes
 * within the same millisecond, and the id of the device that made it. The parts have fixed
 * widths, so comparing two HLCs as strings orders them.
 */
export type Hlc = string;

/** The last HLC a device issued or received, without its device id (data model §3.3). */
export interface ClockState {
  readonly wall: number;
  readonly counter: number;
}

/** A device's clock before it has issued or received anything. */
export const INITIAL_CLOCK: ClockState = { wall: 0, counter: 0 };

export const MAX_WALL = 999_999_999_999_999;
export const MAX_COUNTER = 65_535;

const DAY = 24 * 60 * 60 * 1000;

/**
 * How far after this device's clock an HLC may lie before it is from the future (data model
 * §3.5).
 */
export const MAX_CLOCK_AHEAD = DAY;

/**
 * The latest wall time of an HLC from outside: the last millisecond of the year 9999, which no
 * device's date reaches (data model §3.5). A device that receives it can still issue more HLCs
 * than it ever will; one that received `MAX_WALL` could issue only 65,536.
 */
export const MAX_RECEIVED_WALL = 253_402_300_799_999;

/**
 * How far after this device's clock the greatest HLC of a backup may lie for the device to
 * receive it at all, whatever the user confirms (data model §3.5): 100 years, as 36,525 days. A
 * device's own HLCs run at most a few milliseconds ahead of what it received, and real time moves
 * on between an export and its import, so a bound that moves with this device's clock never
 * refuses a backup of what a device received, while a crafted year-9999 file is never received.
 */
export const MAX_RECEIVED_AHEAD = 36_525 * DAY;

const HLC = /^[0-9]{15}:[0-9]{5}:[0-9a-f]{16}$/;
const DEVICE_ID = /^[0-9a-f]{16}$/;

/** The parts of an HLC. */
export interface HlcParts extends ClockState {
  readonly device: string;
}

/** Whether `value` is a device id: 16 lowercase hexadecimal digits (data model §3.2). */
export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID.test(value);
}

/** A new device id: 64 random bits (data model §3.2). */
export function newDeviceId(random: RandomBytes = randomBytes): string {
  return toHex(random(8));
}

/** The parts of an HLC, or `undefined` if `value` is not one. */
export function parseHlc(value: unknown): HlcParts | undefined {
  if (typeof value !== "string" || !HLC.test(value)) {
    return undefined;
  }
  // The parts have fixed widths: 15 digits, a colon, 5 digits, a colon, 16 hexadecimal digits.
  const counter = Number(value.slice(16, 21));
  if (counter > MAX_COUNTER) {
    return undefined;
  }
  return { wall: Number(value.slice(0, 15)), counter, device: value.slice(22) };
}

/** Whether `value` is a well-formed HLC (data model §3.1). */
export function isHlc(value: unknown): value is Hlc {
  return parseHlc(value) !== undefined;
}

export function formatHlc({ wall, counter, device }: HlcParts): Hlc {
  if (!Number.isSafeInteger(wall) || wall < 0 || wall > MAX_WALL) {
    throw new DataLayerError(
      "invalid",
      "An HLC's wall time must be an integer from 0 to 10^15 - 1.",
    );
  }
  if (!Number.isSafeInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
    throw new DataLayerError(
      "invalid",
      `An HLC's counter must be an integer from 0 to ${MAX_COUNTER}.`,
    );
  }
  if (!isDeviceId(device)) {
    throw new DataLayerError("invalid", "A device id must be 16 lowercase hexadecimal digits.");
  }
  return `${String(wall).padStart(15, "0")}:${String(counter).padStart(5, "0")}:${device}`;
}

/** The HLC for a new change, and the device's clock after it (data model §3.3). */
export function issueHlc(
  last: ClockState,
  now: number,
  device: string,
): { readonly hlc: Hlc; readonly clock: ClockState } {
  let next: ClockState;
  if (now > last.wall) {
    next = { wall: now, counter: 0 };
  } else if (last.counter < MAX_COUNTER) {
    next = { wall: last.wall, counter: last.counter + 1 };
  } else {
    next = { wall: last.wall + 1, counter: 0 };
  }
  return { hlc: formatHlc({ ...next, device }), clock: next };
}

/**
 * The device's clock after it received `hlc` from elsewhere (data model §3.4): every later
 * change then sorts after it.
 */
export function receiveHlc(last: ClockState, hlc: Hlc): ClockState {
  const parts = parseHlc(hlc);
  if (parts === undefined) {
    throw new DataLayerError("invalid", "Only a well-formed HLC can be received.");
  }
  const isLater =
    parts.wall > last.wall || (parts.wall === last.wall && parts.counter > last.counter);
  return isLater ? { wall: parts.wall, counter: parts.counter } : last;
}

/** The wall time of `hlc`: when the device that issued it made its change, by its own date. */
export function wallTime(hlc: Hlc): number {
  const parts = parseHlc(hlc);
  if (parts === undefined) {
    throw new DataLayerError("invalid", "Only a well-formed HLC has a time.");
  }
  return parts.wall;
}

/** Whether `hlc` lies more than 24 hours after `now`: from the future (data model §3.5). */
export function isFromFuture(hlc: Hlc, now: number): boolean {
  return wallTime(hlc) - now > MAX_CLOCK_AHEAD;
}

/**
 * Whether `hlc` lies more than 100 years after `now`: too far ahead for this device to receive
 * it, whatever the user confirms (data model §3.5).
 */
export function isTooFarAhead(hlc: Hlc, now: number): boolean {
  return wallTime(hlc) - now > MAX_RECEIVED_AHEAD;
}

/** The greater of two HLCs, where a missing one is lower than every HLC. */
export function maxHlc(a: Hlc | undefined, b: Hlc | undefined): Hlc | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  return a > b ? a : b;
}
