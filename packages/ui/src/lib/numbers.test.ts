import { describe, expect, it } from 'vitest';
import { parseDecimal } from './numbers.ts';

describe('parseDecimal', () => {
  it('reads a point or a comma as the decimal separator', () => {
    expect(parseDecimal('12.50')).toBe(12.5);
    expect(parseDecimal('12,50')).toBe(12.5);
    expect(parseDecimal(',5')).toBe(0.5);
    expect(parseDecimal('3.')).toBe(3);
    expect(parseDecimal(' 1 234,5 ')).toBe(1234.5);
    expect(parseDecimal('-2')).toBe(-2);
  });

  it('says empty is empty, and anything ambiguous isn’t a number', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
    for (const text of ['1.234,50', '1,500.25', '1,2,3', '1e3', '12a', '.', 'Infinity']) {
      expect(parseDecimal(text), text).toBeNaN();
    }
  });
});
