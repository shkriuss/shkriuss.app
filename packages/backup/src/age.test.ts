import { Decrypter, Encrypter, armor, generateIdentity, identityToRecipient } from "age-encryption";
import { describe, expect, it, vi } from "vitest";
import { WORK_FACTOR, decrypt, encrypt } from "./age.ts";
import { BackupError, type BackupErrorCode } from "./errors.ts";
import { EXAMPLE_PASSPHRASE, encryptedExample, example } from "./test/fixtures.ts";

const DOCUMENT = new TextEncoder().encode('{"format": "shkriuss-backup"}');
const PASSPHRASE = EXAMPLE_PASSPHRASE;
// A low work factor keeps the tests fast; importers accept any up to 18.
const FAST = 10;
// age encrypts the payload in chunks of 64 KiB, each with a tag of 16 bytes, after a nonce.
const CHUNK = 64 * 1024 + 16;
const NONCE = 16;

async function refusal(decrypting: Promise<unknown>): Promise<BackupErrorCode> {
  try {
    await decrypting;
  } catch (error) {
    if (error instanceof BackupError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("The file was decrypted.");
}

/** Where the last line of an age file's header starts: "--- " and the header's MAC. */
function macLine(file: Uint8Array): number {
  const end = new TextDecoder("latin1").decode(file).indexOf("\n--- ");
  expect(end).toBeGreaterThan(0);
  return end + 1;
}

/** Where the payload of an age file starts, after its header. */
function payload(file: Uint8Array): number {
  return file.indexOf(0x0a, macLine(file)) + 1;
}

/** The lines of an age file's header, before the line of its MAC. */
function header(file: Uint8Array): string[] {
  return new TextDecoder().decode(file.subarray(0, macLine(file) - 1)).split("\n");
}

/** `file` with the lines of its header before the MAC changed by `change`, and the rest kept. */
function withHeader(file: Uint8Array, change: (lines: string[]) => string[]): Uint8Array {
  const end = macLine(file) - 1;
  const changed = new TextEncoder().encode(change(header(file)).join("\n"));
  const result = new Uint8Array(changed.length + file.length - end);
  result.set(changed);
  result.set(file.subarray(end), changed.length);
  return result;
}

/** `file` with the byte at `index` replaced by `byte`. */
function withByte(file: Uint8Array, index: number, byte: number): Uint8Array {
  return file.map((value, at) => (at === index ? byte : value));
}

describe("encrypt (backup format §3)", () => {
  it("writes a binary age file with one scrypt stanza", async () => {
    const file = await encrypt(DOCUMENT, PASSPHRASE, FAST);
    const [version, stanza, ...rest] = header(file);
    expect(version).toBe("age-encryption.org/v1");
    expect(stanza).toMatch(/^-> scrypt [A-Za-z0-9+/]{22} 10$/);
    expect(rest.some((line) => line.startsWith("->"))).toBe(false);
    expect(file.buffer).toBeInstanceOf(ArrayBuffer);
    // New backups take 256 MiB to decrypt: the end-to-end tests check that in browsers, where
    // it takes a second, not a test run with coverage, where it takes ten.
    expect(WORK_FACTOR).toBe(18);
  });

  it("encrypts so that decrypting gives the document back", async () => {
    const file = await encrypt(DOCUMENT, PASSPHRASE, FAST);
    expect(await decrypt(file, PASSPHRASE)).toStrictEqual(DOCUMENT);
    // A new salt and file key every time.
    expect(await encrypt(DOCUMENT, PASSPHRASE, FAST)).not.toStrictEqual(file);
  });

  it("encrypts documents of several chunks", async () => {
    const document = new Uint8Array(2 * CHUNK).map((_, index) => index % 251);
    const file = await encrypt(document, PASSPHRASE, FAST);
    expect(file.length - payload(file)).toBe(NONCE + 3 * 16 + document.length);
    expect(await decrypt(file, PASSPHRASE)).toStrictEqual(document);
  });

  it("normalizes the passphrase, so that it decrypts as it was typed elsewhere", async () => {
    const decomposed = `${String.fromCodePoint(0x63, 0x61, 0x66, 0x65, 0x301)}-tea-with-milk`;
    const composed = `${String.fromCodePoint(0x63, 0x61, 0x66, 0xe9)}-tea-with-milk`;
    const file = await encrypt(DOCUMENT, decomposed, FAST);
    expect(await decrypt(file, composed)).toStrictEqual(DOCUMENT);
    expect(await decrypt(await encrypt(DOCUMENT, composed, FAST), decomposed)).toStrictEqual(
      DOCUMENT,
    );
  });
});

describe("decrypt (backup format §3, §5.2)", () => {
  it.each<["binary" | "armored"]>([["binary"], ["armored"]])(
    "decrypts the %s file that the age command-line tool made, at work factor 18",
    async (form) => {
      // The spec's example, which the tool encrypted: any age implementation reads a backup.
      expect(await decrypt(encryptedExample(form), PASSPHRASE)).toStrictEqual(
        new TextEncoder().encode(example()),
      );
    },
    60_000,
  );

  it("decrypts the ASCII-armored form", async () => {
    const file = await encrypt(DOCUMENT, PASSPHRASE, FAST);
    const armored = new TextEncoder().encode(armor.encode(file));
    expect(await decrypt(armored, PASSPHRASE)).toStrictEqual(DOCUMENT);
  });

  it("decrypts the ASCII-armored form with CRLF line ends, and with white space after it", async () => {
    const file = await encrypt(DOCUMENT, PASSPHRASE, FAST);
    const text = armor.encode(file);
    const crlf = text.replaceAll("\n", "\r\n");
    for (const variant of [crlf, `${text}\n\n \t`, `${crlf}\r\n  `]) {
      expect(await decrypt(new TextEncoder().encode(variant), PASSPHRASE)).toStrictEqual(DOCUMENT);
    }
  });

  it("reads what it decrypts without a Response, which Firefox reports when the stream fails", async () => {
    // Firefox reports to the console a stream that fails while a Response reads it, even when the
    // error is handled: a damaged backup would leave an error there.
    const file = await encrypt(DOCUMENT, PASSPHRASE, FAST);
    const responses = vi.spyOn(globalThis, "Response");
    try {
      expect(await decrypt(file, PASSPHRASE)).toStrictEqual(DOCUMENT);
      const damaged = withByte(file, file.length - 1, (file.at(-1) ?? 0) ^ 1);
      expect(await refusal(decrypt(damaged, PASSPHRASE))).toBe("damaged");
      expect(responses).not.toHaveBeenCalled();
    } finally {
      responses.mockRestore();
    }
  });

  it("tells a wrong passphrase, which the user can try again", async () => {
    const file = await encrypt(DOCUMENT, PASSPHRASE, FAST);
    expect(await refusal(decrypt(file, "burst-swarm-slender-curve-ability-variouz"))).toBe(
      "wrong-passphrase",
    );
    expect(await decrypt(file, PASSPHRASE)).toStrictEqual(DOCUMENT);
  });

  it("reads a changed stanza as a wrong passphrase, which age cannot tell apart", async () => {
    // The stanza holds the file key encrypted with the passphrase: a changed salt or body fails
    // to decrypt just as a wrong passphrase does.
    const file = await encrypt(DOCUMENT, PASSPHRASE, FAST);
    const salt = withHeader(file, ([version = "", stanza = "", ...rest]) => [
      version,
      stanza.replace(/^-> scrypt (.)/, (_, first) => `-> scrypt ${first === "A" ? "B" : "A"}`),
      ...rest,
    ]);
    const body = withHeader(file, (lines) =>
      lines.map((line) =>
        line.replace(/^([A-Za-z0-9+/])(?=[A-Za-z0-9+/]{42}$)/, (first) =>
          first === "A" ? "B" : "A",
        ),
      ),
    );
    expect(salt).not.toStrictEqual(file);
    expect(body).not.toStrictEqual(file);
    expect(await refusal(decrypt(salt, PASSPHRASE))).toBe("wrong-passphrase");
    expect(await refusal(decrypt(body, PASSPHRASE))).toBe("wrong-passphrase");
  });

  it.each<[string, (file: Uint8Array) => Promise<Uint8Array> | Uint8Array, string]>([
    [
      "a work factor above 18, which would take 512 MiB or more",
      (file) => withHeader(file, (lines) => lines.map((line) => line.replace(/ 10$/, " 19"))),
      "The file's work factor is above 18.",
    ],
    ...["018", "+18", "1e1", "0x12", "18\r"].map(
      (form): [string, (file: Uint8Array) => Uint8Array, string] => [
        `a work factor written as ${JSON.stringify(form)}, which is not how age writes one`,
        (file) =>
          withHeader(file, (lines) => lines.map((line) => line.replace(/ 10$/, ` ${form}`))),
        "The file's scrypt stanza is not as age writes it.",
      ],
    ),
    [
      "a scrypt stanza with an argument too many",
      (file) => withHeader(file, (lines) => lines.map((line) => line.replace(/ 10$/, " 10 1"))),
      "The file's scrypt stanza is not as age writes it.",
    ],
    [
      "two scrypt stanzas",
      (file) => withHeader(file, ([version = "", ...stanzas]) => [version, ...stanzas, ...stanzas]),
      "The file is not encrypted with a passphrase alone.",
    ],
    [
      "a stanza for a key and one for a passphrase",
      async (file) => {
        const encrypter = new Encrypter();
        encrypter.addRecipient(await identityToRecipient(await generateIdentity()));
        const forKey = header(await encrypter.encrypt(DOCUMENT)).slice(1);
        return withHeader(file, ([version = "", ...stanzas]) => [version, ...forKey, ...stanzas]);
      },
      "The file is not encrypted with a passphrase alone.",
    ],
    [
      "a header longer than 4096 bytes",
      (file) =>
        withHeader(file, ([version = "", stanza = "", ...body]) => [
          version,
          stanza,
          ...Array.from({ length: 70 }, () => "A".repeat(64)),
          ...body,
        ]),
      "The file's age header has no end.",
    ],
  ])("refuses %s as damaged before deriving any key", async (_case, damage, message) => {
    const file = await damage(await encrypt(DOCUMENT, PASSPHRASE, FAST));
    const derive = vi.spyOn(Decrypter.prototype, "decrypt");
    try {
      await expect(decrypt(file, PASSPHRASE)).rejects.toThrow(
        expect.objectContaining({ name: "BackupError", code: "damaged", message }),
      );
      expect(derive).not.toHaveBeenCalled();
    } finally {
      derive.mockRestore();
    }
  });

  it.each<[string, (file: Uint8Array) => Promise<Uint8Array> | Uint8Array]>([
    ["a truncated file", (file) => file.subarray(0, file.length - 1)],
    ["a file without its payload", (file) => file.subarray(0, payload(file))],
    ["a file without its last chunk", (file) => file.subarray(0, payload(file) + NONCE + CHUNK)],
    ["a changed payload", (file) => withByte(file, file.length - 1, (file.at(-1) ?? 0) ^ 1)],
    [
      "a changed header MAC",
      (file) => {
        const first = macLine(file) + 4;
        return withByte(file, first, file[first] === 0x41 ? 0x42 : 0x41);
      },
    ],
    [
      "a header without its end",
      () => new TextEncoder().encode("age-encryption.org/v1\n-> scrypt"),
    ],
    [
      "a work factor above 18",
      (file) => withHeader(file, (lines) => lines.map((line) => line.replace(/ 10$/, " 19"))),
    ],
    [
      "a work factor that is no number",
      (file) => withHeader(file, (lines) => lines.map((line) => line.replace(/ 10$/, " ten"))),
    ],
    [
      "a second stanza",
      (file) =>
        withHeader(file, ([version = "", ...stanzas]) => [version, "-> other", "", ...stanzas]),
    ],
    [
      "a file for a key instead of a passphrase",
      async () => {
        const encrypter = new Encrypter();
        encrypter.addRecipient(await identityToRecipient(await generateIdentity()));
        return encrypter.encrypt(DOCUMENT);
      },
    ],
    [
      "damaged armor",
      (file) => {
        // "!" is not in the base64 alphabet: put one at the start of the armor's first line of data.
        const text = armor.encode(file);
        const data = text.indexOf("\n") + 1;
        return new TextEncoder().encode(`${text.slice(0, data)}!${text.slice(data)}`);
      },
    ],
  ])("refuses %s as damaged", async (_case, damage) => {
    // Two chunks, so that a file can lose its last chunk and still end where a chunk ends.
    const document = new Uint8Array(CHUNK).fill(0x20);
    const file = await damage(await encrypt(document, PASSPHRASE, FAST));
    expect(await refusal(decrypt(file, PASSPHRASE))).toBe("damaged");
  });
});

describe("a device without the memory that deriving the key takes (backup format §6)", () => {
  it.each<[string, Error]>([
    [
      "a RangeError, as V8 and JavaScriptCore throw",
      new RangeError("Array buffer allocation failed"),
    ],
    ["an error that says out of memory", new Error("out of memory")],
  ])("is told apart from a damaged file while decrypting, by %s", async (_case, error) => {
    const file = await encrypt(DOCUMENT, PASSPHRASE, FAST);
    const derive = vi.spyOn(Decrypter.prototype, "decrypt").mockRejectedValueOnce(error);
    try {
      await expect(decrypt(file, PASSPHRASE)).rejects.toThrow(
        expect.objectContaining({ name: "BackupError", code: "no-memory", cause: error }),
      );
    } finally {
      derive.mockRestore();
    }
  });

  it("is told while encrypting, and any other failure there is let through", async () => {
    const error = new RangeError("Array buffer allocation failed");
    const derive = vi.spyOn(Encrypter.prototype, "encrypt").mockRejectedValueOnce(error);
    try {
      await expect(encrypt(DOCUMENT, PASSPHRASE, FAST)).rejects.toThrow(
        expect.objectContaining({ name: "BackupError", code: "no-memory", cause: error }),
      );
      derive.mockRejectedValueOnce(new TypeError("Unexpected."));
      const failure = await encrypt(DOCUMENT, PASSPHRASE, FAST).catch((cause: unknown) => cause);
      expect(failure).not.toBeInstanceOf(BackupError);
      expect(failure).toStrictEqual(new TypeError("Unexpected."));
    } finally {
      derive.mockRestore();
    }
  });
});
