import { startWorker } from "@shkriuss/edge/workers";
import { type AgeRequest, isAgeResponse } from "./age-messages.ts";
import ageWorker from "./age.worker.ts?worker&url";
import { BackupError } from "./errors.ts";

/**
 * Runs one request in a new backup worker, which ends with it (backup format §3.1). The page
 * stays responsive while the worker derives the key.
 */
async function inWorker(request: AgeRequest): Promise<Uint8Array<ArrayBuffer>> {
  const worker = startWorker(ageWorker);
  const channel = new MessageChannel();
  try {
    const response = await new Promise<unknown>((resolve, reject) => {
      const fail = (): void => {
        reject(new Error("The backup worker could not run."));
      };
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
    channel.port1.close();
    worker.terminate();
  }
}

/** `document` encrypted with `passphrase` (backup format §3), in a worker. */
export function encryptBackup(
  document: Uint8Array,
  passphrase: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return inWorker({ operation: "encrypt", bytes: document, passphrase });
}

/**
 * The backup document in the encrypted backup `file` (backup format §3, §5.2), decrypted in a
 * worker. Throws a `BackupError`: `wrong-passphrase`, after which the user can try again, or
 * `damaged`.
 */
export function decryptBackup(
  file: Uint8Array,
  passphrase: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return inWorker({ operation: "decrypt", bytes: file, passphrase });
}
