import { MAX_BACKUP_BYTES } from "./document.ts";
import { BackupError } from "./errors.ts";

/** How a file offered for import is encoded (backup format §5.2). */
export type BackupKind = "age" | "armored-age" | "plain";

const encoder = new TextEncoder();
const AGE = encoder.encode("age-encryption.org/v1\n");
const ARMORED_AGE = encoder.encode("-----BEGIN AGE ENCRYPTED FILE-----");

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * How a file is encoded, by its content and never by its name or media type (backup format §1,
 * §5.2): an age file, an ASCII-armored age file, or, for anything else, a plain backup document,
 * which reading then checks.
 */
export function kindOf(bytes: Uint8Array): BackupKind {
  if (startsWith(bytes, AGE)) {
    return "age";
  }
  if (startsWith(bytes, ARMORED_AGE)) {
    return "armored-age";
  }
  return "plain";
}

/** The media types of encrypted and plain backup files (backup format §1). */
export const MEDIA_TYPES = { encrypted: "application/octet-stream", plain: "application/json" };

function pad(value: number, length: number): string {
  return value.toString().padStart(length, "0");
}

/**
 * The name of a backup file of the app `app` (backup format §1): `shkriuss-<app>-<date>.age`, or
 * `.json` if it is plain, where the date is the device's local date when the backup was made.
 */
export function backupFileName(app: string, made: Date, encrypted: boolean): string {
  const date = `${pad(made.getFullYear(), 4)}-${pad(made.getMonth() + 1, 2)}-${pad(made.getDate(), 2)}`;
  return `shkriuss-${app}-${date}.${encrypted ? "age" : "json"}`;
}

/** A file offered for import, read: its bytes, and whether it is encrypted (§5.2). */
export interface OpenedFile {
  readonly encrypted: boolean;
  readonly bytes: Uint8Array;
}

/**
 * Reads a file offered for import (backup format §5.1, §5.2), and refuses one larger than 64 MiB
 * with a `BackupError` `too-large` before reading any of it.
 */
export async function openBackupFile(file: Blob): Promise<OpenedFile> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new BackupError("too-large", `The file has ${file.size} bytes.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { encrypted: kindOf(bytes) !== "plain", bytes };
}
