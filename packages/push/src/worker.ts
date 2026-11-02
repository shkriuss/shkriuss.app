/**
 * Server side of notifications while an app is closed (docs/adr/0009).
 *
 * An app that uses it re-exports this from apps/<slug>/src/worker.ts, so it
 * runs in that app's own Worker: requests to /api/push/* come here, and
 * everything else is served from the app's static files as before.
 *
 *   GET    /api/push/key        the app's public VAPID key (for subscribing)
 *   GET    /api/push/schedule   whether the server still has this device (404 if not)
 *   PUT    /api/push/schedule   replace this device's scheduled notifications
 *   DELETE /api/push/schedule   forget this device
 *   POST   /api/push/test       send one notification now
 *
 * The device is identified by a random key only the phone has (a bearer
 * token); the server stores just its SHA-256 hash. Messages arrive already
 * encrypted by the phone, so the server can't read them.
 *
 * Anyone can make up a device key, so all of an app's devices together have
 * a limit (STORAGE_LIMITS, kept by the namespace's meter:
 * @shkriuss/server/meter, docs/adr/0017-storage-limits.md).
 */
import {
  bearerToken,
  bytesBody,
  createWorker,
  json,
  jsonBody,
  noContent,
  problem,
  runAlarm,
  sha256Text,
  type DurableObjectNamespace,
  type DurableObjectState,
  type SiteEnv,
} from '@shkriuss/server';
import {
  LIMIT_HEADER,
  limitOf,
  METER,
  meterFetch,
  NO_LIMIT,
  release,
  reserve,
} from '@shkriuss/server/meter';
import { fromBase64Url } from './base64.ts';
import { nextFireTime } from './schedule.ts';
import {
  checkSchedule,
  checkTest,
  isKnownPushService,
  LIMITS,
  type ScheduleEntry,
} from './validate.ts';
import { generateVapidKeys, vapidAuthorization, type VapidKeys } from './vapid.ts';

export interface PushEnv extends SiteEnv {
  PUSH_DEVICES: DurableObjectNamespace;
  PUSH_KEYS: DurableObjectNamespace;
  /** Only for local browser tests: lets the server send to http://127.0.0.1. */
  ALLOW_LOCAL_ENDPOINTS?: string;
}

// ---------- Settings ----------

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a push service keeps a message for an offline phone. */
const TTL_SECONDS = 6 * 60 * 60;
/** Messages more than this late (the phone was off, the server busy) are skipped. */
const LATE_LIMIT_MS = 60 * 60 * 1000;
/** Retries when a push service is busy or failing, a minute apart, then two. */
const RETRIES = 3;
/**
 * A device whose messages have all failed or been refused for this long is
 * forgotten: a real push service accepts them. Without this, a schedule made
 * up by a stranger would wake the server every day, for good.
 */
const GIVE_UP_MS = 2 * DAY_MS;
/**
 * Messages one app may send in a day (UTC), from all its devices together.
 * Past it, sending waits until 00:00 UTC, so made-up schedules can't use up
 * the free plan's daily Durable Object requests, which every app shares.
 * Each whole second spent waiting for push services counts as one more
 * message: waiting uses up the free plan's Durable Object time, which every
 * app shares too (audit B-1). So an app waits at most about DAILY_SENDS
 * seconds a day, however slow a push address someone makes up.
 */
export const DAILY_SENDS = 2000;
/**
 * How DAILY_SENDS is shared, each part used up on its own (audit 3 B-2):
 * push addresses at the push services browsers use (isKnownPushService) get
 * most of it; any other address (a UnifiedPush server, or one a stranger
 * made up) shares a small part; and test messages, which any made-up device
 * can ask for, another. So strangers' made-up devices can't use up the
 * messages of people at Google's, Apple's, Mozilla's or Microsoft's.
 */
export const DAILY_SHARES = { known: 1700, other: 200, test: 100 } as const;
type Share = keyof typeof DAILY_SHARES;
/**
 * Messages one device may get in a day (UTC), tries again included. Real
 * ones get a few dozen at most; past it, the rest that day are skipped like
 * late ones, so a few made-up devices can't use up a share (audit 3 B-2).
 * Each whole second spent waiting for its push service counts as one more
 * here too, as it does for the app (DAILY_SENDS), and the app counts only
 * the messages really sent: so one device can't use more of the app's day
 * than this (audit 7 B-2, run 28).
 */
