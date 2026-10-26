import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  currencyDigits,
  decimalText,
  formatMoney,
  parseDecimal,
  parseWhole,
  roundDecimal,
} from './numbers.ts';

/** Expects each text to read as its number (or NaN, or null) in `locale`. */
function reads(locale: string, cases: Record<string, number | null>): void {
  for (const [text, value] of Object.entries(cases)) {
    expect(parseDecimal(text, locale), `${locale} "${text}"`).toBe(value);
  }
}

describe('parseDecimal', () => {
  it('reads a point or a comma as the decimal sign, in any locale', () => {
    for (const locale of ['en-US', 'de-DE', 'fr-FR', 'ka-GE', 'ar-EG']) {
      reads(locale, {
        '12.50': 12.5,
        '12,50': 12.5,
        ',5': 0.5,
        '3.': 3,
        ' 1 234,5 ': 1234.5,
        '-2': -2,
        '0,500': 0.5,
        '1,5000': 1.5,
      });
    }
  });

  it('says empty is empty, and anything else isn’t a number', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
    for (const text of ['1,2,3', '1e3', '12a', '.', ',', '-', 'Infinity', '0x10', '1 e3', '−5']) {
      expect(parseDecimal(text, 'en-US'), text).toBeNaN();
      expect(parseDecimal(text, 'de-DE'), text).toBeNaN();
    }
  });

  // Audit F2-1: a thousands separator was read as a decimal sign ("2,000" saved as 2).
  it('reads thousands the way the locale writes them', () => {
    reads('en-US', {
      '1,500': 1500,
      '2,000': 2000,
      '12,345': 12_345,
      '1,234.50': 1234.5,
      '1,234,567': 1_234_567,
      '1.500': 1.5,
      '1.234,50': Number.NaN,
      '1,23,456': Number.NaN,
      '1.500.000': Number.NaN,
      '1,500.25.5': Number.NaN,
      "1'500": Number.NaN,
    });
    reads('de-DE', {
      '1.500': 1500,
      '120.000': 120_000,
      '1,500': 1.5,
      '1.234,50': 1234.5,
      '1.234.567': 1_234_567,
      '0.500': 0.5,
      '1,234.50': Number.NaN,
      '1.234.50': Number.NaN,
    });
    // Thousands are grouped with a space in French and Georgian.
    reads('fr-FR', { '1\u202F234,56': 1234.56, '1 500': 1500, '1,500': 1.5, '1.500': 1.5 });
    reads('ka-GE', { '1\u00A0500': 1500, '1,500': 1.5, '1.500': 1.5, '1.234,5': Number.NaN });
    // India groups by two after the first three; one sign is still one thousand.
    reads('en-IN', { '1,23,456': 123_456, '12,34,567.5': 1_234_567.5, '123,456': 123_456 });
    reads('en-IN', { '1,234,567': Number.NaN });
    // Switzerland groups with an apostrophe (typed straight, or curly by a phone).
    reads('de-CH', { "1'500": 1500, '1’500': 1500, "1'234.50": 1234.5, "1'50": Number.NaN });
  });

  // Audit 3 F2-4: spaces were left out wherever they were, so "12 50" was 1,250.
  it('reads a space between digits as grouping thousands, checked like a comma', () => {
    for (const locale of ['en-US', 'de-DE', 'fr-FR', 'ka-GE']) {
      reads(locale, {
        '1 500': 1500,
        '12 345 678': 12_345_678,
        '1 500,5': 1500.5,
        '12 50': Number.NaN,
        '1 2': Number.NaN,
        '0 500': Number.NaN,
        '1 500 00': Number.NaN,
        '12,5 0': Number.NaN,
      });
    }
    // A comma or point after the spaces can only be the decimal sign.
    reads('en-US', { '1 234,5': 1234.5, '1 234.50': 1234.5, '1 23 456': Number.NaN });
    reads('en-IN', { '1 23 456': 123_456, '1 500': 1500 });
    // The no-break spaces locales group with, as when a number is copied.
    reads('fr-FR', { '1 234 567,5': 1_234_567.5, '1 500': 1500 });
    // Spaces that aren't between digits are left out.
    reads('en-US', { ' -5 ': -5, '- 5': -5, '12 ,50': 12.5 });
    expect(parseWhole('12 50', 'fr-FR')).toBeNaN();
    expect(parseWhole('120 000', 'en-US')).toBe(120_000);
  });

  // Audit F2-10: amounts were shown in the browser's own digits, and those were refused.
  it('reads digits the way the browser shows them', () => {
    for (const locale of ['ar-EG', 'fa-IR', 'bn-BD', 'mr-IN', 'en-US']) {
      const shown = new Intl.NumberFormat(locale).format(1234567.5);
      expect(parseDecimal(shown, locale), `${locale} "${shown}"`).toBe(1234567.5);
      expect(parseDecimal(new Intl.NumberFormat(locale).format(12.5), locale)).toBe(12.5);
    }
    reads('ar-EG', {
      '١٢٫٥٠': 12.5,
      '١٬٥٠٠': 1500,
      '١٬٢٣٤٫٥': 1234.5,
      '١٬٥٠': Number.NaN,
      // Typed with a Latin keyboard, Arabic's ٬ is a comma.
      '1,500': 1500,
      '12,50': 12.5,
    });
    // Arabic's signs mean the same in any locale.
    reads('de-DE', { '١٫٥٠٠': 1.5, '١٬٥٠٠': 1500 });
    // Full-width digits, as Japanese keyboards type them.
    reads('ja-JP', { '１，５００': 1500, '１２．５': 12.5 });
  });
});

