/**
 * Notifications while an app is closed: the browser side (docs/adr/0009).
 *
 *   enablePush()        ask permission, subscribe this device
 *   syncPush(notices)   upload the app's scheduled notifications, encrypted
 *   sendTestPush()      one notification right now
 *   disablePush()       forget this device on the server and unsubscribe
 *
 * Every message is encrypted here, to this device's own subscription, before
 * it's uploaded. The device key and subscription keys are kept under
 * "shkriuss-device:", which backups skip: they belong to this device only.
 */
import { fromBase64Url, toBase64Url } from './base64.ts';
import { encryptPayload, MAX_PLAINTEXT_BYTES } from './encrypt.ts';
import { nextFireTime, type Repeat } from './schedule.ts';
import { LIMITS } from './validate.ts';

const STORAGE_KEY = 'shkriuss-device:push';
const API = '/api/push';
/** Re-upload at least this often, even if nothing changed (keeps the server's copy fresh). */
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_WORKER_TIMEOUT_MS = 10_000;

/** One scheduled notification, in the app's own local time. */
export interface Notice {
  /** Unique within the app, e.g. an event id. */
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

export type PushErrorCode = 'unsupported' | 'denied' | 'unavailable' | 'server';

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
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...init, headers });
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
  if (!response.ok) throw new PushError('server', 'The notification service isn’t answering.');
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
 * Uploads the app's scheduled notifications (replacing earlier ones). Skips
 * the upload when nothing changed recently. Returns how many are scheduled.
 */
export async function syncPush(
  notices: readonly Notice[],
  options: { force?: boolean } = {},
): Promise<number> {
  const state = await current();
  if (!state) return 0;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Only ones that will still happen, soonest first, up to the server's limit.
  const now = Date.now();
  const upcoming = notices
    .map((notice) => ({ notice, next: nextFireTime(notice, timeZone, now) }))
    .filter((item): item is { notice: Notice; next: number } => item.next !== null)
    .sort((a, b) => a.next - b.next)
    .slice(0, LIMITS.entries)
    .map((item) => item.notice);

  const hash = await hashOf({ upcoming, timeZone, endpoint: state.endpoint });
  if (!options.force && state.synced?.hash === hash && now - state.synced.at < REFRESH_MS) {
    return upcoming.length;
  }
  const target = { p256dh: fromBase64Url(state.p256dh), auth: fromBase64Url(state.auth) };
  const entries = [];
  for (const notice of upcoming) {
    const payload = toBase64Url(await encryptPayload(messageOf(notice), target));
    const { id, start, repeat, until, offset } = notice;
    entries.push({ id, start, repeat, until, offset, payload });
  }
  const response = await api(
    '/schedule',
    { method: 'PUT', body: JSON.stringify({ endpoint: state.endpoint, timeZone, entries }) },
    state.deviceKey,
  );
  if (!response.ok)
    throw new PushError('server', 'The notification service didn’t accept the update.');
  store({ ...state, synced: { hash, at: now } });
  return upcoming.length;
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
  if (!response.ok) throw new PushError('server', 'The test notification couldn’t be sent.');
}

/** Deletes this device's data on the server and unsubscribes. Never throws. */
export async function disablePush(): Promise<void> {
  const state = load();
  store(null);
  if (state) {
    await api('/schedule', { method: 'DELETE' }, state.deviceKey).catch(() => undefined);
  }
  try {
    const subscription = await (await registration()).pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Nothing to unsubscribe.
  }
}