export const DEVICE_DAILY_SENDS = 100;
/**
 * How long a push service has to answer a message (real ones take well under
 * a second). One that doesn't is treated as busy: tried again later.
 */
export const SEND_MS = 5_000;
/**
 * A wake-up stops sending after this long, and the rest go out straight
 * after: far inside the 30 seconds Cloudflare gives it.
 */
const WAKE_UP_MS = 10_000;
/** Schedule changes per device in 10 minutes; test messages need 10 seconds between them. */
const UPDATES_PER_WINDOW = 60;
const UPDATE_WINDOW_MS = 10 * 60 * 1000;
const TEST_GAP_MS = 10 * 1000;
/** Messages sent per wake-up; the rest go out straight after (keeps each wake-up short). */
const SENDS_PER_ALARM = 25;
/**
 * A device whose schedule hasn't been uploaded for this long (about 13
 * months) is forgotten. Apps upload it at least weekly while they're used.
 */
const UNUSED_MS = 396 * DAY_MS;
/**
 * All of one app's device schedules together, in bytes. Each device also
 * counts 16 KB, whatever it holds.
 */
export const STORAGE_LIMITS = 40_000_000;

// ---------- Helpers ----------

const allowLocal = (env: PushEnv) => env.ALLOW_LOCAL_ENDPOINTS === 'true';

// ---------- The Worker ----------

/** Requests to /api/push/*. */
export async function handlePush(request: Request, env: PushEnv, path: string): Promise<Response> {
  if (path === '/api/push/key') {
    if (request.method !== 'GET') return problem(405, 'Use GET.');
    const keys = env.PUSH_KEYS.get(env.PUSH_KEYS.idFromName('vapid'));
    return json(await (await keys.fetch('https://keys/public-key')).json());
  }

  const route =
    path === '/api/push/schedule' &&
    (request.method === 'GET' || request.method === 'PUT' || request.method === 'DELETE')
      ? request.method
      : path === '/api/push/test' && request.method === 'POST'
        ? 'TEST'
        : null;
  if (!route) return problem(404, 'Not found.');

  const deviceKey = bearerToken(request);
  if (!deviceKey) return problem(401, 'Missing or malformed device key.');
  const device = env.PUSH_DEVICES.get(env.PUSH_DEVICES.idFromName(await sha256Text(deviceKey)));

  if (route === 'GET' || route === 'DELETE') {
    return device.fetch('https://device/schedule', { method: route });
  }

  // Only the size is checked here, and the device checks the rest: checking a
  // full schedule here took more than the free plan's 10 ms of CPU time
  // (audit finding B-9), while the device's object has 30 seconds.
  const read = await bytesBody(request, LIMITS.requestBytes);
  if (!read.ok) return read.response;
  return device.fetch(route === 'PUT' ? 'https://device/schedule' : 'https://device/test', {
    method: route === 'PUT' ? 'PUT' : 'POST',
    body: read.body,
    headers: { [LIMIT_HEADER]: String(STORAGE_LIMITS) },
  });
}

export default createWorker<PushEnv>({ '/api/push': handlePush });

// ---------- The app's signing keys (one per app) ----------

export class PushKeys {
  readonly state: DurableObjectState;
  #keys: VapidKeys | undefined;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /** Loads the key pair, making one the first time. */
  async #load(): Promise<VapidKeys> {
    this.#keys ??= await this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get<VapidKeys>('vapid');
      if (saved) return saved;
      const created = await generateVapidKeys();
      await this.state.storage.put('vapid', created);
      return created;
    });
    return this.#keys;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const keys = await this.#load();
    if (pathname === '/public-key') return json({ publicKey: keys.publicKey });
    if (pathname === '/sign' && request.method === 'POST') {
      const { endpoint, sends, share } = (await request.json()) as {
        endpoint: string;
        sends: number;
        share: Share;
      };
      if (!(await this.#count(share, () => sends))) {
        return problem(429, 'Today’s messages are used up.');
      }
      return json({ authorization: await vapidAuthorization(endpoint, keys) });
    }
    if (pathname === '/settle' && request.method === 'POST') {
      const { day, unsent, seconds, share } = (await request.json()) as Settled;
      const count = (value: number) => (Number.isSafeInteger(value) ? Math.max(0, value) : 0);
      // Messages signed for but not sent are given back, if it's still that day.
      await this.#count(
        share,
        (today) => count(seconds) - (day === today ? count(unsent) : 0),
        true,
      );
      return noContent();
    }
    return problem(404, 'Not found.');
  }

  /**
   * Counts `change(today)` more messages today (UTC) in this share of the
   * day's messages; false if that would go over it. Time already spent
   * waiting, and messages given back, are counted `anyway`.
   */
  async #count(share: Share, change: (today: number) => number, anyway = false): Promise<boolean> {
    return this.state.blockConcurrencyWhile(async () => {
      const today = Math.floor(Date.now() / DAY_MS);
      const saved = await this.state.storage.get<{ day: number; shares?: Record<string, number> }>(
        'sent',
      );
      const shares = saved?.day === today ? (saved.shares ?? {}) : {};
      const name = share in DAILY_SHARES ? share : 'other';
      const sent = shares[name] ?? 0;
      const sends = change(today);
      if (sent + sends > DAILY_SHARES[name] && !anyway) return false;
      if (sends === 0) return true;
      await this.state.storage.put('sent', {
        day: today,
        shares: { ...shares, [name]: Math.max(0, sent + sends) },
      });
      return true;
    });
  }
}

