/**
 * Replacing the account key (docs/adr/0010), for when a signed-in device is
 * lost: the old key is marked as replaced on the account service, so every
 * device still holding it signs out when it next checks, and it can't sign
 * in again.
 */
import { hkdf, toBase64Url } from '@shkriuss/crypto';
import { noteReplaced, saveAccount } from './device.ts';
import { AccountError, api } from './errors.ts';

/** Checking gives up after this long (then the device carries on as it is). */
const CHECK_TIMEOUT_MS = 5000;

const statusToken = async (secret: Uint8Array<ArrayBuffer>) =>
  toBase64Url(await hkdf(secret, 'shkriuss account status v1'));

/** Whether this account key was replaced on another device. Throws AccountError("server") if it can't tell. */
export async function isReplaced(secret: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const response = await api(
    '/status',
    { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
    await statusToken(secret),
  );
  if (!response.ok) throw new AccountError('server', 'Couldn’t check the account.');
  const { replaced } = (await response.json()) as { replaced: boolean };
  return replaced === true;
}

/**
 * Replaces this device's account key with `next`: marks `current` as
 * replaced for good, then signs in here with `next`. Returns false if the
 * browser won't store it (the person has the new recovery key by then).
 */
export async function replaceAccountKey(
  current: Uint8Array<ArrayBuffer>,
  next: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const response = await api('/status', { method: 'PUT' }, await statusToken(current));
  if (!response.ok) throw new AccountError('server', 'Couldn’t replace the account key.');
  noteReplaced(current);
  return saveAccount(next);
}
