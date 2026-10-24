import { describe, expect, it } from 'vitest';
import { compareText, foldText } from './text.ts';

describe('compareText', () => {
  it('sorts like localeCompare, ignoring case and accents, with numbers in order', () => {
    const names = ['item 10', 'Item 2', 'éclair', 'Banana', 'apple', 'eclair'];
    expect([...names].sort(compareText)).toEqual(
      [...names].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }),
      ),
    );
    expect(compareText('Café', 'cafe')).toBe(0);
    expect(compareText('Bus 2', 'Bus 10')).toBeLessThan(0);
  });
});

describe('foldText', () => {
  it('drops case, accents and extra spaces', () => {
    expect(foldText('  Café  au   Lait ')).toBe('cafe au lait');
    expect(foldText('Crème\tbrûlée\n')).toBe('creme brulee');
    expect(foldText('ÇAĞRI')).toBe(foldText('çağri'));
    expect(foldText('')).toBe('');
  });
});
