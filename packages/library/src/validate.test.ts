import { describe, expect, it } from 'vitest';
import {
  callerNetwork,
  checkFirstParts,
  checkMove,
  checkRemove,
  checkUnlock,
  isDetails,
  itemListBytes,
  LIMITS,
  NOTE_BYTES,
  parseParts,
  utcDay,
} from './validate.ts';

describe('callerNetwork', () => {
  it('keeps an IPv4 address, and the first 64 bits of an IPv6 one', () => {
    expect(callerNetwork('203.0.113.7')).toBe('203.0.113.7');
    expect(callerNetwork('2001:db8:1:2::abcd')).toBe('2001:db8:1:2');
    expect(callerNetwork('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2');
    expect(callerNetwork('2001:db8::1')).toBe('2001:db8:0:0');
    expect(callerNetwork('::1')).toBe('0:0:0:0');
    expect(callerNetwork('fe80::')).toBe('fe80:0:0:0');
    expect(callerNetwork(null)).toBe('');
  });
});

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

  it('checks removals and their seals, removing doubles', () => {
    expect(checkRemove({ ids: ['photo-0001', 'photo-0001'] })).toEqual({
      ok: true,
      value: [['photo-0001', null]],
    });
    const proof = `k1.${'A'.repeat(47)}`;
    expect(checkRemove({ ids: ['photo-0001', 'photo-0002'], proofs: [proof, proof] })).toEqual({
      ok: true,
      value: [
        ['photo-0001', proof],
        ['photo-0002', proof],
      ],
    });
    // One seal for each id, each one a seal.
    expect(checkRemove({ ids: ['photo-0001'], proofs: [] }).ok).toBe(false);
    expect(checkRemove({ ids: ['photo-0001'], proofs: ['not a seal'] }).ok).toBe(false);
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

// A library's list was counted by no meter, and items with long details
// took ten times what the budget assumed (audit 6): what each counts now.
describe('room in a library’s list', () => {
  /** A row as kept: its key and its value, with what SQLite adds to each (about 32 bytes). */
  const row = (key: string, value: unknown) => key.length + JSON.stringify(value).length + 32;
  /** The biggest numbers a row can hold, so nothing is counted short. */
  const BIG = Number.MAX_SAFE_INTEGER;
  const seqKey = `seq:${String(BIG).padStart(16, '0')}`;
  /** An item's two rows, as the Worker keeps them. */
  const itemRows = (item: { id: string; key: string; details: string; parts: number[] }) =>
    row(seqKey, { ...item, seq: BIG, at: BIG }) +
    row(`item:${item.id}`, { seq: BIG, size: LIMITS.itemBytes, list: 99_999 });
  /** A deletion note's two rows. */
  const noteRows = (id: string, proof: string) =>
    row(seqKey, { id, seq: BIG, deleted: true, at: BIG, proof }) +
    row(`item:${id}`, { seq: BIG, deleted: true, proof });

  it('counts at least what an item’s rows take, however long its id and details', () => {
    for (const id of ['photo-01', 'p'.repeat(64)]) {
      for (const details of ['D'.repeat(40), 'D'.repeat(LIMITS.detailsChars)]) {
        for (const parts of [[LIMITS.itemBytes], Array(LIMITS.parts).fill(23_750_000)]) {
          const item = { id, key: 'k'.repeat(16), details, parts };
          expect(itemListBytes(item)).toBeGreaterThanOrEqual(itemRows(item));
        }
      }
    }
  });

  it('counts a note at least what it takes, and an item never less than its note', () => {
    const proof = `${'k'.repeat(16)}.${'s'.repeat(64)}`;
    expect(NOTE_BYTES).toBeGreaterThanOrEqual(noteRows('p'.repeat(64), proof));
    const smallest = { id: 'photo-01', key: 'k', details: 'D'.repeat(40), parts: [28] };
    expect(itemListBytes(smallest)).toBe(NOTE_BYTES);
  });

  it('counts a photo about 750 bytes, so the room holds about 400,000', () => {
    // Photos' details: when it was taken and added, its name, type, size,
    // width, height and SHA-256, sealed (about 250 characters before).
    const photo = {
      id: crypto.randomUUID(),
      key: 'k1',
      details: 'D'.repeat(366),
      parts: [45_678, 456_789, 3_456_817],
    };
    expect(itemListBytes(photo)).toBeGreaterThan(700);
    expect(itemListBytes(photo)).toBeLessThan(800);
    expect(LIMITS.listBytes / 800).toBe(LIMITS.items);
  });
});

it('counts days in UTC', () => {
  expect(utcDay(Date.UTC(2026, 9, 22, 23, 59))).toBe('2026-10-22');
  expect(utcDay(Date.UTC(2026, 9, 23, 0, 0))).toBe('2026-10-23');
});

// The other tests read these limits from the code, so they check how each
// works, never its value. These pin the values that the docs promise:
// changing one fails here, and means changing those lines too (audit 3 J-4).
describe('the limits the docs promise', () => {
  it('20 wrong storage codes an hour from each internet address', () => {
    // SECURITY.md: "20 wrong tries an hour from each internet address";
    // ADR 0016: "20 wrong codes an hour from each internet address".
    expect(LIMITS.unlockTries).toBe(20);
  });

  it('10,000 uploads a day, 1 TB and 320 MB of lists in all; 400,000 photos per library, 95 MB each', () => {
    // SECURITY.md: "Hard limits across all libraries (1 TB, 320 MB of lists,
    // 10,000 uploads a day), plus 400,000 photos per library and 95 MB
    // each"; ADR 0016: "1 TB stored, 320 MB of lists and 10,000 uploads a
    // day in all", "400,000 photos, and 95 MB per photo", "each note 512
    // bytes"; ADR 0017's table: "320 MB"; docs/deployment.md: "At most
    // 10,000 photos go up a day"; Photos' status line
    // (apps/photos/src/lib/online.ts): "too big to keep online (over 95 MB)".
    expect(LIMITS.uploadsPerDay).toBe(10_000);
    expect(LIMITS.bytes).toBe(1_000_000_000_000);
    expect(LIMITS.listBytes).toBe(320_000_000);
    expect(NOTE_BYTES).toBe(512);
    expect(LIMITS.items).toBe(400_000);
    expect(LIMITS.itemBytes).toBe(95_000_000);
  });
});
