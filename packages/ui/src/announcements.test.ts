import { describe, expect, it } from "vitest";
import { announce } from "./announcements.ts";

describe("announce", () => {
  it("counts the announcements from the first", () => {
    const first = announce(undefined, "“Milk” deleted.");
    expect(first).toStrictEqual({ id: 1, text: "“Milk” deleted." });
    expect(announce(first, "“Eggs” deleted.")).toStrictEqual({ id: 2, text: "“Eggs” deleted." });
  });

  it("makes a new announcement of the same text, so that screen readers read it again (WCAG 4.1.3)", () => {
    const first = announce(undefined, "“Milk” deleted.");
    const again = announce(first, "“Milk” deleted.");
    expect(again).not.toStrictEqual(first);
    expect(again).toStrictEqual({ id: 2, text: "“Milk” deleted." });
  });
});
