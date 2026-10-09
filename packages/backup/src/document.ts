import {
  DataLayerError,
  type DataLayerErrorCode,
  type Incoming,
  type Schemas,
  type Snapshot,
  checkIncomingStores,
  toJson,
} from "@shkriuss/data";
import { isAppId } from "@shkriuss/edge/domains";
import { BackupError, type BackupErrorCode } from "./errors.ts";

/** The `format` of every backup document (backup format §2). */
export const BACKUP_FORMAT = "shkriuss-backup";

/** The format version that this code writes, and the newest it reads (backup format §8). */
export const FORMAT_VERSION = 1;

/** The largest backup file that imports accept, and so the largest that exports make (§5.1). */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

const MEMBERS = ["format", "formatVersion", "app", "schemaVersion", "exported", "stores"];

/** How `Date.prototype.toISOString` writes a time, which is how `exported` is written. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The backup document of `snapshot` for the app `app`, made at `exported` (backup format §2), as
 * UTF-8 bytes. It is indented with two spaces, so that a decrypted backup is readable. Throws a
 * `BackupError` `too-large` if it is larger than imports accept: every backup must import.
 */
export function writeBackup(
  app: string,
  snapshot: Snapshot,
  exported: Date,
): Uint8Array<ArrayBuffer> {
  if (!isAppId(app)) {
    throw new TypeError(`"${app}" is not an app id.`);
  }
  const stores = Object.fromEntries(
    Object.entries(snapshot.stores).map(([store, records]) => [store, records.map(toJson)]),
  );
  const document = {
    format: BACKUP_FORMAT,
    formatVersion: FORMAT_VERSION,
    app,
    schemaVersion: snapshot.schemaVersion,
    exported: exported.toISOString(),
    stores,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(document, undefined, 2));
  if (bytes.length > MAX_BACKUP_BYTES) {
    throw new BackupError("too-large", `The backup would have ${bytes.length} bytes.`);
  }
  return bytes;
}

/** A backup document, read and checked. */
export interface BackupContents {
  /** When the backup was made. */
  readonly exported: Date;
  /** The app's schema version when the backup was made. */
  readonly schemaVersion: number;
  /** Its records, checked and migrated to the current schema version, ready to import. */
  readonly incoming: Incoming;
}

export interface ReadOptions {
  /** The id of the app that imports the backup. */
  readonly app: string;
  /** Every version of the app's data schema. */
  readonly schemas: Schemas;
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function invalid(message: string, cause?: unknown): BackupError {
  return new BackupError("invalid", message, { cause });
}

/**
 * What the data layer's refusal of a record means for the import as a whole (§6). Reading never
 * refuses clocks from the future: the import does, unless the user confirmed them (data model
 * §3.5).
 */
const FROM_DATA: Readonly<Record<DataLayerErrorCode, BackupErrorCode>> = {
  "future-clock": "invalid",
  "newer-version": "newer-version",
  invalid: "invalid",
  "too-large": "invalid",
  deleted: "invalid",
  "not-found": "invalid",
  closed: "invalid",
  "storage-full": "invalid",
};

// Invalid UTF-8 is refused. A byte order mark stays in the text, where JSON refuses it.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Reads a backup document (backup format §5.3) and checks it (§5.4) for the app `app`, then
 * checks and migrates its records (§5.5). Throws a `BackupError` (§6): `not-a-backup` for
 * anything that is not a backup document, `other-app`, `newer-version`, `too-large` above 64 MiB,
 * or `invalid` for any other failed check. Clocks from the future pass: the preview shows them
 * (data model §3.5).
 *
 * A newer format version is refused before anything else is checked, because a newer format
 * may differ in every other way.
 */
export function readBackup(bytes: Uint8Array, { app, schemas }: ReadOptions): BackupContents {
  if (bytes.length > MAX_BACKUP_BYTES) {
    throw new BackupError("too-large", `The file has ${bytes.length} bytes.`);
  }
  let document: unknown;
  try {
    document = JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new BackupError("not-a-backup", "The file is not JSON in UTF-8.", { cause: error });
  }
  if (!isObject(document) || document["format"] !== BACKUP_FORMAT) {
    throw new BackupError("not-a-backup", "The file is not a backup document.");
  }
  const { formatVersion } = document;
  if (!isVersion(formatVersion)) {
    throw invalid("The backup's format version is not an integer from 1.");
  }
  if (formatVersion > FORMAT_VERSION) {
    throw new BackupError(
      "newer-version",
      `The backup has format version ${formatVersion}, newer than ${FORMAT_VERSION}.`,
    );
  }
  // Each member is checked below, so with as many members as expected there is no other.
  if (Object.keys(document).length !== MEMBERS.length) {
    throw invalid(`A backup document has the members ${MEMBERS.join(", ")} and no others.`);
  }
  const { app: owner, schemaVersion, exported, stores } = document;
  if (typeof owner !== "string" || !isAppId(owner)) {
    throw invalid("The backup's app is not an app id.");
  }
  if (owner !== app) {
    throw new BackupError("other-app", `The backup is of the app ${owner}.`, { app: owner });
  }
  // A newer schema version is refused with the stores, as `newer-version`.
  if (!isVersion(schemaVersion)) {
    throw invalid("The backup's schema version is not an integer from 1.");
  }
  const time = typeof exported === "string" && ISO_TIME.test(exported) ? new Date(exported) : null;
  // A time that does not exist, such as February 30, is written differently once parsed.
  if (time === null || Number.isNaN(time.getTime()) || time.toISOString() !== exported) {
    throw invalid("The backup's time of export is not a UTC time as toISOString() writes it.");
  }
  try {
    return {
      exported: time,
      schemaVersion,
      incoming: checkIncomingStores(schemas, schemaVersion, stores),
    };
  } catch (error) {
    if (error instanceof DataLayerError) {
      throw new BackupError(FROM_DATA[error.code], error.message, { cause: error });
    }
    throw error;
  }
}
