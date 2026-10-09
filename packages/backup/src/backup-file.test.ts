import { describe, expect, it, vi } from "vitest";
import type * as Age from "./age.ts";
import { encrypt } from "./age.ts";
import { createBackupFile, readBackupFile } from "./backup-file.ts";
import { MAX_BACKUP_BYTES, type ReadOptions, writeBackup } from "./document.ts";
import { openBackupFile } from "./files.ts";
import {
  APP,
  EXAMPLE_PASSPHRASE,
  SCHEMAS,
  encryptedExample,
  openTestDatabase,
} from "./test/fixtures.ts";
import { started } from "./test/worker.ts";

vi.mock("@shkriuss/edge/workers", () => import("./test/worker.ts"));
vi.mock("./age.ts", async (importOriginal) => {
  const age = await importOriginal<typeof Age>();
  // A low work factor keeps the tests fast; age.test.ts checks the one of new backups.
  return {
    ...age,
    encrypt: vi.fn<typeof age.encrypt>((document, passphrase) =>
      age.encrypt(document, passphrase, 10),
    ),
  };
});

/** Noon in UTC, which is the same date in nearly every time zone. */
const MADE = new Date("2026-10-05T12:00:00.000Z");
const OPTIONS: ReadOptions = { app: APP, schemas: SCHEMAS };

/** A database with a few changes: a deleted note, a note and a setting. */
async function withNotes(): ReturnType<typeof openTestDatabase> {
  const db = await openTestDatabase();
  await db.change(async (change) => {
    const id = await change.create("notes", { title: "Milk" });
    await change.create("notes", { title: "Eggs", done: true });
    await change.delete("notes", id);
    await change.updateSettings({ sortBy: "date" });
  });
  return db;
}

async function bytesOf(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

describe("createBackupFile and readBackupFile (backup format §4, §5.1–§5.5)", () => {
  it("make an encrypted backup, which another device imports", async () => {
    const first = await withNotes();
    const { file, fromFuture } = await createBackupFile(first, {
      app: APP,
      passphrase: EXAMPLE_PASSPHRASE,
      made: MADE,
    });
    expect(fromFuture).toBeUndefined();
    expect(file.name).toBe("shkriuss-notes-2026-10-05.age");
    expect(file.type).toBe("application/octet-stream");
    const opened = await openBackupFile(file);
    expect(opened.encrypted).toBe(true);
    const contents = await readBackupFile(opened, EXAMPLE_PASSPHRASE, OPTIONS);
    expect(contents.exported).toStrictEqual(MADE);
    const second = await openTestDatabase();
    expect((await second.import(contents.incoming)).total).toStrictEqual({
      new: 2,
      updated: 0,
      deleted: 0,
      unchanged: 1,
    });
    expect((await second.snapshot()).stores).toStrictEqual((await first.snapshot()).stores);
  });

  it("make a plain backup without a passphrase, and without a worker", async () => {
    const db = await withNotes();
    const before = started.length;
    const { file } = await createBackupFile(db, { app: APP, passphrase: null, made: MADE });
    expect(file.name).toBe("shkriuss-notes-2026-10-05.json");
    expect(file.type).toBe("application/json");
    expect(await bytesOf(file)).toStrictEqual(writeBackup(APP, await db.snapshot(), MADE));
    const opened = await openBackupFile(file);
    expect(opened.encrypted).toBe(false);
    expect((await readBackupFile(opened, null, OPTIONS)).exported).toStrictEqual(MADE);
    expect(started.length).toBe(before);
  });

  it("let the user try again after a wrong passphrase", async () => {
    const db = await withNotes();
    const opened = await openBackupFile(
      (await createBackupFile(db, { app: APP, passphrase: EXAMPLE_PASSPHRASE, made: MADE })).file,
    );
    await expect(readBackupFile(opened, "a wrong passphrase", OPTIONS)).rejects.toThrow(
      expect.objectContaining({ name: "BackupError", code: "wrong-passphrase" }),
    );
    expect((await readBackupFile(opened, EXAMPLE_PASSPHRASE, OPTIONS)).exported).toStrictEqual(
      MADE,
    );
  });

  it("need the passphrase of an encrypted file", async () => {
    const opened = await openBackupFile(new Blob([Uint8Array.from(encryptedExample("binary"))]));
    await expect(readBackupFile(opened, null, OPTIONS)).rejects.toThrow(TypeError);
  });

  it("refuse a passphrase shorter than 12 characters", async () => {
    const db = await withNotes();
    await expect(
      createBackupFile(db, { app: APP, passphrase: "eleven char", made: MADE }),
    ).rejects.toThrow(TypeError);
    const { file } = await createBackupFile(db, {
      app: APP,
      passphrase: "twelve chars",
      made: MADE,
    });
    expect(file.name).toBe("shkriuss-notes-2026-10-05.age");
  });

  it("refuse a backup that would be too large once encrypted: every backup must import", async () => {
    // Encryption adds 16 bytes to every 64 KiB, so a document just under 64 MiB grows over it.
    const db = await withNotes();
    vi.mocked(encrypt).mockResolvedValueOnce(new Uint8Array(MAX_BACKUP_BYTES + 1));
    await expect(
      createBackupFile(db, { app: APP, passphrase: EXAMPLE_PASSPHRASE }),
    ).rejects.toThrow(expect.objectContaining({ name: "BackupError", code: "too-large" }));
    vi.mocked(encrypt).mockResolvedValueOnce(new Uint8Array(MAX_BACKUP_BYTES));
    expect(
      (await createBackupFile(db, { app: APP, passphrase: EXAMPLE_PASSPHRASE })).file.size,
    ).toBe(MAX_BACKUP_BYTES);
  });

  it("say when the backup has clocks from the future, which restoring it asks to confirm", async () => {
    const day = 24 * 60 * 60 * 1000;
    let now = MADE.getTime() + 2 * day;
    const db = await openTestDatabase(() => now);
    await db.change(async (change) => {
      await change.create("notes", { title: "Milk" });
    });
    // The device's date was two days ahead, and is right again (data model §3.5).
    now = MADE.getTime();
    for (const passphrase of [null, EXAMPLE_PASSPHRASE]) {
      expect((await createBackupFile(db, { app: APP, passphrase, made: MADE })).fromFuture).toBe(
        MADE.getTime() + 2 * day,
      );
    }
    now = MADE.getTime() + day;
    expect(
      (await createBackupFile(db, { app: APP, passphrase: null, made: MADE })).fromFuture,
    ).toBeUndefined();
  });
});
