import { describe, expect, it } from 'vitest';
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
});
