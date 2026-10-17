import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  daysInMonth,
  isIsoDate,
  isIsoTime,
  minutesOf,
  monthGrid,
  sameDayInMonth,
  shiftMonth,
  today,
  weekday,
} from './dates.ts';

describe('validation', () => {
  it.each(['2026-10-17', '2024-02-29', '2000-02-29', '1999-12-31'])('accepts %s', (date) => {
    expect(isIsoDate(date)).toBe(true);
  });
  it.each(['2026-13-01', '2026-02-29', '1900-02-29', '2026-4-1', '17/10/2026', '', 20261017])(
    'rejects %j',
    (date) => {
      expect(isIsoDate(date)).toBe(false);
    },
  );
  it('validates times', () => {
    expect(isIsoTime('00:00')).toBe(true);
    expect(isIsoTime('23:59')).toBe(true);
    expect(isIsoTime('24:00')).toBe(false);
    expect(isIsoTime('9:30')).toBe(false);
    expect(minutesOf('14:30')).toBe(870);
  });
});

describe('arithmetic', () => {
  it('adds days across months, years and daylight-saving changes', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // DST start in Europe
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(daysBetween('2026-10-17', '2026-10-24')).toBe(7);
  });

  it('knows month lengths and weekdays', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(weekday('2026-10-17')).toBe(6); // Saturday
    expect(weekday('2026-10-18')).toBe(7); // Sunday
  });

  it('moves between months', () => {
    expect(shiftMonth('2026-10-17', 1)).toBe('2026-11-01');
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01');
    expect(shiftMonth('2026-12-01', 13)).toBe('2028-01-01');
    expect(sameDayInMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(sameDayInMonth('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('reads today from the device clock', () => {
    expect(today(new Date(2026, 9, 17, 23, 59))).toBe('2026-10-17');
  });
});

describe('monthGrid', () => {
  it('lays out October 2026 with Monday first', () => {
    const weeks = monthGrid('2026-10-01', 1);
    // 1 October 2026 is a Thursday: three empty cells first.
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(weeks).toHaveLength(5);
    expect(weeks.at(-1)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      null,
    ]);
  });

  it('lays out with Sunday first', () => {
    const weeks = monthGrid('2026-10-01', 7);
    expect(weeks[0]?.slice(0, 5)).toEqual([null, null, null, null, '2026-10-01']);
  });

  it('always has complete weeks', () => {
    for (let month = 1; month <= 12; month += 1) {
      const weeks = monthGrid(`2026-${String(month).padStart(2, '0')}-01`, 1);
      expect(weeks.every((week) => week.length === 7)).toBe(true);
      expect(weeks.flat().filter(Boolean)).toHaveLength(daysInMonth(2026, month));
    }
  });
});
