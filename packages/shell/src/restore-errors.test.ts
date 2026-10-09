import { BackupError, type BackupErrorCode } from "@shkriuss/backup";
import { DataLayerError } from "@shkriuss/data";
import { describe, expect, it } from "vitest";
import { restoreErrorMessage } from "./restore-errors.ts";

describe("a backup that cannot be restored", () => {
  it("says what happened and what to do, for every error of backup format §6", () => {
    const cases: readonly (readonly [BackupErrorCode, string])[] = [
      ["too-large", "The file is too large to be a backup."],
      ["not-a-backup", "This is not a backup file."],
      ["wrong-passphrase", "The passphrase is wrong. Try again."],
      ["damaged", "The file is damaged or not supported."],
      ["other-app", "This is a backup of another app."],
      [
        "newer-version",
        "The backup was made by a newer version of the app. Update the app and try again.",
      ],
      ["invalid", "The backup is damaged or was changed, and was not restored."],
    ];
    for (const [code, message] of cases) {
      expect(restoreErrorMessage(new BackupError(code, "A test."))).toBe(message);
    }
  });

  it("names the other app whose backup it is, when the backup names a valid one", () => {
    expect(restoreErrorMessage(new BackupError("other-app", "A test.", { app: "notes" }))).toBe(
      "This is a backup of the app “notes”, not of this one.",
    );
  });

  it("says that the backup's dates lie in the future when the user did not confirm them (§5.7)", () => {
    expect(restoreErrorMessage(new DataLayerError("future-clock", "A test."))).toBe(
      "The backup's dates lie in the future. Check the date and time on this device, then try again.",
    );
  });

  it("says only that nothing changed when something else failed", () => {
    expect(restoreErrorMessage(new DataLayerError("closed", "A test."))).toBe(
      "The backup could not be restored. Nothing was changed.",
    );
    expect(restoreErrorMessage(new Error("The backup worker could not run."))).toBe(
      "The backup could not be restored. Nothing was changed.",
    );
  });
});
