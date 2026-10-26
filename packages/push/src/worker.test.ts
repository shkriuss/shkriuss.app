/**
 * The notification server (worker.ts): the real Worker code and Durable
 * Objects, with storage in memory (testing.ts). fetch() is replaced to play
 * the push service.
 */
import { randomBytes, toBase64Url } from '@shkriuss/crypto';
import { METER } from '@shkriuss/server/meter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceKey, memoryPush } from './testing.ts';
import { LIMITS } from './validate.ts';
import {
  DAILY_SENDS,
  DAILY_SHARES,
  DEVICE_DAILY_SENDS,
  SEND_MS,
  STORAGE_LIMITS,
} from './worker.ts';

const ORIGIN = 'https://calendar.example';
const ENDPOINT = 'https://push.example.com/device-1';
const payload = toBase64Url(randomBytes(200));

let server: ReturnType<typeof memoryPush>;
beforeEach(() => {
  server = memoryPush();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const DAY = 86_400_000;

/** The push service answers every message with `status` (201: delivered). */
function pushService(status: number | (() => number) = 201) {
  const sent = vi.fn(
    async (_input: string, _init?: RequestInit) =>
      new Response(null, { status: typeof status === 'number' ? status : status() }),
  );
  vi.stubGlobal('fetch', sent);
  return sent;
}

/** Lets `days` days pass, waking each device's object whenever its alarm is due. */
async function passDays(days: number): Promise<void> {
  const end = Date.now() + days * DAY;
  for (;;) {
    const alarms = [...server.devices.values()]
      .map(({ storage }) => storage.alarm)
      .filter((alarm): alarm is number => alarm !== null && alarm <= end);
    if (alarms.length === 0) break;
    vi.setSystemTime(Math.max(Date.now(), Math.min(...alarms)));
    await server.runAlarms();
  }
  vi.setSystemTime(end);
}

/** `count` daily reminders, a minute apart from 09:00 UTC. */
const daily = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    entry({
      id: `e${index}`,
      start: `2026-10-01T${String(9 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`,
    }),
  );

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'e1',
  start: '2026-10-01T09:00',
  repeat: 'daily',
  until: null,
  offset: 0,
  payload,
  ...overrides,
});

/** One device's way into the server. */
function device(key = deviceKey()) {
  const call = (path: string, init: RequestInit) =>
    server.fetch(
      new Request(`${ORIGIN}/api/push${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
  return {
    schedule: (entries: unknown[], more: Record<string, unknown> = {}) =>
      call('/schedule', {
        method: 'PUT',
        body: JSON.stringify({ endpoint: ENDPOINT, timeZone: 'UTC', entries, ...more }),
      }),
    test: () =>
      call('/test', { method: 'POST', body: JSON.stringify({ endpoint: ENDPOINT, payload }) }),
  };
}

describe('a schedule sent to the Worker', () => {
  // Checking the biggest schedule takes more than the free plan's 10 ms of CPU
  // time for the Worker, so only the device's object (with 30 seconds) does it.
  it('reaches its device as it was sent, with only its size checked first', async () => {
    const { PUSH_DEVICES } = server.env;
    const received: string[] = [];
    server.env.PUSH_DEVICES = {
      idFromName: (name) => PUSH_DEVICES.idFromName(name),
      get: (id) => ({
        fetch: async (input, init) => {
          received.push(await new Request(input, init).text());
          return PUSH_DEVICES.get(id).fetch(input, init);
        },
      }),
    };
    const body = `{ "timeZone": "UTC", "entries": ${JSON.stringify([entry()])},\n  "endpoint": "${ENDPOINT}" }`;
    const request = new Request(`${ORIGIN}/api/push/schedule`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${deviceKey()}` },
      body,
    });
    expect((await server.fetch(request)).status).toBe(200);
    expect(received).toContain(body);
  });

  it('is checked by its device, which keeps nothing when it’s wrong', async () => {
    const key = deviceKey();
    const send = async (path: string, body: string) => {
      const response = await server.fetch(
        new Request(`${ORIGIN}/api/push${path}`, {
          method: path === '/test' ? 'POST' : 'PUT',
          headers: { Authorization: `Bearer ${key}` },
          body,
        }),
      );
      return [response.status, ((await response.json()) as { error: string }).error];
    };
    const schedule = (more: Record<string, unknown>) =>
      JSON.stringify({ endpoint: ENDPOINT, timeZone: 'UTC', entries: [entry()], ...more });
    expect(await send('/schedule', '{"entries": [')).toEqual([400, 'Body must be JSON.']);
    expect(await send('/schedule', schedule({ timeZone: 'Mars/Olympus' }))).toEqual([
      400,
      'Unknown time zone.',
    ]);
    expect(await send('/schedule', schedule({ entries: [entry({ start: 'soon' })] }))).toEqual([
      400,
      'Entry 0: Bad start.',
    ]);
    expect(await send('/schedule', schedule({ endpoint: 'http://push.example.com/x' }))).toEqual([
      400,
      'Push address must be https with a domain name.',
    ]);
    expect(
      await send('/test', JSON.stringify({ endpoint: ENDPOINT, payload: 'not a message!' })),
    ).toEqual([400, 'Message is not base64url.']);
    expect(await send('/schedule', 'x'.repeat(LIMITS.requestBytes + 1))).toEqual([
      413,
      'Request too big.',
    ]);
    const kept = [...server.devices.values()].filter(
      ({ storage }) => storage.map.size > 0 || storage.alarm !== null,
    );
    expect(kept).toEqual([]);
    expect(server.meter.map.size).toBe(0);
  });
});

