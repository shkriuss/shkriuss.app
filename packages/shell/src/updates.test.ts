import type { AppUpdates, UpdateState } from "@shkriuss/pwa";
import { describe, expect, it, vi } from "vitest";
import { appUpdates } from "./updates.ts";

/** The service worker's updates, in the state that the test sets. */
function serviceWorker(initial: UpdateState): AppUpdates & { set(state: UpdateState): void } {
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
    applyUpdate: vi.fn<() => void>(),
    checkForUpdate: vi.fn<() => Promise<void>>(async () => undefined),
    firstUseKept: vi.fn<() => Promise<boolean>>(async () => true),
    controlled: vi.fn<() => boolean>(() => true),
    set(next) {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe("appUpdates", () => {
  it("is the service worker's while the database is open", async () => {
    const worker = serviceWorker("ready");
    const updates = appUpdates(worker);
    const listener = vi.fn<() => void>();
    updates.subscribe(listener);
    worker.set("update-available");
    expect(updates.getState()).toBe("update-available");
    expect(listener).toHaveBeenCalledOnce();
    updates.applyUpdate();
    expect(worker.applyUpdate).toHaveBeenCalledOnce();
    void updates.checkForUpdate();
    expect(worker.checkForUpdate).toHaveBeenCalledOnce();
    expect(await updates.firstUseKept()).toBe(true);
    expect(updates.controlled()).toBe(true);
    expect(worker.controlled).toHaveBeenCalledOnce();
  });

  it("is outdated once a newer version closed the database, and reloads the page", () => {
    const reload = vi.fn<() => void>();
    const worker = serviceWorker("ready");
    const updates = appUpdates(worker, reload);
    const listener = vi.fn<() => void>();
    updates.subscribe(listener);
    updates.databaseClosed();
    expect(updates.getState()).toBe("outdated");
    expect(listener).toHaveBeenCalledOnce();
    // Told once.
    updates.databaseClosed();
    expect(listener).toHaveBeenCalledOnce();
    updates.applyUpdate();
    expect(reload).toHaveBeenCalledOnce();
    expect(worker.applyUpdate).not.toHaveBeenCalled();
  });

  it("makes a waiting version active, which is the newer one, rather than reloading as it is", () => {
    const reload = vi.fn<() => void>();
    const worker = serviceWorker("update-available");
    const updates = appUpdates(worker, reload);
    updates.databaseClosed();
    expect(updates.getState()).toBe("outdated");
    updates.applyUpdate();
    expect(worker.applyUpdate).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("stays updating while the page reloads into the new version", () => {
    const worker = serviceWorker("update-available");
    const updates = appUpdates(worker);
    updates.databaseClosed();
    worker.set("updating");
    expect(updates.getState()).toBe("updating");
  });

  it("reloads the page itself, unless told how", () => {
    const reload = vi.fn<() => void>();
    vi.stubGlobal("location", { reload });
    try {
      const updates = appUpdates(serviceWorker("ready"));
      updates.databaseClosed();
      updates.applyUpdate();
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops telling a listener that unsubscribed, about either", () => {
    const worker = serviceWorker("ready");
    const updates = appUpdates(worker);
    const listener = vi.fn<() => void>();
    const unsubscribe = updates.subscribe(listener);
    unsubscribe();
    worker.set("update-available");
    updates.databaseClosed();
    expect(listener).not.toHaveBeenCalled();
  });
});
