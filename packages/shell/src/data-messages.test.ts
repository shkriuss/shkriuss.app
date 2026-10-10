import { describe, expect, it } from "vitest";
import { createFormat } from "@shkriuss/i18n";
import { m, messages } from "./data-messages.ts";
import { m as everyApp } from "./messages.ts";

describe("the text that only apps with data show", () => {
  it("has every message, in English", () => {
    expect({
      startFailedTitle: m.startFailedTitle(),
      startFailedText: m.startFailedText(),
      startRescueText: m.startRescueText(),
      startStorageFullText: m.startStorageFullText(),
      startOutdatedTitle: m.startOutdatedTitle(),
      startOutdatedText: m.startOutdatedText(),
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
      easyToGuess: m.easyToGuess(),
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
      onlyDeletions: m.onlyDeletions(),
      restoreNow: m.restoreNow(),
      restoreAnyway: m.restoreAnyway(),
      restoringTitle: m.restoringTitle(),
      restoring: m.restoring(),
      restoredTitle: m.restoredTitle(),
      restoredNothingShown: m.restoredNothingShown(),
      notRestoredTitle: m.notRestoredTitle(),
      fileTooLarge: m.fileTooLarge(),
      notABackup: m.notABackup(),
      damaged: m.damaged(),
      newerVersion: m.newerVersion(),
      futureClock: m.futureClock(),
      invalid: m.invalid(),
      storageFull: m.storageFull(),
      restoreFailed: m.restoreFailed(),
      installFirst: m.installFirst(),
      remindFirst: m.remindFirst(),
    }).toStrictEqual({
      startFailedTitle: "The app could not start",
      startFailedText:
        "It could not open its data on this device. Reload the app to try again. Your data stays on this device.",
      startRescueText:
        "To keep a copy of it meanwhile, back it up: once the app works again, it can restore the backup.",
      startStorageFullText:
        "This device has no space left for the app's data. Free some space, then reload the app. Your data stays on this device.",
      startOutdatedTitle: "This app was updated",
      startOutdatedText:
        "A newer version of this app has opened its data on this device already. Reload the app to use it.",
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
        "Choose a passphrase of at least 12 characters that is hard to guess, and type it twice. Without it, nobody can open the backup, not even you.",
      passphrase: "Passphrase",
      passphraseAgain: "Passphrase again",
      tooShort: "Use at least 12 characters.",
      easyToGuess:
        "This is easy to guess. Avoid repeats, runs such as 123456 or qwerty, and common passwords.",
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
      onlyDeletions:
        "This device already has everything in this backup that the app shows. Restoring it still records what was deleted on other devices, so that an older backup cannot bring those items back.",
      restoreNow: "Restore",
      restoreAnyway: "Restore anyway",
      restoringTitle: "Restoring the backup",
      restoring: "Restoring the backup…",
      restoredTitle: "Restored",
      restoredNothingShown: "Restored. Nothing that the app shows has changed.",
      notRestoredTitle: "Not restored",
      fileTooLarge: "The file is too large to be a backup.",
      notABackup: "This is not a backup file.",
      damaged: "The file is damaged or not supported.",
      newerVersion:
        "The backup was made by a newer version of the app. Update the app and try again.",
      futureClock:
        "The backup's dates lie in the future. Check the date and time on this device, then try again.",
      invalid: "The backup is damaged or was changed, and was not restored.",
      storageFull:
        "This device has no space left for the app's data. Free some space, then try again.",
      restoreFailed: "The backup could not be restored. Nothing was changed.",
      installFirst:
        "Before you start, add this app to your Home Screen: there it keeps its own data, apart from your browser's. Open the share menu, then choose Add to Home Screen.",
      remindFirst: "No backup yet. Back up your data to keep it safe.",
    });
  });

  it("has the text that every app shows too, and replaces none of it", () => {
    expect(m).toMatchObject(everyApp);
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

  it("says when a backup's changes are dated more than a day ahead of this device's clock (data model §3.5)", () => {
    const latest = new Date("2027-03-01T09:00:00Z");
    const british = messages(createFormat("en-GB", { timeZone: "UTC" }));
    expect(british.readyFromFuture(latest)).toBe(
      "Some changes in it are dated up to 1 Mar 2027, 09:00, more than a day ahead of this device's clock. If the clock is wrong, correct it. If not, restoring this backup will ask you to confirm those dates.",
    );
    expect(british.restoreFromFuture(latest)).toBe(
      "Some changes in it are dated up to 1 Mar 2027, 09:00, more than a day ahead of this device's clock. If the clock is wrong, correct it first. If not, the backup comes from a device whose clock was set ahead: restoring it anyway gives this device's changes that date too, until it comes.",
    );
  });

  it("reminds of a backup that is a week old, with the changes it lacks, as the device writes", () => {
    const made = new Date("2026-09-29T14:30:00Z");
    const british = messages(createFormat("en-GB", { timeZone: "UTC" }));
    expect(british.remindDue(made, 1)).toBe(
      "Your last backup is from 29 Sept 2026, and 1 change is not in it.",
    );
    expect(british.remindDue(made, 1234)).toBe(
      "Your last backup is from 29 Sept 2026, and 1,234 changes are not in it.",
    );
    expect(messages(createFormat("de-DE", { timeZone: "UTC" })).remindDue(made, 1234)).toBe(
      "Your last backup is from 29 Sept 2026, and 1.234 changes are not in it.",
    );
  });

  it("names another app whose backup it is", () => {
    expect(m.otherApp(undefined)).toBe("This is a backup of another app.");
    expect(m.otherApp("notes")).toBe("This is a backup of the app “notes”, not of this one.");
  });
});
