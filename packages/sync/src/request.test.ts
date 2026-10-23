import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithLimit, isTimeout, timeLimit } from './request.ts';

/** Each time limit set so far. They only run out when a test calls `elapse`. */
let limits: { ms: number; controller: AbortController }[];

const elapse = (index: number) => {
  limits[index]?.controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
};

/** A fetch that never answers (rejecting once it's given up on), or answers with `answer`. */
function network(answer?: (signal: AbortSignal) => Response) {
  const requests: RequestInit[] = [];
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
    requests.push(init);
    const signal = init.signal as AbortSignal;
    if (answer) return Promise.resolve(answer(signal));
    return new Promise<Response>((_, reject) => {
      signal.addEventListener('abort', () => {
        reject(signal.reason);
      });
    });
  });
  return requests;
}

/** An answer of `bytes` bytes that never finishes arriving, like one on a network that hangs. */
const stalled = (bytes: number) => (signal: AbortSignal) =>
  new Response(
    new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => {
          controller.error(signal.reason);
        });
      },
    }),
    { headers: { 'Content-Length': String(bytes) } },
  );

beforeEach(() => {
  limits = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    const controller = new AbortController();
    limits.push({ ms, controller });
    return controller.signal;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('timeLimit', () => {
  it('waits 20 seconds for an answer, and longer for a lot of data on a slow connection', () => {
    expect(timeLimit(0)).toBe(20_000);
    // The biggest copy, 1.9 MB, at about 256 kbit/s.
    expect(timeLimit(1_900_000)).toBe(20_000 + 59_375);
  });
});

describe('fetchWithLimit', () => {
  it('gives up on a server that never answers', async () => {
    network();
    const request = fetchWithLimit('/api/sync/copy');
    expect(limits.map(({ ms }) => ms)).toEqual([20_000]);
    elapse(0);
    const error = await request.catch((reason: unknown) => reason);
    expect(isTimeout(error)).toBe(true);
  });

  it('gives an upload time to be sent', async () => {
    network();
    const request = fetchWithLimit('/api/sync/copy', {
      method: 'PUT',
      body: 'x'.repeat(320_000),
    });
    expect(limits.map(({ ms }) => ms)).toEqual([30_000]);
    elapse(0);
    expect(isTimeout(await request.catch((reason: unknown) => reason))).toBe(true);
  });

  it('gives the answer time to arrive, for its size, then gives up on it too', async () => {
    network(stalled(64_000));
    const response = await fetchWithLimit('/api/sync/copy');
    expect(limits.map(({ ms }) => ms)).toEqual([20_000, 22_000]);
    // The time to start answering is over: running out now changes nothing.
    elapse(0);
    const reading = response.text().catch((reason: unknown) => reason);
    elapse(1);
    expect(isTimeout(await reading)).toBe(true);
  });

  it('allows for the biggest answer when it doesn’t say its size', async () => {
    network(() => new Response('{}'));
    const response = await fetchWithLimit('/api/sync/copy');
    expect(limits[1]?.ms).toBe(timeLimit(2_000_000));
    expect(await response.json()).toEqual({});
  });

  it('isn’t a time limit when the network is down', () => {
    expect(isTimeout(new TypeError('Failed to fetch'))).toBe(false);
  });
});
