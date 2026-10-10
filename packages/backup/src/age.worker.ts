// The backup worker (backup format §3.1): it encrypts and decrypts backups away from the page,
// because deriving a key takes seconds and 256 MiB on a phone. It answers each message on the
// port that comes with it. The page starts a new worker for each request and ends it after, so
// that the passphrase stays in memory only during the operation.
import { decrypt, encrypt } from "./age.ts";
import { type AgeResponse, isAgeRequest } from "./age-messages.ts";
import { BackupError } from "./errors.ts";

async function answer(request: unknown, port: MessagePort): Promise<void> {
  if (!isAgeRequest(request)) {
    const response: AgeResponse = { ok: false, code: null, message: "The request is not one." };
    port.postMessage(response);
    return;
  }
  const { operation, bytes, passphrase } = request;
  try {
    const output = await (operation === "encrypt"
      ? encrypt(bytes, passphrase)
      : decrypt(bytes, passphrase));
    const response: AgeResponse = { ok: true, bytes: output };
    // Moved, not copied: the worker ends after this.
    port.postMessage(response, [output.buffer]);
  } catch (error) {
    // Only what the page needs: the details of an unexpected error stay here. Running out of
    // memory is expected, and a `BackupError` of its own.
    const response: AgeResponse =
      error instanceof BackupError
        ? { ok: false, code: error.code, message: error.message }
        : { ok: false, code: null, message: "The backup worker failed." };
    port.postMessage(response);
  }
}

self.addEventListener("message", (event) => {
  const [port] = event.ports;
  if (port !== undefined) {
    void answer(event.data, port);
  }
});

// The script has run, so the page may stop the worker from now on: Firefox can crash the page
// when a worker stops while its script still compiles (microsoft/playwright#42565).
postMessage("running");
