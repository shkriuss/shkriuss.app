import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMinutes,
  daysBetween,
  daysInMonth,
  isIsoDate,
  isIsoTime,
  minutesOf,
  monthGrid,
  nowStamp,
  sameDayInMonth,
  shiftMonth,
  shiftTime,
  stampMinutes,
  today,
  weekday,
} from './dates.ts';

describe('validation', () => {
  it.each(['2026-10-17', '2024-02-29', '2000-02-29', '1999-12-31'])('accepts %s', (date) => {
    expect(isIsoDate(date)).toBe(true);
  });
  it.each([
    '2026-13-01',
    '2026-02-29',
    '1900-02-29',
    '2026-4-1',
    '0050-01-01',
    '17/10/2026',
    '',
    20261017,
  ])('rejects %j', (date) => {
    expect(isIsoDate(date)).toBe(false);
  });
  it('validates times', () => {
    expect(isIsoTime('00:00')).toBe(true);
    expect(isIsoTime('23:59')).toBe(true);
    expect(isIsoTime('24:00')).toBe(false);
    expect(isIsoTime('9:30')).toBe(false);
    expect(minutesOf('14:30')).toBe(870);
  });
  it('moves times within the day only', () => {
    expect(shiftTime('09:00', 330)).toBe('14:30');
    expect(shiftTime('10:15', -615)).toBe('00:00');
    expect(shiftTime('23:00', 60)).toBeNull();
    expect(shiftTime('00:30', -31)).toBeNull();
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

describe('stamps', () => {
  it('adds minutes across days, months and years', () => {
    expect(addMinutes('2026-10-17T09:00', -15)).toBe('2026-10-17T08:45');
    expect(addMinutes('2026-10-17T00:10', -20)).toBe('2026-10-16T23:50');
    expect(addMinutes('2026-12-31T23:30', 45)).toBe('2027-01-01T00:15');
    expect(addMinutes('2024-03-01T00:00', -1440)).toBe('2024-02-29T00:00');
    expect(stampMinutes('1970-01-02T01:01')).toBe(1440 + 61);
  });

  it('reads the device clock to the minute', () => {
    expect(nowStamp(new Date(2026, 9, 17, 7, 5, 59))).toBe('2026-10-17T07:05');
  });
});
