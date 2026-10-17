/**
 * Server side of notifications while an app is closed (docs/adr/0009).
 *
 * An app that uses it re-exports this from apps/<slug>/src/worker.ts, so it
 * runs in that app's own Worker: requests to /api/push/* come here, and
 * everything else is served from the app's static files as before.
 *
 *   GET    /api/push/key        the app's public VAPID key (for subscribing)
 *   PUT    /api/push/schedule   replace this device's scheduled notifications
 *   DELETE /api/push/schedule   forget this device
 *   POST   /api/push/test       send one notification now
 *
 * The device is identified by a random key only the phone has (a bearer
 * token); the server stores just its SHA-256 hash. Messages arrive already
 * encrypted by the phone, so the server can't read them.
 */
import {
  bearerToken,
  createWorker,
  json,
  jsonBody,
  noContent,
  problem,
  sha256Text,
  type DurableObjectNamespace,
  type DurableObjectState,
  type SiteEnv,
} from '@shkriuss/server';
import { fromBase64Url } from './base64.ts';
import { nextFireTime } from './schedule.ts';
import {
  checkSchedule,
  checkTest,
  LIMITS,
  type ScheduleEntry,
  type ScheduleRequest,
} from './validate.ts';
import { generateVapidKeys, vapidAuthorization, type VapidKeys } from './vapid.ts';

export interface PushEnv extends SiteEnv {
  PUSH_DEVICES: DurableObjectNamespace;
  PUSH_KEYS: DurableObjectNamespace;
  /** Only for local browser tests: lets the server send to http://127.0.0.1. */
  ALLOW_LOCAL_ENDPOINTS?: string;
}

// ---------- Settings ----------

/** How long a push service keeps a message for an offline phone. */
const TTL_SECONDS = 6 * 60 * 60;
/** Messages more than this late (the phone was off, the server busy) are skipped. */
const LATE_LIMIT_MS = 60 * 60 * 1000;
/** Retries when a push service is busy or failing, a minute apart, then two. */
const RETRIES = 3;
/** Schedule changes per device in 10 minutes; test messages need 10 seconds between them. */
const UPDATES_PER_WINDOW = 60;
const UPDATE_WINDOW_MS = 10 * 60 * 1000;
const TEST_GAP_MS = 10 * 1000;
/** Messages sent per wake-up; the rest go out straight after (keeps each wake-up short). */
const SENDS_PER_ALARM = 25;

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
    path === '/api/push/schedule' && (request.method === 'PUT' || request.method === 'DELETE')
      ? request.method
      : path === '/api/push/test' && request.method === 'POST'
        ? 'TEST'
        : null;
  if (!route) return problem(404, 'Not found.');

  const deviceKey = bearerToken(request);
  if (!deviceKey) return problem(401, 'Missing or malformed device key.');
  const device = env.PUSH_DEVICES.get(env.PUSH_DEVICES.idFromName(await sha256Text(deviceKey)));

  if (route === 'DELETE') return device.fetch('https://device/schedule', { method: 'DELETE' });

  const read = await jsonBody(request, LIMITS.requestBytes);
  if (!read.ok) return read.response;
  const checked =
    route === 'PUT'
      ? checkSchedule(read.body, allowLocal(env))
      : checkTest(read.body, allowLocal(env));
  if (!checked.ok) return problem(400, checked.error);
  return device.fetch(route === 'PUT' ? 'https://device/schedule' : 'https://device/test', {
    method: route === 'PUT' ? 'PUT' : 'POST',
    body: JSON.stringify(checked.value),
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
      const { endpoint } = (await request.json()) as { endpoint: string };
      return json({ authorization: await vapidAuthorization(endpoint, keys) });
    }
    return problem(404, 'Not found.');
  }
}

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
}

type SendResult = 'sent' | 'gone' | 'rejected' | 'retry';

export class PushDevice {
  readonly state: DurableObjectState;
  readonly env: PushEnv;

  constructor(state: DurableObjectState, env: PushEnv) {
    this.state = state;
    this.env = env;
  }

