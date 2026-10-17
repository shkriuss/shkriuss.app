/**
 * The account on this device: the secret, kept in this browser's storage for
 * the hub only. It's under "shkriuss-device:", so it's never in backups.
 */
import { fromBase64Url, toBase64Url } from '@shkriuss/crypto';
import { accountCodeOf, SECRET_BYTES } from './secret.ts';

const STORAGE_KEY = 'shkriuss-device:account';

export interface Account {
  secret: Uint8Array<ArrayBuffer>;
  /** e.g. "K7Q2-M9XD" */
  code: string;
  /** When this device signed in (ISO date). */
  since: string;
}

interface Saved {
  secret: string;
  since: string;
}

function read(): Saved | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const { secret, since } = value as Record<string, unknown>;
    return typeof secret === 'string' && typeof since === 'string' ? { secret, since } : null;
  } catch {
    return null;
  }
}

/** The account this device is signed in to, or null. */
export async function currentAccount(): Promise<Account | null> {
  const saved = read();
  if (!saved) return null;
  let secret: Uint8Array<ArrayBuffer>;
  try {
    secret = fromBase64Url(saved.secret);
  } catch {
    return null;
  }
  if (secret.length !== SECRET_BYTES) return null;
  return { secret, code: await accountCodeOf(secret), since: saved.since };
}

/** Signs this device in. Returns false if the browser won't store it. */
export function saveAccount(secret: Uint8Array<ArrayBuffer>, now = new Date()): boolean {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ secret: toBase64Url(secret), since: now.toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Signs this device out (forgets the secret here only). */
export function forgetAccount(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was saved.
  }
}
