/**
 * Why the data layer refused something:
 *
 * - `invalid`: not a valid record, field, value or clock (data model §2, §3, §8);
 * - `too-large`: beyond a limit (data model §2.4);
 * - `future-clock`: an HLC more than 24 hours ahead of this device's clock (data model §3.5);
 * - `deleted`: a write to a deleted record (data model §4.2).
 *
 * Messages are for developers. They name fields and members, never their values, because values
 * are user data.
 */
export type DataErrorCode = "invalid" | "too-large" | "future-clock" | "deleted";

export class DataError extends Error {
  readonly code: DataErrorCode;

  constructor(code: DataErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DataError";
    this.code = code;
  }
}
