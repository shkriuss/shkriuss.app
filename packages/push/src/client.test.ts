/**
 * The browser side (client.ts) on a pretend phone: its storage, push
 * subscription and network are stand-ins, and requests to /api/push/* go to
 * the real server code, kept in memory (testing.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disablePush,
  enablePush,
  finishPushDelete,
  isPushDeletePending,
  isPushEnabled,
  PushError,
  syncPush,
  type Notice,
} from './client.ts';
import { memoryPush } from './testing.ts';

const ORIGIN = 'https://calendar.example';
const ENDPOINT = 'https://push.example.com/phone';

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let server: ReturnType<typeof memoryPush>;
/** How the app's server is doing: answering, unreachable, or failing. */
let network: 'up' | 'down' | 'failing';

/** A phone with notifications allowed, whose browser can subscribe to push. */
async function phone(): Promise<void> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const p256dh = await crypto.subtle.exportKey('raw', keys.publicKey);
  const auth = crypto.getRandomValues(new Uint8Array(16)).buffer;
  let subscription: object | null = null;
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe: async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
      subscription = {
        endpoint: ENDPOINT,
        options: { applicationServerKey },
        getKey: (name: string) => (name === 'p256dh' ? p256dh : auth),
        unsubscribe: async () => {
          subscription = null;
          return true;
        },
      };
      return subscription;
    },
  };
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('window', { PushManager: {}, Notification: {} });
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('navigator', {
    userAgent: 'test',
    maxTouchPoints: 0,
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    // The push service (the server sends to it) accepts everything.
    if (input.startsWith(ENDPOINT)) return new Response(null, { status: 201 });
    if (network === 'down') throw new TypeError('Failed to fetch');
    if (network === 'failing') return new Response(null, { status: 503 });
    return server.fetch(new Request(`${ORIGIN}${input}`, init));
  });
  await enablePush();
}

beforeEach(async () => {
  server = memoryPush();
  network = 'up';
  await phone();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const notice = (overrides: Partial<Notice> = {}): Notice => ({
  id: 'event-1',
  start: '2099-01-01T09:00',
  repeat: 'none',
  until: null,
  offset: 15,
  title: 'Dentist',
  body: 'Thu, Jan 1 · 9:00 AM',
  ...overrides,
});

/** What the server keeps for this phone. */
const stored = () => [...server.devices.values()].map(({ storage }) => [...storage.map]);
const storedIds = () =>
  [...server.devices.values()].flatMap(({ storage }) => {
    const record = storage.map.get('device') as { entries: { id: string }[] } | undefined;
    return record?.entries.map((entry) => entry.id) ?? [];
  });

describe('syncPush', () => {
  it('sends numbers, never the app’s own ids', async () => {
    // Imported events keep their calendar file's ids: Google's, or Outlook's 112 characters.
    const google = '8f3kq0c5b1@google.com';
    const outlook = '0'.repeat(56) + 'f'.repeat(56);
    const notices = [notice({ id: google }), notice({ id: outlook, start: '2099-01-02T09:00' })];
    expect(await syncPush(notices)).toBe(2);
    expect(storedIds()).toEqual(['1', '2']);
    const kept = JSON.stringify(stored());
    expect(kept).not.toContain('google');
    expect(kept).not.toContain(outlook);
  });

  it('leaves out a reminder the server would refuse, and sends the rest', async () => {
    const notices = [
      notice({ id: 'a' }),
      // Two events with the same id (a file can have that).
      notice({ id: 'b', start: '2099-01-02T09:00' }),
      notice({ id: 'b', start: '2099-01-03T09:00' }),
      // Five weeks before: more than the server takes.
      notice({ id: 'c', offset: 5 * 7 * 1440 }),
    ];
    expect(await syncPush(notices)).toBe(3);
    expect(storedIds()).toEqual(['1', '2', '3']);
  });

  it('sends only as many very long reminders as the server can keep', async () => {
    // Texts that make messages of about 4 KB each (characters written as \u0001).
    const long = (index: number) =>
      notice({
        id: `n${index}`,
        start: `2099-01-01T${String(Math.floor(index / 60) % 24).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`,
        repeat: 'yearly',
        title: '\u0001'.repeat(200),
        body: '\u0001'.repeat(450),
      });
    const scheduled = await syncPush(Array.from({ length: 500 }, (_, index) => long(index)));
    expect(scheduled).toBeGreaterThan(200);
    expect(scheduled).toBeLessThan(500);
    expect(storedIds()).toHaveLength(scheduled);
  });

  it('tells a server that answers with a problem apart from one it can’t reach', async () => {
    network = 'failing';
    const failing = await syncPush([notice()], { force: true }).catch((error: unknown) => error);
    expect(failing).toBeInstanceOf(PushError);
    expect((failing as PushError).code).toBe('refused');
    network = 'down';
    const down = await syncPush([notice()], { force: true }).catch((error: unknown) => error);
    expect((down as PushError).code).toBe('server');
  });
});

describe('disablePush', () => {
  /** How many devices the server keeps reminders for. */
  const devicesKept = () =>
    [...server.devices.values()].filter(({ storage }) => storage.map.has('device')).length;

  it('deletes the reminders on the server', async () => {
    await syncPush([notice()]);
    expect(await disablePush()).toBe(true);
    expect(devicesKept()).toBe(0);
    expect(isPushDeletePending()).toBe(false);
  });

  it('says so when the server can’t be reached, and finishes later', async () => {
    await syncPush([notice()]);
    network = 'down';
    expect(await disablePush()).toBe(false);
    expect(isPushEnabled()).toBe(false);
    expect(isPushDeletePending()).toBe(true);
    expect(devicesKept()).toBe(1);
    // Still failing: still waiting.
    network = 'failing';
    expect(await finishPushDelete()).toBe(false);
    network = 'up';
    expect(await finishPushDelete()).toBe(true);
    expect(isPushDeletePending()).toBe(false);
    expect(devicesKept()).toBe(0);
  });

  it('deletes the copy left behind before turning on again, so nothing arrives twice', async () => {
    await syncPush([notice()]);
    network = 'down';
    await disablePush();
    network = 'up';
    await enablePush();
    await syncPush([notice()]);
    expect(devicesKept()).toBe(1);
    expect(isPushDeletePending()).toBe(false);
  });
});
