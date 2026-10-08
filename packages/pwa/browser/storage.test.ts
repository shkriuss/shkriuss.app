import { describe, expect, it, vi } from "vitest";
import { type AppStorage, createAppStorage, type StorageManagerLike } from "./storage.ts";
import { settle } from "./test/fakes.ts";

interface Estimate {
  readonly usage?: number;
  readonly quota?: number;
}

/** `navigator.storage`, with the answers that a test sets. */
class FakeManager implements StorageManagerLike {
  persistedValue = false;
  estimateValue: Estimate = { usage: 1000, quota: 1_000_000 };
  /** What `persist()` answers: whether the browser grants it. */
  grants = true;
  readonly persisted = vi.fn<() => Promise<boolean>>(async () => this.persistedValue);
  readonly estimate = vi.fn<() => Promise<Estimate>>(async () => this.estimateValue);
  readonly persist = vi.fn<() => Promise<boolean>>(async () => {
    this.persistedValue ||= this.grants;
    return this.grants;
  });
}

/** The statuses that `storage` goes through from now on. */
function statuses(storage: AppStorage): unknown[] {
  const seen: unknown[] = [];
  storage.subscribe(() => {
    seen.push(storage.getStatus());
  });
  return seen;
}

describe("the status", () => {
  it("is unknown at first, then what the browser says", async () => {
    const manager = new FakeManager();
    const storage = createAppStorage(manager);
    expect(storage.getStatus()).toStrictEqual({
      persistence: "unknown",
      usage: undefined,
      quota: undefined,
    });
    const seen = statuses(storage);
    await settle();
    expect(seen).toStrictEqual([{ persistence: "best-effort", usage: 1000, quota: 1_000_000 }]);
  });

  it("says persisted when the browser keeps the data until the user deletes it", async () => {
    const manager = new FakeManager();
    manager.persistedValue = true;
    const storage = createAppStorage(manager);
    await settle();
    expect(storage.getStatus().persistence).toBe("persisted");
  });

  it("stays unknown without a Storage API, and asks for nothing", async () => {
    const storage = createAppStorage(undefined);
    const seen = statuses(storage);
    await storage.refresh();
    expect(await storage.requestPersistence()).toBe(false);
    expect(storage.getStatus().persistence).toBe("unknown");
    expect(seen).toStrictEqual([]);
  });

  it("keeps what the browser answered when it fails the other question", async () => {
    const manager = new FakeManager();
    manager.persisted.mockRejectedValueOnce(new DOMException("Not now.", "InvalidStateError"));
    const storage = createAppStorage(manager);
    await settle();
    expect(storage.getStatus()).toStrictEqual({
      persistence: "unknown",
      usage: 1000,
      quota: 1_000_000,
    });

    manager.estimate.mockRejectedValueOnce(new DOMException("Not now.", "InvalidStateError"));
    await storage.refresh();
    expect(storage.getStatus()).toStrictEqual({
      persistence: "best-effort",
      usage: undefined,
      quota: undefined,
    });
  });

  it("leaves out an estimate that the browser does not give", async () => {
    const manager = new FakeManager();
    manager.estimateValue = {};
    const storage = createAppStorage(manager);
    await settle();
    expect(storage.getStatus()).toStrictEqual({
      persistence: "best-effort",
      usage: undefined,
      quota: undefined,
    });
  });
});

