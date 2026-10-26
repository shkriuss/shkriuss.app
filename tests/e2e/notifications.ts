// Notifications in browser tests (packages/push, docs/adr/0009).
//
// Browsers in tests can't show real notifications, so fakeNotifications()
// replaces them with a recorder. They can't reach Google's or Apple's push
// services either, so for notifications while an app is closed the page gets
// a fake push subscription whose address is a small push receiver run by the
// test (startRig, fakeSubscription). Headless browsers also report
// notifications as blocked whatever their settings, so the page is told
// they're allowed. Everything else is real: the page encrypts, the app's
// Worker and Durable Objects store and sign, and the receiver decrypts.
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { Page } from '@playwright/test';
import { toBase64Url } from '../../packages/push/src/base64.ts';
import { decryptPayload } from '../../packages/push/src/encrypt.ts';

interface Received {
  headers: IncomingHttpHeaders;
  body: Uint8Array<ArrayBuffer>;
}

/** A pretend push service, and the keys of the pretend browser subscription. */
export interface PushRig {
  endpoint: string;
  received: Received[];
  open(body: Uint8Array<ArrayBuffer>): Promise<Record<string, unknown>>;
  server: Server;
  p256dh: string;
  auth: string;
}

export async function startRig(): Promise<PushRig> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({ headers: request.headers, body: new Uint8Array(Buffer.concat(chunks)) });
      response.writeHead(201).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    endpoint: `http://127.0.0.1:${port}/push/device-1`,
    received,
    server,
    p256dh: toBase64Url(publicKey),
    auth: toBase64Url(auth),
    open: async (body) =>
      JSON.parse(
        new TextDecoder().decode(
          await decryptPayload(body, { privateKey: keys.privateKey, publicKey, auth }),
        ),
      ) as Record<string, unknown>,
  };
}

/** Allows notifications, and replaces the push subscription with one pointing at the rig. */
export async function fakeSubscription(page: Page, rig: PushRig, options: { fail?: boolean } = {}) {
  await page.addInitScript(
    ({ endpoint, p256dh, auth, fail }) => {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
      Notification.requestPermission = async () => 'granted';
      const bytes = (text: string) =>
        Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
          .buffer;
      const target = window as unknown as Record<string, unknown>;
      const make = (serverKey: string) => ({
        endpoint,
        options: { userVisibleOnly: true, applicationServerKey: bytes(serverKey) },
        getKey: (name: string) =>
          name === 'p256dh' ? bytes(p256dh) : name === 'auth' ? bytes(auth) : null,
        unsubscribe: async () => {
          sessionStorage.removeItem('fake-push');
          target['unsubscribed'] = true;
          return true;
        },
      });
      PushManager.prototype.subscribe = async function (init?: PushSubscriptionOptionsInit) {
        if (fail) throw new DOMException('push service not available', 'AbortError');
        const key = new Uint8Array(init?.applicationServerKey as ArrayBuffer);
        const serverKey = btoa(String.fromCharCode(...key))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        sessionStorage.setItem('fake-push', serverKey);
        return make(serverKey) as unknown as PushSubscription;
      };
      PushManager.prototype.getSubscription = async function () {
        const serverKey = sessionStorage.getItem('fake-push');
        return (serverKey ? make(serverKey) : null) as unknown as PushSubscription;
      };
    },
    { endpoint: rig.endpoint, p256dh: rig.p256dh, auth: rig.auth, fail: options.fail ?? false },
  );
}

export type Permission = NotificationPermission | 'unsupported';

/** Replaces the browser's notifications with a recorder (see shownNotifications). */
export async function fakeNotifications(page: Page, permission: Permission): Promise<void> {
  await page.addInitScript((initial: Permission) => {
    const target = window as unknown as Record<string, unknown>;
    if (initial === 'unsupported') {
      delete target['Notification'];
      return;
    }
    let current = initial;
    const shown: unknown[] = [];
    target['shownNotifications'] = shown;
    function FakeNotification(
      title: string,
      options: NotificationOptions & { renotify?: boolean },
    ): void {
      // As Chrome does.
      if (options.renotify && !options.tag) throw new TypeError('renotify needs a tag');
      shown.push({ title, ...options });
    }
    Object.defineProperty(FakeNotification, 'permission', { get: () => current });
    Object.assign(FakeNotification, {
      requestPermission: async () => {
        target['permissionAsked'] = true;
        current = 'granted';
        return current;
      },
    });
    target['Notification'] = FakeNotification;
  }, permission);
}

/** The notifications shown so far, as { title, ...options }. */
export const shownNotifications = (page: Page) =>
  page.evaluate(() => (window as unknown as Record<string, unknown>)['shownNotifications']);
