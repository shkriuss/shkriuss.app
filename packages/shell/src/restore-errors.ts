import { BackupError, type BackupErrorCode } from "@shkriuss/backup";
import { m } from "./messages.ts";

/** The message of each error of backup format §6, but `other-app`, which names the app. */
const MESSAGES: Readonly<Record<Exclude<BackupErrorCode, "other-app">, () => string>> = {
  "too-large": m.fileTooLarge,
  "not-a-backup": m.notABackup,
  "wrong-passphrase": m.wrongPassphrase,
  damaged: m.damaged,
  "newer-version": m.newerVersion,
  "future-clock": m.futureClock,
  invalid: m.invalid,
};

/**
 * What the user reads when a backup cannot be restored (backup format §6): what happened, and
 * what to do. Nothing has changed then (§5). A failure that is no `BackupError`, as of the
 * database, says only that the backup was not restored.
 */
export function restoreErrorMessage(error: unknown): string {
  if (!(error instanceof BackupError)) {
    return m.restoreFailed();
  }
  if (error.code === "other-app") {
    return m.otherApp(error.app);
  }
  return MESSAGES[error.code]();
}
