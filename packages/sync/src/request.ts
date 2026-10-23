/**
 * Requests to an app's sync server, with a time limit (audit G-8). On a
 * network that hangs (a VPN with no connection, captive Wi-Fi, a very bad
 * signal) a request can wait for ever, and sync would say "Syncing…" for
 * ever. A request that takes too long counts as no connection instead, and
 * sync tries again later.
 *
 * The server must start answering within 20 seconds, plus the time it takes
 * to send what's uploaded on a slow connection. Then the answer gets time to
 * arrive too, for its size. So a big copy or photo still gets through on a
 * slow connection, while a server that never answers is given up on soon.
 */

/** How long the server may take to start answering. */
const ANSWER_MS = 20_000;
/** A slow connection that still works, in bytes per second (about 256 kbit/s). */
const SLOW_BYTES_PER_SECOND = 32_000;
/** For an answer that doesn't say how big it is: the biggest the server sends (a copy). */
const LARGEST_ANSWER_BYTES = 2_000_000;

/** How long sending, or receiving, this many bytes may take (ms). */
export const timeLimit = (bytes: number): number =>
  ANSWER_MS + Math.ceil((bytes / SLOW_BYTES_PER_SECOND) * 1000);

function sizeOf(body: BodyInit | null | undefined): number {
  if (typeof body === 'string') return body.length;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength;
  return 0;
}

/** True for a request that ran out of time (see fetchWithLimit). */
export const isTimeout = (error: unknown): boolean =>
  error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');

/** Runs `then` after `ms`. Nothing needs clearing: giving up on a request that's done does nothing. */
function after(ms: number, then: () => void): void {
  AbortSignal.timeout(ms).addEventListener('abort', then, { once: true });
}

/**
 * fetch() with a time limit, for waiting for the answer and for reading it.
 * Running out of time rejects (the request, or reading its body) with a
 * DOMException named "TimeoutError" (see isTimeout).
 */
export async function fetchWithLimit(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const giveUp = () => {
    controller.abort(new DOMException('The server took too long to answer.', 'TimeoutError'));
  };
  let answered = false;
  after(timeLimit(sizeOf(init.body)), () => {
    if (!answered) giveUp();
  });
  const response = await fetch(url, { ...init, signal: controller.signal });
  answered = true;
  const length = Number(response.headers.get('Content-Length') ?? Number.NaN);
  after(timeLimit(Number.isFinite(length) ? length : LARGEST_ANSWER_BYTES), giveUp);
  return response;
}
