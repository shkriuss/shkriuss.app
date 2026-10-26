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
 *
 * Any page on a shkriuss.app subdomain could ask for the same passkey (only
 * Chromium-based browsers stop app pages), so the service also keeps the
 * passkey's public key, and hands out or removes the lock only for the
 * passkey's signature made on this page (./webauthn.ts, docs/adr/0018).
 */
import { hkdf, open, randomBytes, seal, toBase64Url, utf8 } from '@shkriuss/crypto';
import { AccountError, api } from './errors.ts';
import { SECRET_BYTES } from './secret.ts';
import { ALGORITHMS, challengeFor, type Assertion, type Purpose } from './webauthn.ts';

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

const base64Url = (buffer: ArrayBuffer) => toBase64Url(new Uint8Array(buffer));

/**
 * Uses a passkey (any of this site's, or the one given) for `purpose`: its
 * PRF value, and its signature for the account service.
 */
async function usePasskey(
  rpId: string,
  purpose: Purpose,
  only?: ArrayBuffer,
): Promise<{ prf: ArrayBuffer; credentialId: ArrayBuffer; assertion: Assertion }> {
  const credential = (await webAuthn(() =>
    navigator.credentials.get({
      publicKey: {
        rpId,
        challenge: challengeFor(purpose),
        userVerification: 'required',
        ...(only ? { allowCredentials: [{ type: 'public-key', id: only }] } : {}),
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
    }),
  )) as PublicKeyCredential;
  const prf = (credential.getClientExtensionResults() as PrfResults).prf?.results?.first;
  if (!prf) throw new AccountError('no-prf', 'This passkey can’t unlock accounts.');
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    prf,
    credentialId: credential.rawId,
    assertion: {
      authenticatorData: base64Url(response.authenticatorData),
      clientDataJSON: base64Url(response.clientDataJSON),
      signature: base64Url(response.signature),
    },
  };
}

/** What the account service says when it won't hand out or remove a lock. */
async function refusal(response: Response): Promise<AccountError | null> {
  if (response.status === 403) {
    return new AccountError('passkey-refused', 'The account service didn’t accept this passkey.');
  }
  if (response.status !== 404 && response.status !== 410) return null;
  const body = (await response.json().catch(() => null)) as { unknown?: unknown; old?: unknown };
  if (body?.old === true) {
    return new AccountError('old-passkey', 'This passkey was added before passkeys were checked.');
  }
  if (body?.unknown === true) {
    return new AccountError('unknown-passkey', 'No account is connected to this passkey.');
  }
  return null;
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
  // The service keeps the passkey's public key, to check its signatures.
  const attestation = credential.response as AuthenticatorAttestationResponse;
  const publicKey = attestation.getPublicKey?.() ?? null;
  const algorithm = attestation.getPublicKeyAlgorithm?.();
  if (
    created?.enabled !== true ||
    !publicKey ||
    !ALGORITHMS.includes(algorithm as (typeof ALGORITHMS)[number])
  ) {
    await forgetPasskey(rpId, credential.rawId);
    throw new AccountError(
      'no-prf',
      'This password manager can’t make passkeys that unlock accounts.',
    );
  }
  // Used once more, for its PRF value (some browsers only give it then) and
  // a signature that shows the passkey was added on this page. A passkey left
  // without its lock is forgotten: it can't unlock anything, and a lock made
  // somewhere else could take its place first (audit 4 A-2).
  let used: Awaited<ReturnType<typeof usePasskey>>;
  try {
    used = await usePasskey(rpId, 'add', credential.rawId);
  } catch (error) {
    await forgetPasskey(rpId, credential.rawId);
    throw error;
  }
  const { lookup, wrapKey } = await keysOf(used.prf);
  const wrap = await seal(wrapKey, secret, WRAP_LABEL);
  const body = { wrap, publicKey: base64Url(publicKey), algorithm, assertion: used.assertion };
  // No answer (offline), or a server error, which may come after the lock was
  // kept: the passkey stays, or the lock could never be removed. If it wasn't
  // kept, signing in with it says so, and the browser forgets it then. Only
  // a refusal (nothing kept, 507: no room) makes the browser forget it now.
  const response = await api('/passkey', { method: 'PUT', body: JSON.stringify(body) }, lookup);
  if (!response.ok) {
    if (response.status < 500 || response.status === 507) {
      await forgetPasskey(rpId, credential.rawId);
    }
    throw new AccountError('server', 'Couldn’t save the passkey.');
  }
}

/** Signs in with a passkey: returns the account secret it unlocks. */
export async function signInWithPasskey(
  rpId: string = location.hostname,
): Promise<Uint8Array<ArrayBuffer>> {
  const { prf, credentialId, assertion } = await usePasskey(rpId, 'open');
  const { lookup, wrapKey } = await keysOf(prf);
  const response = await api(
    '/passkey/open',
    { method: 'POST', body: JSON.stringify({ assertion }) },
    lookup,
  );
  const refused = await refusal(response);
  if (refused) {
    // Only when the service says no account uses it, not on any 404 (audit A-4).
    if (refused.code === 'unknown-passkey') await forgetPasskey(rpId, credentialId);
    throw refused;
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
  const { prf, credentialId, assertion } = await usePasskey(rpId, 'remove');
  const { lookup } = await keysOf(prf);
  const response = await api(
    '/passkey/remove',
    { method: 'POST', body: JSON.stringify({ assertion }) },
    lookup,
  );
  const refused = await refusal(response);
  if (refused) throw refused;
  if (!response.ok) throw new AccountError('server', 'Couldn’t remove the passkey.');
  await forgetPasskey(rpId, credentialId);
}
