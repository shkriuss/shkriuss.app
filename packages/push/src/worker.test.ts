/**
 * The notification server (worker.ts): the real Worker code and Durable
 * Objects, with storage in memory (testing.ts). fetch() is replaced to play
 * the push service.
 */
import { randomBytes, toBase64Url } from '@shkriuss/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceKey, memoryPush } from './testing.ts';

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

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'e1',
  start: '2026-11-01T09:00',
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
