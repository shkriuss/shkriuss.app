/**
 * This device's push subscription, what's noted about it, and requests to
 * the app's notification server: what the "Also remind me when … is closed"
 * switch needs as soon as the page opens (./client.ts). Uploading the
 * schedule is in ./upload.ts, loaded when it's first needed.
 *
 * The device key and subscription keys are kept under "shkriuss-device:",
 * which backups skip: they belong to this device only.
 */
import { fromBase64Url, toBase64Url } from './base64.ts';

const STORAGE_KEY = 'shkriuss-device:push';
/** Device keys whose reminders are still on the server (it couldn't be reached to delete them). */
const DELETE_KEY = 'shkriuss-device:push-delete';
const API = '/api/push';
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

export type PushSupport = 'supported' | 'needs-home-screen' | 'unsupported';

/**
 * 'server': it couldn't be reached. 'refused': it answered, but with a
 * problem. 'storage': this device couldn't keep the setting (storage full or
 * blocked), so it's still off.
 */
export type PushErrorCode =
  'unsupported' | 'denied' | 'unavailable' | 'server' | 'refused' | 'storage';

export class PushError extends Error {
  readonly code: PushErrorCode;
  constructor(code: PushErrorCode, message: string) {
    super(message);
    this.name = 'PushError';
    this.code = code;
  }
}

export interface DeviceState {
  /** Random; identifies this device to the server (which stores only its hash). */
  deviceKey: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** The server key the subscription was made with. */
  serverKey: string;
  /**
   * What was last uploaded, and when, and how many of the upcoming
   * notifications that was: the soonest ones, as many as fit on the server
   * (audit 3 F1-5; all of them, in what older versions saved).
   */
  synced?: { hash: string; at: number; count?: number };
}

const isDeviceState = (value: unknown): value is DeviceState => {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return ['deviceKey', 'endpoint', 'p256dh', 'auth', 'serverKey'].every(
    (field) => typeof state[field] === 'string',
  );
};

export function load(): DeviceState | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return isDeviceState(value) ? value : null;
  } catch {
    return null;
  }
}

/** Saves the push state (null: off); false if storage refused. */
export function store(state: DeviceState | null): boolean {
  try {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    // Storage full or blocked: the device simply won't stay enabled.
    return false;
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

/** Notes a device key whose reminders are still on the server; false if storage refused. */
export function noteDelete(deviceKey: string): boolean {
  const keys = pendingDeletes();
  if (!keys.includes(deviceKey)) storePendingDeletes([...keys, deviceKey]);
  return pendingDeletes().includes(deviceKey);
}

/** Uploads on their way: disablePush() waits for them (audit 3 D-1). */
let uploading: Promise<unknown> = Promise.resolve();

/** Marks an upload as on its way; call what it returns once it's done. */
export function startUpload(): () => void {
  let done = (): void => undefined;
  uploading = Promise.all([
    uploading,
    new Promise<void>((resolve) => {
      done = resolve;
    }),
  ]);
  return done;
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

export async function registration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new PushError('unavailable', 'The app’s service worker isn’t running.'));
    }, SERVICE_WORKER_TIMEOUT_MS);
  });
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

export async function api(path: string, init: RequestInit, deviceKey?: string): Promise<Response> {
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
export const enablePush = (): Promise<void> => subscribe();

/**
 * enablePush(), or with `renewing` (a device key), a subscription the browser
 * renewed: kept only if push is still on with that key, so turning it off
 * meanwhile isn't undone (audit 3 D-1).
 */
export async function subscribe(renewing?: string): Promise<void> {
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
  if (renewing !== undefined && previous?.deviceKey !== renewing) {
    // Turned off while it was renewed: nothing stays subscribed.
    await subscription.unsubscribe().catch(() => false);
    return;
  }
  const saved = store({
    deviceKey: previous?.deviceKey ?? toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    endpoint: subscription.endpoint,
    p256dh: keyOf(subscription, 'p256dh'),
    auth: keyOf(subscription, 'auth'),
    serverKey: publicKey,
  });
  // Not "on" when nothing could be kept: nothing would be uploaded (audit 3 F1-4).
  if (!saved) throw new PushError('storage', 'This device couldn’t keep the setting.');
}

/**
 * Deletes reminders the server still has from when they were turned off on
 * this device without reaching it, and `deviceKey`'s, held in memory in case
 * storage was too full to note it (audit 3 D-3). True when none are left there.
 */
export async function finishPushDelete(deviceKey?: string): Promise<boolean> {
  const keys = pendingDeletes();
  if (deviceKey && !keys.includes(deviceKey)) keys.push(deviceKey);
  let left = false;
  for (const key of keys) {
    const response = await api('/schedule', { method: 'DELETE' }, key).catch(() => null);
    if (response?.ok) storePendingDeletes(pendingDeletes().filter((pending) => pending !== key));
    else left = true;
  }
  return !left;
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
 * False if the server couldn't be reached: the deletion is kept (if storage
 * lets it be noted: isPushDeletePending()), to be finished later by
 * finishPushDelete().
 *
 * It's off on this device as soon as this is called: the deletion is noted
 * before anything waits, so a caller doesn't need to wait for the server
 * (like "Delete all data", which deletes everything here straight away).
 * The deletion waits for an upload already on its way, so the server gets it
 * last (audit 3 D-1).
 */
export async function disablePush(): Promise<boolean> {
  const deviceKey = load()?.deviceKey;
  // Removed first: that makes room to note the deletion when storage is full,
  // so it can be tried again (audit 3 D-3).
  store(null);
  const noted = deviceKey === undefined || noteDelete(deviceKey);
  // Unsubscribing doesn't wait for the server: then nothing more arrives on
  // this device, even while the server can't be reached.
  const [deleted] = await Promise.all([
    // With the key held here, if it couldn't be noted.
    uploading.then(() => finishPushDelete(noted ? undefined : deviceKey)),
    unsubscribe(),
  ]);
  // Neither deleted nor noted: noted now if it can be ("Delete all data" has
  // made room since).
  if (!deleted && !noted) noteDelete(deviceKey);
  return deleted;
}
