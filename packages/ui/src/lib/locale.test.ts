import { describe, expect, it } from 'vitest';
import { dayLabel, englishLocale, monthLabel, ordinal, timeLabel } from './locale.ts';

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

describe('timeLabel', () => {
  it("writes a time of day in the person's style", () => {
    expect(timeLabel('20:05', 'en-US')).toMatch(/^8:05\s?PM$/);
    expect(timeLabel('08:00', 'en-US')).toMatch(/^8:00\s?AM$/);
    expect(timeLabel('00:00', 'en-US')).toMatch(/^12:00\s?AM$/);
    expect(timeLabel('20:05', 'en-GB')).toBe('20:05');
    expect(timeLabel('00:00', 'en-GB')).toBe('0:00');
    expect(timeLabel('23:59', englishLocale(['ka-GE']))).toBe('23:59');
  });
});

describe('dayLabel', () => {
  it('says today and yesterday in words', () => {
    expect(dayLabel('2026-10-26', '2026-10-26', 'en-GB')).toBe('Today');
    expect(dayLabel('2026-10-25', '2026-10-26', 'en-GB')).toBe('Yesterday');
    // Across a month and a year.
    expect(dayLabel('2026-12-31', '2027-01-01', 'en-GB')).toBe('Yesterday');
  });

  it('writes other days with their weekday', () => {
    expect(dayLabel('2026-10-24', '2026-10-26', 'en-GB')).toBe('Saturday 24 October');
    expect(dayLabel('2026-10-24', '2026-10-26', 'en-US')).toBe('Saturday, October 24');
    // A day after today isn't "Tomorrow": these lists have only past days.
    expect(dayLabel('2026-10-27', '2026-10-26', 'en-GB')).toBe('Tuesday 27 October');
  });
});

describe('monthLabel', () => {
  it('writes a month with its year', () => {
    expect(monthLabel('2026-10', 'en-GB')).toBe('October 2026');
    expect(monthLabel('2027-01', 'en-US')).toBe('January 2027');
    expect(monthLabel('2026-12', englishLocale(['ar-EG']))).toBe('December 2026');
  });
});

describe('ordinal', () => {
  it('writes English ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '31st',
    ]);
  });
});
