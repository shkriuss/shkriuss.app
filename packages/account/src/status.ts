/**
 * Replacing the account key (docs/adr/0010), for when a signed-in device is
 * lost: the old key is marked as replaced on the account service, so every
 * device still holding it signs out when it next checks, and it can't sign
 * in again.
 */
import { hkdf, toBase64Url } from '@shkriuss/crypto';
import {
  forgetReplaced,
  noteReplaced,
  noteReplacing,
  replacingWith,
  saveAccount,
  type Account,
} from './device.ts';
import { AccountError, api } from './errors.ts';
import { successorTag } from './secret.ts';
import { SUCCESSOR_PATTERN } from './validate.ts';

/** Checking gives up after this long (then the device carries on as it is). */
const CHECK_TIMEOUT_MS = 5000;

const statusToken = async (secret: Uint8Array<ArrayBuffer>) =>
  toBase64Url(await hkdf(secret, 'shkriuss account status v1'));

/** What the account service notes about a key: whether it was replaced, and the tag of the key that did (successorTag; null if the note doesn't say). */
interface Note {
  replaced: boolean;
  successor: string | null;
}

function noteOf(value: unknown): Note {
  const { replaced, successor } = (typeof value === 'object' && value !== null ? value : {}) as {
    replaced?: unknown;
    successor?: unknown;
  };
  return {
    replaced: replaced === true,
    successor:
      typeof successor === 'string' && SUCCESSOR_PATTERN.test(successor) ? successor : null,
  };
}

/**
 * Whether this account key was replaced on another device, and the tag of
 * the key that replaced it (successorTag; null if the note doesn't say).
 * Throws AccountError("server") if it can't tell.
 */
export async function replacedNote(secret: Uint8Array<ArrayBuffer>): Promise<Note> {
  const response = await api(
    '/status',
    { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
    await statusToken(secret),
  );
  if (!response.ok) throw new AccountError('server', 'Couldn’t check the account.');
  return noteOf(await response.json());
}

/** Whether this account key was replaced on another device. Throws AccountError("server") if it can't tell. */
export async function isReplaced(secret: Uint8Array<ArrayBuffer>): Promise<boolean> {
  return (await replacedNote(secret)).replaced;
}

/** What a check of this device's key found, and did. */
export type KeyCheck =
  /**
   * Not replaced, or that can't be told now (it's checked next time), or
   * this device has another key by then (in another tab): nothing changed.
   */
  | { outcome: 'unchanged' }
  /**
   * Replaced by this device: it's signed in with the new key now, and keeps
   * the old one for the apps. `saved` is false if the browser won't store
   * it (the person has the new recovery key by then). `noted` is false if
   * the account service had no room to note the old key (docs/adr/0017):
   * it's replaced all the same, but devices that still have it don't sign
   * out by themselves.
   */
  | { outcome: 'replaced'; saved: boolean; noted: boolean }
  /**
   * Replaced on another device (a lost one, say): this device is signed
   * out, keeping nothing of it, as signing out does (audit 3 D-8). `apps`
   * synced here with it, and keep syncing with the old key until sync is
   * turned on in them again.
   */
  | { outcome: 'signed-out'; apps: string[] };

const UNCHANGED: KeyCheck = { outcome: 'unchanged' };

/**
 * What the account service's note means for this device, signed in to
 * `account`, which may be replacing it with `next` (noteReplacing). The
 * note's tag needs both keys, so if it names `next`, the replacement was
 * this device's: it signs in with `next`, keeping the old key for the apps.
 * Any other replacement was another device's: it signs out.
 */
async function settle(
  account: Pick<Account, 'secret' | 'code'>,
  note: Note,
  next: Uint8Array<ArrayBuffer> | null,
): Promise<KeyCheck> {
  if (!note.replaced) return UNCHANGED;
  const successor = next ? await successorTag(account.secret, next) : null;
  if (next && successor !== null && note.successor === successor) {
    noteReplaced(account.secret, successor);
    return { outcome: 'replaced', saved: await saveAccount(next), noted: true };
  }
  const apps = forgetReplaced(account);
  return apps ? { outcome: 'signed-out', apps } : UNCHANGED;
}

/**
 * What the Account page does as it opens, signed in to `account`: asks the
 * account service, once, whether its key was replaced, and acts on that one
 * answer (settle). Replaced on another device (a lost one), it signs out
 * here. Replaced here, but the answer never came (the connection dropped,
 * or the page was closed), the replacement is finished now, as if it had
 * (audit 6 A-1). If the service can't be reached, nothing changes until the
 * next time. Before, the page asked twice, and when only the first check
 * failed, the second took this device for a lost one: it signed out and
 * forgot the old key, so no app could move its old copy any more (audit 7
 * A-1, run 27).
 */
export async function checkReplaced(account: Account): Promise<KeyCheck> {
  const note = await replacedNote(account.secret).catch(() => null);
  if (!note) return UNCHANGED;
  return settle(account, note, replacingWith(account));
}

/**
 * Replaces this device's account key with `next`: marks `current` as
 * replaced for good, then signs in here with `next`. `saved` and `noted` as
 * in KeyCheck "replaced".
 */
export async function replaceAccountKey(
  current: Uint8Array<ArrayBuffer>,
  next: Uint8Array<ArrayBuffer>,
): Promise<{ saved: boolean; noted: boolean }> {
  // The note says which key replaced this one, in a way only devices that
  // have both can check: they keep the old key only for that account.
  const successor = await successorTag(current, next);
  // Kept here first, in case the service's answer is lost (audit 6 A-1).
  noteReplacing(current, next);
  const response = await api(
    '/status',
    { method: 'PUT', body: JSON.stringify({ successor }) },
    await statusToken(current),
  );
  const noted = response.status !== 507;
  if (!response.ok && noted) throw new AccountError('server', 'Couldn’t replace the account key.');
  noteReplaced(current, successor);
  return { saved: await saveAccount(next), noted };
}
