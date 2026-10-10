import type { InstallState, UpdateState } from "@shkriuss/pwa";
import { describe, expect, it, vi } from "vitest";
import {
  type Check,
  type CheckerEnvironment,
  createChecker,
  type RunningCheck,
  Superseded,
  Unanswered,
} from "./checker.ts";

/** A store whose state the test sets, as the service worker's updates and the install are. */
function store<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: T) {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

/**
 * A check whose answers the test gives: it holds each request until then, with the mistakes, a
 * failure, or `fail(error)`, as with an `Unanswered` once the worker's deadline has passed.
 */
function fakeCheck() {
  const pending: {
    readonly text: string;
    readonly settle: (ok: boolean) => void;
    readonly fail: (error: Error) => void;
  }[] = [];
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
        fail: reject,
      });
    });
  return { check, pending };
}

/**
 * The page as the checker sees it: the service worker in `worker`, which controls the page or
 * not, and keeps the module or not, the app installed or not, and the device's coming back
 * online, which `online()` makes.
 */
function page({
  worker = "ready",
  controlled = true,
  kept = false,
  installed = false,
  webAssembly = true,
}: {
  worker?: UpdateState;
  controlled?: boolean;
  kept?: boolean;
  installed?: boolean;
  webAssembly?: boolean;
} = {}) {
  const workerState = store<UpdateState>(worker);
  let inControl = controlled;
  const updates = {
    ...workerState,
    firstUseKept: async () => kept,
    controlled: () => inControl,
    /** The version takes control of the page, which the listeners hear, as of a state. */
    control: () => {
      inControl = true;
      workerState.set(workerState.getState());
    },
  };
  const install = store<InstallState>(installed ? "installed" : "unavailable");
  const { check, pending } = fakeCheck();
  const stop = vi.fn<() => void>(() => {
    // The checks that wait for the worker end with it, as `startWorkerCheck()`'s do.
    for (const request of pending) {
      request.fail(new Error("The checker was stopped."));
    }
  });
  const start = vi.fn<() => RunningCheck>(() => ({ check, stop }));
  let online: (() => void) | undefined;
  const environment: CheckerEnvironment = {
    updates,
    install,
    start,
    onOnline: (listener) => {
      online = listener;
    },
    webAssembly,
  };
  return { environment, updates, install, start, stop, pending, online: () => online?.() };
}

