import type { ImportCounts } from "@shkriuss/data";
import { defineMessages, type Format } from "@shkriuss/i18n";
import { messages as everyAppMessages, uiFormat } from "./messages.ts";

/** What an import does, as backup format §5.6 shows it: "12 new, 3 updated, 1 deleted". */
function importCounts(format: Format, counts: ImportCounts): string {
  const parts: string[] = [];
  if (counts.new > 0) {
    parts.push(`${format.number(counts.new)} new`);
  }
  if (counts.updated > 0) {
    parts.push(`${format.number(counts.updated)} updated`);
  }
  if (counts.deleted > 0) {
    parts.push(`${format.number(counts.deleted)} deleted`);
  }
  return format.list(parts, "units");
}

/**
 * The text of the shell that only apps with data show: when the app cannot open its data, the
 * install banner, storage, backups and restoring them; with the text that every app shows, from
 * `messages.ts`. The build of an app without data fails if it has this file (`app()` of
 * `vite.ts`), and so if it has any part of the shell that shows this text.
 */
export const messages = defineMessages((format) => ({
  ...everyAppMessages(format),
  startFailedTitle: () => "The app could not start",
  startFailedText: () =>
    "It could not open its data on this device. Reload the app to try again. Your data stays on this device.",
  startRescueText: () =>
    "To keep a copy of it meanwhile, back it up: once the app works again, it can restore the backup.",
  startStorageFullText: () =>
    "This device has no space left for the app's data. Free some space, then reload the app. Your data stays on this device.",
  startOutdatedTitle: () => "This app was updated",
  startOutdatedText: () =>
    "A newer version of this app has opened its data on this device already. Reload the app to use it.",
  startBlockedTitle: () => "Waiting for another window",
  startBlockedText: () =>
    "This app is open in another window or tab, with an older version, which has not closed its data yet. Close this app's other windows and tabs; if the app does not start then, reload it.",
  storage: () => "Storage",
  usage: (bytes: number) => `This app stores ${format.bytes(bytes)} on this device.`,
  usageUnknown: () => "Your browser does not say how much this app stores.",
  kept: () => "Your browser keeps this data until you delete it.",
  mayDelete: () => "Your browser may delete this data when the device runs low on space.",
  notKept: () => "Your browser did not agree to keep this data. Back it up to keep it safe.",
  keptUnknown: () => "Your browser does not say whether it keeps this data.",
  keepData: () => "Keep data on this device",
  backups: () => "Backups",
  noBackup: () => "No backup yet.",
  lastBackup: (made: Date) => `Last backup: ${format.dateTime(made)}.`,
  changesSince: (count: number) =>
    count === 0
      ? "Nothing has changed since then."
      : format.plural(count, { one: "# change since then.", other: "# changes since then." }),
  backUp: () => "Back up",
  backUpTitle: () => "Back up your data",
  generatedText: () =>
    "Your backup is encrypted with this passphrase. Write it down and keep it safe: without it, nobody can open the backup, not even you.",
  chooseOwn: () => "Use my own passphrase",
  plainInstead: () => "Make a plain backup instead",
  cancel: () => "Cancel",
  ownTitle: () => "Your own passphrase",
  ownText: () =>
    "Choose a passphrase of at least 12 characters that is hard to guess, and type it twice. Without it, nobody can open the backup, not even you.",
  passphrase: () => "Passphrase",
  passphraseAgain: () => "Passphrase again",
  tooShort: () => "Use at least 12 characters. Spaces do not count.",
  easyToGuess: () =>
    "This is easy to guess. Avoid repeats, runs such as 123456 or qwerty, and common passwords.",
  different: () => "The two passphrases are not the same.",
  chooseGenerated: () => "Use a generated passphrase",
  plainTitle: () => "A plain backup",
  plainText: () =>
    "A plain backup is not encrypted: anyone who gets the file can read all of it. Keep it only where nobody else can.",
  makePlain: () => "Make a plain backup",
  makingTitle: () => "Making your backup",
  making: () => "Making your backup… This takes a few seconds.",
  readyTitle: () => "Your backup is ready",
  readyText: () => "Save it somewhere other than this device, such as a cloud drive.",
  readyFromFuture: (latest: Date) =>
    `Some changes in it are dated up to ${format.dateTime(latest)}, more than a day ahead of this device's clock. If the clock is wrong, correct it. If not, restoring this backup will ask you to confirm those dates.`,
  notSaved: () => "The backup is not saved yet.",
  save: () => "Save backup",
  savedTitle: () => "Backed up",
  shared: () => "Your backup is saved.",
  downloaded: (name: string) => `Your backup is in your downloads, as ${name}.`,
  keepElsewhere: () => "Keep it somewhere other than this device.",
  done: () => "Done",
  failedTitle: () => "No backup",
  tooLarge: () => "This app's data is too large for a backup.",
  failed: () => "The backup could not be made. Try again.",
  noMemoryToBackUp: () =>
    "This device does not have enough free memory to make the backup right now. Close other apps or tabs and try again.",
  tryAgain: () => "Try again",
  notLoadedTitle: () => "The backup could not start",
  notLoadedText: () =>
    "The app could not load the part of itself that makes backups. Try again; if that fails, reload the app.",
  restore: () => "Restore from a backup",
  readingTitle: () => "Reading the backup",
  reading: () => "Reading the backup… An encrypted one takes a few seconds.",
  encryptedTitle: () => "This backup is encrypted",
  encryptedText: () => "Enter the passphrase that the backup was made with.",
  open: () => "Open",
  enterPassphrase: () => "Enter the passphrase.",
  wrongPassphrase: () => "The passphrase is wrong. Try again.",
  previewTitle: () => "Restore this backup?",
  madeOn: (made: Date) => `This backup was made on ${format.dateTime(made)}.`,
  brings: (counts: ImportCounts) => `Restoring it brings ${importCounts(format, counts)}.`,
  nothingNew: () => "This device already has everything in this backup.",
  onlyDeletions: () =>
    "This device already has everything in this backup that the app shows. Restoring it still records what was deleted on other devices, so that an older backup cannot bring those items back.",
  restoreNow: () => "Restore",
  restoreFromFuture: (latest: Date) =>
    `Some changes in it are dated up to ${format.dateTime(latest)}, more than a day ahead of this device's clock. If the clock is wrong, correct it first. If not, the backup comes from a device whose clock was set ahead: restoring it anyway gives this device's changes that date too, until it comes.`,
  restoreAnyway: () => "Restore anyway",
  restoringTitle: () => "Restoring the backup",
  restoring: () => "Restoring the backup…",
  restoredTitle: () => "Restored",
  restored: (counts: ImportCounts) => `Restored: ${importCounts(format, counts)}.`,
  restoredNothingShown: () => "Restored. Nothing that the app shows has changed.",
  notRestoredTitle: () => "Not restored",
  fileTooLarge: () => "The file is too large to be a backup.",
  notABackup: () => "This is not a backup file.",
  damaged: () => "The file is damaged or not supported.",
  noMemory: () =>
    "This device does not have enough free memory to open the backup right now. Close other apps or tabs and try again.",
  otherApp: (app: string | undefined) =>
    app === undefined
      ? "This is a backup of another app."
      : `This is a backup of the app “${app}”, not of this one.`,
  newerVersion: () =>
    "The backup was made by a newer version of the app. Update the app and try again.",
  futureClock: () =>
    "The backup's dates lie in the future. Check the date and time on this device, then try again.",
  invalid: () => "The backup is damaged or was changed, and was not restored.",
  storageFull: () =>
    "This device has no space left for the app's data. Free some space, then try again.",
  restoreFailed: () => "The backup could not be restored. Nothing was changed.",
  installFirst: () =>
    "Before you start, add this app to your Home Screen: there it keeps its own data, apart from your browser's. Open the share menu, then choose Add to Home Screen.",
  remindFirst: () => "No backup yet. Back up your data to keep it safe.",
  remindDue: (made: Date, changes: number) =>
    format.plural(changes, {
      one: `Your last backup is from ${format.date(made)}, and # change is not in it.`,
      other: `Your last backup is from ${format.date(made)}, and # changes are not in it.`,
    }),
}));

export const m = messages(uiFormat);
