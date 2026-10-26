/**
 * VAPID (RFC 8292): how our server proves to a push service (Google, Apple,
 * Mozilla, Microsoft or a UnifiedPush server) that a message comes from the same server
 * the browser subscribed with. Each app has its own key pair, made by the
 * server itself on first use, kept only in its own storage and never sent
 * anywhere (see worker.ts).
 */
import { toBase64Url } from './base64.ts';

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url. Browsers subscribe with it. */
  publicKey: string;
  privateJwk: JsonWebKey;
}

/** Who to contact about this server, sent with every message (push services require one). */
export const VAPID_SUBJECT = 'https://shkriuss.app';
/** How long a signature is valid (the most push services accept is 24 hours). */
const LIFETIME_SECONDS = 12 * 60 * 60;

const ecdsa = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const encoder = new TextEncoder();

export async function generateVapidKeys(): Promise<VapidKeys> {
  // Extractable only to be stored, as a JWK: Durable Object storage can't
  // keep a key object as it is (audit 3 D-8).
  const pair = await crypto.subtle.generateKey(ecdsa, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey: toBase64Url(publicKey),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
}

const json = (value: unknown) => toBase64Url(encoder.encode(JSON.stringify(value)));

/** The Authorization header for one message to `endpoint`. */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  now: number = Date.now(),
): Promise<string> {
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + LIFETIME_SECONDS,
    sub: VAPID_SUBJECT,
  };
  const unsigned = `${json({ typ: 'JWT', alg: 'ES256' })}.${json(claims)}`;
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, ecdsa, false, ['sign']);
  // Web Crypto signs in the raw r‖s form that ES256 JWTs use.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)),
  );
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}