/** What a wake-up (or a test message) tells the signing object when it's done: see PushDevice#settle. */
interface Settled {
  share: Share;
  day: number;
  unsent: number;
  seconds: number;
}

/** Whole seconds since `started` (ms). */
const secondsSince = (started: number): number => Math.floor((Date.now() - started) / 1000);

/** Which share of the day's messages one to this push address counts against. */
const shareOf = (endpoint: string): Share => (isKnownPushService(endpoint) ? 'known' : 'other');

// ---------- One device's scheduled notifications ----------

interface StoredEntry extends ScheduleEntry {
  /** When it's next due (ms). */
  next: number;
  /** Failed sends of this time so far, and when to try again. */
  attempts: number;
  retryAt: number | null;
}

interface DeviceRecord {
  endpoint: string;
  timeZone: string;
  entries: StoredEntry[];
  updates: { windowStart: number; count: number };
  /** Since when every message has failed or been refused (null: the last one got through). */
  failingSince?: number | null;
  /**
   * Messages sent to it on this day (days since 1970, UTC), with each whole
   * second spent waiting for its push service as one more: see DEVICE_DAILY_SENDS.
   */
  sentToday?: { day: number; sends: number };
}

/** How many messages this device has had today (UTC). */
const sentToday = (record: DeviceRecord, now: number): number =>
  record.sentToday?.day === Math.floor(now / DAY_MS) ? record.sentToday.sends : 0;

/**
 * Once a device has had its messages for the day (UTC), every entry due
 * before 00:00 UTC is skipped now, on to its first time after that, as each
 * would be skipped at its own time anyway. Waking up for each one cost
 * about 500 wake-ups a day for a schedule of 500 reminders a minute apart,
 * for 13 months (audit 7 B-3, run 28). One tried again after 00:00 UTC is
 * kept: it can go out then.
 */
function skipRestOfDay(record: DeviceRecord, now: number): DeviceRecord {
  if (sentToday(record, now) < DEVICE_DAILY_SENDS) return record;
  const tomorrow = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
  const entries = record.entries.flatMap((entry) => {
    if ((entry.retryAt ?? entry.next) >= tomorrow) return [entry];
    const next = nextFireTime(entry, record.timeZone, tomorrow - 1);
    return next === null ? [] : [{ ...entry, next, attempts: 0, retryAt: null }];
  });
  return { ...record, entries };
}

type SendResult = 'sent' | 'gone' | 'rejected' | 'retry';
/** The Authorization header for messages, or why there's none. */
type Signed = { authorization: string } | 'limit' | 'failed';

export class PushDevice {
  readonly state: DurableObjectState;
  readonly env: PushEnv;
  /**
   * When this device last asked for a test message (ms). Only in memory: a
   * device without a schedule keeps nothing at all, since anyone can make
   * one up and no meter counts it (audit 6). Cloudflare keeps an object
   * in memory far longer than TEST_GAP_MS after a request; if it doesn't,
   * a test only comes a little sooner, and the day's test messages
   * (DAILY_SHARES.test) are limited anyway.
   */
  #lastTest = 0;

  constructor(state: DurableObjectState, env: PushEnv) {
    this.state = state;
    this.env = env;
  }

