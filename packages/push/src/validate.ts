/**
 * Checks everything the server receives before storing or acting on it.
 * Requests come from anyone on the internet, so the limits matter.
 */
import { fromBase64Url } from './base64.ts';
import { canonicalTimeZone, isDate, parseStamp, REPEATS, type Timing } from './schedule.ts';

export const LIMITS = {
  /** Scheduled notifications per device. */
  entries: 500,
  idLength: 100,
  /** An encrypted message (what push services accept). */
  payloadBytes: 4096,
  /** The smallest real encrypted message: header, end marker and tag. */
  minPayloadBytes: 86 + 1 + 16,
  endpointLength: 2048,
  /** Reminders up to 4 weeks before, or up to a day after (all-day events at 9:00). */
  maxOffsetBefore: 4 * 7 * 1440,
  maxOffsetAfter: 1440,
  /**
   * All of a device's messages together, as sent (base64url characters). The
   * server keeps a schedule as one value, which can be at most 2 MB.
   */
  payloadsLength: 1_500_000,
  /** A whole request: the messages, and room for the rest (about 200 characters an entry). */
  requestBytes: 1_650_000,
} as const;

export interface ScheduleEntry extends Timing {
  /** Tells the entries apart. Today's apps send a number, never their own ids. */
  id: string;
  /** The encrypted message (encrypt.ts), base64url. */
  payload: string;
}

export interface ScheduleRequest {
  endpoint: string;
  timeZone: string;
  entries: ScheduleEntry[];
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const isIpAddress = (host: string) => /^\d+(\.\d+){3}$/.test(host) || host.includes(':');

/**
 * A reason this push address can't be used, or undefined. Push services
 * (Google, Apple, Mozilla, Microsoft, UnifiedPush servers) all use https on port 443
 * with a domain name. `allowLocal` lets local tests use http://127.0.0.1.
 */
export function endpointProblem(endpoint: unknown, allowLocal = false): string | undefined {
  if (typeof endpoint !== 'string' || endpoint.length > LIMITS.endpointLength) {
    return 'Push address missing or too long.';
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'Push address is not a URL.';
  }
  if (allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1') return undefined;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    url.protocol !== 'https:' ||
    (url.port !== '' && url.port !== '443') ||
    url.username ||
    url.password ||
    !host.includes('.') ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    isIpAddress(host)
  ) {
    return 'Push address must be https with a domain name.';
  }
  return undefined;
}

/**
 * The push services browsers use, by the host names of the addresses they
 * give: Google's (Chrome, Android, Samsung Internet), Apple's (Safari) and
 * Mozilla's (Firefox). Only these names: any other under their domains, such
 * as one that doesn't even exist, counted as theirs, so one made-up device
 * could use their part of an app's day (audit 7 B-2, run 28). If one of them
 * starts giving out addresses at another host, add it here; until then,
 * those devices share the smaller part.
 */
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'web.push.apple.com',
  'updates.push.services.mozilla.com',
];
/** Microsoft's (Edge on Windows), whose hosts are by region, like wns2-par02p.notify.windows.com. */
const WNS_HOST = /^[a-z0-9-]+\.notify\.windows\.com$/;

/**
 * Whether this push address is at one of the push services browsers use.
 * Any other (a UnifiedPush server, or one a stranger made up) shares a
 * smaller part of an app's daily messages (audit 3 B-2).
 */
export function isKnownPushService(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return false;
  }
  return PUSH_HOSTS.includes(host) || WNS_HOST.test(host);
}

function payloadProblem(payload: unknown): string | undefined {
  if (typeof payload !== 'string') return 'Message missing.';
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(payload);
  } catch {
    return 'Message is not base64url.';
  }
  if (bytes.length < LIMITS.minPayloadBytes || bytes.length > LIMITS.payloadBytes) {
    return 'Message has the wrong size.';
  }
  return undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A reason the server won't take this timing, or undefined. Apps check their
 * reminders with it too, so one odd reminder can't stop the others.
 */
export function timingProblem(timing: Record<keyof Timing, unknown>): string | undefined {
  const { start, repeat, until, offset } = timing;
  if (typeof start !== 'string' || !parseStamp(start)) return 'Bad start.';
  if (typeof repeat !== 'string' || !REPEATS.includes(repeat as Timing['repeat'])) {
    return 'Bad repeat.';
  }
  if (until !== null && (typeof until !== 'string' || !isDate(until))) return 'Bad until.';
  if (
    !Number.isInteger(offset) ||
    (offset as number) > LIMITS.maxOffsetBefore ||
    (offset as number) < -LIMITS.maxOffsetAfter
  ) {
    return 'Bad offset.';
  }
  return undefined;
}

function entryProblem(entry: unknown): string | undefined {
  if (!isRecord(entry)) return 'Each entry must be an object.';
  const { id, start, repeat, until, offset } = entry;
  if (typeof id !== 'string' || id.length === 0 || id.length > LIMITS.idLength) return 'Bad id.';
  return timingProblem({ start, repeat, until, offset }) ?? payloadProblem(entry['payload']);
}

/** Checks a "replace my schedule" request. */
export function checkSchedule(value: unknown, allowLocal = false): Checked<ScheduleRequest> {
  if (!isRecord(value)) return { ok: false, error: 'Expected an object.' };
  const endpointError = endpointProblem(value['endpoint'], allowLocal);
  if (endpointError) return { ok: false, error: endpointError };
  const { entries } = value;
  // Kept, and worked with, under the zone's own name only (however it was spelt).
  const timeZone =
    typeof value['timeZone'] === 'string' && value['timeZone'].length <= 64
      ? canonicalTimeZone(value['timeZone'])
      : null;
  if (!timeZone) return { ok: false, error: 'Unknown time zone.' };
  if (!Array.isArray(entries) || entries.length > LIMITS.entries) {
    return { ok: false, error: `Up to ${LIMITS.entries} entries.` };
  }
  const ids = new Set<string>();
  let payloadsLength = 0;
  for (const [index, entry] of entries.entries()) {
    const error = entryProblem(entry);
    if (error) return { ok: false, error: `Entry ${index}: ${error}` };
    const { id, payload } = entry as ScheduleEntry;
    if (ids.has(id)) return { ok: false, error: `Entry ${index}: id used twice.` };
    ids.add(id);
    payloadsLength += payload.length;
    if (payloadsLength > LIMITS.payloadsLength)
      return { ok: false, error: 'Messages too big in all.' };
  }
  // Keep only the fields we know (nothing else gets stored).
  const clean = (entries as ScheduleEntry[]).map(
    ({ id, start, repeat, until, offset, payload }) => ({
      id,
      start,
      repeat,
      until,
      offset,
      payload,
    }),
  );
  return {
    ok: true,
    value: { endpoint: value['endpoint'] as string, timeZone, entries: clean },
  };
}

/** Checks a "send a test notification now" request. */
export function checkTest(
  value: unknown,
  allowLocal = false,
): Checked<{ endpoint: string; payload: string }> {
  if (!isRecord(value)) return { ok: false, error: 'Expected an object.' };
  const error = endpointProblem(value['endpoint'], allowLocal) ?? payloadProblem(value['payload']);
  if (error) return { ok: false, error };
  return {
    ok: true,
    value: { endpoint: value['endpoint'] as string, payload: value['payload'] as string },
  };
}
