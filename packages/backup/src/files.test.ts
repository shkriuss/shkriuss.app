import { describe, expect, it, vi } from "vitest";
import { MEDIA_TYPES, backupFileName, kindOf } from "./files.ts";

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
