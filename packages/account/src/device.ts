/**
 * The account on this device: the secret, kept in this browser's storage for
 * the hub only. It's under "shkriuss-device:", so it's never in backups.
 *
 * It also keeps account keys this device knows were replaced (by replacing
 * the key here, or by being signed out because it was replaced elsewhere).
 * When an app connects, it gets its keys from those too, so it can move its
 * old online copy to the new key (packages/sync).
 */
import { fromBase64Url, toBase64Url } from '@shkriuss/crypto';
import { accountCodeOf, SECRET_BYTES } from './secret.ts';

const STORAGE_KEY = 'shkriuss-device:account';
/** Replaced keys kept, newest first. */
const MAX_REPLACED = 5;

export interface Account {
  secret: Uint8Array<ArrayBuffer>;
  /** e.g. "K7Q2-M9XD" */
  code: string;
  /** When this device signed in (ISO date). */
  since: string;
}

interface Saved {
  secret?: string;
  since?: string;
  replaced: string[];
}

function read(): Saved {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return { replaced: [] };
    const { secret, since, replaced } = value as Record<string, unknown>;
    return {
      ...(typeof secret === 'string' && typeof since === 'string' ? { secret, since } : {}),
      replaced: Array.isArray(replaced)
        ? replaced.filter((key): key is string => typeof key === 'string')
        : [],
    };
  } catch {
    return { replaced: [] };
  }
}

function write(saved: Saved): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

function decode(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const secret = fromBase64Url(text);
    return secret.length === SECRET_BYTES ? secret : null;
  } catch {
    return null;
  }
}

/** The account this device is signed in to, or null. */
export async function currentAccount(): Promise<Account | null> {
  const { secret: text, since } = read();
  const secret = text === undefined ? null : decode(text);
  if (!secret || since === undefined) return null;
  return { secret, code: await accountCodeOf(secret), since };
}

/** Signs this device in. Returns false if the browser won't store it. */
export function saveAccount(secret: Uint8Array<ArrayBuffer>, now = new Date()): boolean {
  const text = toBase64Url(secret);
  return write({
    secret: text,
    since: now.toISOString(),
    replaced: read().replaced.filter((key) => key !== text),
  });
}

/**
 * Remembers that an account key was replaced. If this device is signed in
 * with it, it's signed out.
 */
export function noteReplaced(secret: Uint8Array<ArrayBuffer>): void {
  const text = toBase64Url(secret);
  const saved = read();
  const replaced = [text, ...saved.replaced.filter((key) => key !== text)].slice(0, MAX_REPLACED);
  write(saved.secret === text ? { replaced } : { ...saved, replaced });
}

/** Account keys this device knows were replaced, newest first. */
export function replacedSecrets(): Uint8Array<ArrayBuffer>[] {
  return read()
    .replaced.map(decode)
    .filter((secret) => secret !== null);
}

/** Signs this device out (forgets the secret here only, and any replaced keys). */
export function forgetAccount(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was saved.
  }
}
