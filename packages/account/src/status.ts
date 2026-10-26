/**
 * Replacing the account key (docs/adr/0010), for when a signed-in device is
 * lost: the old key is marked as replaced on the account service, so every
 * device still holding it signs out when it next checks, and it can't sign
 * in again.
 */
import { hkdf, toBase64Url } from '@shkriuss/crypto';
import { forgetReplaced, noteReplaced, saveAccount, type Account } from './device.ts';
import { AccountError, api } from './errors.ts';
import { successorTag } from './secret.ts';
import { SUCCESSOR_PATTERN } from './validate.ts';

/** Checking gives up after this long (then the device carries on as it is). */
const CHECK_TIMEOUT_MS = 5000;

const statusToken = async (secret: Uint8Array<ArrayBuffer>) =>
  toBase64Url(await hkdf(secret, 'shkriuss account status v1'));

/**
 * Whether this account key was replaced on another device, and the tag of
 * the key that replaced it (successorTag; null if the note doesn't say).
 * Throws AccountError("server") if it can't tell.
 */
export async function replacedNote(
  secret: Uint8Array<ArrayBuffer>,
): Promise<{ replaced: boolean; successor: string | null }> {
  const response = await api(
    '/status',
    { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
    await statusToken(secret),
  );
  if (!response.ok) throw new AccountError('server', 'Couldn’t check the account.');
  const { replaced, successor } = (await response.json()) as {
    replaced?: unknown;
    successor?: unknown;
  };
  return {
    replaced: replaced === true,
    successor:
      typeof successor === 'string' && SUCCESSOR_PATTERN.test(successor) ? successor : null,
  };
}

/** Whether this account key was replaced on another device. Throws AccountError("server") if it can't tell. */
export async function isReplaced(secret: Uint8Array<ArrayBuffer>): Promise<boolean> {
  return (await replacedNote(secret)).replaced;
}

/**
 * Signs this device out if its account key was replaced on another device,
 * forgetting it there as signing out does (forgetReplaced, audit 3 D-8).
 * Returns the apps that synced here with it (they keep syncing with the old
 * key until sync is turned on in them again), or null if it wasn't
 * replaced, that can't be checked now, or this device has another key by
 * then: it stays as it is.
 */
export async function signOutIfReplaced(account: Account): Promise<string[] | null> {
  const replaced = await isReplaced(account.secret).catch(() => false);
  return replaced ? forgetReplaced(account) : null;
}

/**
 * Replaces this device's account key with `next`: marks `current` as
 * replaced for good, then signs in here with `next`. `saved` is false if the
 * browser won't store it (the person has the new recovery key by then).
 * `noted` is false if the account service had no room to note the old key
 * (docs/adr/0017): it's replaced all the same, but devices that still have
 * it don't sign out by themselves.
 */
export async function replaceAccountKey(
  current: Uint8Array<ArrayBuffer>,
  next: Uint8Array<ArrayBuffer>,
): Promise<{ saved: boolean; noted: boolean }> {
  // The note says which key replaced this one, in a way only devices that
  // have both can check: they keep the old key only for that account.
  const successor = await successorTag(current, next);
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
