/**
 * Notifications while an app is closed: the browser side (docs/adr/0009).
 *
 *   enablePush()        ask permission, subscribe this device
 *   syncPush(notices)   upload the app's scheduled notifications, encrypted
 *   pushHolds(notices)  whether the server has them as they are now
 *   sendTestPush()      one notification right now
 *   disablePush()       forget this device on the server and unsubscribe
 *   finishPushDelete()  try again to forget it, if the server couldn't be reached
 *
 * Every message is encrypted here, to this device's own subscription, before
 * it's uploaded. The device key and subscription keys are kept under
 * "shkriuss-device:", which backups skip: they belong to this device only.
 */
import { fromBase64Url, toBase64Url } from './base64.ts';
import { encryptPayload, MAX_PLAINTEXT_BYTES } from './encrypt.ts';
import { nextFireTime, type Repeat } from './schedule.ts';
import { LIMITS, timingProblem } from './validate.ts';

const STORAGE_KEY = 'shkriuss-device:push';
/** Device keys whose reminders are still on the server (it couldn't be reached to delete them). */
const DELETE_KEY = 'shkriuss-device:push-delete';
const API = '/api/push';
/** Re-upload at least this often, even if nothing changed (keeps the server's copy fresh). */
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_WORKER_TIMEOUT_MS = 10_000;
/** The server must answer within this long (plus the time to send what's uploaded). */
const ANSWER_MS = 20_000;
/** A slow connection that still works, in bytes per millisecond (32 KB a second, about 256 kbit/s). */
const SLOW_BYTES_PER_MS = 32;

/**
 * How long a request that sends this many bytes may take before it counts
 * as "couldn't reach the server". A network that hangs (a VPN with no
 * connection, captive Wi-Fi, a very bad signal) would otherwise keep the app
 * waiting for ever; a big upload on a slow connection still gets through.
 */
export const timeLimit = (bytes: number): number =>
  ANSWER_MS + Math.ceil(bytes / SLOW_BYTES_PER_MS);

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

export type PushSupport = 'supported' | 'needs-home-screen' | 'unsupported';

/** 'server': it couldn't be reached. 'refused': it answered, but with a problem. */
export type PushErrorCode = 'unsupported' | 'denied' | 'unavailable' | 'server' | 'refused';

export class PushError extends Error {
  readonly code: PushErrorCode;
  constructor(code: PushErrorCode, message: string) {
    super(message);
    this.name = 'PushError';
    this.code = code;
  }
}

interface DeviceState {
  /** Random; identifies this device to the server (which stores only its hash). */
  deviceKey: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** The server key the subscription was made with. */
  serverKey: string;
  /** What was last uploaded, and when. */
  synced?: { hash: string; at: number };
}

const isDeviceState = (value: unknown): value is DeviceState => {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return ['deviceKey', 'endpoint', 'p256dh', 'auth', 'serverKey'].every(
    (field) => typeof state[field] === 'string',
  );
};

function load(): DeviceState | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return isDeviceState(value) ? value : null;
  } catch {
    return null;
  }
}

function store(state: DeviceState | null): void {
  try {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the device simply won't stay enabled.
  }
}

function pendingDeletes(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DELETE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function storePendingDeletes(keys: readonly string[]): void {
  try {
    if (keys.length > 0) localStorage.setItem(DELETE_KEY, JSON.stringify(keys));
    else localStorage.removeItem(DELETE_KEY);
  } catch {
    // Storage blocked: the deletion can't be tried again later.
  }
}

/** Whether this browser can get notifications while the app is closed. */
export function pushSupport(): PushSupport {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    return 'supported';
  }
  // iPhone and iPad: only web apps added to the Home Screen can use push.
  const apple =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return apple ? 'needs-home-screen' : 'unsupported';
}

export const isPushEnabled = (): boolean => load() !== null;

/** True while reminders turned off on this device are still on the server. */
export const isPushDeletePending = (): boolean => pendingDeletes().length > 0;

async function registration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new PushError('unavailable', 'The app’s service worker isn’t running.'));
    }, SERVICE_WORKER_TIMEOUT_MS);
  });
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

