/**
 * Why a backup could not be made or imported (backup format §6), so that the app can tell the
 * user what happened and what to do:
 *
 * - `too-large`: a file larger than 64 MiB, or a backup that would be;
 * - `not-a-backup`: neither an age file nor a backup document;
 * - `wrong-passphrase`: the passphrase does not decrypt the file; the user can try again;
 * - `damaged`: a damaged or truncated age file, or one whose work factor is above 20;
 * - `other-app`: a backup of another app, whose id `app` names if it is a valid app id;
 * - `newer-version`: made by a newer version of the app, with a newer format or schema version;
 * - `future-clock`: an HLC more than 24 hours ahead of this device's clock;
 * - `invalid`: any other failed check: the backup is damaged or was changed.
 *
 * Messages are for developers and never contain anything from the backup but ids.
 */
export type BackupErrorCode =
  | "too-large"
  | "not-a-backup"
  | "wrong-passphrase"
  | "damaged"
  | "other-app"
  | "newer-version"
  | "future-clock"
  | "invalid";

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  /** For `other-app`: the id of the app whose backup it is, if it is a valid app id. */
  readonly app: string | undefined;

  constructor(
    code: BackupErrorCode,
    message: string,
    options?: ErrorOptions & { readonly app?: string },
  ) {
    super(message, options);
    this.name = "BackupError";
    this.code = code;
    this.app = options?.app;
  }
}
