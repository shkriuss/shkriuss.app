import { describe, expect, it } from 'vitest';
import { englishLocale } from './locale.ts';

const weekday = (locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
    Date.UTC(2026, 9, 26),
  );
const time = (locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    Date.UTC(2026, 9, 26, 21),
  );

describe('englishLocale', () => {
  it("keeps the person's own kind of English", () => {
    expect(englishLocale(['en-US'])).toBe('en-US');
    expect(englishLocale(['ka-GE', 'en-AU', 'en-US'])).toBe('en-AU');
    expect(englishLocale(['EN'])).toBe('EN');
  });

  it('names days in English on a phone set to another language', () => {
    expect(weekday(englishLocale(['ka-GE']))).toBe('Monday');
    expect(weekday(englishLocale(['ar-EG']))).toBe('Monday');
  });

  it("keeps the 12- or 24-hour clock of the person's language", () => {
    expect(time(englishLocale(['ka-GE']))).toBe('21:00');
    expect(time(englishLocale(['ko-KR']))).toMatch(/^9:00\s?pm$/i);
  });

  it('falls back to British English', () => {
    expect(englishLocale([])).toMatch(/^en-GB/);
    expect(englishLocale(['not a language tag'])).toMatch(/^en-GB/);
    // Some systems report their language like this; every date would fail to show.
    expect(englishLocale(['en-US@posix'])).toBe('en-US');
    expect(englishLocale(['', 'ka-GE'])).toMatch(/^en-GB/);
  });
});
