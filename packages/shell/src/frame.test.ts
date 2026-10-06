import { describe, expect, it } from "vitest";
import { NO_FRAME } from "./frame.ts";

describe("NO_FRAME", () => {
  it("does nothing, for components outside a frame", () => {
    expect(NO_FRAME.focusScreen()).toBeUndefined();
  });
});
