import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytesBody, jsonBody, readJson, runAlarm } from './index.ts';
import { MemoryStorage, memoryState } from './testing.ts';

afterEach(() => {
  vi.useRealTimers();
});

/** A body sent in chunks, with no Content-Length; counts the chunks read. */
function streamed(chunks: number, size: number) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === chunks) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
  });
  // Node needs "duplex" for a streamed body; the Workers types don't know it.
  const init: RequestInit & { duplex: 'half' } = { method: 'PUT', body, duplex: 'half' };
  const request = new Request('https://x.example/', init);
  return { request, sent: () => sent };
}

describe('request bodies', () => {
  it('stops reading as soon as a body without Content-Length is too big', async () => {
    const { request, sent } = streamed(1000, 1024);
    await expect(readJson(request, 2048)).rejects.toThrow(RangeError);
    expect(sent()).toBeLessThan(10);

    const raw = streamed(1000, 1024);
    const read = await bytesBody(raw.request, 2048);
    expect(read.ok).toBe(false);
    expect(raw.sent()).toBeLessThan(10);
  });

  it('reads bodies within the limit, and refuses a declared size over it', async () => {
    const json = new Request('https://x.example/', { method: 'POST', body: '{"a":1}' });
    expect(await jsonBody(json, 100)).toEqual({ ok: true, body: { a: 1 } });
    const bytes = await bytesBody(
      new Request('https://x.example/', { method: 'PUT', body: new Uint8Array([1, 2, 3]) }),
      3,
    );
    expect(bytes.ok && [...bytes.body]).toEqual([1, 2, 3]);
    const declared = new Request('https://x.example/', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Length': '5000' },
    });
    const refused = await jsonBody(declared, 100);
    expect(!refused.ok && refused.response.status).toBe(413);
  });

  it('reads a body that says its size in one go, which costs Workers far less CPU time', async () => {
    const { request } = streamed(100, 1024);
    request.headers.set('Content-Length', String(100 * 1024));
    const whole = vi.spyOn(request, 'arrayBuffer');
    const read = await bytesBody(request, 200 * 1024);
    expect(read.ok && read.body.length).toBe(100 * 1024);
    expect(whole).toHaveBeenCalledOnce();
  });

  it('refuses a body bigger than it said, or with a size that isn’t a number', async () => {
    const lying = streamed(10, 1024).request;
    lying.headers.set('Content-Length', '100');
    expect((await bytesBody(lying, 2048)).ok).toBe(false);
    const garbled = streamed(1, 10).request;
    garbled.headers.set('Content-Length', 'ten');
    expect((await bytesBody(garbled, 2048)).ok).toBe(false);
  });
});

describe('an alarm that fails (audit B-2)', () => {
  const MINUTE = 60_000;

  it('runs again later, then later still, while it keeps failing, at most a day apart', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 25), toFake: ['Date'] });
    const storage = new MemoryStorage();
    const state = memoryState(storage);
    const work = vi.fn(async () => {
      throw new Error('R2 is down');
    });
    const gaps: number[] = [];
    for (let wake = 0; wake < 13; wake += 1) {
      await runAlarm(state, work);
      gaps.push(((storage.alarm ?? 0) - Date.now()) / MINUTE);
      vi.setSystemTime(storage.alarm ?? 0);
    }
    expect(gaps).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 1440, 1440]);
  });

  it('starts counting again once it works, leaving the work’s own alarm', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 25), toFake: ['Date'] });
    const storage = new MemoryStorage();
    const state = memoryState(storage);
    let down = true;
    const work = async () => {
      if (down) throw new Error('R2 is down');
      await storage.setAlarm(Date.now() + 7 * 24 * 60 * MINUTE);
    };
    await runAlarm(state, work);
    await runAlarm(state, work);
    down = false;
    await runAlarm(state, work);
    expect(storage.alarm).toBe(Date.now() + 7 * 24 * 60 * MINUTE);
    expect([...storage.map.keys()]).toEqual([]);
    down = true;
    await runAlarm(state, work);
    expect(storage.alarm).toBe(Date.now() + MINUTE);
  });

  it('runs one at a time with the object’s requests', async () => {
    const state = memoryState(new MemoryStorage());
    const order: string[] = [];
    let finish: () => void = () => undefined;
    const alarm = runAlarm(state, async () => {
      order.push('alarm starts');
      await new Promise<void>((resolve) => (finish = resolve));
      order.push('alarm ends');
    });
    const request = state.blockConcurrencyWhile(async () => {
      order.push('request');
    });
    await vi.waitFor(() => expect(order).toEqual(['alarm starts']));
    finish();
    await Promise.all([alarm, request]);
    expect(order).toEqual(['alarm starts', 'alarm ends', 'request']);
  });
});
