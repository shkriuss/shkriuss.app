import { Decrypter, Encrypter, armor } from "age-encryption";
import { BackupError } from "./errors.ts";
import { kindOf } from "./files.ts";
import { normalizePassphrase } from "./passphrase.ts";

/**
 * Encryption with age (backup format §3), as the backup worker runs it: deriving a key takes
 * seconds and 256 MiB on a phone, which must not freeze the page (§3.1).
 */

/**
 * The work factor of new backups, and the highest that imports accept: scrypt with N = 2^18,
 * r = 8 and p = 1, so 256 MiB (§3).
 */
export const WORK_FACTOR = 18;

/**
 * How age writes a work factor: a decimal number without a sign, leading zeros, an exponent or
 * anything else. `018`, `+18`, `1e1`, `0x12` and `18` with a carriage return, which `Number()`
 * reads as 18 or less, are refused here, before any key is derived, and not left to the library.
 */
const WORK_FACTOR_FORM = /^[1-9][0-9]*$/;

/** What age-encryption says when the passphrase does not open the file's only stanza. */
const NO_MATCH = "no identity matched any of the file's recipients";

function damaged(message: string, cause?: unknown): BackupError {
  return new BackupError("damaged", message, { cause });
}

/**
 * Whether the engine could not give the memory that deriving the key takes, 256 MiB at once: V8
 * and JavaScriptCore throw a RangeError; another engine may say "out of memory" in an error of
 * its own.
 */
function isOutOfMemory(error: unknown): boolean {
  return (
    error instanceof RangeError || (error instanceof Error && /out of memory/i.test(error.message))
  );
}

function noMemory(cause: unknown): BackupError {
  return new BackupError(
    "no-memory",
    "The device did not give the memory that deriving the key takes.",
    { cause },
  );
}

/** A stream of `bytes`, which age-encryption decrypts into a stream that it does not read. */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * Every byte of `stream`, read here rather than by age-encryption, which reads through a
 * `Response`: Firefox reports a stream that fails there to the console, even when the error is
 * handled, as when a damaged backup fails its authentication.
 */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    length += value.length;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * `bytes` on an ArrayBuffer, as files and messages take them. age-encryption gives them so; they
 * are copied only if they are on shared memory.
 */
function unshared(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const { buffer } = bytes;
  return buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer, bytes.byteOffset, bytes.byteLength)
    : Uint8Array.from(bytes);
}

/** The recipient stanzas in the header of an age file: each its type and its arguments. */
function stanzasOf(file: Uint8Array): string[][] {
  // The header is ASCII and short, and ends with the line of its MAC, which starts with "---".
  const head = new TextDecoder("latin1").decode(file.subarray(0, 4096));
  const end = head.indexOf("\n---");
  if (end === -1) {
    throw damaged("The file's age header has no end.");
  }
  return head
    .slice(0, end)
    .split("\n")
    .filter((line) => line.startsWith("-> "))
    .map((line) => line.split(" ").slice(1));
}

/**
 * A backup document encrypted with `passphrase` (backup format §3): an age file in the binary
 * encoding, with one recipient stanza of type `scrypt`. The passphrase is normalized first, so
 * that it decrypts on every device (§3.1). Throws a `BackupError` `no-memory` if the device
 * cannot give the memory that deriving the key takes. `workFactor` is for tests only.
 */
export async function encrypt(
  document: Uint8Array,
  passphrase: string,
  workFactor = WORK_FACTOR,
): Promise<Uint8Array<ArrayBuffer>> {
  const encrypter = new Encrypter();
  encrypter.setScryptWorkFactor(workFactor);
  encrypter.setPassphrase(normalizePassphrase(passphrase));
  let file: Uint8Array;
  try {
    file = await encrypter.encrypt(document);
  } catch (error) {
    if (isOutOfMemory(error)) {
      throw noMemory(error);
    }
    throw error;
  }
  return unshared(file);
}

/**
 * The backup document in an encrypted backup (backup format §3, §5.2), binary or ASCII-armored,
 * which age authenticates in full before this returns. Throws a `BackupError`: `wrong-passphrase`
 * if the passphrase does not open it, so that the user can try again; `no-memory` if the device
 * cannot give the memory that deriving the key takes, after which the user can try again too;
 * and `damaged` for a file that is damaged or truncated, not encrypted with a passphrase alone,
 * whose scrypt stanza is not as age writes it, or whose work factor is above 18: each step above
 * doubles the memory that deriving the key takes, which a phone may not give a worker. No key is
 * derived for such a file.
 */
export async function decrypt(
  file: Uint8Array,
  passphrase: string,
): Promise<Uint8Array<ArrayBuffer>> {
  let binary = file;
  if (kindOf(file) === "armored-age") {
    try {
      binary = armor.decode(new TextDecoder("utf-8", { fatal: true }).decode(file));
    } catch (error) {
      throw damaged("The file's ASCII armor is damaged.", error);
    }
  }
  const stanzas = stanzasOf(binary);
  const [stanza = []] = stanzas;
  const [type, , workFactor = ""] = stanza;
  if (stanzas.length !== 1 || type !== "scrypt") {
    throw damaged("The file is not encrypted with a passphrase alone.");
  }
  // The type, the salt and the work factor, as age writes them: nothing else goes to the library.
  if (stanza.length !== 3 || !WORK_FACTOR_FORM.test(workFactor)) {
    throw damaged("The file's scrypt stanza is not as age writes it.");
  }
  if (Number(workFactor) > WORK_FACTOR) {
    throw damaged(`The file's work factor is above ${WORK_FACTOR}.`);
  }
  const decrypter = new Decrypter();
  decrypter.addPassphrase(normalizePassphrase(passphrase));
  try {
    return await readAll(await decrypter.decrypt(streamOf(binary)));
  } catch (error) {
    if (error instanceof Error && error.message === NO_MATCH) {
      throw new BackupError("wrong-passphrase", "The passphrase does not decrypt the file.");
    }
    // A healthy backup that the device cannot open right now is not a damaged one.
    if (isOutOfMemory(error)) {
      throw noMemory(error);
    }
    throw damaged("The file is damaged, truncated or not supported.", error);
  }
}
