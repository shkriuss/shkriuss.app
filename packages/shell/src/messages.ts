import { createFormat, defineMessages } from "@shkriuss/i18n";

/**
 * The text of the shell that every app shows: the frame around its screens, its banners and
 * errors, and the settings that every app has. The text that only apps with data show is in
 * `data-messages.ts`, which an app without data does not have.
 */
export const messages = defineMessages(() => ({
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
}));

/** The UI's formats, which the shell's text is written with. */
export const uiFormat = createFormat();

export const m = messages(uiFormat);
