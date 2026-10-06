import { createFormat, defineMessages } from "@shkriuss/i18n";

/** The text of the shell, which every app shows around its own screens. */
export const messages = defineMessages((format) => ({
  skipToContent: () => "Skip to content",
  navigation: () => "Sections",
  updateAvailable: () => "A new version of the app is ready.",
  update: () => "Update",
  later: () => "Later",
  updating: () => "Updating…",
  outdated: () => "The app was updated in another window.",
  reload: () => "Reload",
  errorTitle: () => "Something went wrong",
  errorText: () => "Reload the app to try again. Your data stays on this device.",
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
}));

export const m = messages(createFormat());
