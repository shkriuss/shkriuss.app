import { describe, expect, it } from "vitest";
import { createFormat } from "@shkriuss/i18n";
import { m, messages } from "./messages.ts";

describe("the shell's text", () => {
  it("has every message, in English", () => {
    expect({
      skipToContent: m.skipToContent(),
      navigation: m.navigation(),
      updateAvailable: m.updateAvailable(),
      update: m.update(),
      later: m.later(),
      updating: m.updating(),
      outdated: m.outdated(),
      reload: m.reload(),
      errorTitle: m.errorTitle(),
      errorText: m.errorText(),
      storage: m.storage(),
      usageUnknown: m.usageUnknown(),
      kept: m.kept(),
      mayDelete: m.mayDelete(),
      notKept: m.notKept(),
      keptUnknown: m.keptUnknown(),
      keepData: m.keepData(),
      backups: m.backups(),
      noBackup: m.noBackup(),
      backUp: m.backUp(),
      backUpTitle: m.backUpTitle(),
      generatedText: m.generatedText(),
      chooseOwn: m.chooseOwn(),
      plainInstead: m.plainInstead(),
      cancel: m.cancel(),
      ownTitle: m.ownTitle(),
      ownText: m.ownText(),
      passphrase: m.passphrase(),
      passphraseAgain: m.passphraseAgain(),
      tooShort: m.tooShort(),
      different: m.different(),
      chooseGenerated: m.chooseGenerated(),
      plainTitle: m.plainTitle(),
      plainText: m.plainText(),
      makePlain: m.makePlain(),
      makingTitle: m.makingTitle(),
      making: m.making(),
      readyTitle: m.readyTitle(),
      readyText: m.readyText(),
      notSaved: m.notSaved(),
      save: m.save(),
      savedTitle: m.savedTitle(),
      shared: m.shared(),
      keepElsewhere: m.keepElsewhere(),
      done: m.done(),
      failedTitle: m.failedTitle(),
      tooLarge: m.tooLarge(),
      failed: m.failed(),
      tryAgain: m.tryAgain(),
      restore: m.restore(),
      readingTitle: m.readingTitle(),
      reading: m.reading(),
      encryptedTitle: m.encryptedTitle(),
      encryptedText: m.encryptedText(),
      open: m.open(),
      enterPassphrase: m.enterPassphrase(),
      wrongPassphrase: m.wrongPassphrase(),
      previewTitle: m.previewTitle(),
      nothingNew: m.nothingNew(),
      restoreNow: m.restoreNow(),
      restoringTitle: m.restoringTitle(),
      restoring: m.restoring(),
      restoredTitle: m.restoredTitle(),
      notRestoredTitle: m.notRestoredTitle(),
      fileTooLarge: m.fileTooLarge(),
      notABackup: m.notABackup(),
      damaged: m.damaged(),
      newerVersion: m.newerVersion(),
      futureClock: m.futureClock(),
      invalid: m.invalid(),
      restoreFailed: m.restoreFailed(),
      close: m.close(),
    }).toStrictEqual({
      skipToContent: "Skip to content",
      navigation: "Sections",
      updateAvailable: "A new version of the app is ready.",
      update: "Update",
      later: "Later",
      updating: "Updating…",
      outdated: "The app was updated in another window.",
      reload: "Reload",
      errorTitle: "Something went wrong",
      errorText: "Reload the app to try again. Your data stays on this device.",
      storage: "Storage",
      usageUnknown: "Your browser does not say how much this app stores.",
      kept: "Your browser keeps this data until you delete it.",
      mayDelete: "Your browser may delete this data when the device runs low on space.",
      notKept: "Your browser did not agree to keep this data. Back it up to keep it safe.",
      keptUnknown: "Your browser does not say whether it keeps this data.",
      keepData: "Keep data on this device",
      backups: "Backups",
      noBackup: "No backup yet.",
      backUp: "Back up",
      backUpTitle: "Back up your data",
      generatedText:
        "Your backup is encrypted with this passphrase. Write it down and keep it safe: without it, nobody can open the backup, not even you.",
      chooseOwn: "Use my own passphrase",
      plainInstead: "Make a plain backup instead",
      cancel: "Cancel",
      ownTitle: "Your own passphrase",
      ownText:
        "Choose a passphrase of at least 12 characters, and type it twice. Without it, nobody can open the backup, not even you.",
      passphrase: "Passphrase",
      passphraseAgain: "Passphrase again",
      tooShort: "Use at least 12 characters.",
      different: "The two passphrases are not the same.",
      chooseGenerated: "Use a generated passphrase",
      plainTitle: "A plain backup",
      plainText:
        "A plain backup is not encrypted: anyone who gets the file can read all of it. Keep it only where nobody else can.",
      makePlain: "Make a plain backup",
      makingTitle: "Making your backup",
      making: "Making your backup… This takes a few seconds.",
      readyTitle: "Your backup is ready",
      readyText: "Save it somewhere other than this device, such as a cloud drive.",
      notSaved: "The backup is not saved yet.",
      save: "Save backup",
      savedTitle: "Backed up",
      shared: "Your backup is saved.",
      keepElsewhere: "Keep it somewhere other than this device.",
      done: "Done",
      failedTitle: "No backup",
      tooLarge: "This app's data is too large for a backup.",
      failed: "The backup could not be made. Try again.",
      tryAgain: "Try again",
      restore: "Restore from a backup",
      readingTitle: "Reading the backup",
      reading: "Reading the backup… An encrypted one takes a few seconds.",
      encryptedTitle: "This backup is encrypted",
      encryptedText: "Enter the passphrase that the backup was made with.",
      open: "Open",
      enterPassphrase: "Enter the passphrase.",
      wrongPassphrase: "The passphrase is wrong. Try again.",
      previewTitle: "Restore this backup?",
      nothingNew: "This device already has everything in this backup.",
      restoreNow: "Restore",
      restoringTitle: "Restoring the backup",
      restoring: "Restoring the backup…",
      restoredTitle: "Restored",
      notRestoredTitle: "Not restored",
      fileTooLarge: "The file is too large to be a backup.",
      notABackup: "This is not a backup file.",
      damaged: "The file is damaged or not supported.",
      newerVersion:
        "The backup was made by a newer version of the app. Update the app and try again.",
      futureClock:
        "The backup's times lie in the future. Check the date and time on this device and on the one that made the backup.",
      invalid: "The backup is damaged or was changed, and was not restored.",
      restoreFailed: "The backup could not be restored. Nothing was changed.",
      close: "Close",
    });
  });

  it("writes sizes in units of 1,000, with the device's regional conventions", () => {
    const american = messages(createFormat("en-US"));
    expect(american.usage(1_234_567)).toBe("This app stores 1.2 MB on this device.");
    expect(american.usage(512)).toBe("This app stores 512 bytes on this device.");
    expect(messages(createFormat("de-DE")).usage(1_234_567)).toBe(
      "This app stores 1,2 MB on this device.",
    );
  });

  it("says when the last backup was made, and how much changed since, as the device writes", () => {
    const made = new Date("2026-10-06T14:30:00Z");
    const british = messages(createFormat("en-GB", { timeZone: "UTC" }));
    expect(british.lastBackup(made)).toBe("Last backup: 6 Oct 2026, 14:30.");
    expect(british.changesSince(0)).toBe("Nothing has changed since then.");
    expect(british.changesSince(1)).toBe("1 change since then.");
    expect(british.changesSince(1234)).toBe("1,234 changes since then.");
    expect(messages(createFormat("de-DE", { timeZone: "UTC" })).changesSince(1234)).toBe(
      "1.234 changes since then.",
    );
  });

  it("names the downloaded file", () => {
    expect(m.downloaded("shkriuss-notes-2026-10-06.age")).toBe(
      "Your backup is in your downloads, as shkriuss-notes-2026-10-06.age.",
    );
  });

  it("says what restoring a backup does, as backup format §5.6 shows it", () => {
    const british = messages(createFormat("en-GB", { timeZone: "UTC" }));
    expect(british.madeOn(new Date("2026-10-06T14:30:00Z"))).toBe(
      "This backup was made on 6 Oct 2026, 14:30.",
    );
    expect(british.brings({ new: 1234, updated: 3, deleted: 1, unchanged: 7 })).toBe(
      "Restoring it brings 1,234 new, 3 updated, 1 deleted.",
    );
    expect(british.brings({ new: 0, updated: 2, deleted: 0, unchanged: 0 })).toBe(
      "Restoring it brings 2 updated.",
    );
    expect(british.restored({ new: 12, updated: 0, deleted: 1, unchanged: 0 })).toBe(
      "Restored: 12 new, 1 deleted.",
    );
    expect(
      messages(createFormat("de-DE")).brings({ new: 1234, updated: 0, deleted: 0, unchanged: 0 }),
    ).toBe("Restoring it brings 1.234 new.");
  });

  it("names another app whose backup it is", () => {
    expect(m.otherApp(undefined)).toBe("This is a backup of another app.");
    expect(m.otherApp("notes")).toBe("This is a backup of the app “notes”, not of this one.");
  });
});
