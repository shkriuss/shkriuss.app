/**
 * Downloads one big file (Grammar's Deep check model) with limits, so a wrong
 * answer from the server can't fill the disk or hold a build for ever
 * (audit 5 H-2): the answer must say the file's size (Content-Length), and
 * it must be the expected one; no more than that many bytes are read; each
 * try has a time limit; and the SHA-256 must match before the file is kept.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

export interface ExpectedFile {
  bytes: number;
  /** As hex. */
  sha256: string;
}

export interface DownloadOptions {
  /** How long one try may take, in milliseconds. */
  timeoutMs: number;
  /** How many tries (networks fail). */
  tries?: number;
  /** The wait before the next try, in milliseconds, times the tries so far. */
  retryWaitMs?: number;
  /** What answers the request (for tests). */
  fetch?: typeof fetch;
  /** Where to say that a try failed. */
  log?: (message: string) => void;
}

/** What's wrong with an answer before any of it is read; null when nothing is. */
export function answerProblem(
  response: { ok: boolean; status: number; headers: { get(name: string): string | null } },
  expected: ExpectedFile,
): string | null {
  if (!response.ok) return `HTTP ${response.status}`;
  const length = response.headers.get('content-length');
  if (length !== String(expected.bytes)) {
    return `the server says the file is ${length ?? 'an unknown number of'} bytes, not ${expected.bytes}`;
  }
  return null;
}

/** A stream that fails once more than `bytes` have come through, so a never-ending answer stops here. */
export function atMost(bytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.byteLength;
      if (seen > bytes) done(new Error(`more than ${bytes} bytes arrived`));
      else done(null, chunk);
    },
  });
}

/**
 * Downloads `url` to `path` (as `${path}.download` until it's checked),
 * trying a few times, and throws if it can't. What's kept at `path` is
 * always the expected file.
 */
export async function downloadFile(
  url: string,
  path: string,
  expected: ExpectedFile,
  options: DownloadOptions,
): Promise<void> {
  const { timeoutMs, tries = 3, retryWaitMs = 5000, log = console.warn } = options;
  const request = options.fetch ?? fetch;
  const partial = `${path}.download`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await request(url, { signal: AbortSignal.timeout(timeoutMs) });
      const problem = answerProblem(response, expected);
      if (problem !== null) {
        // Not read, and not left open either.
        await response.body?.cancel().catch(() => undefined);
        throw new Error(problem);
      }
      if (!response.body) throw new Error('the answer has no body');
      const hash = createHash('sha256');
      let received = 0;
      const hashing = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          received += chunk.byteLength;
          done(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
        atMost(expected.bytes),
        hashing,
        createWriteStream(partial),
      );
      if (received !== expected.bytes) {
        throw new Error(`${received} bytes arrived, not ${expected.bytes}`);
      }
      const sha256 = hash.digest('hex');
      if (sha256 !== expected.sha256) throw new Error(`checksum ${sha256} doesn't match`);
      await rename(partial, path);
      return;
    } catch (error) {
      await rm(partial, { force: true });
      if (attempt === tries) {
        throw new Error(`Couldn't download ${url}: ${String(error)}`, { cause: error });
      }
      log(`Download failed (${String(error)}), trying again…`);
      await new Promise((resolve) => setTimeout(resolve, attempt * retryWaitMs));
    }
  }
}
