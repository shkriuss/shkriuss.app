import { describe, expect, it } from 'vitest';
import { roomNote } from './room-note.ts';

describe('roomNote', () => {
  const trades = (count: number) =>
    roomNote({
      app: 'Trades',
      count,
      most: 2000,
      one: 'trade',
      many: 'trades',
      also: ', open and closed',
      makeRoom: 'To make room, use “Delete a year…”, below.',
      locale: 'en-US',
    });

  it('says nothing until over 90% is kept', () => {
    expect(trades(0)).toBeNull();
    expect(trades(1800)).toBeNull();
  });

  it('says how many more fit, and how to make room', () => {
    expect(trades(1801)).toBe(
      'Trades is nearly full: there’s room for 199 more trades (it keeps up to 2,000, open and closed). To make room, use “Delete a year…”, below.',
    );
    expect(trades(1999)).toContain('there’s room for 1 more trade (');
  });

  it('says when it’s full, and also past full (from another device)', () => {
    const full =
      'Trades is full: it keeps up to 2,000 trades, open and closed. To make room, use “Delete a year…”, below.';
    expect(trades(2000)).toBe(full);
    expect(trades(2100)).toBe(full);
  });
});
