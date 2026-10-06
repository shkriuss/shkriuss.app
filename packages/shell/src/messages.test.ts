import { describe, expect, it } from "vitest";
import { m } from "./messages.ts";

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
    });
  });
});
