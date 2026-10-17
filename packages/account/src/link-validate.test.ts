import { toBase64Url } from '@shkriuss/crypto';
import { describe, expect, it } from 'vitest';
import { parseLinkFragment } from './link.ts';
import { checkSealedBody, MAX_SEALED_CHARS } from './validate.ts';

const id = toBase64Url(new Uint8Array(16).fill(7));
const key = new Uint8Array(32).fill(9);

describe('parseLinkFragment', () => {
  it('reads the id and key after "#link="', () => {
    expect(parseLinkFragment(`#link=${id}.${toBase64Url(key)}`)).toEqual({ id, key });
  });

  it('ignores anything else', () => {
    for (const hash of [
      '',
      '#',
      '#main',
      `#link=${id}`,
      `#link=${id}.short`,
      `#link=${id}x.${toBase64Url(key)}`,
      `#link=${id}.${toBase64Url(key)}&more`,
      `#other=${id}.${toBase64Url(key)}`,
    ]) {
      expect(parseLinkFragment(hash), hash).toBeNull();
    }
  });
});

describe('checkSealedBody', () => {
  const sealed = 'A'.repeat(80);

  it('accepts exactly one sealed field', () => {
    expect(checkSealedBody({ data: sealed }, 'data')).toEqual({ ok: true, value: sealed });
    expect(checkSealedBody({ wrap: sealed }, 'wrap')).toEqual({ ok: true, value: sealed });
  });

  it('refuses other shapes, extra fields and odd values', () => {
    for (const body of [
      null,
      [],
      'text',
      {},
      { data: sealed, extra: 1 },
      { wrap: sealed },
      { data: 12 },
      { data: 'short' },
      { data: 'A'.repeat(MAX_SEALED_CHARS + 1) },
      { data: `${'A'.repeat(60)}+/=` },
    ]) {
      expect(checkSealedBody(body, 'data').ok, JSON.stringify(body)).toBe(false);
    }
  });
});