describe("refresh()", () => {
  it("follows what the app stores, with a new status object for each change only", async () => {
    const manager = new FakeManager();
    const storage = createAppStorage(manager);
    await settle();
    const first = storage.getStatus();
    const seen = statuses(storage);

    await storage.refresh();
    expect(storage.getStatus()).toBe(first);
    manager.estimateValue = { usage: 5000, quota: 1_000_000 };
    await storage.refresh();
    expect(seen).toStrictEqual([{ persistence: "best-effort", usage: 5000, quota: 1_000_000 }]);
    expect(storage.getStatus()).not.toBe(first);
  });

  it("keeps a later read when an earlier one answers after it", async () => {
    const manager = new FakeManager();
    const storage = createAppStorage(manager);
    await settle();

    const late = Promise.withResolvers<Estimate>();
    manager.estimate.mockImplementationOnce(async () => late.promise);
    const earlier = storage.refresh();
    manager.estimateValue = { usage: 3000, quota: 1_000_000 };
    await storage.refresh();
    late.resolve({ usage: 2000, quota: 1_000_000 });
    await earlier;
    expect(storage.getStatus().usage).toBe(3000);
  });

  it("calls a listener no more after it unsubscribed", async () => {
    const manager = new FakeManager();
    const storage = createAppStorage(manager);
    await settle();
    const listener = vi.fn<() => void>();
    const unsubscribe = storage.subscribe(listener);
    manager.estimateValue = { usage: 2000, quota: 1_000_000 };
    await storage.refresh();
    unsubscribe();
    manager.estimateValue = { usage: 3000, quota: 1_000_000 };
    await storage.refresh();
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("requestPersistence()", () => {
  it("asks the browser, and shows the data as persisted when it agrees", async () => {
    const manager = new FakeManager();
    const storage = createAppStorage(manager);
    await settle();
    expect(await storage.requestPersistence()).toBe(true);
    expect(manager.persist).toHaveBeenCalledOnce();
    expect(storage.getStatus().persistence).toBe("persisted");
  });

  it("resolves to false when the browser or the user says no", async () => {
    const manager = new FakeManager();
    manager.grants = false;
    const storage = createAppStorage(manager);
    await settle();
    expect(await storage.requestPersistence()).toBe(false);
    expect(storage.getStatus().persistence).toBe("best-effort");
  });

  it("resolves to false when the browser fails, and reads the status again", async () => {
    const manager = new FakeManager();
    const storage = createAppStorage(manager);
    await settle();
    manager.persist.mockRejectedValueOnce(new DOMException("Not now.", "InvalidStateError"));
    manager.estimateValue = { usage: 4000, quota: 1_000_000 };
    expect(await storage.requestPersistence()).toBe(false);
    expect(storage.getStatus()).toStrictEqual({
      persistence: "best-effort",
      usage: 4000,
      quota: 1_000_000,
    });
  });
});

describe("requestPersistenceQuietly() (architecture §7)", () => {
  it("asks a browser that asks the user nothing, and shows the data as persisted when it agrees", async () => {
    const manager = new FakeManager();
    const storage = createAppStorage(manager);
    await settle();
    await storage.requestPersistenceQuietly();
    expect(manager.persist).toHaveBeenCalledOnce();
    expect(storage.getStatus().persistence).toBe("persisted");
  });

  it("asks nothing where the browser would ask the user, as Firefox does", async () => {
    const manager = new FakeManager();
    const storage = createAppStorage(manager, { asksUser: true });
    await settle();
    await storage.requestPersistenceQuietly();
    expect(manager.persist).not.toHaveBeenCalled();
    expect(storage.getStatus().persistence).toBe("best-effort");
    // The button in Settings still asks.
    expect(await storage.requestPersistence()).toBe(true);
  });

  it("asks nothing once the browser keeps the data", async () => {
    const manager = new FakeManager();
    manager.persistedValue = true;
    const storage = createAppStorage(manager);
    await storage.requestPersistenceQuietly();
    expect(manager.persist).not.toHaveBeenCalled();
  });

  it("never fails: a no, or a browser that fails, leaves the data as it was", async () => {
    const manager = new FakeManager();
    manager.grants = false;
    const storage = createAppStorage(manager);
    await settle();
    await storage.requestPersistenceQuietly();
    expect(manager.persist).toHaveBeenCalledOnce();
    expect(storage.getStatus().persistence).toBe("best-effort");
    manager.persist.mockRejectedValueOnce(new DOMException("Not now.", "InvalidStateError"));
    await expect(storage.requestPersistenceQuietly()).resolves.toBeUndefined();
    manager.persisted.mockRejectedValueOnce(new DOMException("Not now.", "InvalidStateError"));
    await expect(storage.requestPersistenceQuietly()).resolves.toBeUndefined();
    expect(storage.getStatus().persistence).toBe("best-effort");
  });

  it("does nothing without a Storage API", async () => {
    await expect(createAppStorage(undefined).requestPersistenceQuietly()).resolves.toBeUndefined();
  });
});