/** Lets the page's answer to whether the module is kept arrive. */
async function settled(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("createChecker", () => {
  it("starts once there is text and the service worker controls the page, and is ready after its first check", async () => {
    const { environment, updates, start, pending } = page({
      worker: "starting",
      controlled: false,
    });
    const checker = createChecker(environment);
    await settled();
    expect(start).not.toHaveBeenCalled();
    await expect(checker.check("Hello.", "american")).rejects.toThrow("not running");
    checker.prepare();
    // The page registers the service worker, which installs the app's first version.
    updates.set("installing");
    expect(start).not.toHaveBeenCalled();
    // The version is active, so the app is ready, but it controls the page only once it has
    // claimed it: the module must come through it, which checks it and keeps it (ADR 0019).
    updates.set("ready");
    expect(start).not.toHaveBeenCalled();
    updates.control();
    expect(start).toHaveBeenCalledOnce();
    updates.set("update-available");
    expect(start).toHaveBeenCalledOnce();
    // The module is not kept yet: it comes from the network, and the service worker keeps it.
    expect(checker.getState()).toBe("downloading");
    expect(pending.map((request) => request.text)).toStrictEqual([""]);
    const states: string[] = [];
    checker.subscribe(() => states.push(checker.getState()));
    pending[0]?.settle(true);
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("ready");
    });
    expect(states).toStrictEqual(["ready"]);
    const result = checker.check("Hello.", "british");
    pending[1]?.settle(true);
    await expect(result).resolves.toStrictEqual([]);
  });

  it("does not start without text, while the module is not kept and the app not installed", async () => {
    const { environment, start } = page();
    const checker = createChecker(environment);
    await settled();
    expect(start).not.toHaveBeenCalled();
    expect(checker.getState()).toBe("starting");
    checker.prepare();
    checker.prepare();
    expect(start).toHaveBeenCalledOnce();
  });

  it("starts as soon as the app opens if the service worker keeps the module, which it does not download", async () => {
    const { environment, start } = page({ kept: true });
    const checker = createChecker(environment);
    await settled();
    expect(start).toHaveBeenCalledOnce();
    expect(checker.getState()).toBe("starting");
  });

  it("starts as soon as the app opens if it runs installed, or once it is installed", async () => {
    const installed = page({ installed: true });
    createChecker(installed.environment);
    expect(installed.start).toHaveBeenCalledOnce();

    const later = page();
    createChecker(later.environment);
    await settled();
    expect(later.start).not.toHaveBeenCalled();
    later.install.set("promptable");
    expect(later.start).not.toHaveBeenCalled();
    later.install.set("installed");
    expect(later.start).toHaveBeenCalledOnce();
  });

  it("starts once the page knows that it has no service worker, which keeps nothing", async () => {
    const { environment, updates, start } = page({ worker: "starting", controlled: false });
    const checker = createChecker(environment);
    checker.prepare();
    await settled();
    expect(start).not.toHaveBeenCalled();
    // The first version fails to install, which leaves the page none to wait for.
    updates.set("installing");
    updates.set("unavailable");
    expect(start).toHaveBeenCalledOnce();
    // The module comes from the network each time, as in a private window: nothing to keep.
    expect(checker.getState()).toBe("starting");
  });

  it("starts at once when the page opened with a version active and none in control, which no version will take", async () => {
    // After a hard reload, the browser loads the page past the service worker: no controller
    // change will ever come, and the module comes from the network, as it would anyway.
    const { environment, start } = page({ worker: "ready", controlled: false });
    const checker = createChecker(environment);
    checker.prepare();
    expect(start).toHaveBeenCalledOnce();

    const withoutWorkers = page({ worker: "unavailable", controlled: false });
    createChecker(withoutWorkers.environment).prepare();
    expect(withoutWorkers.start).toHaveBeenCalledOnce();
  });

  it("checks one text at a time, and of those that come meanwhile, only the latest", async () => {
    const { environment, pending } = page({ kept: true });
    const checker = createChecker(environment);
    await settled();
    pending[0]?.settle(true);
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("ready");
    });
    const one = checker.check("One.", "american");
    const two = checker.check("Two.", "american");
    const three = checker.check("Three.", "british");
    // "Three." took the place of "Two.", which the worker never gets.
    await expect(two).rejects.toBeInstanceOf(Superseded);
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

  it("gives a text that waits, asked for again, the answer it waits for; another variety takes its place", async () => {
    const { environment, pending } = page({ kept: true });
    const checker = createChecker(environment);
    await settled();
    pending[0]?.settle(true);
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("ready");
    });
    const one = checker.check("One.", "american");
    const two = checker.check("Two.", "american");
    // The same text again, as after a change undone within the pause: one check serves both,
    // and neither is a failure.
    const twoAgain = checker.check("Two.", "american");
    pending[1]?.settle(true);
    await expect(one).resolves.toStrictEqual([]);
    await vi.waitFor(() => {
      expect(pending.map((request) => request.text)).toStrictEqual(["", "One.", "Two."]);
    });
    pending[2]?.settle(true);
    await expect(two).resolves.toStrictEqual([]);
    await expect(twoAgain).resolves.toStrictEqual([]);

    // The same text in another variety is another check, which takes the waiting one's place.
    const three = checker.check("Three.", "american");
    const four = checker.check("Four.", "american");
    const fourBritish = checker.check("Four.", "british");
    await expect(four).rejects.toBeInstanceOf(Superseded);
    pending[3]?.settle(true);
    await expect(three).resolves.toStrictEqual([]);
    pending[4]?.settle(true);
    await expect(fourBritish).resolves.toStrictEqual([]);
    expect(pending.map((request) => request.text)).toStrictEqual([
      "",
      "One.",
      "Two.",
      "Three.",
      "Four.",
    ]);
  });

  it("stops once the worker does not answer in time, and checks nothing more until the app reloads", async () => {
    const { environment, pending, start, stop, online } = page({ kept: true });
    const checker = createChecker(environment);
    await settled();
    pending[0]?.settle(true);
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("ready");
    });
    const states: string[] = [];
    checker.subscribe(() => states.push(checker.getState()));
    const one = checker.check("One.", "american");
    const two = checker.check("Two.", "american");
    // The worker gave no answer by its deadline, as one that the browser has ended: it is dead.
    pending[1]?.fail(new Unanswered());
    await expect(one).rejects.toBeInstanceOf(Unanswered);
    expect(stop).toHaveBeenCalledOnce();
    expect(checker.getState()).toBe("stopped");
    expect(states).toStrictEqual(["stopped"]);
    // The text that waited ended with the worker, and no later text is checked.
    await expect(two).rejects.toThrow("stopped");
    await expect(checker.check("Three.", "american")).rejects.toThrow("not running");
    // Only reloading the app starts it again.
    checker.prepare();
    online();
    expect(start).toHaveBeenCalledOnce();
  });

  it("fails when its first check has no answer in time, as when the browser ended the worker as it compiled the module", async () => {
    const { environment, pending, stop } = page({ kept: true });
    const checker = createChecker(environment);
    await settled();
    pending[0]?.fail(new Unanswered());
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("failed");
    });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("checks the text that waits after a check that failed", async () => {
    const { environment, pending } = page({ kept: true });
    const checker = createChecker(environment);
    await settled();
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

  it("fails when it cannot start from the module it keeps, and then checks nothing", async () => {
    const { environment, pending, online, start } = page({ kept: true });
    const checker = createChecker(environment);
    await settled();
    pending[0]?.settle(false);
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("failed");
    });
    await expect(checker.check("Hello.", "american")).rejects.toThrow("not running");
    online();
    expect(start).toHaveBeenCalledOnce();

    const withoutWorkers = page({ kept: true });
    withoutWorkers.start.mockImplementation(() => {
      throw new Error("No workers.");
    });
    const broken = createChecker(withoutWorkers.environment);
    await settled();
    expect(broken.getState()).toBe("failed");
  });

  it("fails at once in a browser without WebAssembly, without starting", async () => {
    const { environment, start } = page({ kept: true, installed: true, webAssembly: false });
    const checker = createChecker(environment);
    checker.prepare();
    await settled();
    expect(start).not.toHaveBeenCalled();
    expect(checker.getState()).toBe("failed");
  });

  it("says when it could not download its module, and tries again once the device is back online", async () => {
    const { environment, updates, start, stop, pending, online } = page();
    const checker = createChecker(environment);
    await settled();
    checker.prepare();
    pending[0]?.settle(false);
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("offline");
    });
    expect(stop).toHaveBeenCalledOnce();
    await expect(checker.check("Hello.", "american")).rejects.toThrow("not running");
    // Only coming back online tries again.
    updates.set("update-available");
    checker.prepare();
    expect(start).toHaveBeenCalledOnce();
    online();
    expect(start).toHaveBeenCalledTimes(2);
    expect(checker.getState()).toBe("downloading");
    pending[1]?.settle(true);
    await vi.waitFor(() => {
      expect(checker.getState()).toBe("ready");
    });
  });
});
