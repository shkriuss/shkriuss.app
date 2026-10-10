import { describe, expect, it } from "vitest";
import { m } from "./messages.ts";

describe("the text that every app shows", () => {
  it("has every message, in English", () => {
    expect({
      skipToContent: m.skipToContent(),
      navigation: m.navigation(),
      settings: m.settings(),
      notFoundTitle: m.notFoundTitle(),
      notFoundText: m.notFoundText(),
      updateAvailable: m.updateAvailable(),
      update: m.update(),
      later: m.later(),
      updating: m.updating(),
      outdated: m.outdated(),
      reload: m.reload(),
      errorTitle: m.errorTitle(),
      errorText: m.errorText(),
      close: m.close(),
      install: m.install(),
      installApp: m.installApp(),
      installed: m.installed(),
      installOffer: m.installOffer(),
      addToHomeScreen: m.addToHomeScreen(),
      addToHomeScreenWithoutData: m.addToHomeScreenWithoutData(),
      installFromMenu: m.installFromMenu(),
      about: m.about("Notes"),
      privacy: m.privacy(),
      privacyWithoutData: m.privacyWithoutData(),
      freeSoftware: m.freeSoftware(),
      sourceCode: m.sourceCode(),
      licenses: m.licenses(),
      licensesTitle: m.licensesTitle(),
      licensesLoading: m.licensesLoading(),
      licensesFailed: m.licensesFailed(),
      reportProblem: m.reportProblem(),
    }).toStrictEqual({
      skipToContent: "Skip to content",
      navigation: "Sections",
      settings: "Settings",
      notFoundTitle: "Page not found",
      notFoundText: "This app has no page at this address.",
      updateAvailable: "A new version of the app is ready.",
      update: "Update",
      later: "Later",
      updating: "Updating…",
      outdated: "The app was updated in another window.",
      reload: "Reload",
      errorTitle: "Something went wrong",
      errorText: "Reload the app to try again. Your data stays on this device.",
      close: "Close",
      install: "Install",
      installApp: "Install",
      installed: "This app is installed on this device.",
      installOffer:
        "Install this app to open it like any other, from your home screen or your list of apps.",
      addToHomeScreen:
        "To install this app, open your browser's share menu, then choose Add to Home Screen. The app there keeps its own data, apart from your browser's: to take your data along, back it up here, then restore the backup in the app.",
      addToHomeScreenWithoutData:
        "To install this app, open your browser's share menu, then choose Add to Home Screen.",
      installFromMenu:
        "Some browsers install apps from their menu, with Install or Add to Home Screen.",
      about: "About Notes",
      privacy:
        "Your data stays on this device. The app has no accounts, and sends none of your data anywhere: only the backups that you save leave the device.",
      privacyWithoutData:
        "This app keeps none of your data: what you enter stays on this device, until you close the app. The app has no accounts, and sends nothing anywhere.",
      freeSoftware:
        "This app is free software, under the GNU Affero General Public License, version 3.",
      sourceCode: "Source code",
      licenses: "Licenses of the software it includes",
      licensesTitle: "Licenses",
      licensesLoading: "Reading the licenses…",
      licensesFailed: "The licenses could not be read.",
      reportProblem: "Report a security problem",
    });
  });

  it("titles the page with the screen and the app, or the app alone on a screen named after it", () => {
    expect(m.pageTitle("Settings", "Notes")).toBe("Settings – Notes");
    expect(m.pageTitle("Notes", "Notes")).toBe("Notes");
    expect(m.pageTitle("Settings", undefined)).toBe("Settings");
  });

  it("leads from a page that does not exist to the app", () => {
    expect(m.goHome("Notes")).toBe("Go to Notes");
    expect(m.goHome(undefined)).toBe("Go to the start page");
  });
});
