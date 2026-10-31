import { randomBytes, seal, toBase64Url } from '@shkriuss/crypto';
import { describe, expect, it } from 'vitest';
import {
  connectResultUrl,
  connectUrl,
  isConnectKey,
  isTurnOffProof,
  MAX_REPLACED,
  newConnectRequest,
  openConnection,
  parseConnectRequest,
  parseConnectResult,
  parseTurnOff,
  sealForApp,
  turnOffProof,
  turnOffUrl,
} from './connect.ts';
import { observe } from './merge.ts';
import { MAX_OPENED_BYTES, openStores, sealStores, syncKeys } from './snapshot.ts';

describe('connecting an app', () => {
  const connection = { secret: randomBytes(32), code: 'K7Q2-M9XD', replaces: [randomBytes(32)] };

  it('gets the app’s key from the hub to the app, and only to that request', async () => {
    const { request, pending } = await newConnectRequest(
      'calendar',
      'https://calendar.shkriuss.app',
    );
    const url = new URL(connectUrl('https://shkriuss.app', request));
    expect(url.origin + url.pathname).toBe('https://shkriuss.app/account/');
    expect(parseConnectRequest(url.search)).toEqual(request);

    const result = await sealForApp(request, connection);
    const back = new URL(connectResultUrl(request.from, result));
    expect(back.origin).toBe('https://calendar.shkriuss.app');
    const parsed = parseConnectResult(back.hash);
    if (parsed?.kind !== 'sealed') throw new Error('Expected a sealed result');
    expect(await openConnection('calendar', pending, parsed)).toEqual(connection);

    // Another request's key pair can't open it, and it's tied to the app.
    const other = await newConnectRequest('calendar', 'https://calendar.shkriuss.app');
    await expect(openConnection('calendar', other.pending, parsed)).rejects.toThrow();
    await expect(openConnection('tally', pending, parsed)).rejects.toThrow();
  });

  it('carries at most a few replaced keys', async () => {
    const { request, pending } = await newConnectRequest('tally', 'https://tally.shkriuss.app');
    const replaces = Array.from({ length: MAX_REPLACED + 2 }, () => randomBytes(32));
    const parsed = parseConnectResult(
      `#connect=${await sealForApp(request, { ...connection, replaces })}`,
    );
    if (parsed?.kind !== 'sealed') throw new Error('Expected a sealed result');
    expect((await openConnection('tally', pending, parsed)).replaces).toEqual(
      replaces.slice(0, MAX_REPLACED),
    );
  });

  it('reads only well-formed requests and results', () => {
    expect(parseConnectRequest('')).toBeNull();
    expect(parseConnectRequest('?connect=calendar&from=x&key=short&state=short')).toBeNull();
    expect(parseConnectResult('#connect=cancelled')).toEqual({ kind: 'cancelled' });
    for (const hash of ['', '#connect=', '#connect=abc.def', '#link=x.y']) {
      expect(parseConnectResult(hash), hash).toBeNull();
    }
  });

  it('tells a one-time key that isn’t one from a real one (audit 5 A-3)', async () => {
    const { request } = await newConnectRequest('notes', 'https://notes.shkriuss.app');
    expect(await isConnectKey(request.key)).toBe(true);
    // 65 bytes that aren't a point on the curve fit the pattern, but sealing for them throws.
    const junk = toBase64Url(new Uint8Array(65));
    const search = `?connect=notes&from=https://notes.shkriuss.app&key=${junk}&state=${request.state}`;
    expect(parseConnectRequest(search)).toEqual({ ...request, key: junk });
    expect(await isConnectKey(junk)).toBe(false);
    await expect(sealForApp({ ...request, key: junk }, connection)).rejects.toThrow();
  });
});