  async #record(): Promise<DeviceRecord | undefined> {
    return this.state.storage.get<DeviceRecord>('device');
  }

  async #save(record: DeviceRecord): Promise<void> {
    if (record.entries.length === 0) {
      // Nothing left to send: keep nothing at all.
      await this.#forget();
      return;
    }
    await this.state.storage.setAlarm(
      Math.min(...record.entries.map((entry) => entry.retryAt ?? entry.next)),
    );
    await this.state.storage.put('device', record);
  }

  async #forget(): Promise<void> {
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();
  }

  /** Sends one encrypted message to the device's push service. */
  async #send(endpoint: string, payload: string): Promise<SendResult> {
    const keys = this.env.PUSH_KEYS.get(this.env.PUSH_KEYS.idFromName('vapid'));
    let response: Response;
    try {
      const signed = (await (
        await keys.fetch('https://keys/sign', {
          method: 'POST',
          body: JSON.stringify({ endpoint }),
        })
      ).json()) as { authorization: string };
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: signed.authorization,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(TTL_SECONDS),
          Urgency: 'high',
        },
        body: fromBase64Url(payload),
      });
    } catch {
      return 'retry';
    }
    if (response.ok) return 'sent';
    if (response.status === 404 || response.status === 410) return 'gone';
    if (response.status === 429 || response.status >= 500) return 'retry';
    return 'rejected';
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const now = Date.now();
    const record = await this.#record();

    if (request.method === 'DELETE') {
      await this.#forget();
      return noContent();
    }

    if (pathname === '/test') {
      const { endpoint, payload } = (await request.json()) as { endpoint: string; payload: string };
      const lastTest = (await this.state.storage.get<number>('lastTest')) ?? 0;
      if (now - lastTest < TEST_GAP_MS) return problem(429, 'Wait a few seconds.');
      await this.state.storage.put('lastTest', now);
      const result = await this.#send(endpoint, payload);
      if (result === 'gone') {
        await this.#forget();
        return problem(410, 'This device is no longer subscribed.');
      }
      return result === 'sent'
        ? json({ sent: true })
        : problem(502, 'The push service refused it.');
    }

    // PUT /schedule
    const updates =
      record && now - record.updates.windowStart < UPDATE_WINDOW_MS
        ? { ...record.updates, count: record.updates.count + 1 }
        : { windowStart: now, count: 1 };
    if (updates.count > UPDATES_PER_WINDOW)
      return problem(429, 'Too many changes; try again soon.');
    const schedule = (await request.json()) as ScheduleRequest;
    const entries: StoredEntry[] = [];
    for (const entry of schedule.entries) {
      const next = nextFireTime(entry, schedule.timeZone, now);
      if (next !== null) entries.push({ ...entry, next, attempts: 0, retryAt: null });
    }
    await this.#save({
      endpoint: schedule.endpoint,
      timeZone: schedule.timeZone,
      entries,
      updates,
    });
    return json({ scheduled: entries.length });
  }

  /** Called by the alarm: sends what's due and plans the next wake-up. */
  async alarm(): Promise<void> {
    // No schedule changes while sending, so none get lost.
    await this.state.blockConcurrencyWhile(() => this.#sendDue());
  }

  async #sendDue(): Promise<void> {
    const record = await this.#record();
    if (!record) return;
    const now = Date.now();
    const entries: StoredEntry[] = [];
    let sends = 0;
    for (const entry of record.entries) {
      if ((entry.retryAt ?? entry.next) > now || sends >= SENDS_PER_ALARM) {
        entries.push(entry);
        continue;
      }
      sends += 1;
      let result: SendResult = 'rejected';
      if (now - entry.next <= LATE_LIMIT_MS) {
        result = await this.#send(record.endpoint, entry.payload);
      }
      if (result === 'gone') {
        // The phone unsubscribed or the browser data was cleared: forget everything.
        await this.#forget();
        return;
      }
      if (result === 'retry' && entry.attempts < RETRIES) {
        const attempts = entry.attempts + 1;
        entries.push({ ...entry, attempts, retryAt: now + attempts * 60_000 });
        continue;
      }
      // Sent, refused, too late, or out of retries: on to the next time, if any.
      const next = nextFireTime(entry, record.timeZone, Math.max(entry.next, now));
      if (next !== null) entries.push({ ...entry, next, attempts: 0, retryAt: null });
    }
    await this.#save({ ...record, entries });
  }
}
