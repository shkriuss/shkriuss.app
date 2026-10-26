/**
 * Uploading an app's scheduled notifications, and whether the server has
 * them (./client.ts loads this when it's first needed: the switch itself,
 * ./device.ts, is all a page needs to open).
 *
 * Every message is encrypted here, to this device's own subscription, before
 * it's uploaded.
 */
import { fromBase64Url, toBase64Url } from './base64.ts';
import {
  api,
  disablePush,
  finishPushDelete,
  isPushDeletePending,
  load,
  noteDelete,
  PushError,
  registration,
  startUpload,
  store,
  subscribe,
  type DeviceState,
} from './device.ts';
import { encryptPayload, MAX_PLAINTEXT_BYTES } from './encrypt.ts';
import { nextFireTime, type Repeat } from './schedule.ts';
import { LIMITS, timingProblem } from './validate.ts';

/** Re-upload at least this often, even if nothing changed (keeps the server's copy fresh). */
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

/** One scheduled notification, in the app's own local time. */
export interface Notice {
  /** Unique within the app, e.g. an event id. It stays on the device. */
  id: string;
  /** When the thing starts, local time "YYYY-MM-DDTHH:MM". */
  start: string;
  repeat: Repeat;
  /** The last day it may start on, "YYYY-MM-DD", or null. */
  until: string | null;
  /** Minutes before the start to notify (negative = after). */
  offset: number;
  title: string;
  body: string;
  /** Notifications with the same tag replace each other. */
  tag?: string;
  /** Page to open when it's tapped (this app's own path). */
  url?: string;
}

/** Cuts text so the encrypted message fits (push services take 4 KB). */
function messageOf(
  notice: Pick<Notice, 'title' | 'body' | 'tag' | 'url'>,
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const message = {
    title: notice.title.slice(0, 200),
    body: notice.body.slice(0, 500),
    tag: notice.tag,
    url: notice.url,
  };
  const bytes = encoder.encode(JSON.stringify(message));
  return bytes.length <= MAX_PLAINTEXT_BYTES
    ? bytes
    : encoder.encode(JSON.stringify({ ...message, body: '' }));
}

async function hashOf(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Makes sure the subscription is still the one we know (browsers can renew
 * it) and returns the current device state, or null if push is off.
 */
async function current(): Promise<DeviceState | null> {
  const state = load();
  if (!state) return null;
  const subscription = await (await registration()).pushManager.getSubscription();
  if (subscription?.endpoint === state.endpoint) return state;
  // Turned off meanwhile (here or in another tab): it stays off (audit 3 D-1).
  if (load()?.deviceKey !== state.deviceKey) return null;
  if (Notification.permission !== 'granted') {
    // Turned off in the browser's settings: forget it here and on the server.
    await disablePush();
    return null;
  }
  await subscribe(state.deviceKey);
  return load();
}

/** What an upload left on the server: how many notifications, and how many more didn't fit. */
export interface PushSynced {
  scheduled: number;
  /** Upcoming ones the server doesn't have (more than it keeps): only an open app shows them. */
  left: number;
}

const NONE: PushSynced = { scheduled: 0, left: 0 };

/**
 * What syncPush uploads for these notices at `now`: the ones that will still
 * happen, soonest first, up to the server's limit, and its fingerprint; and
 * the rest still to come (`later`), which the server can't have.
 */
async function scheduleOf(notices: readonly Notice[], endpoint: string, now: number) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const later: Notice[] = [];
  const upcoming = notices
    .flatMap((notice) => {
      // Any the server would turn down stays here, so one odd reminder can't stop the rest.
      if (timingProblem(notice) !== undefined) {
        later.push(notice);
        return [];
      }
      const next = nextFireTime(notice, timeZone, now);
      return next === null ? [] : [{ notice, next }];
    })
    .sort((a, b) => a.next - b.next)
    .map((item) => item.notice);
  later.push(...upcoming.splice(LIMITS.entries));
  return { timeZone, upcoming, later, hash: await hashOf({ upcoming, timeZone, endpoint }) };
}

/**
 * Which of these notifications the notification service has as they are
 * now (the last upload of them got through), so it sends them, and an open
 * app mustn't show them a second time: a test of a notification's tag.
 * None while push is off, and after a change that couldn't be uploaded (say,
 * offline): then nothing would send them, so the open app shows them itself
 * (audit F1-7). Nor those that didn't fit on the server (audit 3 F1-5).
 */