describe('one request at a time', () => {
  it('keeps the limit on changes when two arrive together', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22, 8), toFake: ['Date'] });
    const phone = device();
    // 60 changes in 10 minutes are allowed.
    for (let index = 0; index < 59; index += 1) {
      expect((await phone.schedule([entry()])).status).toBe(200);
    }
    // Two more reach the device's object at the same moment.
    const object = [...server.devices.values()][0]?.device;
    if (!object) throw new Error('No device');
    const change = () =>
      object.fetch(
        new Request('https://device/schedule', {
          method: 'PUT',
          body: JSON.stringify({ endpoint: ENDPOINT, timeZone: 'UTC', entries: [entry()] }),
        }),
      );
    const statuses = await Promise.all([change(), change()]);
    expect(statuses.map((response) => response.status).sort()).toEqual([200, 429]);
  });
});

describe('devices whose messages don’t get through', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22), toFake: ['Date'] });
  });

  it('is forgotten after two days when its push address doesn’t exist', async () => {
    const sent = vi.fn(async () => {
      throw new TypeError('getaddrinfo ENOTFOUND');
    });
    vi.stubGlobal('fetch', sent);
    expect((await device().schedule(daily(50))).status).toBe(200);
    await passDays(3);
    expect(
      [...server.devices.values()].map(({ storage }) => [storage.map.size, storage.alarm]),
    ).toEqual([[0, null]]);
    // Each wake-up asked for one signature at most, however many it sent.
    expect(server.counts.signs).toBeLessThanOrEqual(server.counts.wakes);
    // And nothing more after that.
    const attempts = sent.mock.calls.length;
    await passDays(7);
    expect(sent.mock.calls.length).toBe(attempts);
  });

  it('is forgotten after two days when its push service refuses every message', async () => {
    pushService(400);
    expect((await device().schedule(daily(3))).status).toBe(200);
    await passDays(3);
    expect([...server.devices.values()].map(({ storage }) => storage.map.size)).toEqual([0]);
  });

  // It was forgotten only at its next message: a week later for a weekly
  // reminder, a year later for a yearly one (audit 3 D-4).
  for (const repeat of ['weekly', 'monthly', 'yearly']) {
    it(`is forgotten two days after its first refused message, with one ${repeat} reminder`, async () => {
      const sent = pushService(403);
      const reminder = entry({ start: '2026-10-22T09:00', repeat });
      expect((await device().schedule([reminder])).status).toBe(200);
      // The first message is refused at 09:00 on 22 October.
      await passDays(1);
      expect(sent).toHaveBeenCalledOnce();
      // Kept until 09:00 on 24 October…
      await passDays(1);
      expect([...server.devices.values()].map(({ storage }) => storage.map.has('device'))).toEqual([
        true,
      ]);
      // …and no longer.
      await passDays(1);
      expect(
        [...server.devices.values()].map(({ storage }) => [storage.map.size, storage.alarm]),
      ).toEqual([[0, null]]);
      expect(sent).toHaveBeenCalledOnce();
    });
  }

  it('is kept while some messages get through', async () => {
    // The push service fails all day on 23 and 26 October.
    const badDays = ['2026-10-23', '2026-10-26'];
    const sent = pushService(() =>
      badDays.includes(new Date(Date.now()).toISOString().slice(0, 10)) ? 503 : 201,
    );
    expect((await device().schedule(daily(1))).status).toBe(200);
    await passDays(5);
    expect([...server.devices.values()].map(({ storage }) => storage.map.has('device'))).toEqual([
      true,
    ]);
    // Once on 22, 24 and 25 October, and four tries on each bad day.
    expect(sent.mock.calls).toHaveLength(11);
  });
});

