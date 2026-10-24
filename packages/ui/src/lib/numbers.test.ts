import { describe, expect, it } from 'vitest';
import { CURRENCIES, formatMoney, parseDecimal } from './numbers.ts';

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

describe('formatMoney', () => {
  it('shows an amount in a currency, in a locale', () => {
    expect(formatMoney(1234.5, 'USD', { locale: 'en-US' })).toBe('$1,234.50');
    expect(formatMoney(12.5, 'EUR', { locale: 'de-DE' })).toMatch(/^12,50\s€$/);
    expect(formatMoney(80, 'GEL', { locale: 'en-US' })).toMatch(/^GEL\s80\.00$/);
    expect(formatMoney(1500, 'JPY', { locale: 'en-US' })).toBe('¥1,500');
  });

  it('shows a sign when asked, but not on zero', () => {
    expect(formatMoney(480, 'USD', { signed: true, locale: 'en-US' })).toBe('+$480.00');
    expect(formatMoney(-120, 'USD', { signed: true, locale: 'en-US' })).toBe('-$120.00');
    expect(formatMoney(0, 'USD', { signed: true, locale: 'en-US' })).toBe('$0.00');
    // The same formatter is reused, and still told apart by its options.
    expect(formatMoney(480, 'USD', { locale: 'en-US' })).toBe('$480.00');
  });

  it('offers currencies the browser knows', () => {
    for (const currency of CURRENCIES) expect(formatMoney(1, currency)).toBeTruthy();
  });
});