describe('turning sync off from the hub', () => {
  const T0 = Date.UTC(2026, 9, 27, 12);
  const DAY = 24 * 60 * 60 * 1000;

  it('proves the link is from the account the app syncs with, for the day (audit 5 A-5)', async () => {
    const secret = randomBytes(32);
    const proof = await turnOffProof(secret, T0);
    expect(await turnOffProof(secret, T0 + 60_000)).toBe(proof);
    expect(await turnOffProof(randomBytes(32), T0)).not.toBe(proof);
    expect(await turnOffProof(secret, T0 + DAY)).not.toBe(proof);
    // Not the server's token: the proof never leaves the device.
    expect(proof).not.toBe((await syncKeys(secret)).token);
    // Taken today and tomorrow (the Account page may have been open since
    // before midnight), by the account's apps only, and never later.
    expect(await isTurnOffProof(secret, proof, T0)).toBe(true);
    expect(await isTurnOffProof(secret, proof, T0 + DAY)).toBe(true);
    expect(await isTurnOffProof(secret, proof, T0 + 2 * DAY)).toBe(false);
    expect(await isTurnOffProof(secret, proof, T0 - DAY)).toBe(false);
    expect(await isTurnOffProof(randomBytes(32), proof, T0)).toBe(false);

    const url = new URL(turnOffUrl('https://tally.shkriuss.app', proof));
    expect(url.origin).toBe('https://tally.shkriuss.app');
    expect(parseTurnOff(url.hash)).toBe(proof);
  });

  it('reads only well-formed links', () => {
    for (const hash of ['', '#sync=off', '#sync=off&proof=short', '#sync=connect']) {
      expect(parseTurnOff(hash), hash).toBeNull();
    }
    expect(parseTurnOff(`#sync=off&proof=${'A'.repeat(43)}&more`)).toBeNull();
  });
});

describe('sealed copies', () => {
  it('round-trip, compressed, and only open with the right key and app', async () => {
    const { key } = await syncKeys(randomBytes(32));
    const items = Array.from({ length: 200 }, (_, index) => ({ id: `id-${index}`, name: 'Water' }));
    const stores = { 'shkriuss:tally': observe(undefined, items, 1, 100).snapshot };
    const sealed = await sealStores(key, 'tally', stores, 3);
    expect(sealed).not.toContain('Water');
    expect(sealed.length).toBeLessThan(JSON.stringify(stores).length / 4);
    expect(await openStores(key, 'tally', sealed)).toEqual({ stores, written: 3 });
    await expect(
      openStores((await syncKeys(randomBytes(32))).key, 'tally', sealed),
    ).rejects.toThrow();
    await expect(openStores(key, 'calendar', sealed)).rejects.toThrow();
  });

  it('aren’t opened if they would unpack to more than MAX_OPENED_BYTES (audit E-1)', async () => {
    const { key } = await syncKeys(randomBytes(32));
    // About 64 KB of gzip that unpacks to just over the limit: a lost device
    // could upload a few of those KB, unpacking to gigabytes.
    const zeros = new Blob([new Uint8Array(MAX_OPENED_BYTES + 1)])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));
    const packed = new Uint8Array(await new Response(zeros).arrayBuffer());
    expect(packed.length).toBeLessThan(100_000);
    const sealed = await seal(key, packed, 'shkriuss sync v1 tally');
    await expect(openStores(key, 'tally', sealed)).rejects.toThrow('too much data');
  });

  it('aren’t opened if they nest deeper than any app’s data (audit 3 C-1)', async () => {
    const { key } = await syncKeys(randomBytes(32));
    // Written out, as a device's own JSON.stringify can't go this deep.
    const deep = '['.repeat(5000) + ']'.repeat(5000);
    const file = `{"format":"shkriuss-sync","version":1,"app":"tally","stores":{"x":${deep}}}`;
    const packed = await new Response(
      new Blob([file]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();
    const sealed = await seal(key, new Uint8Array(packed), 'shkriuss sync v1 tally');
    await expect(openStores(key, 'tally', sealed)).rejects.toThrow('Not this app’s sync data');
  });

  it('derive a different token and key for each app key', async () => {
    const a = await syncKeys(randomBytes(32));
    const b = await syncKeys(randomBytes(32));
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(toBase64Url(a.key)).not.toBe(a.token);
  });
});