export async function pushHolds(notices: readonly Notice[]): Promise<(tag: string) => boolean> {
  const state = load();
  const synced = state?.synced;
  if (!state || !synced) return () => false;
  // As they were worked out then: time passing changes nothing.
  const { upcoming, later, hash } = await scheduleOf(notices, state.endpoint, synced.at);
  if (hash !== synced.hash) return () => false;
  const count = synced.count ?? upcoming.length;
  const left = new Set([...upcoming.slice(count), ...later].map((notice) => notice.tag));
  if (left.size === 0) return () => true;
  // A tag also used by one that didn't fit (a habit's other days, say): shown
  // here too, as twice is better than never.
  const held = new Set(upcoming.slice(0, count).map((notice) => notice.tag));
  return (tag) => held.has(tag) && !left.has(tag);
}

/**
 * Uploads the app's scheduled notifications (replacing earlier ones). Skips
 * the upload when nothing changed recently. Says how many are scheduled, and
 * how many more didn't fit (audit 3 F1-5).
 */
export async function syncPush(
  notices: readonly Notice[],
  options: { force?: boolean } = {},
): Promise<PushSynced> {
  // An earlier copy still on the server (turned off while offline) would send twice.
  if (isPushDeletePending()) await finishPushDelete();
  const state = await current();
  if (!state) return NONE;
  const now = Date.now();
  const { timeZone, upcoming, later, hash } = await scheduleOf(notices, state.endpoint, now);
  const { synced } = state;
  if (!options.force && synced?.hash === hash && now - synced.at < REFRESH_MS) {
    const scheduled = synced.count ?? upcoming.length;
    return { scheduled, left: upcoming.length - scheduled + later.length };
  }
  // disablePush() waits for this upload, so the server gets its deletion last (audit 3 D-1).
  const done = startUpload();
  let sent = false;
  try {
    const target = { p256dh: fromBase64Url(state.p256dh), auth: fromBase64Url(state.auth) };
    const entries = [];
    let payloadsLength = 0;
    for (const [index, notice] of upcoming.entries()) {
      const payload = toBase64Url(await encryptPayload(messageOf(notice), target));
      // Only as many as the server can keep (very long texts make big messages).
      payloadsLength += payload.length;
      if (payloadsLength > LIMITS.payloadsLength) break;
      const { start, repeat, until, offset } = notice;
      // A number, never the app's own id: an imported event's id can say where it came from.
      entries.push({ id: String(index + 1), start, repeat, until, offset, payload });
    }
    // Turned off meanwhile: nothing to send.
    if (load()?.deviceKey !== state.deviceKey) return NONE;
    sent = true;
    const response = await api(
      '/schedule',
      { method: 'PUT', body: JSON.stringify({ endpoint: state.endpoint, timeZone, entries }) },
      state.deviceKey,
    );
    if (!response.ok)
      throw new PushError('refused', 'The notification service didn’t accept the update.');
    // Saved only while it's still on with this device key.
    const latest = load();
    if (latest?.deviceKey !== state.deviceKey) return NONE;
    store({ ...latest, synced: { hash, at: now, count: entries.length } });
    return { scheduled: entries.length, left: upcoming.length - entries.length + later.length };
  } finally {
    // Turned off while it was on its way (here, in another tab, or by "Delete
    // all data"): what it may have put back on the server is deleted again,
    // after it, whether its answer came or not (audit 3 D-1).
    if (sent && load()?.deviceKey !== state.deviceKey) {
      noteDelete(state.deviceKey);
      await finishPushDelete(state.deviceKey);
    }
    done();
  }
}

/** Sends one notification to this device right now. */
export async function sendTestPush(title: string, body: string): Promise<void> {
  const state = await current();
  if (!state) throw new PushError('unsupported', 'Notifications while closed are off.');
  const target = { p256dh: fromBase64Url(state.p256dh), auth: fromBase64Url(state.auth) };
  const payload = toBase64Url(
    await encryptPayload(messageOf({ title, body, tag: 'test', url: '/' }), target),
  );
  const response = await api(
    '/test',
    { method: 'POST', body: JSON.stringify({ endpoint: state.endpoint, payload }) },
    state.deviceKey,
  );
  if (!response.ok) throw new PushError('refused', 'The test notification couldn’t be sent.');
}
