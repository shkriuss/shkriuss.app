import { describe, expect, it } from "vitest";
import { NO_FRAME } from "./frame.ts";

describe("NO_FRAME", () => {
  it("has no name and does nothing, for components outside a frame", () => {
    expect(NO_FRAME.name).toBeUndefined();
    expect(NO_FRAME.focusScreen()).toBeUndefined();
  });
});
