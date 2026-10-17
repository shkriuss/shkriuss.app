import { describe, expect, it } from 'vitest';
import {
  accountCodeOf,
  appSecretOf,
  generateSecret,
  parseRecoveryKey,
  RECOVERY_KEY_CHARS,
  recoveryKeyOf,
} from './secret.ts';

const fixed = Uint8Array.from({ length: 32 }, (_, index) => index * 7);

describe('recovery keys', () => {
  it('writes the secret as 14 groups of 4 letters and digits', async () => {
    const key = await recoveryKeyOf(generateSecret());
    expect(key).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(key.replace(/-/g, '')).toHaveLength(RECOVERY_KEY_CHARS);
  });

  it('is always the same for the same secret', async () => {
    expect(await recoveryKeyOf(fixed)).toBe(await recoveryKeyOf(new Uint8Array(fixed)));
  });

  it('reads back the exact secret', async () => {
    for (let round = 0; round < 20; round += 1) {
      const secret = generateSecret();
      const parsed = await parseRecoveryKey(await recoveryKeyOf(secret));
      expect(parsed).toEqual({ ok: true, secret });
    }
  });

  it('forgives case, spaces, dashes and look-alike letters', async () => {
    const key = await recoveryKeyOf(fixed);
    const messy = ` ${key.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l')} `;
    expect(await parseRecoveryKey(messy)).toEqual({ ok: true, secret: fixed });
  });

  it('catches typos', async () => {
    const key = await recoveryKeyOf(fixed);
    const swap = (text: string, at: number) => {
      const replacement = text[at] === 'A' ? 'B' : 'A';
      return text.slice(0, at) + replacement + text.slice(at + 1);
    };
    for (const at of [0, 7, 30, 52, key.length - 1]) {
      if (key[at] === '-') continue;
      expect(await parseRecoveryKey(swap(key, at))).toEqual({ ok: false, problem: 'typo' });
    }
    // Two neighbouring groups swapped.
    const parts = key.split('-');
    [parts[2], parts[3]] = [parts[3] as string, parts[2] as string];
    expect(await parseRecoveryKey(parts.join('-'))).toEqual({ ok: false, problem: 'typo' });
  });

  it('says when it isn’t a recovery key at all', async () => {
    const key = await recoveryKeyOf(fixed);
    for (const text of [
      '',
      'hello',
      key.slice(0, -5),
      `${key}-ABCD`,
      key.replace(/[0-9A-Z]$/, 'U'),
    ]) {
      expect(await parseRecoveryKey(text)).toEqual({ ok: false, problem: 'format' });
    }
  });
});

describe('account codes', () => {
  it('are short, stable and different per account', async () => {
    const code = await accountCodeOf(fixed);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(await accountCodeOf(new Uint8Array(fixed))).toBe(code);
    expect(await accountCodeOf(generateSecret())).not.toBe(code);
  });

  it('don’t appear in the recovery key', async () => {
    const code = (await accountCodeOf(fixed)).replace('-', '');
    expect((await recoveryKeyOf(fixed)).replace(/-/g, '')).not.toContain(code);
  });
});

describe('app keys', () => {
  it('are different for each app and each account, and the same every time', async () => {
    const calendar = await appSecretOf(fixed, 'calendar');
    expect(calendar).toHaveLength(32);
    expect(await appSecretOf(new Uint8Array(fixed), 'calendar')).toEqual(calendar);
    expect(await appSecretOf(fixed, 'tally')).not.toEqual(calendar);
    expect(await appSecretOf(generateSecret(), 'calendar')).not.toEqual(calendar);
    expect(calendar).not.toEqual(fixed);
  });
});
