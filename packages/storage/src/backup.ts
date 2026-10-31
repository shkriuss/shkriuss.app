/**
 * Backup files: everything an app has saved, in one file, usually locked with
 * a passphrase. Locking and unlocking happen on the device with the browser's
 * built-in Web Crypto, so the passphrase and the data never leave it.
 *
 * How a file is locked (see docs/adr/0008-encrypted-backups.md):
 * - PBKDF2 with SHA-256 and 600,000 rounds turns the passphrase into a key.
 *   The rounds make guessing passphrases slow.
 * - AES-256-GCM encrypts the data with that key. The file's header (app,
 *   date, settings) is checked too, so changing any of it makes unlocking fail.
 */
import {
  getLocalStorage,
  KEY_PREFIX,
  madeStores,
  ownKeys,
  type ExportFile,
  type StorageLike,
  type Store,
} from './index.ts';
import { nestedTooDeep } from './nesting.ts';
import { MIN_PASSPHRASE_LENGTH, passphraseProblem } from './passphrase.ts';

export { MIN_PASSPHRASE_LENGTH, passphraseProblem };

export const BACKUP_FORMAT = 'shkriuss-backup';
export const BACKUP_VERSION = 1;
/** How many PBKDF2 rounds new backups use (OWASP's advice for PBKDF2-SHA-256). */
export const PBKDF2_ITERATIONS = 600_000;
// Files asking for fewer rounds are refused (too weak), and more (too slow to open).
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;
/** The sizes locked files use; a file with others isn't one of ours (audit 5 E-6, A-4). */
const SALT_BYTES = 16;
const IV_BYTES = 12;
/** AES-GCM's check value at the end of the encrypted data: even empty data has it. */
const TAG_BYTES = 16;

export interface EncryptedBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** Which app made it, e.g. "calendar". */
  app: string;
  createdAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  /** The app's ExportFile as JSON, encrypted, in base64. */
  data: string;
}

/** A backup file as read from disk: locked, or a plain copy. */
export type BackupFile =
  { kind: 'encrypted'; backup: EncryptedBackup } | { kind: 'plain'; file: ExportFile };

export type BackupErrorCode =
  | 'not-a-backup'
  | 'wrong-app'
  | 'wrong-passphrase'
  | 'weak-passphrase'
  | 'storage-unavailable'
  /** Made by a newer version of the app: update this one first. */
  | 'newer-version';

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The header that is authenticated with the data (fixed key order). */
function headerOf(backup: Omit<EncryptedBackup, 'data'>): Uint8Array<ArrayBuffer> {
  const { format, version, app, createdAt, kdf, cipher } = backup;
  return encoder.encode(
    JSON.stringify({
      format,
      version,
      app,
      createdAt,
      kdf: { name: kdf.name, hash: kdf.hash, iterations: kdf.iterations, salt: kdf.salt },
      cipher: { name: cipher.name, iv: cipher.iv },
    }),
  );
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  // NFC: the same passphrase typed on different keyboards gives the same bytes.
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Locks an app's data with a passphrase. */
export async function encryptBackup(
  file: ExportFile,
  passphrase: string,
  options: { iterations?: number; now?: Date } = {},
): Promise<EncryptedBackup> {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new BackupError('weak-passphrase', problem);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const iterations = options.iterations ?? PBKDF2_ITERATIONS;
  const header: Omit<EncryptedBackup, 'data'> = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: file.app,
    createdAt: (options.now ?? new Date()).toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
  };
  const key = await deriveKey(passphrase, salt, iterations);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: headerOf(header) },
    key,
    encoder.encode(JSON.stringify(file)),
  );
  return { ...header, data: toBase64(new Uint8Array(encrypted)) };
}

