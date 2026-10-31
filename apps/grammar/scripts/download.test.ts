import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerProblem, atMost, downloadFile } from './download.ts';

const content = Buffer.from('a model, in bytes. '.repeat(1000));
const expected = {
  bytes: content.byteLength,
  sha256: createHash('sha256').update(content).digest('hex'),
};

/** A body of `bytes`, in chunks; endless when `bytes` is Infinity. */
function body(bytes: number, chunk = 4096): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      const size = Math.min(chunk, bytes - sent);
      controller.enqueue(
        bytes === Infinity ? new Uint8Array(chunk) : content.subarray(sent, sent + size),
      );
      sent += bytes === Infinity ? chunk : size;
      if (sent >= bytes) controller.close();
    },
  });
}

/** A server that answers every request the same way. */
const answering =
  (stream: ReadableStream<Uint8Array> | null, length?: number, status = 200): typeof fetch =>
  async () =>
    new Response(stream, {
      status,
      headers: length === undefined ? {} : { 'content-length': String(length) },
    });

let dir = '';
let path = '';
const options = { timeoutMs: 5000, tries: 1, retryWaitMs: 0, log: () => undefined };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'deep-check-download-'));
  path = join(dir, 'model.onnx');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the model download (audit 5 H-2)', () => {
  it('keeps the file when the size announced, the bytes and the checksum are right', async () => {
    await downloadFile('https://example.com/model', path, expected, {
      ...options,
      fetch: answering(body(expected.bytes), expected.bytes),
    });
    expect(readFileSync(path).equals(content)).toBe(true);
    expect(existsSync(`${path}.download`)).toBe(false);
  });

  it('refuses an answer whose announced size isn’t the file’s, without reading it', async () => {
    for (const [length, says] of [
      [1, 'is 1 bytes'],
      [undefined, 'an unknown number of bytes'],
    ] as const) {
      let read = false;
      let cancelled = false;
      // Pulled only when read (highWaterMark 0), not to fill a queue.
      const unread = new ReadableStream<Uint8Array>(
        {
          pull() {
            read = true;
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      await expect(
        downloadFile('https://example.com/model', path, expected, {
          ...options,
          fetch: answering(unread, length),
        }),
      ).rejects.toThrow(says);
      expect(read, 'read').toBe(false);
      // And not left open: the connection is closed.
      expect(cancelled, 'cancelled').toBe(true);
    }
    expect(answerProblem({ ok: false, status: 503, headers: new Headers() }, expected)).toBe(
      'HTTP 503',
    );
    expect(
      answerProblem(
        { ok: true, status: 200, headers: new Headers({ 'content-length': '1' }) },
        expected,
      ),
    ).toMatch(/^the server says the file is 1 bytes, not \d+$/);
    expect(
      answerProblem(
        {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-length': String(expected.bytes) }),
        },
        expected,
      ),
    ).toBeNull();
  });

  it('stops reading an answer that never ends, and keeps nothing of it', async () => {
    await expect(
      downloadFile('https://example.com/model', path, expected, {
        ...options,
        fetch: answering(body(Infinity), expected.bytes),
      }),
    ).rejects.toThrow(`more than ${expected.bytes} bytes arrived`);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.download`)).toBe(false);
    // The stream itself, on its own.
    await expect(
      pipeline(Readable.from([Buffer.alloc(3), Buffer.alloc(3)]), atMost(5)),
    ).rejects.toThrow('more than 5 bytes arrived');
    await expect(
      pipeline(Readable.from([Buffer.alloc(3), Buffer.alloc(2)]), atMost(5)),
    ).resolves.toBe(undefined);
  });

  it('refuses an answer that ends early, or whose checksum is wrong', async () => {
    await expect(
      downloadFile('https://example.com/model', path, expected, {
        ...options,
        fetch: answering(body(expected.bytes - 1), expected.bytes),
      }),
    ).rejects.toThrow(`${expected.bytes - 1} bytes arrived, not ${expected.bytes}`);
    const other = Buffer.from(content);
    other[0] = other[0] === 0 ? 1 : 0;
    await expect(
      downloadFile('https://example.com/model', path, expected, {
        ...options,
        fetch: answering(new Response(other).body, expected.bytes),
      }),
    ).rejects.toThrow(/checksum [0-9a-f]{64} doesn't match/);
    expect(existsSync(path)).toBe(false);
  });

  it('gives each try a time limit', async () => {
    const neverAnswers: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const started = Date.now();
    await expect(
      downloadFile('https://example.com/model', path, expected, {
        ...options,
        timeoutMs: 20,
        fetch: neverAnswers,
      }),
    ).rejects.toThrow(/TimeoutError/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('tries again after a failed try, and says so', async () => {
    let calls = 0;
    const flaky: typeof fetch = async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 503 })
        : new Response(body(expected.bytes), {
            headers: { 'content-length': String(expected.bytes) },
          });
    };
    const said: string[] = [];
    await downloadFile('https://example.com/model', path, expected, {
      ...options,
      tries: 2,
      fetch: flaky,
      log: (message) => said.push(message),
    });
    expect(calls).toBe(2);
    expect(said).toEqual(['Download failed (Error: HTTP 503), trying again…']);
    expect(readFileSync(path).equals(content)).toBe(true);
  });
});
