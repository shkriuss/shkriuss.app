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
  pushHolds,
  syncPush,
  timeLimit,
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
/** How the app's server is doing: answering, unreachable, failing, or never answering. */
let network: 'up' | 'down' | 'failing' | 'hanging';
/** The time limits of requests so far (see hangingNetwork). */
let limits: { ms: number; controller: AbortController }[];

/**
 * A network that hangs: requests to the app's server never answer, and wait
 * until their time limit. Time limits only run out when the test says so.
 */
function hangingNetwork(): { elapse(): void } {
  network = 'hanging';
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    const controller = new AbortController();
    limits.push({ ms, controller });
    return controller.signal;
  });
  return {
    elapse() {
      for (const { controller } of limits) {
        controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
      }
    },
  };
}

const subscription = async () =>
  (await navigator.serviceWorker.ready).pushManager.getSubscription();

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
    if (network === 'hanging') {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          reject(signal.reason);
        });
      });
    }
    return server.fetch(new Request(`${ORIGIN}${input}`, init));
  });
  await enablePush();
}

beforeEach(async () => {
  server = memoryPush();
  network = 'up';
  limits = [];
  await phone();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it('gives up on a server that never answers, as on one it can’t reach', async () => {
    const { elapse } = hangingNetwork();
    const uploading = syncPush([notice()], { force: true }).catch((error: unknown) => error);
    await vi.waitFor(() => {
      expect(limits).toHaveLength(1);
    });
    elapse();
    expect(((await uploading) as PushError).code).toBe('server');
  });
});

// An open app shows reminders itself unless the server has them as they are
// now: after a change that couldn't be uploaded, nothing else would (audit F1-7).
describe('pushHolds', () => {
  const later = notice({ id: 'event-2', start: '2099-01-02T09:00', title: 'Gym' });

  it('says whether the server has the notifications as they are now', async () => {
    // Turned on, nothing uploaded yet.
    expect(await pushHolds([notice()])).toBe(false);
    await syncPush([notice()]);
    expect(await pushHolds([notice()])).toBe(true);
    // Changed here: not until it's uploaded.
    expect(await pushHolds([notice(), later])).toBe(false);
    expect(await pushHolds([notice({ title: 'Dentist at 10' })])).toBe(false);
    await syncPush([notice(), later]);
    expect(await pushHolds([notice(), later])).toBe(true);
  });

  it('is false after a change that couldn’t be uploaded, true again once it is', async () => {
    await syncPush([notice()]);
    network = 'down';
    await expect(syncPush([notice(), later])).rejects.toThrow(PushError);
    expect(await pushHolds([notice(), later])).toBe(false);
    // What it does have.
    expect(await pushHolds([notice()])).toBe(true);
    network = 'up';
    await syncPush([notice(), later]);
    expect(await pushHolds([notice(), later])).toBe(true);
  });

  it('stays true as time passes, also once a reminder is over', async () => {
    const soon = notice({ start: '2099-01-01T09:00' });
    await syncPush([soon, later]);
    vi.useFakeTimers({ now: Date.UTC(2099, 0, 1, 12), toFake: ['Date'] });
    expect(await pushHolds([soon, later])).toBe(true);
    vi.useRealTimers();
  });

  it('is false while push is off', async () => {
    await syncPush([notice()]);
    await disablePush();
    expect(await pushHolds([notice()])).toBe(false);
  });
});

describe('timeLimit', () => {
  it('waits 20 seconds for an answer, and longer for a big upload on a slow connection', () => {
    expect(timeLimit(0)).toBe(20_000);
    // The biggest schedule (1.5 MB) at about 256 kbit/s takes 47 seconds to send.
    expect(timeLimit(1_500_000)).toBe(20_000 + 46_875);
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

  it('is off here at once while the server never answers, and finishes later', async () => {
    await syncPush([notice()]);
    const { elapse } = hangingNetwork();
    const disabling = disablePush();
    // Off on this device straight away, and nothing more can arrive here.
    expect(isPushEnabled()).toBe(false);
    expect(isPushDeletePending()).toBe(true);
    await vi.waitFor(async () => {
      expect(await subscription()).toBeNull();
    });
    // The server never answers: after its time limit, that's "couldn't reach".
    expect(limits.map(({ ms }) => ms)).toEqual([timeLimit(0)]);
    elapse();
    expect(await disabling).toBe(false);
    expect(devicesKept()).toBe(1);

    vi.restoreAllMocks();
    network = 'up';
    expect(await finishPushDelete()).toBe(true);
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
