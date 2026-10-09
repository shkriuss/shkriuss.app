/**
 * Why the data layer refused something:
 *
 * - `invalid`: not a valid record, field, value or clock (data model §2, §3, §8);
 * - `too-large`: beyond a limit (data model §2.4);
 * - `future-clock`: an import with HLCs more than 24 hours ahead of this device's clock, which
 *   the user has not confirmed (data model §3.5);
 * - `deleted`: a write to a deleted record (data model §4.2);
 * - `not-found`: a write to a record that the store lacks;
 * - `newer-version`: data from a newer version of the app, which this one cannot read (data
 *   model §5.1, §7);
 * - `closed`: the database is closed, because the app closed it or another tab needed it closed.
 *
 * Messages are for developers. They name fields and members, never their values, because values
 * are user data. The name differs from IndexedDB's `DataError`, which Dexie would wrap in an
 * error of its own.
 */
export type DataLayerErrorCode =
  "invalid" | "too-large" | "future-clock" | "deleted" | "not-found" | "newer-version" | "closed";

export class DataLayerError extends Error {
  readonly code: DataLayerErrorCode;

  constructor(code: DataLayerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DataLayerError";
    this.code = code;
  }
}