  async #record(): Promise<DeviceRecord | undefined> {
    return this.state.storage.get<DeviceRecord>('device');
  }

  /** Saves the schedule; false if there's no room for it (the app's limit is reached). */
  async #save(record: DeviceRecord, limit: number): Promise<boolean> {
    if (record.entries.length === 0) {
      // Nothing left to send: keep nothing at all.
      await this.#forget();
      return true;
    }
    const bytes = JSON.stringify(record).length;
    if (!(await reserve(this.state, this.env.PUSH_DEVICES, bytes, limit))) return false;
    await this.#arm(record);
    await this.state.storage.put('device', record);
    return true;
  }

  /**
   * Sets the next wake-up. Every upload, wake-up and test message sets it
   * again, so one Cloudflare didn't run (if the day's free requests ran
   * out, say) doesn't stop the device's reminders for good (audit 3 B-4).
   */
  async #arm(record: DeviceRecord): Promise<void> {
    await this.state.storage.setAlarm(
      Math.min(
        ...record.entries.map((entry) => entry.retryAt ?? entry.next),
        // Wakes up to forget it, too, if it isn't uploaded again in time…
        record.updates.windowStart + UNUSED_MS,
        // …or once nothing has got through for two days, not only at the
        // next message, which may be a year away (audit 3 D-4).
        (record.failingSince ?? Infinity) + GIVE_UP_MS,
      ),
    );
  }

  async #forget(): Promise<void> {
    await release(this.state, this.env.PUSH_DEVICES);
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
  }

  /**
   * Signs for `sends` messages to `endpoint`, counted in `share` of the
   * app's day (those not sent are given back after: #settle). One signature
   * lasts 12 hours, so a whole wake-up needs only one. 'limit': that share
   * of today's messages is used up.
   */
  async #sign(endpoint: string, sends: number, share: Share): Promise<Signed> {
    const keys = this.env.PUSH_KEYS.get(this.env.PUSH_KEYS.idFromName('vapid'));
    try {
      const response = await keys.fetch('https://keys/sign', {
        method: 'POST',
        body: JSON.stringify({ endpoint, sends, share }),
      });
      if (response.status === 429) return 'limit';
      return response.ok ? ((await response.json()) as { authorization: string }) : 'failed';
    } catch {
      return 'failed';
    }
  }

  /**
   * After sending, in one request (none when there's nothing to say): counts
   * each whole second spent waiting for the push service as one more message
   * in `share` of the app's day (see DAILY_SENDS), and gives back the
   * messages signed for on `day` that weren't sent after all. A wake-up
   * signs for all it means to send, but once one fails for now the rest
   * wait for the try again, which signs for them again: counted each time,
   * they used up the day of the big push services for one made-up device
   * (audit 7 B-2, run 28).
   */
  async #settle({ share, day, unsent, seconds }: Settled): Promise<void> {
    if (unsent <= 0 && seconds <= 0) return;
    const keys = this.env.PUSH_KEYS.get(this.env.PUSH_KEYS.idFromName('vapid'));
    try {
      await keys.fetch('https://keys/settle', {
        method: 'POST',
        body: JSON.stringify({ share, day, unsent, seconds }),
      });
    } catch {
      // Only counting: the time limits keep each wait short anyway.
    }
  }

  /** Sends one encrypted message to the device's push service, waiting SEND_MS at most. */
  async #send(endpoint: string, payload: string, authorization: string): Promise<SendResult> {
    const timeLimit = new AbortController();
    const timer = setTimeout(() => timeLimit.abort(), SEND_MS);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        // Push services never redirect. Following one could lead anywhere (plain
        // http, an IP address), so a redirect is refused like any other answer.
        redirect: 'manual',
        headers: {
          Authorization: authorization,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(TTL_SECONDS),
          Urgency: 'high',
        },
        body: fromBase64Url(payload),
        signal: timeLimit.signal,
      });
    } catch {
      // Unreachable, or no answer in time.
      return 'retry';
    } finally {
      clearTimeout(timer);
    }
    // Only the status matters: the rest of the answer isn't waited for.
    void response.body?.cancel().catch(() => undefined);
    if (response.ok) return 'sent';
    if (response.status === 404 || response.status === 410) return 'gone';
    if (response.status === 429 || response.status >= 500) return 'retry';
    return 'rejected';
  }

  async fetch(request: Request): Promise<Response> {
    // The app's meter is one of these objects too, named METER.
    if (new URL(request.url).hostname === METER) return meterFetch(this.state, request);
    // One request at a time, and never during a wake-up, so none of them works
    // from a copy that another has just changed.
    return this.state.blockConcurrencyWhile(() => this.#handle(request));
  }

  async #handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const now = Date.now();
    const record = await this.#record();

    if (request.method === 'DELETE') {
      await this.#forget();
      return noContent();
    }
    // Whether it still has this device: it forgets one whose push service
    // said it's gone, or that hasn't had a message through for two days, and
    // the device asks now and then (audit 4 F1-2). Keeps nothing.
    if (request.method === 'GET') {
      return record ? json({ entries: record.entries.length }) : problem(404, 'Nothing kept.');
    }

    // Checked here rather than in the Worker (handlePush), before anything is kept.
    const read = await jsonBody(request, LIMITS.requestBytes);
    if (!read.ok) return read.response;

    if (pathname === '/test') {
      const checked = checkTest(read.body, allowLocal(this.env));
      if (!checked.ok) return problem(400, checked.error);
      const { endpoint, payload } = checked.value;
      if (now - this.#lastTest < TEST_GAP_MS) return problem(429, 'Wait a few seconds.');
      this.#lastTest = now;
      // A device with a schedule: its wake-up is set again, in case
      // Cloudflare dropped it (audit 3 B-4). One without keeps nothing.
      if (record) await this.#arm(record);
      // Test messages have their own share of the day: any made-up device can ask for them.
      const signed = await this.#sign(endpoint, 1, 'test');
      if (signed === 'limit') return problem(429, 'No more notifications today; try tomorrow.');
      const started = Date.now();
      const result =
        signed === 'failed' ? 'retry' : await this.#send(endpoint, payload, signed.authorization);
      const day = Math.floor(now / DAY_MS);
      await this.#settle({ share: 'test', day, unsent: 0, seconds: secondsSince(started) });
      if (result === 'gone') {
        if (record) await this.#forget();
        return problem(410, 'This device is no longer subscribed.');
      }
      return result === 'sent'
        ? json({ sent: true })
        : problem(502, 'The push service refused it.');
    }

    // PUT /schedule
    const checked = checkSchedule(read.body, allowLocal(this.env));
    if (!checked.ok) return problem(400, checked.error);
    const schedule = checked.value;
    const updates =
      record && now - record.updates.windowStart < UPDATE_WINDOW_MS
        ? { ...record.updates, count: record.updates.count + 1 }
        : { windowStart: now, count: 1 };
    if (updates.count > UPDATES_PER_WINDOW)
      return problem(429, 'Too many changes; try again soon.');
    const entries: StoredEntry[] = [];
    for (const entry of schedule.entries) {
      const next = nextFireTime(entry, schedule.timeZone, now);
      if (next !== null) entries.push({ ...entry, next, attempts: 0, retryAt: null });
    }
    const saved = await this.#save(
      {
        endpoint: schedule.endpoint,
        timeZone: schedule.timeZone,
        entries,
        updates,
        // Still failing for the same push address: an upload doesn't start the count again.
        failingSince: record?.endpoint === schedule.endpoint ? (record.failingSince ?? null) : null,
        // Nor the day's messages (audit 3 B-2).
        ...(record?.sentToday ? { sentToday: record.sentToday } : {}),
      },
      limitOf(request),
    );
    if (!saved) return problem(507, 'There’s no room for more notifications just now.');
    return json({ scheduled: entries.length });
  }

  /** Called by the alarm: sends what's due and plans the next wake-up. */
  async alarm(): Promise<void> {
    // No schedule changes while sending, so none get lost.
    await runAlarm(this.state, () => this.#sendDue());
  }

  async #sendDue(): Promise<void> {
    const record = await this.#record();
    const now = Date.now();
    // No schedule (only a test's time, which versions before audit 6 kept
    // for 10 seconds), not uploaded for 13 months
    // (updates.windowStart is the last upload, give or take 10 minutes), or
    // nothing has got through for two days (a made-up or long-dead push address).
    if (
      !record ||
      now - record.updates.windowStart >= UNUSED_MS ||
      now - (record.failingSince ?? Infinity) >= GIVE_UP_MS
    ) {
      await this.#forget();
      return;
    }
    // What's due, and what to do with each: send it (at most SENDS_PER_ALARM
    // in a wake-up, while the device has messages left today: the rest go
    // out straight after), or skip it: one more than an hour late, or every
    // one once the device's messages for the day are used up (audit 3 B-2).
    // All those are skipped now, however many, not 25 a wake-up (audit 7
    // B-3, run 28).
    const left = Math.max(0, DEVICE_DAILY_SENDS - sentToday(record, now));
    const due = record.entries.filter((entry) => (entry.retryAt ?? entry.next) <= now);
    const onTime = due.filter((entry) => now - entry.next <= LATE_LIMIT_MS);
    const sending = Math.min(SENDS_PER_ALARM, left);
    const toSend = new Set(onTime.slice(0, sending));
    const straightAfter = new Set(left > 0 ? onTime.slice(sending) : []);
    const handled = new Set(due.filter((entry) => !straightAfter.has(entry)));
    const share = shareOf(record.endpoint);
    // One signature for them all (none needed if none are sent).
    const signed =
      toSend.size > 0 ? await this.#sign(record.endpoint, toSend.size, share) : 'failed';
    if (signed === 'limit') {
      // This share of the app's messages for today is used up: try again after 00:00 UTC.
      await this.state.storage.setAlarm((Math.floor(now / DAY_MS) + 1) * DAY_MS);
      return;
    }
    const day = Math.floor(now / DAY_MS);
    const started = Date.now();
    let sends = 0;
    let seconds: number | undefined;
    try {
      const batch = await this.#sendBatch(record, handled, toSend, signed, now);
      sends = batch.sends;
      seconds = secondsSince(started);
      if (!batch.record) {
        await this.#forget();
        return;
      }
      // The device counts what the app counts: what it really sent, and the waiting.
      const used = { day, sends: sentToday(record, now) + sends + seconds };
      // What it already had, give or take a few bytes: never refused.
      await this.#save(skipRestOfDay({ ...batch.record, sentToday: used }, now), NO_LIMIT);
    } finally {
      await this.#settle({
        share,
        day,
        unsent: signed === 'failed' ? 0 : toSend.size - sends,
        seconds: seconds ?? secondsSince(started),
      });
    }
  }

  /**
   * Sends this wake-up's messages: the record to save after (without the
   * day's count), or null to forget the device; and how many were sent.
   */
  async #sendBatch(
    record: DeviceRecord,
    due: ReadonlySet<StoredEntry>,
    toSend: ReadonlySet<StoredEntry>,
    signed: Exclude<Signed, 'limit'>,
    now: number,
  ): Promise<{ record: DeviceRecord | null; sends: number }> {
    let failingSince = record.failingSince ?? null;
    // Once a message doesn't get through for now (the push service is down,
    // busy or doesn't answer), the rest wait for the retry with it: sending
    // them now would only meet the same.
    let busy = false;
    let sends = 0;
    const entries: StoredEntry[] = [];
    for (const entry of record.entries) {
      if (!due.has(entry)) {
        entries.push(entry);
        continue;
      }
      // Due but not to be sent: skipped, like one more than an hour late.
      let result: SendResult | 'late' = 'late';
      if (toSend.has(entry)) {
        if (busy || signed === 'failed') {
          // If signing failed (our side), try again as if the push service were busy.
          result = 'retry';
        } else if (Date.now() - now >= WAKE_UP_MS) {
          // This wake-up has sent for long enough: it goes straight after.
          entries.push(entry);
          continue;
        } else {
          sends += 1;
          result = await this.#send(record.endpoint, entry.payload, signed.authorization);
          busy = result === 'retry';
        }
      }
      // The phone unsubscribed or the browser data was cleared: forget everything.
      if (result === 'gone') return { record: null, sends };
      if (result === 'sent') failingSince = null;
      else if (result !== 'late' && signed !== 'failed') {
        // Nothing has got through for two days: a made-up or long-dead push address.
        failingSince ??= now;
        if (now - failingSince >= GIVE_UP_MS) return { record: null, sends };
      }
      if (result === 'retry' && entry.attempts < RETRIES) {
        const attempts = entry.attempts + 1;
        entries.push({ ...entry, attempts, retryAt: now + attempts * 60_000 });
        continue;
      }
      // Sent, refused, skipped, or out of retries: on to the next time, if any.
      const next = nextFireTime(entry, record.timeZone, Math.max(entry.next, now));
      if (next !== null) entries.push({ ...entry, next, attempts: 0, retryAt: null });
    }
    return { record: { ...record, entries, failingSince }, sends };
  }
}
