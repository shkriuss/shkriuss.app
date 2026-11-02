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
import { SUBSCRIBE_TIMEOUT_MS } from './device.ts';
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
/** Uploads so far: whether each was to finish after the page is closed (keepalive). */
let keptAlive: boolean[];
/** Like a browser whose limit for those is used up: such a request fails at once. */
let keepaliveRefused: boolean;
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

/** Web Locks, as browsers have them: each lock held by one tab at a time. */
function memoryLocks() {
  const queues = new Map<string, Promise<unknown>>();
  return {
    request: <T>(name: string, work: () => Promise<T>): Promise<T> => {
      const result = (queues.get(name) ?? Promise.resolve()).then(work);
      queues.set(
        name,
        result.catch(() => undefined),
      );
      return result;
    },
  };
}

/** A phone with notifications allowed, whose browser can subscribe to push. */
async function phone(): Promise<void> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const p256dh = await crypto.subtle.exportKey('raw', keys.publicKey);
  const auth = crypto.getRandomValues(new Uint8Array(16)).buffer;
  let subscription: object | null = null;
  /** Each new subscription gets a push address of its own. */
  let made = 0;
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
      made += 1;
      subscription = make(`${ENDPOINT}/${made}`, applicationServerKey);
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
    if (init?.method === 'PUT') {
      keptAlive.push(init.keepalive === true);
      if (init.keepalive && keepaliveRefused) throw new TypeError('Failed to fetch');
    }
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
  keptAlive = [];
  keepaliveRefused = false;
  holds = new Map();
  await phone();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Also after a test that failed before putting the clock back.
  vi.useRealTimers();
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
    // Unchanged, it isn't uploaded again: the server has what it can.
    expect(await syncPush(Array.from({ length: 500 }, (_, index) => long(index)))).toEqual({
      scheduled,
      left,
    });
    expect(requests.filter((request) => request.startsWith('PUT'))).toHaveLength(1);
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

  // A change set just before the app was closed was lost with the page
  // (audit 7 Z-1): an upload now finishes even then, where the browser lets
  // it (64 KiB for all such requests of a page).
  it('sends an upload so that it finishes after the page is closed, when it’s small enough', async () => {
    expect(await syncPush([notice()])).toEqual({ scheduled: 1, left: 0 });
    // About 600 bytes a reminder: about 100 fit, 500 don’t.
    const many = Array.from({ length: 500 }, (_, index) =>
      notice({
        id: `n${index}`,
        start: `2099-01-01T${String(Math.floor(index / 60) % 24).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`,
        repeat: 'yearly',
      }),
    );
    expect(await syncPush(many)).toEqual({ scheduled: 500, left: 0 });
    expect(keptAlive).toEqual([true, false]);
  });

  it('sends it again as usual when the browser refuses one that finishes after the page is closed', async () => {
    keepaliveRefused = true;
    expect(await syncPush([notice()])).toEqual({ scheduled: 1, left: 0 });
    expect(keptAlive).toEqual([true, false]);
    expect(storedIds()).toEqual(['1']);
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

// An open app shows reminders itself unless the server sends them: after a
// change that couldn't be uploaded, nothing else would (audit F1-7).
describe('pushHolds', () => {
  /** Due at 08:45 on 1 January 2099, 15 minutes before it starts. */
  const dentist = notice({ tag: 'dentist' });
  const gym = notice({ id: 'event-2', start: '2099-01-02T09:00', title: 'Gym', tag: 'gym' });
  /** Whether the server sends `reminder` for an open app's check from `from` to `to`. */
  const holds = async (reminder: Notice, from = '2099-01-01T08:44', to = '2099-01-01T08:45') => {
    const tag = reminder.tag ?? '';
    return (await pushHolds([{ tag, title: reminder.title }], { from, to }))(tag);
  };
  const puts = () => requests.filter((request) => request.startsWith('PUT')).length;

  it('says whether the server sends a reminder that’s due', async () => {
    // Turned on, nothing uploaded yet.
    expect(await holds(dentist)).toBe(false);
    await syncPush([dentist]);
    expect(await holds(dentist)).toBe(true);
    // Not at another time, nor one it doesn't have, nor with other words.
    expect(await holds(dentist, '2099-01-01T08:45', '2099-01-01T08:46')).toBe(false);
    expect(await holds(gym, '2099-01-02T08:44', '2099-01-02T08:45')).toBe(false);
    expect(await holds({ ...dentist, title: 'Dentist at 10' })).toBe(false);
    await syncPush([dentist, gym]);
    expect(await holds(gym, '2099-01-02T08:44', '2099-01-02T08:45')).toBe(true);
  });

  it('is false after a change that couldn’t be uploaded, true again once it is', async () => {
    await syncPush([dentist]);
    network = 'down';
    const moved = { ...dentist, start: '2099-01-01T10:00' };
    await expect(syncPush([moved])).rejects.toThrow(PushError);
    // The server sends it at 08:45, not now.
    expect(await holds(moved, '2099-01-01T09:44', '2099-01-01T09:45')).toBe(false);
    network = 'up';
    await syncPush([moved]);
    expect(await holds(moved, '2099-01-01T09:44', '2099-01-01T09:45')).toBe(true);
  });

  it('is false for one that was due before it was uploaded, and while push is off', async () => {
    // Every day at 09:00, uploaded at 09:00 on 5 January: the server sends it the next day.
    const daily = notice({ tag: 'pills', start: '2099-01-01T09:00', repeat: 'daily', offset: 0 });
    vi.useFakeTimers({ now: new Date(2099, 0, 5, 9, 0, 30).getTime(), toFake: ['Date'] });
    await syncPush([daily]);
    expect(await holds(daily, '2099-01-05T08:59', '2099-01-05T09:00')).toBe(false);
    expect(await holds(daily, '2099-01-06T08:59', '2099-01-06T09:00')).toBe(true);
    await disablePush();
    expect(await holds(daily, '2099-01-06T08:59', '2099-01-06T09:00')).toBe(false);
  });

  // Habits' and Water's reminders start from today: at midnight they're
  // worked out again, though the server sends the same ones; and Meals lists
  // only reminders still to come. Compared as a whole, they looked changed:
  // the open page showed a reminder the server sent too, and uploaded them
  // again (audit 4 F1-5). Compared one by one, and from now on, they're not.
  const pad = (value: number) => String(value).padStart(2, '0');
  /** A reminder at `time` every week, for each of the 7 days from `from` days after Monday 5 January 2099. */
  const week = (tag: string, time: string, from: number) =>
    Array.from({ length: 7 }, (_, index) => {
      const date = new Date(2099, 0, 5 + from + index);
      const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      return notice({
        id: `${tag}~${date.getDay()}`,
        tag,
        title: tag,
        start: `${day}T${time}`,
        repeat: 'weekly',
        offset: 0,
      });
    });

  it('stays true when the same reminders are worked out from the next day', async () => {
    const habits = (from: number) => [
      ...week('read', '21:00', from),
      ...week('pills', '00:00', from),
    ];
    // Monday 10:00.
    vi.useFakeTimers({ now: new Date(2099, 0, 5, 10).getTime(), toFake: ['Date'] });
    await syncPush(habits(0));
    // "Read" goes off at 21:00, then "Pills" at 00:00, worked out from Tuesday by then.
    vi.setSystemTime(new Date(2099, 0, 5, 21, 0, 10).getTime());
    expect(await holds(habits(0)[0] as Notice, '2099-01-05T20:59', '2099-01-05T21:00')).toBe(true);
    vi.setSystemTime(new Date(2099, 0, 6, 0, 0, 10).getTime());
    const pills = habits(1)[7] as Notice;
    expect(await holds(pills, '2099-01-05T23:59', '2099-01-06T00:00')).toBe(true);
    // Nor is it uploaded again for it.
    await syncPush(habits(1));
    expect(puts()).toBe(1);
    // A real change still counts.
    const moved = habits(1).map((one, index) =>
      index === 7 ? { ...one, start: '2099-01-06T08:00' } : one,
    );
    expect(await holds(moved[7] as Notice, '2099-01-06T07:59', '2099-01-06T08:00')).toBe(false);
    await syncPush(moved);
    expect(puts()).toBe(2);
  });

  it('stays true for a reminder no longer listed once it’s due, as in Meals', async () => {
    const meal = (tag: string, start: string) =>
      notice({ id: tag, tag, title: tag, start, offset: 0 });
    const dinner = meal('Dinner: Soup', '2099-01-05T18:00');
    const lunch = meal('Lunch: Salad', '2099-01-06T12:00');
    vi.useFakeTimers({ now: new Date(2099, 0, 5, 17).getTime(), toFake: ['Date'] });
    await syncPush([dinner, lunch]);
    vi.setSystemTime(new Date(2099, 0, 5, 18, 0, 5).getTime());
    expect(await holds(dinner, '2099-01-05T17:59', '2099-01-05T18:00')).toBe(true);
    await syncPush([lunch]);
    expect(puts()).toBe(1);
  });

  // Only the 500 soonest fit on the server, but it said it held them all, so
  // the open app showed none of the rest either (audit 3 F1-5).
  const dateOf = (index: number) =>
    new Date(Date.UTC(2099, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
  /** At 09:00 on day `index`, due at 08:45. */
  const day = (index: number, tag = `e${index}`) =>
    notice({ id: `e${index}`, tag, start: `${dateOf(index)}T09:00` });
  /** Whether the server sends the reminder on day `index`, by its tag. */
  const holdsOn = (index: number, tag = `e${index}`) =>
    holds(day(index, tag), `${dateOf(index)}T08:44`, `${dateOf(index)}T08:45`);

  it('holds only the reminders that fit on the server', async () => {
    const notices = Array.from({ length: 520 }, (_, index) => day(index));
    expect(await syncPush(notices)).toEqual({ scheduled: 500, left: 20 });
    expect([await holdsOn(0), await holdsOn(499), await holdsOn(500), await holdsOn(519)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    // Unchanged, it isn't uploaded again, and still says so.
    expect(await syncPush(notices)).toEqual({ scheduled: 500, left: 20 });
    expect(puts()).toBe(1);
  });

  it('moves the server’s 500 on when the soonest are over', async () => {
    const notices = Array.from({ length: 520 }, (_, index) => day(index));
    vi.useFakeTimers({ now: Date.UTC(2098, 11, 31), toFake: ['Date'] });
    await syncPush(notices);
    // The first two are over (each is due at 08:45 on its day, in any time zone by the 3rd).
    vi.setSystemTime(Date.UTC(2099, 0, 3));
    expect(await syncPush(notices.slice(2))).toEqual({ scheduled: 500, left: 18 });
    expect(puts()).toBe(2);
    expect(await holdsOn(501)).toBe(true);
  });

  it('holds a tag one that didn’t fit has too, only when the server has it', async () => {
    // Like a habit's reminders on each of its days, with one tag.
    const notices = Array.from({ length: 501 }, (_, index) => day(index, `e${index % 500}`));
    await syncPush(notices);
    expect([await holdsOn(1), await holdsOn(0, 'e0'), await holdsOn(500, 'e0')]).toEqual([
      true,
      true,
      false,
    ]);
  });
});

// The server forgets a device whose push service said it's gone, or with
// nothing through for two days. The switch said On, nothing was sent, and the
// open app left its reminders to the server (audit 4 F1-2).
describe('a device the server forgot', () => {
  const asked = () => requests.filter((request) => request === 'GET /api/push/schedule').length;
  const deviceKey = () =>
    (JSON.parse(localStorage.getItem('shkriuss-device:push') ?? '{}') as { deviceKey: string })
      .deviceKey;
  const forget = () =>
    server.fetch(
      new Request(`${ORIGIN}/api/push/schedule`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${deviceKey()}` },
      }),
    );

  const dentist = notice({ tag: 'dentist' });
  /** Whether the server sends the dentist's reminder, as far as this device knows. */
  const held = () =>
    pushHolds([{ tag: 'dentist', title: 'Dentist' }], {
      from: '2099-01-01T08:44',
      to: '2099-01-01T08:45',
    }).then((holds) => holds('dentist'));
  /** The push address the server sends to. */
  const serverEndpoint = () =>
    [...server.devices.values()].map(
      ({ storage }) => (storage.map.get('device') as { endpoint: string } | undefined)?.endpoint,
    );

  it('is noticed within a day, and gets a new subscription and its schedule again', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22), toFake: ['Date'] });
    await syncPush([dentist]);
    await forget();
    // The same day: not asked.
    vi.setSystemTime(Date.UTC(2026, 9, 22, 20));
    await syncPush([dentist]);
    expect(asked()).toBe(0);
    // A day on: asked, and found forgotten.
    vi.setSystemTime(Date.UTC(2026, 9, 23, 1));
    requests = [];
    const before = await subscription();
    expect(await syncPush([dentist])).toEqual({ scheduled: 1, left: 0 });
    expect(requests).toEqual([
      'GET /api/push/schedule',
      'GET /api/push/key',
      'PUT /api/push/schedule',
    ]);
    expect(await subscription()).not.toBe(before);
    expect(await held()).toBe(true);
    // Kept now: not asked again that day.
    await syncPush([dentist]);
    expect(asked()).toBe(1);
  });

  it('is subscribed again once when two tabs find it forgotten at the same time', async () => {
    // Both made a new subscription, and the second could undo the first's,
    // which the first then uploaded: nothing would arrive.
    vi.stubGlobal('navigator', { ...navigator, locks: memoryLocks() });
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22), toFake: ['Date'] });
    await syncPush([dentist]);
    await forget();
    vi.setSystemTime(Date.UTC(2026, 9, 23, 1));
    requests = [];
    await Promise.all([syncPush([dentist]), syncPush([dentist])]);
    expect(asked()).toBe(1);
    expect(requests.filter((request) => request === 'GET /api/push/key')).toHaveLength(1);
    // The server sends to the address the browser has.
    expect(serverEndpoint()).toEqual([(await subscription())?.endpoint]);
    expect(await held()).toBe(true);
  });

  it('keeps an upload another tab made while it asked', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22), toFake: ['Date'] });
    await syncPush([dentist]);
    vi.setSystemTime(Date.UTC(2026, 9, 23, 1));
    const asking = holdNext('GET /api/push/schedule', 'after');
    const checking = syncPush([dentist]);
    await asking.arrived;
    // A change uploaded meanwhile (from another tab, say).
    const moved = { ...dentist, start: '2099-01-01T10:00' };
    await syncPush([moved]);
    asking.release();
    await checking;
    // The server has the change: noting its check didn't put back what it had before.
    expect(
      await pushHolds([{ tag: 'dentist', title: 'Dentist' }], {
        from: '2099-01-01T09:44',
        to: '2099-01-01T09:45',
      }).then((holds) => holds('dentist')),
    ).toBe(true);
    expect(await held()).toBe(false);
  });

  it('asks again later when the server can’t be reached, and not at all with nothing to send', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22), toFake: ['Date'] });
    await syncPush([notice()]);
    vi.setSystemTime(Date.UTC(2026, 9, 23, 1));
    network = 'down';
    await syncPush([notice()]);
    network = 'up';
    await syncPush([notice()]);
    expect(asked()).toBe(2);
    // Still there: asked again only a day on.
    await syncPush([notice()]);
    expect(asked()).toBe(2);

    // Only reminders that are over: the server has nothing to keep.
    const over = notice({ start: '2026-10-22T09:00' });
    await syncPush([over], { force: true });
    vi.setSystemTime(Date.UTC(2026, 9, 25));
    await syncPush([over]);
    expect(asked()).toBe(2);
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

  // A push service that never answers (a network that blocks it) kept
  // "Turning on…" for ever (audit 4 G-7).
  it('gives up on a push service that never answers', async () => {
    await disablePush();
    const { pushManager } = (await navigator.serviceWorker.ready) as unknown as {
      pushManager: { subscribe: () => Promise<never> };
    };
    pushManager.subscribe = () => new Promise<never>(() => undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const turningOn = enablePush().catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(SUBSCRIBE_TIMEOUT_MS);
    const error = await turningOn;
    expect(error).toBeInstanceOf(PushError);
    expect((error as PushError).code).toBe('unavailable');
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
