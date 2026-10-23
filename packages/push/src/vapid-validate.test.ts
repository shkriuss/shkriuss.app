import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from './base64.ts';
import { checkSchedule, checkTest, endpointProblem, LIMITS } from './validate.ts';
import { generateVapidKeys, vapidAuthorization, VAPID_SUBJECT } from './vapid.ts';

describe('vapidAuthorization', () => {
  it('signs a short-lived token for the push service', async () => {
    const keys = await generateVapidKeys();
    const now = Date.parse('2026-10-17T10:00:00Z');
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, now);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    if (!match) throw new Error(`Unexpected header: ${header}`);
    const [, head, body, signature, publicKey] = match as unknown as string[];
    expect(publicKey).toBe(keys.publicKey);
    expect(fromBase64Url(keys.publicKey ?? '')).toHaveLength(65);

    const decode = (part: string) => JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
    expect(decode(head ?? '')).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(decode(body ?? '')).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 60 * 60,
      sub: VAPID_SUBJECT,
    });

    const verifyKey = await crypto.subtle.importKey(
      'raw',
      fromBase64Url(keys.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      fromBase64Url(signature ?? ''),
      new TextEncoder().encode(`${head}.${body}`),
    );
    expect(valid).toBe(true);
  });
});

describe('endpointProblem', () => {
  it('accepts the push services browsers use, including UnifiedPush servers', () => {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://web.push.apple.com/QGkz',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://ntfy.example.org/upABC?up=1',
      'https://push.example.net:443/x',
    ]) {
      expect(endpointProblem(endpoint), endpoint).toBeUndefined();
    }
  });

  it('turns down anything else', () => {
    for (const endpoint of [
      'http://fcm.googleapis.com/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://localhost/x',
      'https://intranet/x',
      'https://push.example.net:8443/x',
      'https://user:pass@push.example.net/x',
      'not a url',
      `https://push.example.net/${'x'.repeat(LIMITS.endpointLength)}`,
      42,
    ]) {
      expect(endpointProblem(endpoint), String(endpoint)).toBeDefined();
    }
  });

  it('allows a local receiver only when asked (tests)', () => {
    expect(endpointProblem('http://127.0.0.1:9999/push')).toBeDefined();
    expect(endpointProblem('http://127.0.0.1:9999/push', true)).toBeUndefined();
  });
});

const payload = toBase64Url(new Uint8Array(200));
const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1',
  start: '2026-10-17T14:30',
  repeat: 'weekly',
  until: null,
  offset: 15,
  payload,
  ...overrides,
});
const request = (overrides: Record<string, unknown> = {}) => ({
  endpoint: 'https://web.push.apple.com/abc',
  timeZone: 'Asia/Tbilisi',
  entries: [entry()],
  ...overrides,
});

describe('checkSchedule', () => {
  it('accepts a good schedule and keeps only known fields', () => {
    const result = checkSchedule(request({ entries: [entry({ title: 'Dentist' })] }));
    expect(result).toEqual({
      ok: true,
      value: {
        endpoint: 'https://web.push.apple.com/abc',
        timeZone: 'Asia/Tbilisi',
        entries: [entry()],
      },
    });
  });

  it('turns down messages too big to keep in all', () => {
    // 500 messages of 4 KB: about 2.7 million characters.
    const big = toBase64Url(new Uint8Array(LIMITS.payloadBytes));
    const entries = Array.from({ length: 500 }, (_, index) =>
      entry({ id: `e${index}`, payload: big }),
    );
    expect(checkSchedule(request({ entries }))).toEqual({
      ok: false,
      error: 'Messages too big in all.',
    });
  });

  it('keeps the time zone under its own name, however it was spelt', () => {
    const result = checkSchedule(request({ timeZone: 'aSiA/tBiLiSi' }));
    expect(result.ok && result.value.timeZone).toBe('Asia/Tbilisi');
  });

  it('explains what is wrong', () => {
    const error = (value: unknown) => {
      const result = checkSchedule(value);
      return result.ok ? 'ok' : result.error;
    };
    expect(error(null)).toBe('Expected an object.');
    expect(error(request({ timeZone: 'Mars/Olympus_Mons' }))).toBe('Unknown time zone.');
    expect(error(request({ timeZone: '+04:00' }))).toBe('Unknown time zone.');
    expect(error(request({ entries: Array.from({ length: 501 }, () => entry()) }))).toMatch(/500/);
    expect(error(request({ entries: [entry(), entry()] }))).toMatch(/id used twice/);
    expect(error(request({ entries: [entry({ start: '2026-02-30T10:00' })] }))).toMatch(
      /Bad start/,
    );
    expect(error(request({ entries: [entry({ repeat: 'hourly' })] }))).toMatch(/Bad repeat/);
    expect(error(request({ entries: [entry({ until: '2026-13-01' })] }))).toMatch(/Bad until/);
    expect(error(request({ entries: [entry({ offset: 40321 })] }))).toMatch(/Bad offset/);
    expect(error(request({ entries: [entry({ offset: -1441 })] }))).toMatch(/Bad offset/);
    expect(error(request({ entries: [entry({ payload: 'abc' })] }))).toMatch(/wrong size/);
    expect(
      error(request({ entries: [entry({ payload: toBase64Url(new Uint8Array(4097)) })] })),
    ).toMatch(/wrong size/);
    expect(error(request({ endpoint: 'http://evil.example/x' }))).toMatch(/https/);
  });
});

describe('checkTest', () => {
  it('needs a push address and a message', () => {
    expect(checkTest({ endpoint: 'https://web.push.apple.com/abc', payload }).ok).toBe(true);
    expect(checkTest({ endpoint: 'https://web.push.apple.com/abc' }).ok).toBe(false);
    expect(checkTest({ payload }).ok).toBe(false);
  });
});
