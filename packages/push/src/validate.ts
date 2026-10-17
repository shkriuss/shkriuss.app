/**
 * Checks everything the server receives before storing or acting on it.
 * Requests come from anyone on the internet, so the limits matter.
 */
import { fromBase64Url } from './base64.ts';
import { isDate, isTimeZone, parseStamp, REPEATS, type Timing } from './schedule.ts';

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
  /** A whole request (500 messages of 4 KB as base64 is about 2.8 MB). */
  requestBytes: 3_000_000,
} as const;

export interface ScheduleEntry extends Timing {
  /** The app's own id for this notification, e.g. an event id. */
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
 * (Google, Apple, Mozilla, UnifiedPush servers) all use https on port 443
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

function entryProblem(entry: unknown): string | undefined {
  if (!isRecord(entry)) return 'Each entry must be an object.';
  const { id, start, repeat, until, offset } = entry;
  if (typeof id !== 'string' || id.length === 0 || id.length > LIMITS.idLength) return 'Bad id.';
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
  return payloadProblem(entry['payload']);
}

/** Checks a "replace my schedule" request. */
export function checkSchedule(value: unknown, allowLocal = false): Checked<ScheduleRequest> {
  if (!isRecord(value)) return { ok: false, error: 'Expected an object.' };
  const endpointError = endpointProblem(value['endpoint'], allowLocal);
  if (endpointError) return { ok: false, error: endpointError };
  const { timeZone, entries } = value;
  if (typeof timeZone !== 'string' || timeZone.length > 64 || !isTimeZone(timeZone)) {
    return { ok: false, error: 'Unknown time zone.' };
  }
  if (!Array.isArray(entries) || entries.length > LIMITS.entries) {
    return { ok: false, error: `Up to ${LIMITS.entries} entries.` };
  }
  const ids = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const error = entryProblem(entry);
    if (error) return { ok: false, error: `Entry ${index}: ${error}` };
    const id = (entry as ScheduleEntry).id;
    if (ids.has(id)) return { ok: false, error: `Entry ${index}: id used twice.` };
    ids.add(id);
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
