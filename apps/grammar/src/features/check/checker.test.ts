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

  it("checks one text at a time, and of those that come meanwhile, only the latest", async () => {
    const { check, pending } = fakeCheck();
    const checker = createChecker(fakeUpdates("ready"), () => check);
    pending[0]?.settle(true);
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("ready");
    });
    const one = checker.check("One.", "american");
    const two = checker.check("Two.", "american");
    const three = checker.check("Three.", "british");
    // "Three." took the place of "Two.", which the worker never gets.
    await expect(two).rejects.toThrow("newer");
    expect(pending.map((request) => request.text)).toStrictEqual(["", "One."]);
    pending[1]?.settle(true);
    await expect(one).resolves.toStrictEqual([]);
    await vi.waitFor(() => {
      expect(pending.map((request) => request.text)).toStrictEqual(["", "One.", "Three."]);
    });
    pending[2]?.settle(true);
    await expect(three).resolves.toStrictEqual([]);
    // With nothing to wait for, a text goes to the worker at once.
    const four = checker.check("Four.", "american");
    expect(pending.map((request) => request.text)).toStrictEqual(["", "One.", "Three.", "Four."]);
    pending[3]?.settle(true);
    await expect(four).resolves.toStrictEqual([]);
  });

  it("checks the text that waits after a check that failed", async () => {
    const { check, pending } = fakeCheck();
    const checker = createChecker(fakeUpdates("ready"), () => check);
    pending[0]?.settle(true);
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("ready");
    });
    const one = checker.check("One.", "american");
    const two = checker.check("Two.", "american");
    pending[1]?.settle(false);
    await expect(one).rejects.toThrow("Failed.");
    await vi.waitFor(() => {
      expect(pending.map((request) => request.text)).toStrictEqual(["", "One.", "Two."]);
    });
    pending[2]?.settle(true);
    await expect(two).resolves.toStrictEqual([]);
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