describe('what’s kept for how long', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22), toFake: ['Date'] });
  });

  it('forgets a device whose schedule isn’t uploaded again for 13 months', async () => {
    pushService();
    // Next due on 29 February 2028, well after that.
    const leapDay = entry({ start: '2028-02-29T09:00', repeat: 'yearly' });
    expect((await device().schedule([leapDay])).status).toBe(200);
    const kept = () => [...server.devices.values()].map(({ storage }) => storage.map.has('device'));
    await passDays(395);
    expect(kept()).toEqual([true]);
    await passDays(2);
    expect([...server.devices.values()].map(({ storage }) => storage.map.size)).toEqual([0]);
    expect([...server.devices.values()].map(({ storage }) => storage.alarm)).toEqual([null]);
  });

  it('keeps nothing for a device that only sent a test', async () => {
    pushService();
    expect((await device().test()).status).toBe(200);
    await passDays(1);
    expect([...server.devices.values()].map(({ storage }) => storage.map.size)).toEqual([0]);
  });
});

describe('a push service that’s slow or never answers (audit B-1)', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: Date.UTC(2026, 9, 22),
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
  });

  /** A push service that answers after `ms` (201: delivered), or never (null). */
  function slowPushService(ms: number | null) {
    const sent = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          if (ms === null) {
            // Only a time limit ends the wait.
            vi.advanceTimersToNextTimer();
            return;
          }
          vi.advanceTimersByTime(ms);
          resolve(new Response(null, { status: 201 }));
        }),
    );
    vi.stubGlobal('fetch', sent);
    return sent;
  }

  /** The app's messages counted today, in all its shares. */
  const counted = async () =>
    Object.values(
      (await server.keysStorage.get<{ shares: Record<string, number> }>('sent'))?.shares ?? {},
    ).reduce((sum, sends) => sum + sends, 0);

  /** 25 reminders, all at 09:00 every day. */
  const together = () => Array.from({ length: 25 }, (_, index) => entry({ id: `e${index}` }));

  it('gives up on a test message after a few seconds, counting each second as a message', async () => {
    const sent = slowPushService(null);
    expect((await device().test()).status).toBe(502);
    expect(sent).toHaveBeenCalledOnce();
    expect(await counted()).toBe(1 + SEND_MS / 1000);
  });

  it('stops a wake-up at the first message with no answer, and forgets the device after two days', async () => {
    const sent = slowPushService(null);
    expect((await device().schedule(together())).status).toBe(200);
    vi.setSystemTime(Date.UTC(2026, 9, 22, 9));
    await server.runAlarms();
    // One message waited; the other 24 are tried again with it, a minute later.
    expect(sent).toHaveBeenCalledOnce();
    const [found] = [...server.devices.values()];
    const record = await found?.storage.get<{
      entries: { attempts: number }[];
      failingSince: number;
    }>('device');
    expect(record?.entries.map(({ attempts }) => attempts)).toEqual(Array(25).fill(1));
    expect(record?.failingSince).toBe(Date.UTC(2026, 9, 22, 9));
    await passDays(3);
    expect(
      [...server.devices.values()].map(({ storage }) => [storage.map.size, storage.alarm]),
    ).toEqual([[0, null]]);
    // Four tries a day (each a single wait), then gone two days after the
    // first one, without trying again then (audit 3 D-4).
    expect(sent).toHaveBeenCalledTimes(8);
  });

  it('keeps each wake-up short when answers are slow, sending the rest straight after', async () => {
    const sent = slowPushService(3_000);
    expect((await device().schedule(together())).status).toBe(200);
    vi.setSystemTime(Date.UTC(2026, 9, 22, 9));
    const [found] = [...server.devices.values()];
    const lengths: number[] = [];
    while (found && found.storage.alarm !== null && found.storage.alarm <= Date.now()) {
      found.storage.alarm = null;
      const start = Date.now();
      await found.device.alarm();
      lengths.push(Date.now() - start);
    }
    expect(sent).toHaveBeenCalledTimes(25);
    // Far inside the 30 seconds Cloudflare gives a wake-up.
    expect(Math.max(...lengths)).toBeLessThanOrEqual(15_000);
    // Every second of the 75 spent waiting counts as one more message.
    expect(await counted()).toBeGreaterThanOrEqual(25 + 75);
  });

  it('can make an app wait about DAILY_SENDS seconds a day at most', async () => {
    // A test message at a time, each to a push address that answers just before the limit.
    slowPushService(SEND_MS - 1);
    let waited = 0;
    for (let tries = 0; tries < DAILY_SENDS; tries += 1) {
      const start = Date.now();
      const response = await device().test();
      if (response.status === 429) break;
      waited += Date.now() - start;
    }
    expect(waited / 1000).toBeLessThanOrEqual(DAILY_SENDS);
    // Test messages have their own share of the day (audit 3 B-2).
    expect(waited / 1000).toBeLessThanOrEqual(DAILY_SHARES.test);
  });

  it('wakes up again later when something fails during a wake-up (audit B-2)', async () => {
    pushService(410);
    expect((await device().schedule([entry()])).status).toBe(200);
    // The push service says the device is gone, but the storage meter can't be reached.
    const { PUSH_DEVICES } = server.env;
    server.env.PUSH_DEVICES = {
      idFromName: (name) => PUSH_DEVICES.idFromName(name),
      get: (id) =>
        id.toString() === METER
          ? { fetch: async () => new Response(null, { status: 503 }) }
          : PUSH_DEVICES.get(id),
    };
    vi.setSystemTime(Date.UTC(2026, 9, 22, 9));
    await server.runAlarms();
    const [found] = [...server.devices.values()];
    expect(found?.storage.alarm).toBe(Date.now() + 60_000);
    // Once it's back, the device is forgotten as it should be.
    server.env.PUSH_DEVICES = PUSH_DEVICES;
    await passDays(1);
    expect([found?.storage.map.size, found?.storage.alarm]).toEqual([0, null]);
  });
});

