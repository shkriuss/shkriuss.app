import { describe, expect, it, vi } from 'vitest';
import { bytesBody, jsonBody, readJson } from './index.ts';

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
