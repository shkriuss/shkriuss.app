/**
 * Connecting an app to the account (docs/adr/0010). The app and the hub are
 * different sites, so they talk through the address bar, never through each
 * other's servers:
 *
 * 1. The app makes a one-time key pair (ECDH P-256), keeps the private half
 *    in this tab, and opens the hub's Account page with the public half.
 * 2. The person confirms on the hub. The hub derives the app's own key from
 *    the account secret and seals it so only that one-time key pair can
 *    open it, then goes back to the app with the result after "#" (never sent
 *    to any server).
 * 3. The app opens it with its private half, which is then thrown away.
 *
 * The hub only sends it back to the app's real address (./origins.ts).
 */
import { fromBase64Url, hkdf, open, randomBytes, seal, toBase64Url, utf8 } from '@shkriuss/crypto';

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
/** A connect request is good for this long. */
export const CONNECT_LIFETIME_MS = 15 * 60 * 1000;

/** What the app keeps in this tab while the person is on the hub. */
export interface PendingConnect {
  privateKey: JsonWebKey;
  state: string;
  at: number;
}

/** What the app gets: its own key, and the account code to show. */
export interface Connection {
  secret: Uint8Array<ArrayBuffer>;
  code: string;
}

/** What the hub is asked: which app, its address, its one-time public key. */
export interface ConnectRequest {
  app: string;
  from: string;
  key: string;
  state: string;
}

const STATE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
/** An uncompressed P-256 public key (65 bytes), base64url. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{87}$/;

const label = (app: string, state: string) => `shkriuss connect v1 ${app} ${state}`;

async function sharedKey(
  privateKey: CryptoKey,
  publicKey: string,
  app: string,
  state: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const other = await crypto.subtle.importKey('raw', fromBase64Url(publicKey), ECDH, false, []);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: other }, privateKey, 256);
  return hkdf(new Uint8Array(bits), label(app, state), 32, utf8(state));
}

/** Step 1 (app): a new request, and what to keep until the person comes back. */
export async function newConnectRequest(
  app: string,
  from: string,
): Promise<{ request: ConnectRequest; pending: PendingConnect }> {
  const pair = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const key = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const state = toBase64Url(randomBytes(16));
  const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { request: { app, from, key, state }, pending: { privateKey, state, at: Date.now() } };
}

/** The hub address to open for a request. */
export function connectUrl(hubOrigin: string, request: ConnectRequest): string {
  const params = new URLSearchParams({
    connect: request.app,
    from: request.from,
    key: request.key,
    state: request.state,
  });
  return `${hubOrigin}/account/?${params.toString()}`;
}

/** Step 2 (hub): reads a request from the Account page's address, or null if there isn't one. */
export function parseConnectRequest(search: string): ConnectRequest | null {
  const params = new URLSearchParams(search);
  const app = params.get('connect');
  const from = params.get('from');
  const key = params.get('key');
  const state = params.get('state');
  if (!app || !from || !key || !state) return null;
  if (!KEY_PATTERN.test(key) || !STATE_PATTERN.test(state)) return null;
  return { app, from, key, state };
}

/** Step 2 (hub): seals the app's connection for the request's one-time key. */
export async function sealForApp(request: ConnectRequest, connection: Connection): Promise<string> {
  const pair = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const hubKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const key = await sharedKey(pair.privateKey, request.key, request.app, request.state);
  const payload = utf8(
    JSON.stringify({ secret: toBase64Url(connection.secret), code: connection.code }),
  );
  return `${hubKey}.${await seal(key, payload, label(request.app, request.state))}`;
}

/** Where the hub sends the person back to: the app, with the result after "#". */
export const connectResultUrl = (from: string, result: string | 'cancelled'): string =>
  `${from}/#connect=${result}`;

export type ConnectResult =
  { kind: 'cancelled' } | { kind: 'sealed'; hubKey: string; sealed: string };

/** Step 3 (app): reads "#connect=…" from the address, or null if it isn't one. */
export function parseConnectResult(hash: string): ConnectResult | null {
  if (hash === '#connect=cancelled') return { kind: 'cancelled' };
  const match = /^#connect=([A-Za-z0-9_-]{87})\.([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? { kind: 'sealed', hubKey: match[1] ?? '', sealed: match[2] ?? '' } : null;
}

/** Step 3 (app): opens the result with the kept private key. Throws if it doesn't open. */
export async function openConnection(
  app: string,
  pending: PendingConnect,
  result: { hubKey: string; sealed: string },
): Promise<Connection> {
  const privateKey = await crypto.subtle.importKey('jwk', pending.privateKey, ECDH, false, [
    'deriveBits',
  ]);
  const key = await sharedKey(privateKey, result.hubKey, app, pending.state);
  const payload = JSON.parse(
    new TextDecoder().decode(await open(key, result.sealed, label(app, pending.state))),
  ) as { secret?: unknown; code?: unknown };
  if (typeof payload.secret !== 'string' || typeof payload.code !== 'string') {
    throw new Error('Not a connection');
  }
  const secret = fromBase64Url(payload.secret);
  if (secret.length !== 32) throw new Error('Not a connection');
  return { secret, code: payload.code };
}
