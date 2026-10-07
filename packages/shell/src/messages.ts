import type { ImportCounts } from "@shkriuss/data";
import { createFormat, defineMessages, type Format } from "@shkriuss/i18n";

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

/** The text of the shell, which every app shows around its own screens. */
export const messages = defineMessages((format) => ({
  skipToContent: () => "Skip to content",
  navigation: () => "Sections",
  settings: () => "Settings",
  pageTitle: (screen: string, app: string | undefined) =>
    app === undefined || screen === app ? screen : `${screen} – ${app}`,
  notFoundTitle: () => "Page not found",
  notFoundText: () => "This app has no page at this address.",
  goHome: (app: string | undefined) =>
    app === undefined ? "Go to the start page" : `Go to ${app}`,
  updateAvailable: () => "A new version of the app is ready.",
  update: () => "Update",
  later: () => "Later",
  updating: () => "Updating…",
  outdated: () => "The app was updated in another window.",
  reload: () => "Reload",
  errorTitle: () => "Something went wrong",
  errorText: () => "Reload the app to try again. Your data stays on this device.",
  startFailedTitle: () => "The app could not start",
  startFailedText: () =>
    "It could not open its data on this device. Reload the app to try again. Your data stays on this device.",
  startOutdatedTitle: () => "This app was updated",
  startOutdatedText: () =>
    "A newer version of this app has opened its data on this device already. Reload the app to use it.",
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
    "Choose a passphrase of at least 12 characters, and type it twice. Without it, nobody can open the backup, not even you.",
  passphrase: () => "Passphrase",
  passphraseAgain: () => "Passphrase again",
  tooShort: () => "Use at least 12 characters.",
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
  tryAgain: () => "Try again",
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
  restoreNow: () => "Restore",
  restoringTitle: () => "Restoring the backup",
  restoring: () => "Restoring the backup…",
  restoredTitle: () => "Restored",
  restored: (counts: ImportCounts) => `Restored: ${importCounts(format, counts)}.`,
  notRestoredTitle: () => "Not restored",
  fileTooLarge: () => "The file is too large to be a backup.",
  notABackup: () => "This is not a backup file.",
  damaged: () => "The file is damaged or not supported.",
  otherApp: (app: string | undefined) =>
    app === undefined
      ? "This is a backup of another app."
      : `This is a backup of the app “${app}”, not of this one.`,
  newerVersion: () =>
    "The backup was made by a newer version of the app. Update the app and try again.",
  futureClock: () =>
    "The backup's times lie in the future. Check the date and time on this device and on the one that made the backup.",
  invalid: () => "The backup is damaged or was changed, and was not restored.",
  restoreFailed: () => "The backup could not be restored. Nothing was changed.",
  close: () => "Close",
  install: () => "Install",
  installApp: () => "Install",
  installed: () => "This app is installed on this device.",
  installOffer: () =>
    "Install this app to open it like any other, from your home screen or your list of apps.",
  addToHomeScreen: () =>
    "To install this app, open your browser's share menu, then choose Add to Home Screen. The app there keeps its own data, apart from your browser's: to take your data along, back it up here, then restore the backup in the app.",
  addToHomeScreenWithoutData: () =>
    "To install this app, open your browser's share menu, then choose Add to Home Screen.",
  installFromMenu: () =>
    "Some browsers install apps from their menu, with Install or Add to Home Screen.",
  installFirst: () =>
    "Before you start, add this app to your Home Screen: there it keeps its own data, apart from your browser's. Open the share menu, then choose Add to Home Screen.",
  about: (name: string) => `About ${name}`,
  privacy: () =>
    "Your data stays on this device. The app has no accounts, and sends none of your data anywhere: only the backups that you save leave the device.",
  privacyWithoutData: () =>
    "This app keeps none of your data: what you enter stays on this device, until you close the app. The app has no accounts, and sends nothing anywhere.",
  freeSoftware: () =>
    "This app is free software, under the GNU Affero General Public License, version 3.",
  sourceCode: () => "Source code",
  licenses: () => "Licenses of the software it includes",
  licensesTitle: () => "Licenses",
  licensesLoading: () => "Reading the licenses…",
  licensesFailed: () => "The licenses could not be read.",
  reportProblem: () => "Report a security problem",
  remindFirst: () => "No backup yet. Back up your data to keep it safe.",
  remindDue: (made: Date, changes: number) =>
    format.plural(changes, {
      one: `Your last backup is from ${format.date(made)}, and # change is not in it.`,
      other: `Your last backup is from ${format.date(made)}, and # changes are not in it.`,
    }),
}));

export const m = messages(createFormat());
