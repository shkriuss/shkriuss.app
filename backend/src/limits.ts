// The numbers of docs/architecture/sync-protocol.md that the server keeps
// to. A change to any of them is a change to that page first.

/** The versions of the server interface this server speaks. */
export const LOWEST_VERSION = 1;
export const HIGHEST_VERSION = 1;

/**
 * What `info` names. The protocol's largest values. The measurement of CPU
 * time on a deployed Worker may lower them ("The free plan", point 8).
 */
export const MOST_RECORDS = 100;
export const MOST_BYTES = 524_288;
export const MOST_FILE_ITEMS = 256;

/** A sealed record is 50 to 524,288 bytes ("Send", result 03). */
export const SEALED_RECORD_MIN = 50;
export const SEALED_RECORD_MAX = 524_288;

/** A device's sealed name is 52 to 211 bytes (`enrol`, `devices/name`). */
export const SEALED_NAME_MIN = 52;
export const SEALED_NAME_MAX = 211;

/** The format's own bound on the records of one batch or page. */
export const FORMAT_MOST_RECORDS = 100;

/** The format's own bound on the items of one file request. */
export const FORMAT_MOST_FILE_ITEMS = 256;

/** The chunks of one `files/send` or `files/fetch` are at most this many bytes together. */
export const CHUNK_BYTES = 4_194_304;

/** A request's time must be within this of the server's clock. */
export const CLOCK_WINDOW_MS = 5 * 60_000;

/** A join statement is good for this long from its time. */
export const STATEMENT_LIFE_MS = 10 * 60_000;

/** A device code: how long it lasts, and how many wrong tries void it. */
export const DEVICE_CODE_LIFE_MS = 10 * 60_000;
export const DEVICE_CODE_TRIES = 5;

/** The letters of both codes: `A` to `Z` without `I` and `O`, and `2` to `9`. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const DEVICE_CODE_LENGTH = 8;
export const SETUP_CODE_LENGTH = 26;

/** A mark "its chunks are being deleted" older than this counts as "deleted". */
export const MARK_STALE_MS = 10 * 60_000;

/** A `files/delete` deletes no chunk later than this after it set its mark. */
export const DELETE_DEADLINE_MS = 5 * 60_000;

/** A batch of a comparison of everything may not pass this many row writes of the day. */
export const COMPARISON_DAY_WRITES = 70_000;

/**
 * Calls to R2 that one request may make. Cloudflare allows 1,000 calls
 * to its own services in one request, D1 included. The server makes at
 * most a few calls to D1, so this leaves room for them.
 */
export const R2_CALLS = 900;

/** The longest body a request may have, by call. Anything longer is `0C`. */
export const MOST_BODY_BYTES = 1_100_000;
export const MOST_FILES_SEND_BODY_BYTES = 2 + 88 * FORMAT_MOST_FILE_ITEMS + CHUNK_BYTES;

/** A day, for the row writes of the day and the day a device was last seen. */
export const DAY_MS = 86_400_000;
