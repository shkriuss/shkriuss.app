import { describe, expect, it } from "vitest";
import { stopOnUnmount } from "./work.ts";

describe("stopOnUnmount", () => {
  it("stops the work in the ref, and lets go of it", () => {
    const controller = new AbortController();
    const work = { current: controller as AbortController | undefined };
    const stop = stopOnUnmount(work);
    expect(controller.signal.aborted).toBe(false);
    stop();
    expect(controller.signal.aborted).toBe(true);
    expect(work.current).toBeUndefined();
  });

  it("does nothing without work", () => {
    const work = { current: undefined };
    expect(() => {
      stopOnUnmount(work)();
    }).not.toThrow();
    expect(work.current).toBeUndefined();
  });
});
