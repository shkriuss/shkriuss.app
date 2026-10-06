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
});
