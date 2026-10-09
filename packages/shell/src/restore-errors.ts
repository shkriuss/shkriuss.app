import { BackupError, type BackupErrorCode } from "@shkriuss/backup";
import { DataLayerError, isStorageFull } from "@shkriuss/data";
import { m } from "./messages.ts";

/** The message of each error of backup format §6, but `other-app`, which names the app. */
const MESSAGES: Readonly<Record<Exclude<BackupErrorCode, "other-app">, () => string>> = {
  "too-large": m.fileTooLarge,
  "not-a-backup": m.notABackup,
  "wrong-passphrase": m.wrongPassphrase,
  damaged: m.damaged,
  "newer-version": m.newerVersion,
  invalid: m.invalid,
};

/**
 * What the user reads when a backup cannot be restored (backup format §6): what happened, and
 * what to do. Nothing has changed then (§5). The database's refusal of dates from the future
 * that the user did not confirm, as when this device's date changed after the preview, says so
 * (§5.7), and so does a device without space left for the data; any other failure that is no
 * `BackupError` says only that the backup was not restored.
 */
export function restoreErrorMessage(error: unknown): string {
  if (error instanceof DataLayerError && error.code === "future-clock") {
    return m.futureClock();
  }
  if (isStorageFull(error)) {
    return m.storageFull();
  }
  if (!(error instanceof BackupError)) {
    return m.restoreFailed();
  }
  if (error.code === "other-app") {
    return m.otherApp(error.app);
  }
  return MESSAGES[error.code]();
}
