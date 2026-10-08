import type { Snapshot } from "@shkriuss/data";
import { decryptBackup, encryptBackup } from "./crypto.ts";
import {
  MAX_BACKUP_BYTES,
  type BackupContents,
  type ReadOptions,
  readBackup,
  writeBackup,
} from "./document.ts";
import { BackupError } from "./errors.ts";
import { MEDIA_TYPES, type OpenedFile, backupFileName } from "./files.ts";
import { isLongEnough } from "./passphrase.ts";

/** A backup file that `createBackupFile()` made. */
export interface BackupFile {
  readonly file: File;
  /**
   * The wall time of the backup's greatest HLC, in milliseconds since 1970, if that lies more
   * than 24 hours after this device's clock (data model §3.5): restoring the backup will ask the
   * user to confirm it. `undefined` otherwise.
   */
  readonly fromFuture: number | undefined;
  /**
   * How many changes the device had counted at the snapshot, for the database's
   * `recordBackup()` once the app has handed the file over (data model §7).
   */
  readonly counted: number;
}

export interface BackupFileOptions {
  /** The id of the app whose data it is. */
  readonly app: string;
  /**
   * The passphrase to encrypt it with: a generated one, or one of at least 12 characters that
   * the user typed twice (§3.1). `null` makes a plain backup, which the app offers only after
   * the user confirms a warning that anyone who gets the file can read all of it (§4).
   */
  readonly passphrase: string | null;
  /** When the backup is made: now, unless a test says otherwise. */
  readonly made?: Date;
  /** Stops making it, and the worker that encrypts it, as when the user closes the dialog. */
  readonly signal?: AbortSignal;
}

export interface ReadFileOptions extends ReadOptions {
  /** Stops reading it, and the worker that decrypts it, as when the user closes the dialog. */
  readonly signal?: AbortSignal;
}

/**
 * A backup file of the database's data (backup format §4): the document of a snapshot, encrypted
 * with the passphrase in a worker unless it is plain, and named and typed as §1 says, with
 * whether it has clocks from the future (data model §3.5). Throws a `BackupError` `too-large` for
 * a backup larger than imports accept, and a TypeError for a passphrase shorter than 12
 * characters. Once the app has handed the file over, it records the backup with the database's
 * `recordBackup(counted)`.
 */
export async function createBackupFile(
  db: { snapshot(): Promise<Snapshot> },
  { app, passphrase, made = new Date(), signal }: BackupFileOptions,
): Promise<BackupFile> {
  if (passphrase !== null && !isLongEnough(passphrase)) {
    throw new TypeError("A passphrase has at least 12 characters.");
  }
  const snapshot = await db.snapshot();
  const document = writeBackup(app, snapshot, made);
  if (passphrase === null) {
    const file = new File([document], backupFileName(app, made, false), {
      type: MEDIA_TYPES.plain,
    });
    return { file, fromFuture: snapshot.fromFuture, counted: snapshot.counted };
  }
  const bytes = await encryptBackup(document, passphrase, signal);
  // Encryption adds 16 bytes to every 64 KiB, and a header.
  if (bytes.length > MAX_BACKUP_BYTES) {
    throw new BackupError("too-large", `The backup would have ${bytes.length} bytes.`);
  }
  const file = new File([bytes], backupFileName(app, made, true), {
    type: MEDIA_TYPES.encrypted,
  });
  return { file, fromFuture: snapshot.fromFuture, counted: snapshot.counted };
}

/**
 * The checked contents of a file that `openBackupFile()` read (backup format §5.2–§5.5),
 * decrypted first with `passphrase` if it is encrypted. Throws a `BackupError`, such as
 * `wrong-passphrase`, after which the user can try again with the same opened file, and a
 * TypeError if the file is encrypted and `passphrase` is `null`.
 */
export async function readBackupFile(
  file: OpenedFile,
  passphrase: string | null,
  options: ReadFileOptions,
): Promise<BackupContents> {
  if (!file.encrypted) {
    return readBackup(file.bytes, options);
  }
  if (passphrase === null) {
    throw new TypeError("The file is encrypted: ask for its passphrase.");
  }
  return readBackup(await decryptBackup(file.bytes, passphrase, options.signal), options);
}
