import { describe, expect, it } from 'vitest';
import { hasEdits, withEdits } from './edits.ts';

describe('withEdits', () => {
  const opened = { name: 'Shampoo', price: '5', notes: '', tags: ['hair'] };

  it('keeps what another device changed while the form was open', () => {
    const edited = { ...opened, notes: 'Smells nice' };
    const current = { ...opened, price: '6' };
    expect(withEdits(opened, edited, current)).toEqual({
      ...opened,
      price: '6',
      notes: 'Smells nice',
    });
  });

  it('lets the person’s change win when both changed the same field', () => {
    const edited = { ...opened, price: '4' };
    expect(withEdits(opened, edited, { ...opened, price: '6' }).price).toBe('4');
  });

  it('compares lists by what they hold', () => {
    const current = { ...opened, tags: ['hair', 'travel'] };
    expect(withEdits(opened, { ...opened, tags: ['hair'] }, current).tags).toEqual([
      'hair',
      'travel',
    ]);
    expect(withEdits(opened, { ...opened, tags: [] }, current).tags).toEqual([]);
  });
});

describe('hasEdits', () => {
  const opened = { name: 'Shampoo', price: '5', tags: ['hair'] };

  it('tells whether anything in the form was changed', () => {
    expect(hasEdits(opened, { ...opened })).toBe(false);
    expect(hasEdits(opened, { ...opened, tags: ['hair'] })).toBe(false);
    expect(hasEdits(opened, { ...opened, price: '6' })).toBe(true);
    expect(hasEdits(opened, { ...opened, tags: [] })).toBe(true);
  });
});
