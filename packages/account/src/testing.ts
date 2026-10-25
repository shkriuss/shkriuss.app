/**
 * A passkey for tests: makes a key pair and signs like an authenticator, for
 * any page (./webauthn.ts checks what it signs). Real passkeys only sign for
 * the page that asks, with its real address.
 */
import { sha256, toBase64Url, utf8 } from '@shkriuss/crypto';
import { challengeFor, type Assertion, type PasskeyKey, type Purpose } from './webauthn.ts';

/** The Account page on the real site. */
export const HUB = { origin: 'https://shkriuss.app', rpId: 'shkriuss.app' };

/** Writes an ECDSA signature (r and s, as WebCrypto gives it) as ASN.1 DER, as WebAuthn does. */
function der(raw: Uint8Array): Uint8Array<ArrayBuffer> {
  const integer = (bytes: Uint8Array) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    const trimmed = bytes.subarray(start);
    const padded = (trimmed[0] ?? 0) & 0x80 ? [0, ...trimmed] : [...trimmed];
    return [0x02, padded.length, ...padded];
  };
  const body = [...integer(raw.subarray(0, 32)), ...integer(raw.subarray(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

/** A passkey in a test: signs like an authenticator, for any page. */
export async function testPasskey(algorithm: -7 | -257) {
  const pair =
    algorithm === -7
      ? await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
          'sign',
          'verify',
        ])
      : await crypto.subtle.generateKey(
          {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
          },
          true,
          ['sign', 'verify'],
        );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  const key: PasskeyKey = { publicKey: toBase64Url(spki), algorithm };

  async function sign(options: {
    origin?: string;
    rpId?: string;
    purpose?: Purpose;
    type?: string;
    flags?: number;
    time?: number;
    challenge?: Uint8Array<ArrayBuffer>;
  }): Promise<Assertion> {
    const challenge = options.challenge ?? challengeFor(options.purpose ?? 'open', options.time);
    const clientData = utf8(
      JSON.stringify({
        type: options.type ?? 'webauthn.get',
        challenge: toBase64Url(challenge),
        origin: options.origin ?? HUB.origin,
        crossOrigin: false,
      }),
    );
    const authenticatorData = new Uint8Array(37);
    authenticatorData.set(await sha256(utf8(options.rpId ?? HUB.rpId)));
    authenticatorData[32] = options.flags ?? 0x05;
    authenticatorData[36] = 1;
    const signed = new Uint8Array([...authenticatorData, ...(await sha256(clientData))]);
    const raw = new Uint8Array(
      algorithm === -7
        ? await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed)
        : await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, signed),
    );
    return {
      authenticatorData: toBase64Url(authenticatorData),
      clientDataJSON: toBase64Url(clientData),
      signature: toBase64Url(algorithm === -7 ? der(raw) : raw),
    };
  }
  return { key, sign };
}