async function api(path: string, init: RequestInit, deviceKey?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (deviceKey) headers.set('Authorization', `Bearer ${deviceKey}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const bytes = typeof init.body === 'string' ? init.body.length : 0;
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeLimit(bytes)),
    });
  } catch {
    throw new PushError('server', 'Couldn’t reach the notification service.');
  }
  return response;
}

const keyOf = (subscription: PushSubscription, name: PushEncryptionKeyName): string => {
  const key = subscription.getKey(name);
  if (!key) throw new PushError('unavailable', 'The subscription has no keys.');
  return toBase64Url(new Uint8Array(key));
};

/**
 * Asks for permission (call it from a tap) and subscribes this device.
 * Throws PushError explaining what's missing.
 */
export async function enablePush(): Promise<void> {
  if (pushSupport() !== 'supported') {
    throw new PushError('unsupported', 'This browser can’t get notifications while closed.');
  }
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') {
    throw new PushError('denied', 'Notifications are blocked.');
  }
  const response = await api('/key', { method: 'GET' });
  if (!response.ok) throw new PushError('refused', 'The notification service isn’t working.');
  const { publicKey } = (await response.json()) as { publicKey: string };

  const worker = await registration();
  let subscription = await worker.pushManager.getSubscription();
  // A subscription made with another server key can't be used with this one.
  const usedKey = subscription?.options.applicationServerKey;
  if (subscription && (!usedKey || toBase64Url(new Uint8Array(usedKey)) !== publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  try {
    subscription ??= await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(publicKey),
    });
  } catch {
    // For example a phone without Google services and no UnifiedPush.
    throw new PushError('unavailable', 'This browser couldn’t connect to a push service.');
  }
  const previous = load();
  store({
    deviceKey: previous?.deviceKey ?? toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    endpoint: subscription.endpoint,
    p256dh: keyOf(subscription, 'p256dh'),
    auth: keyOf(subscription, 'auth'),
    serverKey: publicKey,
  });
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
  if (Notification.permission !== 'granted') {
    // Turned off in the browser's settings: forget it here and on the server.
    await disablePush();
    return null;
  }
  await enablePush();
  return load();
}

/**
 * What syncPush uploads for these notices at `now`: the ones that will still
 * happen, soonest first, up to the server's limit, and its fingerprint.
 */
async function scheduleOf(notices: readonly Notice[], endpoint: string, now: number) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const upcoming = notices
    // Leave out any the server would turn down, so one odd reminder can't stop the rest.
    .filter((notice) => timingProblem(notice) === undefined)
    .map((notice) => ({ notice, next: nextFireTime(notice, timeZone, now) }))
    .filter((item): item is { notice: Notice; next: number } => item.next !== null)
    .sort((a, b) => a.next - b.next)
    .slice(0, LIMITS.entries)
    .map((item) => item.notice);
  return { timeZone, upcoming, hash: await hashOf({ upcoming, timeZone, endpoint }) };
}

/**
 * Whether the notification service has these notifications as they are now
 * (the last upload of them got through), so it sends them, and an open app
 * mustn't show them a second time. False while push is off, and after a
 * change that couldn't be uploaded (say, offline): then nothing would send
 * them, so the open app shows them itself (audit F1-7).
 */
export async function pushHolds(notices: readonly Notice[]): Promise<boolean> {
  const state = load();
  if (!state?.synced) return false;
  // As they were worked out then: time passing changes nothing.
  const { hash } = await scheduleOf(notices, state.endpoint, state.synced.at);
  return hash === state.synced.hash;
}

/**
 * Uploads the app's scheduled notifications (replacing earlier ones). Skips
 * the upload when nothing changed recently. Returns how many are scheduled.
 */
export async function syncPush(
  notices: readonly Notice[],
  options: { force?: boolean } = {},
): Promise<number> {
  // An earlier copy still on the server (turned off while offline) would send twice.
  if (isPushDeletePending()) await finishPushDelete();
  const state = await current();
  if (!state) return 0;
  const now = Date.now();
  const { timeZone, upcoming, hash } = await scheduleOf(notices, state.endpoint, now);
  if (!options.force && state.synced?.hash === hash && now - state.synced.at < REFRESH_MS) {
    return upcoming.length;
  }
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
  const response = await api(
    '/schedule',
    { method: 'PUT', body: JSON.stringify({ endpoint: state.endpoint, timeZone, entries }) },
    state.deviceKey,
  );
  if (!response.ok)
    throw new PushError('refused', 'The notification service didn’t accept the update.');
  store({ ...state, synced: { hash, at: now } });
  return entries.length;
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

/**
 * Deletes reminders the server still has from when they were turned off on
 * this device without reaching it. True when none are left there.
 */
export async function finishPushDelete(): Promise<boolean> {
  for (const deviceKey of pendingDeletes()) {
    const response = await api('/schedule', { method: 'DELETE' }, deviceKey).catch(() => null);
    if (response?.ok) storePendingDeletes(pendingDeletes().filter((key) => key !== deviceKey));
  }
  return !isPushDeletePending();
}

async function unsubscribe(): Promise<void> {
  try {
    const subscription = await (await registration()).pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Nothing to unsubscribe.
  }
}

/**
 * Deletes this device's data on the server and unsubscribes. Never throws.
 * False if the server couldn't be reached: the deletion is kept, to be
 * finished later by finishPushDelete().
 *
 * It's off on this device as soon as this is called: the deletion is noted
 * before anything waits, so a caller doesn't need to wait for the server
 * (like "Delete all data", which deletes everything here straight away).
 */
export async function disablePush(): Promise<boolean> {
  const state = load();
  // Noted before the device key is gone, so the deletion can be tried again.
  if (state) storePendingDeletes([...pendingDeletes(), state.deviceKey]);
  store(null);
  // Unsubscribing doesn't wait for the server: then nothing more arrives on
  // this device, even while the server can't be reached.
  const [deleted] = await Promise.all([finishPushDelete(), unsubscribe()]);
  return deleted;
}
