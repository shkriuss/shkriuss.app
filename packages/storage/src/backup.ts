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
  deleteAll,
  getLocalStorage,
  KEY_PREFIX,
  madeStores,
  ownKeys,
  type ExportFile,
  type StorageLike,
  type Store,
} from './index.ts';
import { nestedTooDeep } from './nesting.ts';

export const BACKUP_FORMAT = 'shkriuss-backup';
export const BACKUP_VERSION = 1;
/** How many PBKDF2 rounds new backups use (OWASP's advice for PBKDF2-SHA-256). */
export const PBKDF2_ITERATIONS = 600_000;
/** Shorter passphrases are refused. */
export const MIN_PASSPHRASE_LENGTH = 12;
// Files asking for fewer rounds are refused (too weak), and more (too slow to open).
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;

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

/** A reason the passphrase can't be used, or undefined if it's fine. */
export function passphraseProblem(passphrase: string): string | undefined {
  if ([...passphrase.normalize('NFC')].length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  }
  return undefined;
}

/** Locks an app's data with a passphrase. */
export async function encryptBackup(
  file: ExportFile,
  passphrase: string,
  options: { iterations?: number; now?: Date } = {},
): Promise<EncryptedBackup> {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new BackupError('weak-passphrase', problem);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
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

const isBase64 = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);

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
    isBase64(kdf['salt']) &&
    cipher['name'] === 'AES-GCM' &&
    isBase64(cipher['iv']) &&
    isBase64(value['data'])
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
 * the old data is put back. Returns how many items were restored.
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
  // Values that weren't JSON (like the theme, "dark") were exported as plain text.
  const serialize = (value: unknown): string =>
    typeof value === 'string' ? value : JSON.stringify(value);
  const incoming = Object.entries(file.data)
    .filter(([key]) => key.startsWith(KEY_PREFIX))
    .map(([key, value]) => [key, serialize(value)] as const);
  const previous = ownKeys(storage).map((key) => [key, storage.getItem(key)] as const);

  deleteAll(storage);
  try {
    for (const [key, value] of incoming) storage.setItem(key, value);
  } catch {
    // Put the old data back (it fitted before, so it fits again).
    deleteAll(storage);
    for (const [key, value] of previous) {
      if (value !== null) storage.setItem(key, value);
    }
    throw new BackupError(
      'storage-unavailable',
      'There isn’t enough room to restore this backup. Nothing was changed.',
    );
  }
  return incoming.length;
}