describe('parseWhole', () => {
  it('reads whole numbers, thousands too, and nothing with a decimal sign', () => {
    expect(parseWhole('120.000', 'de-DE')).toBe(120_000);
    expect(parseWhole('120,000', 'en-US')).toBe(120_000);
    expect(parseWhole('120 000', 'fr-FR')).toBe(120_000);
    expect(parseWhole('١٢٠٬٠٠٠', 'ar-EG')).toBe(120_000);
    expect(parseWhole(' 120000 ', 'en-US')).toBe(120_000);
    expect(parseWhole('', 'en-US')).toBeNull();
    for (const text of ['120.000', '12,5', '1e3', '0x10', '1.5', 'abc']) {
      expect(parseWhole(text, 'en-US'), text).toBeNaN();
    }
    expect(parseWhole('12,5', 'de-DE')).toBeNaN();
  });
});

describe('decimalText', () => {
  it('writes plain digits with the locale’s decimal sign, never an exponent', () => {
    expect(decimalText(12.5, 'en-US')).toBe('12.5');
    expect(decimalText(12.5, 'de-DE')).toBe('12,5');
    expect(decimalText(12.5, 'ar-EG')).toBe('12.5');
    expect(decimalText(1234.5, 'en-US')).toBe('1234.5');
    expect(decimalText(0, 'en-US')).toBe('0');
    expect(decimalText(-2.5, 'en-US')).toBe('-2.5');
    // String() would give "1.5e-9" and "1e+21".
    expect(decimalText(1.5e-9, 'en-US')).toBe('0.0000000015');
    expect(decimalText(5e-7, 'en-US')).toBe('0.0000005');
    expect(decimalText(1e12, 'en-US')).toBe('1000000000000');
    expect(decimalText(1.5e21, 'en-US')).toBe('1500000000000000000000');
  });

  it('is read back as the same number', () => {
    const values = [1.5e-9, 1.234e-9, 5e-7, 0.1, 0.3, 1.234, 12.5, 1234.5, 123_456.789, 1e12, 1e21];
    for (const locale of ['en-US', 'de-DE', 'fr-FR', 'ka-GE', 'ar-EG', 'en-IN', 'de-CH']) {
      for (const value of values) {
        expect(parseDecimal(decimalText(value, locale), locale), `${locale} ${value}`).toBe(value);
      }
    }
  });
});

describe('roundDecimal', () => {
  it('rounds by the digits as written, half away from zero', () => {
    // 1.005 * 100 is 100.49999999999999.
    expect(roundDecimal(1.005, 2)).toBe(1.01);
    expect(roundDecimal(1.004, 2)).toBe(1);
    expect(roundDecimal(-1.005, 2)).toBe(-1.01);
    expect(roundDecimal(1_234_567.005, 2)).toBe(1_234_567.01);
    expect(roundDecimal(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundDecimal(2.5, 0)).toBe(3);
    expect(roundDecimal(1.5e-9, 8)).toBe(0);
    expect(roundDecimal(1e21, 2)).toBe(1e21);
  });

  // Audit F2-11: a sum that's a tiny bit below 0 was shown as "-$0.00".
  it('never gives -0', () => {
    expect(Object.is(roundDecimal(3.3 - 1.1 - 2.2, 2), 0)).toBe(true);
    expect(Object.is(roundDecimal(-0, 2), 0)).toBe(true);
    expect(Object.is(roundDecimal(-0.001, 2), 0)).toBe(true);
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

  it('offers currencies the browser knows, with their own decimals', () => {
    for (const currency of CURRENCIES) expect(formatMoney(1, currency)).toBeTruthy();
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('GEL')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
  });
});