describe('the app’s daily limit', () => {
  it('signs once per wake-up, not once per message', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22), toFake: ['Date'] });
    const sent = pushService();
    const entries = Array.from({ length: 30 }, (_, index) => entry({ id: `e${index}` }));
    expect((await device().schedule(entries)).status).toBe(200);
    await passDays(1);
    // 25 messages in the first wake-up, the other 5 straight after.
    expect(sent.mock.calls).toHaveLength(30);
    expect(server.counts.signs).toBe(2);
  });

  it('shares the 2,000 messages of a day so that no share goes over (audit 3 B-2)', async () => {
    expect(Object.values(DAILY_SHARES).reduce((sum, sends) => sum + sends, 0)).toBe(DAILY_SENDS);
  });

  it('stops sending a share of the day’s messages until 00:00 UTC once it’s used up', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22), toFake: ['Date'] });
    const sent = pushService();
    // Devices with 100 reminders each (as many as one gets in a day), all at
    // 09:00: 18 at a push service browsers use, which can have 1,800 of their 1,700…
    const entries = Array.from({ length: DEVICE_DAILY_SENDS }, (_, index) =>
      entry({ id: `e${index}` }),
    );
    for (let index = 0; index < 18; index += 1) {
      const endpoint = `https://fcm.googleapis.com/fcm/send/device-${index}`;
      expect((await device().schedule(entries, { endpoint })).status).toBe(200);
    }
    // …and 3 elsewhere, which can have 300 of their 200.
    for (let index = 0; index < 3; index += 1) {
      expect((await device().schedule(entries)).status).toBe(200);
    }
    const perDay: { known: number; other: number }[] = [];
    for (let day = 0; day < 2; day += 1) {
      const before = sent.mock.calls.length;
      await passDays(1);
      const calls = sent.mock.calls.slice(before).map(([url]) => url);
      const known = calls.filter((url) => url.startsWith('https://fcm.googleapis.com/')).length;
      perDay.push({ known, other: calls.length - known });
    }
    expect(perDay).toEqual([
      { known: DAILY_SHARES.known, other: DAILY_SHARES.other },
      { known: DAILY_SHARES.known, other: DAILY_SHARES.other },
    ]);
    // Every device is still there, waiting for its next time.
    expect([...server.devices.values()].every(({ storage }) => storage.alarm !== null)).toBe(true);
    // 3,800 messages take a second or two, longer on a busy CI machine.
  }, 30_000);
});

