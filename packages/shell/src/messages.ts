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
}));

export const m = messages(createFormat());
