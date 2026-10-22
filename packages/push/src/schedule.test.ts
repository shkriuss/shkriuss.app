import { describe, expect, it } from 'vitest';
import {
  cachedTimeZones,
  canonicalTimeZone,
  isDate,
  nextFireTime,
  parseStamp,
  type Timing,
} from './schedule.ts';

const at = (iso: string) => Date.parse(iso);
const iso = (moment: number | null) => (moment === null ? null : new Date(moment).toISOString());

const timing = (overrides: Partial<Timing>): Timing => ({
  start: '2026-10-17T14:30',
  repeat: 'none',
  until: null,
  offset: 0,
  ...overrides,
});

/** Every fire time from `from`, up to `count` of them. */
function fires(t: Timing, timeZone: string, from: string, count: number): (string | null)[] {
  const result: (string | null)[] = [];
  let after = at(from);
  for (let index = 0; index < count; index += 1) {
    const next = nextFireTime(t, timeZone, after);
    result.push(iso(next));
    if (next === null) break;
    after = next;
  }
  return result;
}

describe('nextFireTime', () => {
  it('fires a one-off reminder once, in the phone’s time zone', () => {
    // 14:30 in Tbilisi (UTC+4), 15 minutes before: 14:15 local = 10:15 UTC.
    const dentist = timing({ offset: 15 });
    expect(iso(nextFireTime(dentist, 'Asia/Tbilisi', at('2026-10-17T10:00:00Z')))).toBe(
      '2026-10-17T10:15:00.000Z',
    );
    expect(nextFireTime(dentist, 'Asia/Tbilisi', at('2026-10-17T10:15:00Z'))).toBeNull();
  });

  it('keeps weekly reminders at the same local time through daylight saving', () => {
    // Berlin leaves summer time on 25 October 2026: 09:00 is 07:00 UTC, then 08:00 UTC.
    const standup = timing({ start: '2026-10-20T09:00', repeat: 'weekly' });
    expect(fires(standup, 'Europe/Berlin', '2026-10-20T00:00:00Z', 3)).toEqual([
      '2026-10-20T07:00:00.000Z',
      '2026-10-27T08:00:00.000Z',
      '2026-11-03T08:00:00.000Z',
    ]);
  });

  it('moves a time that doesn’t exist that night an hour later, west of UTC too', () => {
    // Berlin skips 02:00–03:00 on 29 March: 02:30 becomes 03:30 (01:30 UTC).
    const berlin = timing({ start: '2026-03-29T02:30' });
    expect(iso(nextFireTime(berlin, 'Europe/Berlin', at('2026-03-28T00:00:00Z')))).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    // New York skips 02:00–03:00 on 8 March: 02:30 becomes 03:30 EDT, not 01:30 EST.
    const newYork = timing({ start: '2026-03-08T02:30' });
    expect(iso(nextFireTime(newYork, 'America/New_York', at('2026-03-07T00:00:00Z')))).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    // Santiago skips 00:00–01:00 on 6 September: a daily 00:30 reminder goes off at
    // 01:30 that morning, not at 23:30 the evening before.
    const daily = timing({ start: '2026-09-01T00:30', repeat: 'daily' });
    expect(fires(daily, 'America/Santiago', '2026-09-05T00:00:00Z', 3)).toEqual([
      '2026-09-05T04:30:00.000Z',
      '2026-09-06T04:30:00.000Z',
      '2026-09-07T03:30:00.000Z',
    ]);
  });

  it('stops after the last day', () => {
    const walk = timing({ start: '2026-10-17T07:00', repeat: 'daily', until: '2026-10-19' });
    expect(fires(walk, 'UTC', '2026-10-16T00:00:00Z', 5)).toEqual([
      '2026-10-17T07:00:00.000Z',
      '2026-10-18T07:00:00.000Z',
      '2026-10-19T07:00:00.000Z',
      null,
    ]);
  });

  it('skips months without the day, like Calendar', () => {
    const rent = timing({ start: '2026-01-31T09:00', repeat: 'monthly' });
    expect(fires(rent, 'UTC', '2026-02-01T00:00:00Z', 3)).toEqual([
      '2026-03-31T09:00:00.000Z',
      '2026-05-31T09:00:00.000Z',
      '2026-07-31T09:00:00.000Z',
    ]);
  });

  it('reminds before each real occurrence, even across a month boundary', () => {
    // Monthly on the 31st, a day before: 30 January and 30 March, never 30 April.
    const rent = timing({ start: '2026-01-31T10:00', repeat: 'monthly', offset: 1440 });
    expect(fires(rent, 'UTC', '2026-01-01T00:00:00Z', 3)).toEqual([
      '2026-01-30T10:00:00.000Z',
      '2026-03-30T10:00:00.000Z',
      '2026-05-30T10:00:00.000Z',
    ]);
  });

  it('repeats 29 February only in leap years', () => {
    const birthday = timing({ start: '2024-02-29T00:00', repeat: 'yearly', offset: -540 });
    expect(fires(birthday, 'UTC', '2025-01-01T00:00:00Z', 2)).toEqual([
      '2028-02-29T09:00:00.000Z',
      '2032-02-29T09:00:00.000Z',
    ]);
  });

  it('finds the next time quickly for things that started long ago', () => {
    const daily = timing({ start: '2000-01-01T08:00', repeat: 'daily' });
    expect(iso(nextFireTime(daily, 'UTC', at('2026-10-17T09:00:00Z')))).toBe(
      '2026-10-18T08:00:00.000Z',
    );
    const yearly = timing({ start: '1990-10-17T00:00', repeat: 'yearly', offset: 900 });
    // 9:00 the day before, every year.
    expect(iso(nextFireTime(yearly, 'UTC', at('2026-10-17T00:00:00Z')))).toBe(
      '2027-10-16T09:00:00.000Z',
    );
  });
});

describe('checks', () => {
  it('reads local date-times and dates', () => {
    expect(parseStamp('2026-10-17T14:30')).toEqual({
      year: 2026,
      month: 10,
      day: 17,
      hour: 14,
      minute: 30,
    });
    expect(parseStamp('2026-02-29T14:30')).toBeNull();
    expect(parseStamp('2026-10-17T24:00')).toBeNull();
    expect(parseStamp('0050-01-01T00:00')).toBeNull();
    expect(isDate('2026-10-17')).toBe(true);
    expect(isDate('2026-13-01')).toBe(false);
  });

  it('knows real time zones, by their own names', () => {
    expect(canonicalTimeZone('Asia/Tbilisi')).toBe('Asia/Tbilisi');
    expect(canonicalTimeZone('Mars/Olympus_Mons')).toBeNull();
    expect(canonicalTimeZone('aMeRiCa/nEw_YoRk')).toBe('America/New_York');
    expect(canonicalTimeZone('+03:00')).toBeNull();
  });

  it('keeps one clock reader per time zone, however it’s spelt', () => {
    // 256 ways to write America/New_York, with capitals in different places.
    for (let n = 0; n < 256; n += 1) {
      const spelling = [...'america/new_york']
        .map((letter, index) => ((n >> index) & 1 ? letter.toUpperCase() : letter))
        .join('');
      expect(canonicalTimeZone(spelling)).toBe('America/New_York');
    }
    expect(cachedTimeZones().filter((name) => /new_york/i.test(name))).toEqual([
      'America/New_York',
    ]);
  });
});
