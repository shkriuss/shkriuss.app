import { toBase64Url } from '@shkriuss/crypto';
import { describe, expect, it } from 'vitest';
import { HUB, testPasskey as passkey } from './testing.ts';
import { CHALLENGE_WINDOW_MS, checkAssertion } from './webauthn.ts';

const open = { ...HUB, purpose: 'open' as const };

describe('checking a passkey’s signature', () => {
  it.each([-7, -257] as const)(
    'accepts one made on the Account page (algorithm %i)',
    async (alg) => {
      const { key, sign } = await passkey(alg);
      expect(await checkAssertion(await sign({}), key, open)).toBe(true);
    },
  );

  it('refuses one made on any other page, such as an app’s (audit C-1)', async () => {
    const { key, sign } = await passkey(-7);
    const fromApp = await sign({ origin: 'https://tally.shkriuss.app' });
    expect(await checkAssertion(fromApp, key, open)).toBe(false);
  });

  it('refuses one made for something else, or long ago', async () => {
    const { key, sign } = await passkey(-7);
    expect(await checkAssertion(await sign({ purpose: 'remove' }), key, open)).toBe(false);
    expect(await checkAssertion(await sign({ type: 'webauthn.create' }), key, open)).toBe(false);
    const old = Date.now() - CHALLENGE_WINDOW_MS - 60_000;
    expect(await checkAssertion(await sign({ time: old }), key, open)).toBe(false);
    // A device whose clock is a few hours off is fine.
    const late = Date.now() - 3 * 60 * 60 * 1000;
    expect(await checkAssertion(await sign({ time: late }), key, open)).toBe(true);
  });

  it('refuses one for another domain, or without the person there and the passkey unlocked', async () => {
    const { key, sign } = await passkey(-7);
    expect(await checkAssertion(await sign({ rpId: 'tally.shkriuss.app' }), key, open)).toBe(false);
    expect(await checkAssertion(await sign({ flags: 0x01 }), key, open)).toBe(false);
    expect(await checkAssertion(await sign({ flags: 0x04 }), key, open)).toBe(false);
  });

  it('refuses another passkey’s signature, a changed one, and nonsense', async () => {
    const mine = await passkey(-7);
    const other = await passkey(-7);
    expect(await checkAssertion(await other.sign({}), mine.key, open)).toBe(false);

    const signed = await mine.sign({});
    const changed = { ...signed, authenticatorData: toBase64Url(new Uint8Array(37)) };
    expect(await checkAssertion(changed, mine.key, open)).toBe(false);
    expect(await checkAssertion({ ...signed, signature: 'AAAA' }, mine.key, open)).toBe(false);
    expect(await checkAssertion({ ...signed, clientDataJSON: '***' }, mine.key, open)).toBe(false);
    expect(await checkAssertion(signed, { ...mine.key, algorithm: -8 }, open)).toBe(false);
    expect(await checkAssertion(signed, { ...mine.key, publicKey: 'AAAA' }, open)).toBe(false);
  });
});