// Four made-up devices, uploaded once, used up every app's 2,000 messages a
// day, so nobody's reminders arrived (audit 3 B-2).
describe('strangers’ made-up devices (audit 3 B-2)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22), toFake: ['Date'] });
  });

  /** 500 reminders at 00:01 UTC each day. */
  const junk = Array.from({ length: 500 }, (_, index) =>
    entry({ id: `j${index}`, start: '2026-10-01T00:01' }),
  );
  const REAL = 'https://fcm.googleapis.com/fcm/send/real-person';

  it('can’t stop people’s reminders at the push services browsers use', async () => {
    const sent = pushService();
    // Four at an address of their own, and four at Google's (with subscriptions made there).
    for (let index = 0; index < 4; index += 1) {
      expect((await device().schedule(junk)).status).toBe(200);
      const endpoint = `https://fcm.googleapis.com/fcm/send/junk-${index}`;
      expect((await device().schedule(junk, { endpoint })).status).toBe(200);
    }
    // A real person's daily reminder at 12:00 UTC.
    const real = [entry({ id: 'real', start: '2026-10-01T12:00' })];
    expect((await device().schedule(real, { endpoint: REAL })).status).toBe(200);
    const perDay: number[] = [];
    for (let day = 0; day < 2; day += 1) {
      const before = sent.mock.calls.length;
      await passDays(1);
      perDay.push(sent.mock.calls.length - before);
    }
    expect(sent.mock.calls.filter(([url]) => url === REAL)).toHaveLength(2);
    // 100 a day for each made-up device at Google's, 200 for all the others together.
    expect(perDay).toEqual(Array(2).fill(4 * DEVICE_DAILY_SENDS + DAILY_SHARES.other + 1));
  }, 30_000);

  it('gives one device at most 100 messages a day, tries again included', async () => {
    // Every other message fails, and gets through when tried again.
    let calls = 0;
    const sent = pushService(() => (++calls % 2 === 1 ? 503 : 201));
    const at = (time: string) =>
      Array.from({ length: 500 }, (_, index) =>
        entry({ id: `e${index}`, start: `2026-10-01T${time}` }),
      );
    const phone = device();
    expect((await phone.schedule(at('09:00'), { endpoint: REAL })).status).toBe(200);
    await passDays(0.5);
    expect(sent.mock.calls).toHaveLength(DEVICE_DAILY_SENDS);
    // Uploading again that day doesn't start the count again…
    expect((await phone.schedule(at('18:00'), { endpoint: REAL })).status).toBe(200);
    await passDays(0.5);
    expect(sent.mock.calls).toHaveLength(DEVICE_DAILY_SENDS);
    // …but a new day does.
    await passDays(1);
    expect(sent.mock.calls).toHaveLength(2 * DEVICE_DAILY_SENDS);
  }, 30_000);

  it('can use up the test messages of a day, but not the reminders', async () => {
    const sent = pushService();
    let tests = 0;
    while ((await device().test()).status === 200) tests += 1;
    expect(tests).toBe(DAILY_SHARES.test);
    // Reminders still go out.
    expect((await device().schedule([entry()], { endpoint: REAL })).status).toBe(200);
    await passDays(1);
    expect(sent.mock.calls.filter(([url]) => url === REAL)).toHaveLength(1);
  });
});

