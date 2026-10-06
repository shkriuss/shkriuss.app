import type { DeviceState } from "@shkriuss/data";
import { describe, expect, it, vi } from "vitest";
import {
  type BackupStatusStore,
  backupStatusOf,
  createBackupStatus,
  type DeviceReader,
} from "./backup-status.ts";

const STATE: DeviceState = {
  device: "0123456789abcdef",
  lastBackup: Date.UTC(2026, 9, 1),
  changesSinceBackup: 3,
};

/** A database whose answers the test gives, one read at a time. */
function fakeDatabase(): {
  db: DeviceReader;
  answers: PromiseWithResolvers<DeviceState>[];
} {
  const answers: PromiseWithResolvers<DeviceState>[] = [];
  return {
    answers,
    db: {
      device: async () => {
        const answer = Promise.withResolvers<DeviceState>();
        answers.push(answer);
        return answer.promise;
      },
    },
  };
}

/** Lets every promise that can settle do so. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** The statuses that `store` goes through from now on. */
function statuses(store: BackupStatusStore): unknown[] {
  const seen: unknown[] = [];
  store.subscribe(() => {
    seen.push(store.getStatus());
  });
  return seen;
}

describe("createBackupStatus", () => {
  it("reads nothing until it is asked to", () => {
    const device = vi.fn<() => Promise<DeviceState>>(async () => STATE);
    const store = createBackupStatus({ device });
    expect(store.getStatus()).toBeUndefined();
    expect(device).not.toHaveBeenCalled();
  });

  it("holds what the database says, and when it said it", async () => {
    const store = createBackupStatus({ device: async () => STATE }, () => 1000);
    const seen = statuses(store);
    await store.refresh();
    expect(store.getStatus()).toStrictEqual({ device: STATE, at: 1000 });
    expect(seen).toStrictEqual([{ device: STATE, at: 1000 }]);
  });

  it("keeps the same status until the next read, as useSyncExternalStore needs", async () => {
    const store = createBackupStatus({ device: async () => STATE });
    await store.refresh();
    const status = store.getStatus();
    expect(store.getStatus()).toBe(status);
    await store.refresh();
    expect(store.getStatus()).not.toBe(status);
  });

  it("follows the database from read to read", async () => {
    let state = STATE;
    let now = 1000;
    const store = createBackupStatus({ device: async () => state }, () => now);
    const seen = statuses(store);
    await store.refresh();
    state = { ...STATE, lastBackup: Date.UTC(2026, 9, 6), changesSinceBackup: 0 };
    now = 2000;
    await store.refresh();
    expect(seen).toStrictEqual([
      { device: STATE, at: 1000 },
      { device: state, at: 2000 },
    ]);
  });

  it("leaves out what the database cannot say", async () => {
    const store = createBackupStatus(
      {
        device: async () => {
          throw new Error("The database is closed.");
        },
      },
      () => 1000,
    );
    await store.refresh();
    expect(store.getStatus()).toStrictEqual({ device: undefined, at: 1000 });
  });

  it("ignores a read that answers after a later one", async () => {
    const { db, answers } = fakeDatabase();
    const store = createBackupStatus(db, () => 1000);
    const seen = statuses(store);
    const first = store.refresh();
    const second = store.refresh();
    const later = { ...STATE, changesSinceBackup: 4 };
    answers[1]?.resolve(later);
    await second;
    answers[0]?.resolve(STATE);
    await first;
    expect(store.getStatus()).toStrictEqual({ device: later, at: 1000 });
    expect(seen).toHaveLength(1);
  });

  it("resolves an overtaken read only once the latest one has answered", async () => {
    const { db, answers } = fakeDatabase();
    const store = createBackupStatus(db, () => 1000);
    const first = store.refresh();
    const second = store.refresh();
    let firstDone = false;
    void (async () => {
      await first;
      firstDone = true;
    })();
    // The first read answers, but a later one is on its way: the first call still waits.
    answers[0]?.resolve(STATE);
    await settle();
    expect(firstDone).toBe(false);
    expect(store.getStatus()).toBeUndefined();
    // A third read starts meanwhile: the first call waits for it too.
    const third = store.refresh();
    answers[1]?.resolve(STATE);
    await settle();
    expect(firstDone).toBe(false);
    const latest = { ...STATE, changesSinceBackup: 9 };
    answers[2]?.resolve(latest);
    await Promise.all([first, second, third]);
    expect(firstDone).toBe(true);
    expect(store.getStatus()).toStrictEqual({ device: latest, at: 1000 });
  });

  it("stops telling a listener that unsubscribed", async () => {
    const store = createBackupStatus({ device: async () => STATE });
    const listener = vi.fn<() => void>();
    const unsubscribe = store.subscribe(listener);
    await store.refresh();
    unsubscribe();
    await store.refresh();
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("backupStatusOf", () => {
  it("gives every part of the shell the same store for a database, and another for another", () => {
    const db: DeviceReader = { device: async () => STATE };
    const other: DeviceReader = { device: async () => STATE };
    expect(backupStatusOf(db)).toBe(backupStatusOf(db));
    expect(backupStatusOf(other)).not.toBe(backupStatusOf(db));
  });

  it("tells every part about a read that one of them asked for", async () => {
    const db: DeviceReader = { device: async () => STATE };
    const listener = vi.fn<() => void>();
    backupStatusOf(db).subscribe(listener);
    await backupStatusOf(db).refresh();
    expect(listener).toHaveBeenCalledOnce();
    expect(backupStatusOf(db).getStatus()?.device).toStrictEqual(STATE);
  });
});