/** Unlocks a backup. Throws BackupError('wrong-passphrase') if it doesn't fit. */
export async function decryptBackup(
  backup: EncryptedBackup,
  passphrase: string,
): Promise<ExportFile> {
  const key = await deriveKey(passphrase, fromBase64(backup.kdf.salt), backup.kdf.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(backup.cipher.iv), additionalData: headerOf(backup) },
      key,
      fromBase64(backup.data),
    );
  } catch {
    throw new BackupError(
      'wrong-passphrase',
      'That passphrase doesn’t unlock this backup. Check it and try again.',
    );
  }
  let file: unknown;
  try {
    file = JSON.parse(decoder.decode(plain));
  } catch {
    file = undefined;
  }
  if (!isExportFile(file) || file.app !== backup.app) {
    throw new BackupError('not-a-backup', 'This backup is damaged and can’t be restored.');
  }
  return file;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * How many bytes base64 `text` decodes to, or null when atob() would refuse
 * it: a character outside the alphabet, a length that isn't a whole number
 * of bytes, or "=" where none belongs. So a damaged file is turned down,
 * with the backup's own words, before anything is decoded (audit 5 E-6, A-4).
 */
export function base64ByteLength(text: string): number | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const padding = text.length - text.replace(/=+$/, '').length;
  if (padding > 0 && text.length % 4 !== 0) return null;
  const unpadded = text.length - padding;
  if (unpadded % 4 === 1) return null;
  return Math.floor((unpadded * 3) / 4);
}

/** Whether `value` is base64 text that decodes to `bytes` bytes (or at least that many). */
const decodesTo = (value: unknown, bytes: number, orMore = false): value is string => {
  if (typeof value !== 'string') return false;
  const length = base64ByteLength(value);
  return length !== null && (orMore ? length >= bytes : length === bytes);
};

function isExportFile(value: unknown): value is ExportFile {
  return (
    isRecord(value) &&
    typeof value['app'] === 'string' &&
    typeof value['exportedAt'] === 'string' &&
    isRecord(value['data'])
  );
}

function isEncryptedBackup(value: unknown): value is EncryptedBackup {
  if (!isRecord(value) || !isRecord(value['kdf']) || !isRecord(value['cipher'])) return false;
  const { kdf, cipher } = value;
  return (
    value['format'] === BACKUP_FORMAT &&
    value['version'] === BACKUP_VERSION &&
    typeof value['app'] === 'string' &&
    typeof value['createdAt'] === 'string' &&
    kdf['name'] === 'PBKDF2' &&
    kdf['hash'] === 'SHA-256' &&
    Number.isInteger(kdf['iterations']) &&
    (kdf['iterations'] as number) >= MIN_ITERATIONS &&
    (kdf['iterations'] as number) <= MAX_ITERATIONS &&
    decodesTo(kdf['salt'], SALT_BYTES) &&
    cipher['name'] === 'AES-GCM' &&
    decodesTo(cipher['iv'], IV_BYTES) &&
    decodesTo(value['data'], TAG_BYTES, true)
  );
}

/**
 * Reads a backup file's text. `app` is the app restoring it: a backup from
 * another app is refused (each app can only read its own data).
 */
export function readBackup(text: string, app: string): BackupFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  const notABackup = new BackupError('not-a-backup', 'This file isn’t a backup from shkriuss.app.');
  let result: BackupFile;
  if (isEncryptedBackup(value)) result = { kind: 'encrypted', backup: value };
  else if (isExportFile(value)) result = { kind: 'plain', file: value };
  else throw notABackup;

  const from = result.kind === 'encrypted' ? result.backup.app : result.file.app;
  if (from !== app) {
    throw new BackupError('wrong-app', `This backup is from a different app (“${from}”).`);
  }
  return result;
}

/**
 * Checks a store's data from a backup with the store itself, so a backup
 * the app can't read is refused before anything is replaced.
 */
function checkWith(store: Pick<Store<unknown>, 'version' | 'read'>, saved: unknown): void {
  const envelope: Record<string, unknown> = isRecord(saved) ? saved : {};
  const v = envelope['v'];
  if (typeof v === 'number' && v > store.version) {
    throw new BackupError(
      'newer-version',
      'This backup is from a newer version of the app. Close the app and open it again to update it, then restore the backup. Nothing was changed.',
    );
  }
  if (typeof v !== 'number' || store.read(v, envelope['data']) === undefined) {
    throw new BackupError(
      'not-a-backup',
      'Part of this backup can’t be read, so it wasn’t restored. Nothing was changed.',
    );
  }
}

