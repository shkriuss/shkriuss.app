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
  /** Characters it can hold in all (keys and values), like a browser's limit. */
  quota = Infinity;
  /** Like storage that's blocked: nothing can be saved. */
  blocked = false;
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.blocked || this.used(key) + key.length + value.length > this.quota) {
      throw new DOMException('Full', 'QuotaExceededError');
    }
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  /** What it holds, leaving out `except`. */
  used(except?: string): number {
    let total = 0;
    for (const [key, value] of this.map) if (key !== except) total += key.length + value.length;
    return total;
  }
  /** Full: nothing more fits. */
  fill(): void {
    this.quota = this.used();
  }
}

let server: ReturnType<typeof memoryPush>;
/** How the app's server is doing: answering, unreachable, failing, or never answering. */
let network: 'up' | 'down' | 'failing' | 'hanging';
/** The time limits of requests so far (see hangingNetwork). */
let limits: { ms: number; controller: AbortController }[];
/** Requests to the app's server so far, as "METHOD /path". */
let requests: string[];
/** Requests to hold on their way (see holdNext), by "METHOD /path". */
let holds: Map<string, { when: 'before' | 'after'; wait: Promise<void>; reached: () => void }>;
/** The browser gives this device a new push address, as browsers sometimes do. */
let renewSubscription: () => void;

/**
 * Holds the next `request` ("PUT /api/push/schedule") until release(): before
 * it reaches the server, or after (only its answer waits). `arrived` is when
 * it was sent.
 */
