import { startWorker } from "@shkriuss/edge/workers";
import { type AgeRequest, isAgeResponse } from "./age-messages.ts";
import ageWorker from "./age.worker.ts?worker&url";
import { BackupError } from "./errors.ts";

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
  const ran = (): void => {
    running = true;
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
      const fail = (): void => {
        reject(new Error("The backup worker could not run."));
      };
      abort = () => {
        const reason: unknown = signal?.reason;
        reject(reason instanceof Error ? reason : new DOMException("Stopped.", "AbortError"));
      };
      signal?.addEventListener("abort", abort);
      channel.port1.addEventListener("message", (event) => {
        resolve(event.data);
      });
      channel.port1.addEventListener("messageerror", fail);
      channel.port1.start();
      worker.addEventListener("error", fail);
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