/**
 * Replaces everything the app saved with the backup's data. First, the data
 * of each store made on this page is checked with that store: a backup from
 * a newer version of the app, or one it can't read, is refused and nothing
 * changes. If the browser refuses part-way (for example, storage is full),
 * the old data is put back, and if even that doesn't all work (another tab
 * wrote meanwhile), it says so. Returns how many items were restored.
 */
export function restoreAll(
  file: ExportFile,
  storage: StorageLike | undefined = getLocalStorage(),
  stores: typeof madeStores = madeStores,
): number {
  if (!storage) {
    throw new BackupError(
      'storage-unavailable',
      'This browser isn’t letting the app save data, so the backup can’t be restored.',
    );
  }
  // Data nested deeper than any app's would stop sync for good (audit 3 C-1).
  if (nestedTooDeep(file.data)) {
    throw new BackupError(
      'not-a-backup',
      'Part of this backup can’t be read, so it wasn’t restored. Nothing was changed.',
    );
  }
  for (const [key, value] of Object.entries(file.data)) {
    const store = stores.get(key);
    if (store) checkWith(store, value);
  }
  // What's saved now may be from a newer version of the app (a tab open from
  // before an update, or a rollback): the app looks empty, and restoring a
  // backup would replace the person's latest data (audit 5 E-3).
  for (const store of stores.values()) {
    if (store.status() !== 'newer') continue;
    throw new BackupError(
      'newer-version',
      'What’s saved here now is from a newer version of this app, so it wasn’t replaced: that would lose your latest data. Close the app and open it again to update it, then restore the backup if you still want to. Nothing was changed.',
    );
  }
  // Values that weren't JSON (like the theme, "dark") were exported as plain text.
  const serialize = (value: unknown): string =>
    typeof value === 'string' ? value : JSON.stringify(value);
  const incoming = Object.entries(file.data)
    .filter(([key]) => key.startsWith(KEY_PREFIX))
    .map(([key, value]) => [key, serialize(value)] as const);
  const previous = new Map(ownKeys(storage).map((key) => [key, storage.getItem(key)] as const));

  // Each key is replaced in its place, and keys the backup doesn't have go
  // last: the old data is never all gone at once, and the browser never
  // needs room for the old and the new together (audit 5 E-7).
  const written: string[] = [];
  try {
    for (const [key, value] of incoming) {
      storage.setItem(key, value);
      written.push(key);
    }
  } catch {
    putBack(storage, written, previous);
    throw new BackupError(
      'storage-unavailable',
      'There isn’t enough room to restore this backup. Nothing was changed.',
    );
  }
  const restored = new Set(incoming.map(([key]) => key));
  for (const key of previous.keys()) if (!restored.has(key)) storage.removeItem(key);
  return incoming.length;
}

/**
 * After a restore that ran out of room: puts the old data back. Keys the
 * backup added go first, which frees room; then those it replaced, the ones
 * that got smaller before the ones that got bigger, so the room asked for
 * never exceeds what was in use before, or when the writes stopped. That
 * fails only when another tab wrote meanwhile: then it says so, and the
 * backup, which is at hand, can be restored again once there's room
 * (audit 5 E-7).
 */
function putBack(
  storage: StorageLike,
  written: readonly string[],
  previous: ReadonlyMap<string, string | null>,
): void {
  const grows = (key: string) =>
    (previous.get(key) ?? '').length - (storage.getItem(key) ?? '').length;
  const notBack = [...written]
    .sort((a, b) => grows(a) - grows(b))
    .filter((key) => {
      const old = previous.get(key) ?? null;
      try {
        if (old === null) storage.removeItem(key);
        else storage.setItem(key, old);
        return false;
      } catch {
        return true;
      }
    });
  if (notBack.length > 0) {
    throw new BackupError(
      'storage-unavailable',
      'There isn’t enough room to restore this backup, and some of your old data couldn’t be put back either. Make room in this browser (close this app’s other tabs, say), then restore the backup again.',
    );
  }
}
