import type { BackupErrorCode } from "./errors.ts";

/** What the page asks the backup worker, with a port for the answer. */
export interface AgeRequest {
  readonly operation: "encrypt" | "decrypt";
  readonly bytes: Uint8Array;
  readonly passphrase: string;
}

/** The worker's answer: the bytes, or why it failed; `code` is `null` for an unexpected error. */
export type AgeResponse =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly code: BackupErrorCode | null; readonly message: string };

const CODES: readonly BackupErrorCode[] = [
  "too-large",
  "not-a-backup",
  "wrong-passphrase",
  "damaged",
  "other-app",
  "newer-version",
  "future-clock",
  "invalid",
];

function isCode(value: unknown): value is BackupErrorCode {
  return CODES.some((code) => code === value);
}

export function isAgeRequest(value: unknown): value is AgeRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "operation" in value &&
    (value.operation === "encrypt" || value.operation === "decrypt") &&
    "bytes" in value &&
    value.bytes instanceof Uint8Array &&
    "passphrase" in value &&
    typeof value.passphrase === "string"
  );
}

export function isAgeResponse(value: unknown): value is AgeResponse {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }
  if (value.ok === true) {
    return (
      "bytes" in value &&
      value.bytes instanceof Uint8Array &&
      value.bytes.buffer instanceof ArrayBuffer
    );
  }
  return (
    value.ok === false &&
    "code" in value &&
    (value.code === null || isCode(value.code)) &&
    "message" in value &&
    typeof value.message === "string"
  );
}
