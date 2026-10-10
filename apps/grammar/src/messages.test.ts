import { describe, expect, it } from "vitest";
import { m } from "./messages.ts";

describe("kind", () => {
  it("names Harper's kinds of mistakes as the list does, and any other kind Other", () => {
    expect(m.kind("Spelling")).toBe("Spelling");
    expect(m.kind("WordChoice")).toBe("Word choice");
    expect(m.kind("Miscellaneous")).toBe("Grammar");
    expect(m.kind("Later")).toBe("Other");
  });

  it("names a kind named like a property of every object Other too, not after the property", () => {
    for (const kind of ["constructor", "__proto__", "hasOwnProperty", "toString", "valueOf"]) {
      expect(m.kind(kind)).toBe("Other");
    }
  });
});
