/**
 * Passkeys that unlock the account (docs/adr/0010).
 *
 * A passkey normally only proves who you are to a server. With the WebAuthn
 * "PRF" extension it can also produce a secret value that only that passkey
 * can produce. From it come two keys:
 *
 * - a wrap key, which seals the account secret (the "passkey lock");
 * - a lookup token, which finds that lock on the account service.
 *
 * The service stores the lock, sealed, and only a hash of the token. Signing
 * in on a new device: use the passkey, get the same value, fetch and unlock.
 * Passkeys sync through the phone's password manager (Google, Apple and
 * others), so a new phone with the same password manager can sign in alone.
 */
import { hkdf, open, randomBytes, seal, toBase64Url, utf8 } from '@shkriuss/crypto';
import { AccountError, api } from './errors.ts';
import { SECRET_BYTES } from './secret.ts';

const PRF_SALT = utf8('shkriuss account passkey v1');
const WRAP_LABEL = 'shkriuss passkey wrap v1';

/** "yes": this browser says it can; "maybe": it doesn't say (try, and see); "no": it can't. */
export type PasskeySupport = 'yes' | 'maybe' | 'no';

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

/** The WebAuthn parts that TypeScript's DOM types don't know yet. */
interface PublicKeyCredentialExtras {
  getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
  signalUnknownCredential?: (options: { rpId: string; credentialId: string }) => Promise<void>;
}
const extras = () =>
  (typeof PublicKeyCredential === 'undefined'
    ? {}
    : PublicKeyCredential) as unknown as PublicKeyCredentialExtras;

export async function passkeySupport(): Promise<PasskeySupport> {
  if (typeof PublicKeyCredential === 'undefined' || !('credentials' in navigator)) return 'no';
  const { getClientCapabilities } = extras();
  if (!getClientCapabilities) return 'maybe';
  try {
    const capabilities = await getClientCapabilities.call(PublicKeyCredential);
    const prf = capabilities['extension:prf'];
    return prf === true ? 'yes' : prf === false ? 'no' : 'maybe';
  } catch {
    return 'maybe';
  }
}

/** Runs a WebAuthn call, turning its errors into AccountErrors. */
async function webAuthn<T>(call: () => Promise<T | null>): Promise<T> {
  let result: T | null;
  try {
    result = await call();
  } catch (error) {
    if (error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name)) {
      throw new AccountError('cancelled', 'The passkey prompt was closed.');
    }
    throw new AccountError('no-prf', 'This browser can’t use a passkey here.');
  }
  if (result === null) throw new AccountError('cancelled', 'No passkey was chosen.');
  return result;
}

/** Asks the password manager to delete a passkey we can't use (where supported). */
async function forgetPasskey(rpId: string, credentialId: ArrayBuffer): Promise<void> {
  try {
    await extras().signalUnknownCredential?.call(PublicKeyCredential, {
      rpId,
      credentialId: toBase64Url(new Uint8Array(credentialId)),
    });
  } catch {
    // Not supported, or the password manager ignores it: nothing else to do.
  }
}

/** Uses a passkey (any of this site's, or the one given) and returns its PRF value. */
async function usePasskey(
  rpId: string,
  only?: ArrayBuffer,
): Promise<{ prf: ArrayBuffer; credentialId: ArrayBuffer }> {
  const credential = (await webAuthn(() =>
    navigator.credentials.get({
      publicKey: {
        rpId,
        challenge: randomBytes(32),
        userVerification: 'required',
        ...(only ? { allowCredentials: [{ type: 'public-key', id: only }] } : {}),
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
    }),
  )) as PublicKeyCredential;
  const prf = (credential.getClientExtensionResults() as PrfResults).prf?.results?.first;
  if (!prf) throw new AccountError('no-prf', 'This passkey can’t unlock accounts.');
  return { prf, credentialId: credential.rawId };
}

async function keysOf(prf: ArrayBuffer) {
  const value = new Uint8Array(prf);
  return {
    lookup: toBase64Url(await hkdf(value, 'shkriuss passkey lookup v1')),
    wrapKey: await hkdf(value, 'shkriuss passkey wrap v1'),
  };
}

/**
 * Makes a passkey for this account (the browser asks to save it) and stores
 * its lock on the account service. `code` names it in the password manager.
 */
export async function addPasskey(
  secret: Uint8Array<ArrayBuffer>,
  code: string,
  rpId: string = location.hostname,
): Promise<void> {
  const name = `shkriuss account ${code}`;
  const credential = (await webAuthn(() =>
    navigator.credentials.create({
      publicKey: {
        rp: { id: rpId, name: 'shkriuss' },
        user: { id: randomBytes(16), name, displayName: name },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        attestation: 'none',
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
    }),
  )) as PublicKeyCredential;

  const created = (credential.getClientExtensionResults() as PrfResults).prf;
  if (created?.enabled !== true) {
    await forgetPasskey(rpId, credential.rawId);
    throw new AccountError(
      'no-prf',
      'This password manager can’t make passkeys that unlock accounts.',
    );
  }
  // Some browsers give the value straight away; others need the passkey used once.
  const prf = created.results?.first ?? (await usePasskey(rpId, credential.rawId)).prf;
  const { lookup, wrapKey } = await keysOf(prf);
  const wrap = await seal(wrapKey, secret, WRAP_LABEL);
  const response = await api('/passkey', { method: 'PUT', body: JSON.stringify({ wrap }) }, lookup);
  if (!response.ok) throw new AccountError('server', 'Couldn’t save the passkey.');
}

/** Signs in with a passkey: returns the account secret it unlocks. */
export async function signInWithPasskey(
  rpId: string = location.hostname,
): Promise<Uint8Array<ArrayBuffer>> {
  const { prf, credentialId } = await usePasskey(rpId);
  const { lookup, wrapKey } = await keysOf(prf);
  const response = await api('/passkey', {}, lookup);
  if (response.status === 404) {
    await forgetPasskey(rpId, credentialId);
    throw new AccountError('unknown-passkey', 'No account is connected to this passkey.');
  }
  if (!response.ok) throw new AccountError('server', 'Couldn’t reach the account service.');
  const { wrap } = (await response.json()) as { wrap: string };
  try {
    const secret = await open(wrapKey, wrap, WRAP_LABEL);
    if (secret.length === SECRET_BYTES) return secret;
  } catch {
    // Falls through: the lock doesn't open with this passkey.
  }
  throw new AccountError('unknown-passkey', 'This passkey doesn’t unlock an account.');
}

/** Removes a passkey's lock (the person picks which passkey), so it no longer signs in. */
export async function removePasskey(rpId: string = location.hostname): Promise<void> {
  const { prf, credentialId } = await usePasskey(rpId);
  const { lookup } = await keysOf(prf);
  const response = await api('/passkey', { method: 'DELETE' }, lookup);
  if (!response.ok) throw new AccountError('server', 'Couldn’t remove the passkey.');
  await forgetPasskey(rpId, credentialId);
}
