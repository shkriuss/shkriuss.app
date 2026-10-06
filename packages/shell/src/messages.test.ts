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
});
