import type { AppUpdates, UpdateState } from "@shkriuss/pwa";
import { describe, expect, it, vi } from "vitest";
import { type Check, createChecker } from "./checker.ts";

/** The service worker's updates, whose state the test sets. */
function fakeUpdates(initial: UpdateState): AppUpdates & { set(state: UpdateState): void } {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyUpdate: () => {},
    checkForUpdate: async () => {},
    set(next) {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

/** A check whose answers the test gives: it holds each request until then. */
function fakeCheck() {
  const pending: { text: string; settle: (ok: boolean) => void }[] = [];
  const check: Check = async (text) =>
    new Promise((resolve, reject) => {
      pending.push({
        text,
        settle: (ok) => {
          if (ok) {
            resolve([]);
          } else {
            reject(new Error("Failed."));
          }
        },
      });
    });
  return { check, pending };
}

describe("createChecker", () => {
  it("waits until the service worker keeps the app, then starts, and is ready after its first check", async () => {
    const updates = fakeUpdates("starting");
    const { check, pending } = fakeCheck();
    const start = vi.fn<() => Check>(() => check);
    const checker = createChecker(updates, start);
    const states: string[] = [];
    checker.subscribe(() => states.push(checker.getState()));

    expect(start).not.toHaveBeenCalled();
    await expect(checker.check("Hello.", "american")).rejects.toThrow("not running");
    // The page registers the service worker, which installs the app's first version.
    updates.set("installing");
    expect(start).not.toHaveBeenCalled();
    updates.set("ready");
    updates.set("update-available");
    expect(start).toHaveBeenCalledOnce();
    expect(checker.getState()).toBe("starting");
    expect(pending.map((request) => request.text)).toStrictEqual([""]);
    pending[0]?.settle(true);
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("ready");
    });
    expect(states).toStrictEqual(["ready"]);
    const result = checker.check("Hello.", "british");
    pending[1]?.settle(true);
    await expect(result).resolves.toStrictEqual([]);
  });

  it("starts at once when a version of the app is active already, or there is no service worker", () => {
    for (const state of ["ready", "update-available", "outdated", "unavailable"] as const) {
      const start = vi.fn<() => Check>(() => fakeCheck().check);
      createChecker(fakeUpdates(state), start);
      expect(start).toHaveBeenCalledOnce();
    }
  });

  it("starts once the page knows that it has no service worker, as in a private window", () => {
    const updates = fakeUpdates("starting");
    const start = vi.fn<() => Check>(() => fakeCheck().check);
    createChecker(updates, start);
    expect(start).not.toHaveBeenCalled();
    updates.set("unavailable");
    expect(start).toHaveBeenCalledOnce();
  });

  it("fails when it cannot start, and then checks nothing", async () => {
    const { check, pending } = fakeCheck();
    const checker = createChecker(fakeUpdates("ready"), () => check);
    pending[0]?.settle(false);
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("failed");
    });
    await expect(checker.check("Hello.", "american")).rejects.toThrow("not running");

    const broken = createChecker(fakeUpdates("ready"), () => {
      throw new Error("No workers.");
    });
    expect(broken.getState()).toBe("failed");
  });
});
