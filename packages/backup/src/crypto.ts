import { startWorker } from "@shkriuss/edge/workers";
import { type AgeRequest, isAgeResponse } from "./age-messages.ts";
import ageWorker from "./age.worker.ts?worker&url";
import { BackupError } from "./errors.ts";

/**
 * How long the page waits for the backup worker to say that its script has run (backup format
 * §3.1). A worker that the browser ended without an `error` event, as it may when memory runs
 * short, would otherwise leave the request pending forever.
 */
const START_TIMEOUT = 15_000;

/**
 * Runs one request in a new backup worker, which ends with it (backup format §3.1), or as soon as
 * `signal` aborts, which rejects with its reason. The page stays responsive while the worker
 * derives the key, and an app that no longer needs the answer stops it, so that two workers
 * never take hundreds of MiB at once.
 */
async function inWorker(
  request: AgeRequest,
  signal: AbortSignal | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  signal?.throwIfAborted();
  const worker = startWorker(ageWorker);
  // Firefox can crash the page when a worker stops while its script still compiles, so the
  // worker stops only once it has said that its script has run, or has failed to start.
  let running = false;
  let done = false;
  let fail: (() => void) | undefined;
  // But a worker that has said nothing for 15 seconds never will: the browser ended it without
  // an `error` event, or it is stuck. It no longer compiles its script, so stopping it is safe,
  // and nothing else would stop it, even after the request was given up.
  const watchdog = setTimeout(() => {
    worker.terminate();
    fail?.();
  }, START_TIMEOUT);
  const ran = (): void => {
    running = true;
    clearTimeout(watchdog);
    if (done) {
      worker.terminate();
    }
  };
  worker.addEventListener("message", ran, { once: true });
  worker.addEventListener("error", ran, { once: true });
  const channel = new MessageChannel();
  let abort: (() => void) | undefined;
  try {
    const response = await new Promise<unknown>((resolve, reject) => {
      const failed = (): void => {
        reject(new Error("The backup worker could not run."));
      };
      fail = failed;
      abort = () => {
        const reason: unknown = signal?.reason;
        reject(reason instanceof Error ? reason : new DOMException("Stopped.", "AbortError"));
      };
      signal?.addEventListener("abort", abort);
      channel.port1.addEventListener("message", (event) => {
        resolve(event.data);
      });
      channel.port1.addEventListener("messageerror", failed);
      channel.port1.start();
      worker.addEventListener("error", failed);
      // The bytes are copied, not moved, so that the caller can try another passphrase.
      worker.postMessage(request, [channel.port2]);
    });
    if (!isAgeResponse(response)) {
      throw new Error("The backup worker gave an answer it should not.");
    }
    if (!response.ok) {
      throw response.code === null
        ? new Error(response.message)
        : new BackupError(response.code, response.message);
    }
    return response.bytes;
  } finally {
    if (abort !== undefined) {
      signal?.removeEventListener("abort", abort);
    }
    channel.port1.close();
    done = true;
    if (running) {
      worker.terminate();
    }
  }
}

/**
 * `document` encrypted with `passphrase` (backup format §3), in a worker that `signal` stops.
 */
export function encryptBackup(
  document: Uint8Array,
  passphrase: string,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return inWorker({ operation: "encrypt", bytes: document, passphrase }, signal);
}

/**
 * The backup document in the encrypted backup `file` (backup format §3, §5.2), decrypted in a
 * worker that `signal` stops. Throws a `BackupError`: `wrong-passphrase`, after which the user
 * can try again, or `damaged`.
 */
export function decryptBackup(
  file: Uint8Array,
  passphrase: string,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  return inWorker({ operation: "decrypt", bytes: file, passphrase }, signal);
}