function holdNext(request: string, when: 'before' | 'after') {
  let release = (): void => undefined;
  let reached = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    reached = resolve;
  });
  holds.set(request, { when, wait, reached });
  return { arrived, release };
}

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
  const make = (endpoint: string, applicationServerKey: Uint8Array) => {
    const made = {
      endpoint,
      options: { applicationServerKey },
      getKey: (name: string) => (name === 'p256dh' ? p256dh : auth),
      unsubscribe: async () => {
        if (subscription === made) subscription = null;
        return true;
      },
    };
    return made;
  };
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe: async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
      subscription = make(ENDPOINT, applicationServerKey);
      return subscription;
    },
  };
  renewSubscription = () => {
    const { options } = subscription as { options: { applicationServerKey: Uint8Array } };
    subscription = make(`${ENDPOINT}/renewed`, options.applicationServerKey);
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
    const request = `${init?.method ?? 'GET'} ${input}`;
    requests.push(request);
    const hold = holds.get(request);
    if (hold) {
      holds.delete(request);
      hold.reached();
      if (hold.when === 'before') await hold.wait;
      const response = await server.fetch(new Request(`${ORIGIN}${input}`, init));
      if (hold.when === 'after') await hold.wait;
      return response;
    }
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
  requests = [];
  holds = new Map();
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

/** What syncPush says when it uploaded nothing (push is off). */
const NONE = { scheduled: 0, left: 0 };

/** What the server keeps for this phone. */
const stored = () => [...server.devices.values()].map(({ storage }) => [...storage.map]);
const storedIds = () =>
  [...server.devices.values()].flatMap(({ storage }) => {
    const record = storage.map.get('device') as { entries: { id: string }[] } | undefined;
    return record?.entries.map((entry) => entry.id) ?? [];
  });

describe('notifications turned off in the browser’s or phone’s settings', () => {
  it('deletes everything on the server, even while the browser keeps the subscription', async () => {
    // As an iPhone might when notifications are turned off in its Settings (audit 4 D-6).
    expect(await syncPush([notice()])).toEqual({ scheduled: 1, left: 0 });
    expect(storedIds()).toEqual(['1']);
    vi.stubGlobal('Notification', { permission: 'denied' });
    expect(await subscription()).not.toBeNull();
    expect(await syncPush([notice(), notice({ id: 'event-2' })])).toEqual(NONE);
    expect(stored().flat()).toEqual([]);
    expect(isPushEnabled()).toBe(false);
    expect(await subscription()).toBeNull();
  });
});

describe('syncPush', () => {
  it('sends numbers, never the app’s own ids', async () => {
    // Imported events keep their calendar file's ids: Google's, or Outlook's 112 characters.
    const google = '8f3kq0c5b1@google.com';
    const outlook = '0'.repeat(56) + 'f'.repeat(56);
    const notices = [notice({ id: google }), notice({ id: outlook, start: '2099-01-02T09:00' })];
    expect(await syncPush(notices)).toEqual({ scheduled: 2, left: 0 });
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
      // Five weeks before: more than the server takes (only the open app shows it).
      notice({ id: 'c', offset: 5 * 7 * 1440 }),
    ];
    expect(await syncPush(notices)).toEqual({ scheduled: 3, left: 1 });
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
    const { scheduled, left } = await syncPush(
      Array.from({ length: 500 }, (_, index) => long(index)),
    );
    expect(scheduled).toBeGreaterThan(200);
    expect(scheduled).toBeLessThan(500);
    expect(left).toBe(500 - scheduled);
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

  // The privacy page: "The app sends your reminders again each week while you
  // use it" (pinned so changing it means changing the page too: audit 3 J-4).
  it('uploads an unchanged schedule again after a week, not before', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22), toFake: ['Date'] });
    const puts = () => requests.filter((request) => request.startsWith('PUT')).length;
    await syncPush([notice()]);
    vi.setSystemTime(Date.UTC(2026, 9, 29) - 1);
    await syncPush([notice()]);
    expect(puts()).toBe(1);
    vi.setSystemTime(Date.UTC(2026, 9, 29));
    await syncPush([notice()]);
    expect(puts()).toBe(2);
    vi.useRealTimers();
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
  /** Whether the server has a reminder of these, by its tag. */
  const holds = async (notices: Notice[], tag = 'any') => (await pushHolds(notices))(tag);

  it('says whether the server has the notifications as they are now', async () => {
    // Turned on, nothing uploaded yet.
    expect(await holds([notice()])).toBe(false);
    await syncPush([notice()]);
    expect(await holds([notice()])).toBe(true);
    // Changed here: not until it's uploaded.
    expect(await holds([notice(), later])).toBe(false);
    expect(await holds([notice({ title: 'Dentist at 10' })])).toBe(false);
    await syncPush([notice(), later]);
    expect(await holds([notice(), later])).toBe(true);
  });

  it('is false after a change that couldn’t be uploaded, true again once it is', async () => {
    await syncPush([notice()]);
    network = 'down';
    await expect(syncPush([notice(), later])).rejects.toThrow(PushError);
    expect(await holds([notice(), later])).toBe(false);
    // What it does have.
    expect(await holds([notice()])).toBe(true);
    network = 'up';
    await syncPush([notice(), later]);
    expect(await holds([notice(), later])).toBe(true);
  });

  it('stays true as time passes, also once a reminder is over', async () => {
    const soon = notice({ start: '2099-01-01T09:00' });
    await syncPush([soon, later]);
    vi.useFakeTimers({ now: Date.UTC(2099, 0, 1, 12), toFake: ['Date'] });
    expect(await holds([soon, later])).toBe(true);
    vi.useRealTimers();
  });

  it('is false while push is off', async () => {
    await syncPush([notice()]);
    await disablePush();
    expect(await holds([notice()])).toBe(false);
  });

  // Only the 500 soonest fit on the server, but it said it held them all, so
  // the open app showed none of the rest either (audit 3 F1-5).
  const day = (index: number, tag = `e${index}`) =>
    notice({
      id: `e${index}`,
      tag,
      start: new Date(Date.UTC(2099, 0, 1) + index * 86_400_000).toISOString().slice(0, 16),
    });

  it('holds only the reminders that fit on the server', async () => {
    const notices = Array.from({ length: 520 }, (_, index) => day(index));
    expect(await syncPush(notices)).toEqual({ scheduled: 500, left: 20 });
    const held = await pushHolds(notices);
    expect([held('e0'), held('e499'), held('e500'), held('e519')]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    // Unchanged, it isn't uploaded again, and still says so.
    expect(await syncPush(notices)).toEqual({ scheduled: 500, left: 20 });
    expect(requests.filter((request) => request.startsWith('PUT'))).toHaveLength(1);
  });

  it('leaves a reminder to the open app too when one that didn’t fit has its tag', async () => {
    // Like a habit's reminders on each of its days, with one tag.
    const notices = Array.from({ length: 501 }, (_, index) => day(index, `e${index % 500}`));
    await syncPush(notices);
    const held = await pushHolds(notices);
    expect([held('e1'), held('e0')]).toEqual([true, false]);
  });
});

describe('enablePush', () => {
  // It said "On" though nothing was kept, so nothing was uploaded (audit 3 F1-4).
  it('says so when this device can’t keep the setting', async () => {
    await disablePush();
    (localStorage as unknown as MemoryStorage).blocked = true;
    const error = await enablePush().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PushError);
    expect((error as PushError).code).toBe('storage');
    expect(isPushEnabled()).toBe(false);
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

// "Turn off" and "Delete all data" while an upload is on its way: the
// upload's answer turned it back on, and the server could get the upload
// after the deletion and keep every reminder (audit 3 D-1).
describe('turning it off while an upload is on its way (audit 3 D-1)', () => {
  const later = notice({ id: 'event-2', start: '2099-01-02T09:00', title: 'Gym' });
  const devicesKept = () =>
    [...server.devices.values()].filter(({ storage }) => storage.map.has('device')).length;
  const deviceKeyHere = () =>
    (JSON.parse(localStorage.getItem('shkriuss-device:push') ?? '{}') as { deviceKey: string })
      .deviceKey;

  for (const when of ['before', 'after'] as const) {
    it(`stays off, and the server keeps nothing (it gets the upload ${when} the deletion)`, async () => {
      await syncPush([notice()]);
      // "after": the upload is slow to get there. "before": its answer is slow to come back.
      const put = holdNext('PUT /api/push/schedule', when === 'after' ? 'before' : 'after');
      const uploading = syncPush([notice(), later]);
      await put.arrived;
      const disabling = disablePush();
      expect(isPushEnabled()).toBe(false);
      put.release();
      expect(await uploading).toEqual(NONE);
      expect(await disabling).toBe(true);
      expect(isPushEnabled()).toBe(false);
      expect(isPushDeletePending()).toBe(false);
      expect(devicesKept()).toBe(0);
      // The deletion went after the upload, once.
      expect(requests.slice(-2)).toEqual(['PUT /api/push/schedule', 'DELETE /api/push/schedule']);
      // Opening the app again doesn't turn it back on.
      expect(await syncPush([notice(), later])).toEqual(NONE);
      expect(await subscription()).toBeNull();
      expect(devicesKept()).toBe(0);
    });
  }

  it('deletes again what it put back after another tab turned it off', async () => {
    await syncPush([notice()]);
    const put = holdNext('PUT /api/push/schedule', 'before');
    const uploading = syncPush([notice(), later]);
    await put.arrived;
    // Another tab turns it off, and can't wait for this tab's upload.
    const key = deviceKeyHere();
    localStorage.removeItem('shkriuss-device:push');
    await server.fetch(
      new Request(`${ORIGIN}/api/push/schedule`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    put.release();
    expect(await uploading).toEqual(NONE);
    expect(devicesKept()).toBe(0);
    expect(isPushDeletePending()).toBe(false);
  });

  it('sends nothing if it was turned off before the upload left', async () => {
    await syncPush([notice()]);
    // Turned off while the reminders are being locked for the upload.
    const uploading = syncPush([notice(), later]);
    const disabling = disablePush();
    expect(await uploading).toEqual(NONE);
    expect(await disabling).toBe(true);
    expect(requests.filter((request) => request.startsWith('PUT'))).toHaveLength(1);
    expect(devicesKept()).toBe(0);
  });

  it('isn’t turned on again by a push address the browser renewed meanwhile', async () => {
    await syncPush([notice()]);
    renewSubscription();
    // The next upload finds the new address and subscribes again with it…
    const key = holdNext('GET /api/push/key', 'after');
    const uploading = syncPush([notice()]);
    await key.arrived;
    // …while the person turns it off.
    const disabling = disablePush();
    key.release();
    expect(await uploading).toEqual(NONE);
    expect(await disabling).toBe(true);
    expect(isPushEnabled()).toBe(false);
    expect(await subscription()).toBeNull();
    expect(devicesKept()).toBe(0);
  });
});

// With the browser's storage full, the deletion couldn't be noted, so nothing
// was sent to the server, and it still said everything was deleted (audit 3 D-3).
describe('turning it off when storage is full (audit 3 D-3)', () => {
  const storage = () => localStorage as unknown as MemoryStorage;
  const devicesKept = () =>
    [...server.devices.values()].filter(({ storage }) => storage.map.has('device')).length;

  it('notes the deletion in the room it makes by removing the push settings', async () => {
    await syncPush([notice()]);
    storage().fill();
    network = 'down';
    expect(await disablePush()).toBe(false);
    expect(isPushEnabled()).toBe(false);
    expect(isPushDeletePending()).toBe(true);
    network = 'up';
    expect(await finishPushDelete()).toBe(true);
    expect(devicesKept()).toBe(0);
  });

  it('deletes on the server with the key it holds, when nothing can be saved', async () => {
    await syncPush([notice()]);
    storage().blocked = true;
    expect(await disablePush()).toBe(true);
    expect(requests.at(-1)).toBe('DELETE /api/push/schedule');
    expect(isPushEnabled()).toBe(false);
    expect(devicesKept()).toBe(0);
  });

  it('says it couldn’t when the server can’t be reached either', async () => {
    await syncPush([notice()]);
    storage().blocked = true;
    network = 'down';
    expect(await disablePush()).toBe(false);
    expect(requests.at(-1)).toBe('DELETE /api/push/schedule');
    expect(isPushDeletePending()).toBe(false);
    expect(devicesKept()).toBe(1);
  });

  it('notes it once “Delete all data” has made room', async () => {
    await syncPush([notice()]);
    storage().blocked = true;
    network = 'down';
    const disabling = disablePush();
    // "Delete all data" deletes everything else here straight after.
    storage().blocked = false;
    expect(await disabling).toBe(false);
    expect(isPushDeletePending()).toBe(true);
  });
});
