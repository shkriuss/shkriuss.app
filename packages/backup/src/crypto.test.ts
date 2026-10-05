import { describe, expect, it, vi } from "vitest";
import type * as Age from "./age.ts";
import { decrypt, encrypt } from "./age.ts";
import { decryptBackup, encryptBackup } from "./crypto.ts";
import { BackupError } from "./errors.ts";
import { kindOf } from "./files.ts";
import { answerNextWith, failNextWorker, startWorker, started } from "./test/worker.ts";

vi.mock("@shkriuss/edge/workers", () => import("./test/worker.ts"));
vi.mock("./age.ts", async (importOriginal) => {
  const age = await importOriginal<typeof Age>();
  // A low work factor keeps the tests fast; age.test.ts checks the one of new backups.
  return {
    ...age,
    encrypt: vi.fn<typeof age.encrypt>((document, passphrase) =>
      age.encrypt(document, passphrase, 10),
    ),
  };
});

const DOCUMENT = new TextEncoder().encode('{"format": "shkriuss-backup"}');
const PASSPHRASE = "burst-swarm-slender-curve-ability-various";

/** The workers that `run` starts. */
async function workersOf(run: () => Promise<unknown>): Promise<typeof started> {
  const before = started.length;
  await run().catch(() => undefined);
  return started.slice(before);
}

describe("encryptBackup and decryptBackup (backup format §3.1)", () => {
  it("encrypt and decrypt in a worker of their own, which ends with the request", async () => {
    let file = new Uint8Array();
    let document = new Uint8Array();
    const workers = await workersOf(async () => {
      file = await encryptBackup(DOCUMENT, PASSPHRASE);
      document = await decryptBackup(file, PASSPHRASE);
    });
    expect(kindOf(file)).toBe("age");
    expect(await decrypt(file, PASSPHRASE)).toStrictEqual(DOCUMENT);
    expect(document).toStrictEqual(DOCUMENT);
    expect(workers).toHaveLength(2);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it("copy the bytes they are given, so that the user can try another passphrase", async () => {
    const file = await encrypt(DOCUMENT, PASSPHRASE);
    const copy = file.slice();
    await expect(decryptBackup(file, "a wrong passphrase")).rejects.toThrow(
      expect.objectContaining({ name: "BackupError", code: "wrong-passphrase" }),
    );
    expect(file).toStrictEqual(copy);
    expect(await decryptBackup(file, PASSPHRASE)).toStrictEqual(DOCUMENT);
  });

  it("pass on why a file does not decrypt", async () => {
    const file = new TextEncoder().encode("age-encryption.org/v1\n-> scrypt");
    const failure = await decryptBackup(file, PASSPHRASE).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BackupError);
    expect(failure).toMatchObject({ code: "damaged" });
  });

  it("keep the details of an unexpected failure in the worker", async () => {
    vi.mocked(encrypt).mockRejectedValueOnce(new RangeError("Array buffer allocation failed"));
    const failure = await encryptBackup(DOCUMENT, PASSPHRASE).catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(BackupError);
    expect(failure).toStrictEqual(new Error("The backup worker failed."));
  });

  it("fail if the worker cannot run, and end it", async () => {
    failNextWorker();
    const workers = await workersOf(async () => {
      await expect(decryptBackup(DOCUMENT, PASSPHRASE)).rejects.toThrow(
        "The backup worker could not run.",
      );
    });
    expect(workers.map((worker) => worker.terminated)).toStrictEqual([true]);
  });

  it.each<[string, unknown]>([
    ["nothing", null],
    ["bytes on shared memory", { ok: true, bytes: new Uint8Array(new SharedArrayBuffer(3)) }],
    ["an unknown code", { ok: false, code: "unknown", message: "Failed." }],
  ])("refuse an answer of %s, which the worker never gives", async (_case, answer) => {
    answerNextWith(answer);
    await expect(encryptBackup(DOCUMENT, PASSPHRASE)).rejects.toThrow(
      "The backup worker gave an answer it should not.",
    );
  });
});

describe("the backup worker", () => {
  it("answers a message that is not a request with an error, and ignores one without a port", async () => {
    vi.mocked(encrypt).mockClear();
    const worker = startWorker("/src/age.worker.ts?worker_file&type=module");
    worker.postMessage({ operation: "encrypt", bytes: DOCUMENT, passphrase: PASSPHRASE }, []);
    const channel = new MessageChannel();
    const answer = new Promise<unknown>((resolve) => {
      channel.port1.addEventListener("message", (event) => {
        resolve(event.data);
      });
    });
    channel.port1.start();
    worker.postMessage({ operation: "sign", bytes: DOCUMENT, passphrase: PASSPHRASE }, [
      channel.port2,
    ]);
    expect(await answer).toStrictEqual({
      ok: false,
      code: null,
      message: "The request is not one.",
    });
    expect(encrypt).not.toHaveBeenCalled();
    channel.port1.close();
  });
});
