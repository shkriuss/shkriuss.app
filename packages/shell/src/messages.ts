import { createFormat, defineMessages } from "@shkriuss/i18n";

/** The text of the shell, which every app shows around its own screens. */
const messages = defineMessages(() => ({
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
}));

export const m = messages(createFormat());
