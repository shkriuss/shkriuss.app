/**
 * The notification server (worker.ts): the real Worker code and Durable
 * Objects, with storage in memory (testing.ts). fetch() is replaced to play
 * the push service.
 */
import { randomBytes, toBase64Url } from '@shkriuss/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceKey, memoryPush } from './testing.ts';
import { LIMITS } from './validate.ts';

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
    const kept = () => [...server.devices.values()].map(({ storage }) => storage.map.size);
    await passDays(395);
    expect(kept()).toEqual([1]);
    await passDays(2);
    expect(kept()).toEqual([0]);
    expect([...server.devices.values()].map(({ storage }) => storage.alarm)).toEqual([null]);
  });

  it('keeps nothing for a device that only sent a test', async () => {
    pushService();
    expect((await device().test()).status).toBe(200);
    await passDays(1);
    expect([...server.devices.values()].map(({ storage }) => storage.map.size)).toEqual([0]);
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

  it('stops sending until 00:00 UTC once the app has sent 2,000 messages that day', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22), toFake: ['Date'] });
    const sent = pushService();
    // Five devices with 500 reminders each, all at 09:00.
    const entries = Array.from({ length: 500 }, (_, index) => entry({ id: `e${index}` }));
    for (let index = 0; index < 5; index += 1) {
      expect((await device().schedule(entries)).status).toBe(200);
    }
    const perDay: number[] = [];
    for (let day = 0; day < 2; day += 1) {
      const before = sent.mock.calls.length;
      await passDays(1);
      perDay.push(sent.mock.calls.length - before);
    }
    expect(perDay).toEqual([2000, 2000]);
    // Every device is still there, waiting for its next time.
    expect([...server.devices.values()].every(({ storage }) => storage.alarm !== null)).toBe(true);
    // 4,000 sealed messages take about a second, longer on a busy CI machine.
  }, 30_000);
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