describe('size', () => {
  it('keeps the biggest schedule the checks allow, in one stored value', async () => {
    // 500 entries with the longest ids, and messages adding up to the limit.
    const payload = toBase64Url(randomBytes(((LIMITS.payloadsLength / LIMITS.entries) * 3) / 4));
    const entries = Array.from({ length: LIMITS.entries }, (_, index) =>
      entry({
        id: String(index).padStart(LIMITS.idLength, '0'),
        repeat: 'monthly',
        until: '2099-12-31',
        offset: -LIMITS.maxOffsetAfter,
        payload,
      }),
    );
    expect((await device().schedule(entries)).status).toBe(200);
  });

  it('turns down a schedule too big to keep, instead of failing', async () => {
    const payload = toBase64Url(randomBytes(LIMITS.payloadBytes));
    const entries = Array.from({ length: LIMITS.entries }, (_, index) =>
      entry({ id: `e${index}`, payload }),
    );
    expect((await device().schedule(entries)).status).toBe(413);
  });
});

describe('sending', () => {
  it('never follows a redirect from a push address', async () => {
    const reached: string[] = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      reached.push(input);
      // Like the real fetch(): it follows the redirect unless told not to.
      if (init?.redirect === 'manual') {
        return new Response(null, { status: 307, headers: { Location: 'http://10.0.0.1/' } });
      }
      reached.push('http://10.0.0.1/');
      return new Response(null, { status: 201 });
    });
    const response = await device().test();
    expect(response.status).toBe(502);
    expect(reached).toEqual([ENDPOINT]);
  });
});

describe('all of an app’s devices together', () => {
  /** The biggest schedule the checks allow. */
  const biggest = () => {
    const big = toBase64Url(randomBytes(((LIMITS.payloadsLength / LIMITS.entries) * 3) / 4));
    return Array.from({ length: LIMITS.entries }, (_, index) =>
      entry({ id: `e${index}`, payload: big }),
    );
  };

  it('stop at the app’s limit, however many device keys are made up', async () => {
    const entries = biggest();
    let kept = 0;
    for (; kept < 100; kept += 1) {
      const response = await device().schedule(entries);
      if (response.status === 507) break;
      expect(response.status).toBe(200);
    }
    expect(kept).toBeGreaterThan(5);
    expect(kept).toBeLessThan(100);
    expect(server.meter.map.get('total')).toBeLessThanOrEqual(STORAGE_LIMITS);
    // A refused device keeps nothing.
    const stored = [...server.devices.values()].filter(({ storage }) => storage.map.size > 0);
    expect(stored).toHaveLength(kept);
    // Many of the biggest schedules: a few seconds, longer on a busy CI machine.
  }, 30_000);

  it('get room back when a device is forgotten', async () => {
    const entries = biggest();
    const keys: string[] = [];
    for (let tries = 0; tries < 100; tries += 1) {
      const key = deviceKey();
      if ((await device(key).schedule(entries)).status === 507) break;
      keys.push(key);
    }
    await server.fetch(
      new Request(`${ORIGIN}/api/push/schedule`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${keys[0] ?? ''}` },
      }),
    );
    expect((await device().schedule(entries)).status).toBe(200);
  }, 30_000);
});
