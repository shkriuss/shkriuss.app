import { describe, expect, it } from 'vitest';
import {
  concat,
  equalBytes,
  fromBase64Url,
  hkdf,
  open,
  randomBytes,
  seal,
  SealError,
  toBase64Url,
  utf8,
} from './index.ts';

const hex = (text: string) =>
  Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('base64url', () => {
  it('round-trips any bytes without padding or + and /', () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 1]);
    const text = toBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  it('refuses other characters', () => {
    expect(() => fromBase64Url('ab+c')).toThrow();
    expect(() => fromBase64Url('ab c')).toThrow();
  });

  it('joins byte strings', () => {
    expect(concat(new Uint8Array([1]), new Uint8Array([2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe('hkdf', () => {
  it('matches RFC 5869 test case 1', async () => {
    const okm = await hkdf(
      hex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'),
      hex('f0f1f2f3f4f5f6f7f8f9'),
      42,
      hex('000102030405060708090a0b0c'),
    );
    expect(toHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('gives a different key for each purpose, and the same key every time', async () => {
    const secret = randomBytes(32);
    const a = await hkdf(secret, 'purpose a');
    expect(a).toHaveLength(32);
    expect(await hkdf(secret, 'purpose a')).toEqual(a);
    expect(equalBytes(await hkdf(secret, 'purpose b'), a)).toBe(false);
  });
});

describe('seal and open', () => {
  it('round-trips, with a fresh IV every time', async () => {
    const key = randomBytes(32);
    const first = await seal(key, utf8('hello'), 'label');
    const second = await seal(key, utf8('hello'), 'label');
    expect(first).not.toBe(second);
    expect(new TextDecoder().decode(await open(key, first, 'label'))).toBe('hello');
  });

  it('refuses the wrong key, the wrong label and any change', async () => {
    const key = randomBytes(32);
    const sealed = await seal(key, utf8('hello'), 'label');
    await expect(open(randomBytes(32), sealed, 'label')).rejects.toBeInstanceOf(SealError);
    await expect(open(key, sealed, 'other label')).rejects.toBeInstanceOf(SealError);
    const bytes = fromBase64Url(sealed);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 1;
    await expect(open(key, toBase64Url(bytes), 'label')).rejects.toBeInstanceOf(SealError);
    await expect(open(key, 'not base64!', 'label')).rejects.toBeInstanceOf(SealError);
    await expect(open(key, 'AAAA', 'label')).rejects.toBeInstanceOf(SealError);
  });

  it('only takes 32-byte keys', async () => {
    await expect(seal(randomBytes(16), utf8('x'), 'label')).rejects.toThrow();
  });
});

describe('equalBytes', () => {
  it('compares contents', () => {
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(equalBytes(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
