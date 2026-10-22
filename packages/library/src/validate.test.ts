import { describe, expect, it } from 'vitest';
import {
  checkFirstParts,
  checkMove,
  checkRemove,
  checkUnlock,
  isDetails,
  LIMITS,
  parseParts,
  utcDay,
} from './validate.ts';

describe('parseParts', () => {
  it('reads the sizes of an item’s parts', () => {
    expect(parseParts('40,0,300')).toEqual([40, 0, 300]);
    expect(parseParts('28')).toEqual([28]);
  });

  it('refuses sizes that can’t be sealed parts, or are too many or too big', () => {
    for (const header of [
      null,
      '',
      '0',
      '0,0',
      '27',
      '40,10',
      '1,2,3,4,5',
      '40;40',
      '-40',
      '4e3',
    ]) {
      expect(parseParts(header), String(header)).toBeNull();
    }
    expect(parseParts(String(LIMITS.itemBytes))).toEqual([LIMITS.itemBytes]);
    expect(parseParts(String(LIMITS.itemBytes + 1))).toBeNull();
  });
});

describe('bodies', () => {
  it('checks sealed details', () => {
    expect(isDetails('A'.repeat(40))).toBe(true);
    expect(isDetails('A'.repeat(39))).toBe(false);
    expect(isDetails('A'.repeat(LIMITS.detailsChars + 1))).toBe(false);
    expect(isDetails(`${'A'.repeat(40)}=`)).toBe(false);
  });

  it('checks a request for first parts', () => {
    expect(checkFirstParts({ items: [['photo-0001', 100]] })).toEqual({
      ok: true,
      value: [['photo-0001', 100]],
    });
    const many = Array.from({ length: LIMITS.firstParts + 1 }, () => ['photo-0001', 100]);
    for (const body of [
      {},
      { items: [] },
      { items: many },
      { items: [['photo-0001', 10]] },
      { items: [['photo-0001', LIMITS.firstPartBytes + 1]] },
      { items: [['bad id', 100]] },
      { items: [['photo-0001', 100]], extra: 1 },
    ]) {
      expect(checkFirstParts(body).ok, JSON.stringify(body).slice(0, 80)).toBe(false);
    }
  });

  it('checks removals, removing doubles', () => {
    expect(checkRemove({ ids: ['photo-0001', 'photo-0001'] })).toEqual({
      ok: true,
      value: ['photo-0001'],
    });
    expect(checkRemove({ ids: [] }).ok).toBe(false);
    expect(
      checkRemove({ ids: Array.from({ length: 101 }, (_, i) => `photo-${1000 + i}`) }).ok,
    ).toBe(false);
  });

  it('checks the storage code and a move', () => {
    expect(checkUnlock({ code: 'five random words here' })).toEqual({
      ok: true,
      value: 'five random words here',
    });
    expect(checkUnlock({ code: '' }).ok).toBe(false);
    expect(checkUnlock({ code: 'x'.repeat(501) }).ok).toBe(false);
    expect(checkMove({ from: 'A'.repeat(43) }).ok).toBe(true);
    expect(checkMove({ from: 'A'.repeat(42) }).ok).toBe(false);
  });
});

it('counts days in UTC', () => {
  expect(utcDay(Date.UTC(2026, 9, 22, 23, 59))).toBe('2026-10-22');
  expect(utcDay(Date.UTC(2026, 9, 23, 0, 0))).toBe('2026-10-23');
});
