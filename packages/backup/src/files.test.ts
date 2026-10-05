import { describe, expect, it, vi } from "vitest";
import { MAX_BACKUP_BYTES } from "./document.ts";
import { MEDIA_TYPES, backupFileName, kindOf, openBackupFile } from "./files.ts";
import { encryptedExample, example } from "./test/fixtures.ts";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("kindOf (backup format §5.2)", () => {
  it.each<[string, string, string]>([
    ["an age file", "age-encryption.org/v1\n-> scrypt", "age"],
    ["an armored age file", "-----BEGIN AGE ENCRYPTED FILE-----\nYWdl", "armored-age"],
    ["a backup document", '{"format": "shkriuss-backup"}', "plain"],
    ["the age line without its newline", "age-encryption.org/v1", "plain"],
    ["an armored file after a space", " -----BEGIN AGE ENCRYPTED FILE-----", "plain"],
    ["an empty file", "", "plain"],
  ])("recognizes %s by its content", (_case, content, kind) => {
    expect(kindOf(text(content))).toBe(kind);
  });
});

describe("backupFileName (backup format §1)", () => {
  it("names the app and the device's local date", () => {
    // Where it is already the next day when it is noon in UTC.
    vi.stubEnv("TZ", "Pacific/Auckland");
    try {
      const made = new Date(Date.UTC(2026, 9, 4, 12, 0));
      expect(backupFileName("notes", made, true)).toBe("shkriuss-notes-2026-10-05.age");
      expect(backupFileName("notes", made, false)).toBe("shkriuss-notes-2026-10-05.json");
      expect(backupFileName("habit-tracker", new Date(812, 0, 5), true)).toBe(
        "shkriuss-habit-tracker-0812-01-05.age",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("gives the media type of each kind", () => {
    expect(MEDIA_TYPES).toStrictEqual({
      encrypted: "application/octet-stream",
      plain: "application/json",
    });
  });
});

describe("openBackupFile (backup format §5.1, §5.2)", () => {
  it.each<[string, Uint8Array, boolean]>([
    ["an encrypted backup", encryptedExample("binary"), true],
    ["an ASCII-armored backup", encryptedExample("armored"), true],
    ["a plain backup", text(example()), false],
    ["any other file, which reading refuses", text("Milk, eggs"), false],
  ])("reads %s, and tells whether it is encrypted", async (_case, bytes, encrypted) => {
    const opened = await openBackupFile(new File([Uint8Array.from(bytes)], "backup"));
    expect(opened).toStrictEqual({ encrypted, bytes });
  });

  it("refuses a file larger than 64 MiB before reading it", async () => {
    const file = new Blob([new Uint8Array(MAX_BACKUP_BYTES + 1)]);
    const read = vi.spyOn(file, "arrayBuffer");
    await expect(openBackupFile(file)).rejects.toThrow(
      expect.objectContaining({ name: "BackupError", code: "too-large" }),
    );
    expect(read).not.toHaveBeenCalled();
    const largest = await openBackupFile(file.slice(0, MAX_BACKUP_BYTES));
    expect(largest.bytes.length).toBe(MAX_BACKUP_BYTES);
  });
});
