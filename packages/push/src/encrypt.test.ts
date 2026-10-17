import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from './base64.ts';
import { decryptPayload, encryptPayload, MAX_PLAINTEXT_BYTES } from './encrypt.ts';

// The worked example in RFC 8291, Appendix A and section 5.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** Imports a P-256 ECDH key pair from its private scalar and public point. */
async function keyPair(privateKey: string, publicKey: string): Promise<CryptoKeyPair> {
  const point = fromBase64Url(publicKey);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKey,
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33, 65)),
  };
  const algorithm = { name: 'ECDH', namedCurve: 'P-256' };
  return {
    privateKey: await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', point, algorithm, true, []),
  };
}

const encoder = new TextEncoder();
const target = { p256dh: fromBase64Url(RFC.uaPublic), auth: fromBase64Url(RFC.auth) };

describe('encryptPayload', () => {
  it('matches the RFC 8291 example byte for byte', async () => {
    const body = await encryptPayload(encoder.encode(RFC.plaintext), target, {
      senderKeys: await keyPair(RFC.asPrivate, RFC.asPublic),
      salt: fromBase64Url(RFC.salt),
    });
    expect(toBase64Url(body)).toBe(RFC.body);
  });

  it('can be opened by the receiving browser, and only by it', async () => {
    const receiver = await keyPair(RFC.uaPrivate, RFC.uaPublic);
    const body = await encryptPayload(encoder.encode('{"title":"Dentist"}'), target);
    const opened = await decryptPayload(body, {
      privateKey: receiver.privateKey,
      publicKey: target.p256dh,
      auth: target.auth,
    });
    expect(new TextDecoder().decode(opened)).toBe('{"title":"Dentist"}');

    const stranger = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
      'deriveBits',
    ]);
    await expect(
      decryptPayload(body, {
        privateKey: stranger.privateKey,
        publicKey: target.p256dh,
        auth: target.auth,
      }),
    ).rejects.toThrow();
  });

  it('uses a new key and salt for every message', async () => {
    const a = await encryptPayload(encoder.encode('same'), target);
    const b = await encryptPayload(encoder.encode('same'), target);
    expect(toBase64Url(a)).not.toBe(toBase64Url(b));
  });

  it('keeps messages within the 4096 bytes push services accept', async () => {
    const longest = await encryptPayload(new Uint8Array(MAX_PLAINTEXT_BYTES), target);
    expect(longest.length).toBe(4096);
    await expect(encryptPayload(new Uint8Array(MAX_PLAINTEXT_BYTES + 1), target)).rejects.toThrow(
      /too long/,
    );
  });
});
