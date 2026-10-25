/**
 * Adding a device with a QR code (docs/adr/0010).
 *
 * The signed-in device seals the account secret with a new one-time key and
 * stores it on the account service under a random id. The QR code holds a
 * link to this page with the id and the key after "#": browsers never send
 * that part to the server, so the server can't unlock what it holds. The new
 * device fetches it once; after that, or after 10 minutes, it's gone.
 */
import { fromBase64Url, open, randomBytes, seal, toBase64Url } from '@shkriuss/crypto';
import { AccountError, api } from './errors.ts';
import { SECRET_BYTES } from './secret.ts';
import { LINK_ID_PATTERN } from './validate.ts';

export interface DeviceLink {
  id: string;
  /** Open this on the other device (it's what the QR code holds). */
  url: string;
  expiresAt: number;
  /** Cancels the link (cancelLink): only this device has it. */
  cancel: string;
}

export type LinkState = 'waiting' | 'used' | 'expired';

const label = (id: string) => `shkriuss device link v1 ${id}`;

/** Makes a one-time link that signs another device in to this account. */
export async function createLink(
  secret: Uint8Array<ArrayBuffer>,
  origin: string = location.origin,
): Promise<DeviceLink> {
  const id = toBase64Url(randomBytes(16));
  const key = randomBytes(32);
  const cancel = toBase64Url(randomBytes(32));
  const data = await seal(key, secret, label(id));
  const response = await api(`/link/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ data, cancel }),
  });
  if (response.status !== 201) throw new AccountError('server', 'Couldn’t make a link.');
  const { expiresAt } = (await response.json()) as { expiresAt: number };
  return { id, url: `${origin}/account/#link=${id}.${toBase64Url(key)}`, expiresAt, cancel };
}

/**
 * Makes a link stop working before it expires (the person is done with the
 * code, audit A-2). "used" if another device already used it.
 */
export async function cancelLink(link: DeviceLink): Promise<'cancelled' | 'used'> {
  const response = await api(`/link/${link.id}`, { method: 'DELETE' }, link.cancel);
  if (response.status === 409) return 'used';
  if (!response.ok) throw new AccountError('server', 'Couldn’t cancel the link.');
  return 'cancelled';
}

/** Whether the other device has used the link yet. */
export async function linkState(id: string): Promise<LinkState> {
  const response = await api(`/link/${id}/state`);
  if (!response.ok) throw new AccountError('server', 'Couldn’t check the link.');
  const { state } = (await response.json()) as { state: LinkState };
  return state;
}

export interface LinkInFragment {
  id: string;
  key: Uint8Array<ArrayBuffer>;
}

/** Reads "#link=<id>.<key>" from a URL's fragment, or null if it isn't one. */
export function parseLinkFragment(hash: string): LinkInFragment | null {
  const match = /^#link=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(hash);
  if (!match) return null;
  const [, id = '', key = ''] = match;
  if (!LINK_ID_PATTERN.test(id)) return null;
  return { id, key: fromBase64Url(key) };
}

/** Fetches the secret from a link (which can then never be used again). */
export async function claimLink(link: LinkInFragment): Promise<Uint8Array<ArrayBuffer>> {
  const response = await api(`/link/${link.id}`);
  if (response.status === 410 || response.status === 404) {
    const body = (await response.json().catch(() => ({}))) as { used?: unknown };
    if (body.used === true) throw new AccountError('link-taken', 'This link was already used.');
    throw new AccountError('link-used', 'This link has expired.');
  }
  if (!response.ok) throw new AccountError('server', 'Couldn’t open the link.');
  const { data } = (await response.json()) as { data: string };
  let secret: Uint8Array<ArrayBuffer>;
  try {
    secret = await open(link.key, data, label(link.id));
  } catch {
    // Someone changed the link's key (or the stored data): it's of no use.
    throw new AccountError('link-used', 'This link doesn’t work.');
  }
  if (secret.length !== SECRET_BYTES)
    throw new AccountError('link-used', 'This link doesn’t work.');
  return secret;
}
