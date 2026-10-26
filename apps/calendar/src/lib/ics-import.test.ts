import { describe, expect, it, vi } from 'vitest';
import {
  addDays,
  daysInMonth,
  fromDayNumber,
  isLeapYear,
  makeDate,
  toDayNumber,
  type IsoDate,
} from './dates.ts';
import {
  importEvents,
  occurrencesBetween,
  type CalendarEvent,
  type EventDraft,
  type Repeat,
} from './events.ts';
import {
  lastStart,
  parseDuration,
  parseIcs,
  unescapeText,
  type ParseOptions,
} from './ics-import.ts';
import { toIcs } from './ics.ts';

const options: ParseOptions = { timeZone: 'Asia/Tbilisi' };

/** A .ics file around some event lines (CRLF line endings, as files use). */
const calendar = (...events: string[][]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']),
    'END:VCALENDAR',
  ].join('\r\n');

const only = (text: string, opts = options): EventDraft => {
  const result = parseIcs(text, opts);
  expect(result.skipped).toEqual([]);
  expect(result.events).toHaveLength(1);
  const [event] = result.events;
  if (!event) throw new Error('Expected one event');
  return event.draft;
};

/** Random numbers, the same every run. */
function random(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const base: EventDraft = {
  title: 'Dentist',
  startDate: '2026-10-17',
  endDate: '2026-10-17',
  startTime: '09:00',
  endTime: '10:00',
  repeat: 'none',
  repeatUntil: null,
  reminder: null,
  notes: '',
};

describe('parseIcs', () => {
  it('reads back everything Calendar exports', () => {
    const events: CalendarEvent[] = [
      { id: 'a', ...base, reminder: 15, notes: 'Bring the card; and, maybe\nC:\\path' },
      {
        id: 'b',
        ...base,
        title: 'Trip',
        startDate: '2026-10-20',
        endDate: '2026-10-23',
        startTime: null,
        endTime: null,
        reminder: 900,
      },
      {
        id: 'c',
        ...base,
        title: 'Yoga',
        repeat: 'weekly',
        repeatUntil: '2026-12-19',
        endTime: null,
      },
      {
        id: 'd',
        ...base,
        title: 'Night shift',
        startTime: '22:00',
        endTime: '06:00',
        endDate: '2026-10-18',
        repeat: 'monthly',
      },
      { id: 'e', ...base, title: 'Festival', endDate: '2026-10-19', endTime: null },
      {
        id: 'f',
        ...base,
        title: `ბ${'ა'.repeat(98)}`,
        startTime: null,
        endTime: null,
        repeat: 'yearly',
        repeatUntil: '2030-10-17',
        reminder: -540,
      },
    ];
    const result = parseIcs(toIcs(events), options);
    expect(result).toEqual({
      events: events.map(({ id, ...draft }) => ({ id, draft })),
      skipped: [],
      notes: [],
    });
  });

  it('converts UTC times, like Google Calendar writes, to the device time zone', () => {
    const draft = only(
      calendar([
        'DTSTART:20261017T103000Z',
        'DTEND:20261017T113000Z',
        'UID:abc123@google.com',
        'SUMMARY:Call with Ana',
        'LOCATION:Rustaveli Ave 1\\, Tbilisi',
        'DESCRIPTION:',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:This is an event reminder',
        'TRIGGER:-P0DT0H30M0S',
        'END:VALARM',
      ]),
    );
    expect(draft).toEqual({
      ...base,
      title: 'Call with Ana',
      startTime: '14:30',
      endTime: '15:30',
      reminder: 30,
      notes: 'Location: Rustaveli Ave 1, Tbilisi',
    });
  });

  it('converts times in a named time zone, like Apple Calendar writes, through daylight saving', () => {
    const lines = (date: string) => [
      'BEGIN:VTIMEZONE',
      'TZID:America/New_York',
      'BEGIN:STANDARD',
      'DTSTART:20071104T020000',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'END:STANDARD',
      'END:VTIMEZONE',
      `DTSTART;TZID=America/New_York:${date}T090000`,
      `DTEND;TZID="America/New_York":${date}T093000`,
      'SUMMARY:Stand-up',
    ];
    const london = { ...options, timeZone: 'Europe/London' };
    // Summer: New York is 4 hours behind UTC, London 1 hour ahead.
    expect(only(calendar(lines('20260715')), london)).toMatchObject({
      startDate: '2026-07-15',
      startTime: '14:00',
      endTime: '14:30',
    });
    // Winter: 5 hours behind, London on UTC.
    expect(only(calendar(lines('20260115')), london)).toMatchObject({
      startTime: '14:00',
      endTime: '14:30',
    });
    // Old Thunderbird style zone names work too.
    expect(
      only(
        calendar([
          'DTSTART;TZID=/mozilla.org/20050126_1/Europe/Berlin:20260115T090000',
          'SUMMARY:x',
        ]),
        london,
      ),
    ).toMatchObject({ startTime: '08:00', endTime: null });
  });

  it('reads a very long time zone name quickly, as unknown', () => {
    const started = performance.now();
    const result = parseIcs(
      calendar([`DTSTART;TZID=${'A'.repeat(60_000)}:20261017T090000`, 'SUMMARY:x']),
      options,
    );
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.events[0]?.draft).toMatchObject({ startTime: '09:00' });
  });

  it('keeps times as written when the time zone is unknown, and says so', () => {
    const result = parseIcs(
      calendar(['DTSTART;TZID=Pacific Standard Time:20261017T090000', 'SUMMARY:Outlook meeting']),
      options,
    );
    expect(result.events[0]?.draft).toMatchObject({ startTime: '09:00' });
    expect(result.notes).toEqual([
      '1 event used a time zone Calendar doesn’t know, so its times were kept as written.',
    ]);
  });

  it('reads all-day events and durations', () => {
    expect(only(calendar(['DTSTART;VALUE=DATE:20261017', 'SUMMARY:Holiday']))).toMatchObject({
      startDate: '2026-10-17',
      endDate: '2026-10-17',
      startTime: null,
    });
    expect(
      only(calendar(['DTSTART;VALUE=DATE:20261017', 'DURATION:P3D', 'SUMMARY:x'])),
    ).toMatchObject({ endDate: '2026-10-19' });
    expect(only(calendar(['DTSTART:20261017T233000', 'DURATION:PT1H', 'SUMMARY:x']))).toMatchObject(
      { endDate: '2026-10-18', endTime: '00:30' },
    );
    // An end before the start is ignored.
    expect(
      only(calendar(['DTSTART:20261017T100000', 'DTEND:20261017T090000', 'SUMMARY:x'])),
    ).toMatchObject({ endDate: '2026-10-17', endTime: null });
    expect(
      only(calendar(['DTSTART:20261017T100000', 'DURATION:-P100000000D', 'SUMMARY:x'])),
    ).toMatchObject({ endDate: '2026-10-17', endTime: null });
  });

  it('turns down an event that would last longer than Calendar allows', () => {
    // Such a DURATION used to throw, which stopped the whole import (audit F1-8).
    const result = parseIcs(
      calendar(
        ['DTSTART;VALUE=DATE:20261017', 'DURATION:P100000000D', 'SUMMARY:For ever'],
        ['DTSTART:20261017T090000', `DURATION:PT${'9'.repeat(400)}M`, 'SUMMARY:Even longer'],
        ['DTSTART:20261017T090000', 'DURATION:P367D', 'SUMMARY:A year and a day'],
        ['DTSTART:20261017T090000', 'SUMMARY:Fine'],
      ),
      options,
    );
    expect(result.events.map((event) => event.draft.title)).toEqual(['Fine']);
    expect(result.skipped).toEqual([
      { title: 'For ever', reason: 'An event can last up to 366 days.' },
      { title: 'Even longer', reason: 'An event can last up to 366 days.' },
      { title: 'A year and a day', reason: 'An event can last up to 366 days.' },
    ]);
  });

  it('reads the repeats Calendar can show', () => {
    const repeat = (rule: string, start = 'DTSTART:20261017T090000') =>
      only(calendar([start, `RRULE:${rule}`, 'SUMMARY:x']));
    expect(repeat('FREQ=WEEKLY;BYDAY=SA;WKST=MO')).toMatchObject({ repeat: 'weekly' });
    expect(repeat('FREQ=MONTHLY;BYMONTHDAY=17')).toMatchObject({ repeat: 'monthly' });
    expect(repeat('FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=17')).toMatchObject({ repeat: 'yearly' });
    expect(repeat('FREQ=DAILY;INTERVAL=1;UNTIL=20261031')).toMatchObject({
      repeat: 'daily',
      repeatUntil: '2026-10-31',
    });
    // 3 times: 17, 24 and 31 October.
    expect(repeat('FREQ=WEEKLY;COUNT=3')).toMatchObject({ repeatUntil: '2026-10-31' });
    // Monthly on the 31st skips shorter months, as in other calendars.
    expect(repeat('FREQ=MONTHLY;COUNT=3', 'DTSTART:20260131T090000')).toMatchObject({
      repeatUntil: '2026-05-31',
    });
    expect(repeat('FREQ=WEEKLY;COUNT=1')).toMatchObject({ repeat: 'none', repeatUntil: null });
    // 31 Oct 23:59 UTC is 1 Nov 03:59 in Tbilisi: the 1 Nov 09:00 event is after it.
    expect(repeat('FREQ=DAILY;UNTIL=20261031T235959Z')).toMatchObject({
      repeatUntil: '2026-10-31',
    });
  });

  it('keeps the last time of a repeat when the time zones change clocks on different dates', () => {
    const london = { ...options, timeZone: 'Europe/London' };
    const weekly = (start: string, until: string, opts = options) =>
      only(calendar([start, `RRULE:FREQ=WEEKLY;UNTIL=${until}`, 'SUMMARY:x']), opts);
    // Tuesdays at 09:00 in Tbilisi (05:00 UTC), the last on 10 November. In London
    // the first is at 06:00 (summer time) but the last at 05:00.
    expect(weekly('DTSTART;TZID=Asia/Tbilisi:20261020T090000', '20261110T050000Z', london)).toEqual(
      {
        ...base,
        title: 'x',
        startDate: '2026-10-20',
        endDate: '2026-10-20',
        startTime: '06:00',
        endTime: null,
        repeat: 'weekly',
        repeatUntil: '2026-11-10',
      },
    );
    // The same with the start written in UTC.
    expect(weekly('DTSTART:20261020T050000Z', '20261110T050000Z', london)).toMatchObject({
      repeatUntil: '2026-11-10',
    });
    // An UNTIL before the start time on its day ends the day before.
    expect(
      weekly('DTSTART;TZID=Asia/Tbilisi:20261020T090000', '20261110T000000Z', london),
    ).toMatchObject({ repeatUntil: '2026-11-09' });
    // 22:00 UTC on Tuesdays is 02:00 on Wednesdays in Tbilisi: the last one moves too.
    expect(weekly('DTSTART:20261020T220000Z', '20261110T220000Z')).toMatchObject({
      startDate: '2026-10-21',
      startTime: '02:00',
      repeatUntil: '2026-11-11',
    });
    // An UNTIL with only a date, after a start that moves to the next day.
    expect(weekly('DTSTART;TZID=Europe/London:20261020T233000', '20261110')).toMatchObject({
      startDate: '2026-10-21',
      startTime: '02:30',
      repeatUntil: '2026-11-11',
    });
  });

  it('ends an all-day repeat on the day its UNTIL says, wherever the phone is', () => {
    // Some apps (Outlook) write an all-day repeat's last day as a UTC time.
    // Converting it to the phone's time zone moved it a day either way (audit F1-10).
    const until = (rule: string, timeZone: string) =>
      only(
        calendar([
          'DTSTART;VALUE=DATE:20261228',
          'DTEND;VALUE=DATE:20261229',
          `RRULE:FREQ=DAILY;UNTIL=${rule}`,
          'SUMMARY:Holiday camp',
        ]),
        { ...options, timeZone },
      ).repeatUntil;
    for (const timeZone of ['America/New_York', 'Europe/London', 'Asia/Tbilisi']) {
      expect(until('20261231', timeZone)).toBe('2026-12-31');
      expect(until('20261231T000000Z', timeZone)).toBe('2026-12-31');
      expect(until('20261231T235959Z', timeZone)).toBe('2026-12-31');
      expect(until('20261231T120000', timeZone)).toBe('2026-12-31');
    }
  });

  it('says when some repeating times may be an hour off', () => {
    const weekly = (start: string, rule = 'FREQ=WEEKLY') => [start, `RRULE:${rule}`, 'SUMMARY:x'];
    const london = 'DTSTART;TZID=Europe/London:20260714T090000';
    // London changes its clocks and Tbilisi doesn't: 09:00 in London is 12:00 in
    // Tbilisi in summer but 13:00 in winter. Calendar keeps 12:00.
    const result = parseIcs(
      calendar(
        weekly(london),
        weekly('DTSTART;TZID=America/New_York:20260714T090000', 'FREQ=DAILY;COUNT=200'),
        // Nothing to say: the same time zone, UTC, a time without a zone, a
        // whole day, no repeat, or repeats that end before any clocks change.
        weekly('DTSTART;TZID=Asia/Tbilisi:20260714T090000'),
        weekly('DTSTART:20260714T090000Z'),
        weekly('DTSTART:20260714T090000'),
        weekly('DTSTART;VALUE=DATE:20260714'),
        [london, 'SUMMARY:x'],
        weekly(london, 'FREQ=WEEKLY;UNTIL=20260901T080000Z'),
        weekly(london, 'FREQ=WEEKLY;COUNT=5'),
      ),
      options,
    );
    expect(result.skipped).toEqual([]);
    expect(result.events[0]?.draft).toMatchObject({ startTime: '12:00', repeat: 'weekly' });
    expect(result.notes).toEqual([
      '2 repeating events are from a time zone that doesn’t change its clocks on the same dates as yours, so some of their times may be an hour off.',
    ]);

    const notes = (start: string, timeZone: string) =>
      parseIcs(calendar(weekly(start)), { ...options, timeZone }).notes;
    // London and New York both change, but on different dates.
    expect(notes('DTSTART;TZID=America/New_York:20260714T090000', 'Europe/London')).toEqual([
      '1 repeating event is from a time zone that doesn’t change its clocks on the same dates as yours, so some of its times may be an hour off.',
    ]);
    // A repeat that starts in winter still finds the summer.
    expect(notes('DTSTART;TZID=Europe/London:20261201T090000', 'Asia/Tbilisi')).toHaveLength(1);
    // UTC never changes; London does.
    expect(notes('DTSTART:20260714T090000Z', 'Europe/London')).toHaveLength(1);
    // London and Berlin change on the same dates.
    expect(notes(london, 'Europe/Berlin')).toEqual([]);
    expect(notes(london, 'Europe/London')).toEqual([]);
  });

  it('says so when the clocks change on the first day, or twice on one day', () => {
    // Clocks were compared at noon each day, from the second day: these said
    // nothing, though every time from the second was an hour off (audit 3 F1-2).
    const notes = (start: string, rule: string, timeZone: string) =>
      parseIcs(calendar([start, `RRULE:${rule}`, 'SUMMARY:x']), { ...options, timeZone }).notes;
    const hourOff = [
      '1 repeating event is from a time zone that doesn’t change its clocks on the same dates as yours, so some of its times may be an hour off.',
    ];
    // 03:45 in Tbilisi is 00:45 in Berlin on 29 March, and 01:45 from the 30th:
    // Berlin's clocks change at 02:00 that night, just after the first time.
    expect(
      notes('DTSTART;TZID=Asia/Tbilisi:20260329T034500', 'FREQ=DAILY;COUNT=5', 'Europe/Berlin'),
    ).toEqual(hourOff);
    // London's clocks change 45 minutes after the first time.
    expect(
      notes('DTSTART;TZID=Europe/London:20260329T001500', 'FREQ=MONTHLY;COUNT=3', 'Asia/Kolkata'),
    ).toEqual(hourOff);
    // On 8 March, New York's clocks change an hour before Chicago's: 03:30 in
    // New York is 01:30 in Chicago that day, not 02:30.
    expect(
      notes('DTSTART;TZID=America/New_York:20260301T033000', 'FREQ=DAILY', 'America/Chicago'),
    ).toEqual(hourOff);
    // At 09:00 in New York, it's 08:00 in Chicago every time.
    expect(
      notes('DTSTART;TZID=America/New_York:20260301T090000', 'FREQ=DAILY', 'America/Chicago'),
    ).toEqual([]);
  });

  it('says so whenever some times in a repeat’s first year are an hour off', () => {
    // Random repeats between eleven time zones, compared with when they really
    // happen (RFC 5545: a time the clocks skip is moved on by the gap, a time
    // they repeat is the first one). Only the first year is compared: past it,
    // a yearly event a few days before the clocks change can be an hour off in
    // some years (README).
    const zones = [
      'UTC',
      'Europe/London',
      'Europe/Berlin',
      'America/New_York',
      'America/Chicago',
      'America/Los_Angeles',
      'Asia/Tbilisi',
      'Australia/Sydney',
      'Asia/Kolkata',
      'America/Santiago',
      'Pacific/Auckland',
    ];
    const DAY = 86_400_000;
    const formats = new Map<string, Intl.DateTimeFormat>();
    /** What clocks in `zone` show at `ms`, as a number like Date.UTC gives. */
    const wallAt = (ms: number, zone: string): number => {
      let format = formats.get(zone);
      if (!format) {
        format = new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          hourCycle: 'h23',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
        });
        formats.set(zone, format);
      }
      const part = (type: string) =>
        Number(format.formatToParts(ms).find((entry) => entry.type === type)?.value);
      return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
    };
    /** The moment of a date and time in `zone`. */
    const momentOf = (date: IsoDate, time: string, zone: string): number => {
      const wall = Date.parse(`${date}T${time}:00Z`);
      const offsets = [wall - DAY, wall + DAY].map((ms) => wallAt(ms, zone) - ms);
      const fits = offsets.map((offset) => wall - offset).filter((ms) => wallAt(ms, zone) === wall);
      return fits.length > 0 ? Math.min(...fits) : wall - (offsets[0] ?? 0);
    };
    const next = random(99);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
    const pad = (value: number) => String(value).padStart(2, '0');
    let checked = 0;
    const wrong: string[] = [];
    for (let index = 0; index < 500; index += 1) {
      const from = pick(zones);
      const here = pick(zones);
      const freq = pick(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const);
      const month = 1 + Math.floor(next() * 12);
      const lastDay = daysInMonth(2026, month);
      const day =
        next() < 0.3 ? Math.min(pick([28, 29, 30, 31]), lastDay) : 1 + Math.floor(next() * 28);
      const time = `${pad(Math.floor(next() * 24))}:${pick(['00', '15', '30', '45'])}`;
      const first = makeDate(2026, month, day);
      // When it really happens, in its own zone: up to a year on.
      const dates: IsoDate[] = [];
      for (let step = 0; dates.length < 60 && step < 400; step += 1) {
        if (freq === 'DAILY') dates.push(addDays(first, step));
        else if (freq === 'WEEKLY') dates.push(addDays(first, 7 * step));
        else {
          const months = freq === 'MONTHLY' ? step : 12 * step;
          const year = 2026 + Math.floor((month - 1 + months) / 12);
          const inMonth = ((month - 1 + months) % 12) + 1;
          if (day <= daysInMonth(year, inMonth)) dates.push(makeDate(year, inMonth, day));
        }
      }
      const start = momentOf(first, time, from);
      const truth = dates
        .map((date) => momentOf(date, time, from))
        .filter((moment) => moment <= start + 366 * DAY);
      const count = Math.max(2, Math.floor(next() * truth.length));
      const compact = `${first.replace(/-/g, '')}T${time.replace(':', '')}00`;
      const dtstart = from === 'UTC' ? `DTSTART:${compact}Z` : `DTSTART;TZID=${from}:${compact}`;
      const result = parseIcs(
        calendar([dtstart, `RRULE:FREQ=${freq};COUNT=${count}`, 'SUMMARY:x']),
        { ...options, timeZone: here },
      );
      const draft = result.events[0]?.draft;
      if (result.notes.length > 0 || !draft?.startTime) continue;
      checked += 1;
      const shown = occurrencesBetween(
        { events: [{ id: 'x', ...draft }] },
        draft.startDate,
        addDays(draft.startDate, 400),
      ).map((occurrence) => momentOf(occurrence.start, draft.startTime ?? '', here));
      const expected = truth.slice(0, count);
      if (JSON.stringify(shown.slice(0, expected.length)) !== JSON.stringify(expected)) {
        wrong.push(`${dtstart} FREQ=${freq};COUNT=${count} seen in ${here}`);
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(wrong).toEqual([]);
  }, 30_000);

  it('reads a file of repeats from many time zones and years without freezing', () => {
    // Each new time zone and year to compare clocks in costs a year of clock
    // readings: a crafted file of thousands took minutes (audit F1-9). The
    // work for a file is capped; past that, the note says what may be off.
    const zones = Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'Asia/Tbilisi');
    const events = Array.from({ length: 2000 }, (_, index) => [
      `DTSTART;TZID=${zones[index % zones.length]}:${1100 + index}0101T090000`,
      'RRULE:FREQ=WEEKLY',
      'SUMMARY:x',
    ]);
    // Counts the clock readings, and stops at too many.
    const read = Intl.DateTimeFormat.prototype.formatToParts;
    let readings = 0;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockImplementation(function (
      this: Intl.DateTimeFormat,
      date,
    ) {
      readings += 1;
      if (readings > 100_000) throw new Error('Too many clock readings');
      return read.call(this, date);
    });
    try {
      const result = parseIcs(calendar(...events), options);
      expect(result.events).toHaveLength(2000);
      expect(result.notes[0]).toMatch(/^\d+ repeating events are from a time zone/);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('reads a file of repeats with a COUNT quickly', () => {
    // Working out every time up to COUNT took about 28 ms for each of these
    // (2.9 s for 100), so a 5 MB file froze the page for minutes (audit 3 C-2).
    const events = Array.from({ length: 2000 }, (_, index) => [
      `UID:e${index}`,
      'DTSTART:20261026T090000',
      'DTEND:20261026T100000',
      `RRULE:FREQ=${['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'][index % 4]};COUNT=5000`,
      `SUMMARY:x${index}`,
    ]);
    const started = performance.now();
    const result = parseIcs(calendar(...events), options);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.skipped).toEqual([]);
    expect(result.events.slice(0, 4).map((event) => event.draft.repeatUntil)).toEqual([
      '2040-07-03',
      '2122-08-17',
      '2443-05-26',
      '7025-10-26',
    ]);
  });

  it('gives a file only so much work for its COUNTs, and says which events it left out', () => {
    // Monthly on the 31st skips 5 months a year, so its months are counted one
    // by one: about 8,600 of them for COUNT=5000.
    const events = Array.from({ length: 2000 }, (_, index) => [
      `UID:e${index}`,
      'DTSTART;VALUE=DATE:20261231',
      'RRULE:FREQ=MONTHLY;COUNT=5000',
      'SUMMARY:Rent',
    ]);
    const started = performance.now();
    const result = parseIcs(calendar(['DTSTART:20261031T090000', 'SUMMARY:Fine'], ...events), {
      ...options,
    });
    expect(performance.now() - started).toBeLessThan(1000);
    // The first ones fit in the file's work, with the right last date.
    expect(result.events.map((event) => event.draft.title)).toEqual([
      'Fine',
      ...Array.from({ length: result.events.length - 1 }, () => 'Rent'),
    ]);
    expect(result.events.length).toBeGreaterThan(50);
    expect(result.events[1]?.draft).toMatchObject({ repeat: 'monthly', repeatUntil: '2741-01-31' });
    expect(result.skipped.length).toBe(2001 - result.events.length);
    expect(result.skipped[0]).toEqual({
      title: 'Rent',
      reason: 'The file has too many repeats for Calendar to work out when this one stops.',
    });
  });

  it('says when a monthly or yearly repeat moves to another day', () => {
    // 22:00 UTC is 02:00 the next day in Tbilisi. Monthly on the 31st (in UTC)
    // becomes monthly on the 1st, which would show in months without a 31st.
    const result = parseIcs(
      calendar(
        ['DTSTART:20261031T220000Z', 'RRULE:FREQ=MONTHLY', 'SUMMARY:Rent'],
        ['DTSTART:20260228T220000Z', 'RRULE:FREQ=YEARLY', 'SUMMARY:x'],
        // Nothing to say: the 15th becomes the 16th every month, 31 December
        // becomes 1 January every year, weekly stays weekly, or no move.
        ['DTSTART:20261015T220000Z', 'RRULE:FREQ=MONTHLY', 'SUMMARY:x'],
        ['DTSTART:20261231T220000Z', 'RRULE:FREQ=YEARLY', 'SUMMARY:x'],
        ['DTSTART:20261031T220000Z', 'RRULE:FREQ=WEEKLY', 'SUMMARY:x'],
        ['DTSTART:20261031T080000Z', 'RRULE:FREQ=MONTHLY', 'SUMMARY:x'],
        ['DTSTART:20261031T220000Z', 'SUMMARY:x'],
      ),
      options,
    );
    expect(result.skipped).toEqual([]);
    expect(result.events[0]?.draft).toMatchObject({
      startDate: '2026-11-01',
      startTime: '02:00',
      repeat: 'monthly',
    });
    expect(result.notes).toEqual([
      '2 repeating events moved to another day in your time zone, so some of their dates near the end of a month may be wrong.',
    ]);
  });

  it('lists events it can’t show, with the reason', () => {
    const result = parseIcs(
      calendar(
        ['DTSTART:20261017T090000', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'SUMMARY:Every other week'],
        ['DTSTART:20261017T090000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'SUMMARY:Two days a week'],
        [
          'DTSTART;VALUE=DATE:20261017',
          'DTEND;VALUE=DATE:20261020',
          'RRULE:FREQ=DAILY',
          'SUMMARY:Overlaps itself',
        ],
        ['DTSTART:20261017T090000', 'STATUS:CANCELLED', 'SUMMARY:Called off'],
        ['DTSTART:yesterday', 'SUMMARY:Bad date'],
        ['DTSTART:20261017T090000', 'SUMMARY:Fine'],
      ),
      options,
    );
    expect(result.events.map((e) => e.draft.title)).toEqual(['Fine']);
    expect(result.skipped).toEqual([
      {
        title: 'Every other week',
        reason: 'It repeats in a way Calendar can’t show yet (for example every 2 weeks).',
      },
      {
        title: 'Two days a week',
        reason: 'It repeats in a way Calendar can’t show yet (for example every 2 weeks).',
      },
      { title: 'Overlaps itself', reason: 'A repeating event must end before it repeats.' },
      { title: 'Called off', reason: 'It was cancelled.' },
      { title: 'Bad date', reason: 'Calendar can’t read its start date.' },
    ]);
  });

  it('explains what it left out', () => {
    const result = parseIcs(
      calendar(
        [
          'UID:x',
          'DTSTART:20261017T090000',
          'RRULE:FREQ=DAILY',
          'EXDATE:20261018T090000',
          'SUMMARY:Walk',
        ],
        [
          'UID:x',
          'RECURRENCE-ID:20261019T090000',
          'DTSTART:20261019T100000',
          'SUMMARY:Walk (moved)',
        ],
        ['DTSTART:20261017T090000', 'SUMMARY:Far', 'BEGIN:VALARM', 'TRIGGER:-P5W', 'END:VALARM'],
      ),
      options,
    );
    expect(result.events.map((e) => e.draft.title)).toEqual(['Walk', 'Far']);
    expect(result.notes).toEqual([
      '1 change to single dates of repeating events can’t be imported yet.',
      '1 repeating event skipped some dates in the other calendar; here it shows on those dates too.',
      '1 reminder couldn’t be imported (Calendar reminds from 4 weeks before up to the start).',
    ]);
  });

  it('handles folded lines, LF line endings, quotes and long text', () => {
    // Some apps start files with an invisible "byte order mark".
    const text = [
      '\uFEFFBEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20261017T090000',
      'ATTENDEE;CN="Doe: John; Jr";ROLE=REQ-PARTICIPANT:mailto:john@example.com',
      'SUMMARY:A very long ',
      ' title that was folded',
      `DESCRIPTION:${'x'.repeat(1200)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const draft = only(text);
    expect(draft.title).toBe('A very long title that was folded');
    expect(draft.notes).toHaveLength(1000);
    expect(draft.notes.endsWith('…')).toBe(true);
    expect(only(calendar(['DTSTART:20261017T090000'])).title).toBe('Untitled event');
  });

  it('keeps ids, so importing the same file twice can be spotted', () => {
    const ids = parseIcs(
      calendar(
        ['UID:abc@calendar.shkriuss.app', 'DTSTART:20261017T090000'],
        ['UID:XYZ-1@example.com', 'DTSTART:20261017T090000'],
        // Escaped like any text (audit F1-11).
        ['UID:meeting\\,2026\\;room\\\\4@example.com', 'DTSTART:20261017T090000'],
      ),
      options,
    ).events.map((event) => event.id);
    expect(ids).toEqual(['abc', 'XYZ-1@example.com', 'meeting,2026;room\\4@example.com']);
  });

  it('spots an event Calendar exported when it’s imported again, whatever its id', () => {
    // Ids from other calendars' UIDs can hold "," or ";" (audit F1-11).
    for (const id of ['meeting,2026;room\\4@example.com', 'line\nbreak', 'mine']) {
      const event: CalendarEvent = { id, ...base };
      const parsed = parseIcs(toIcs([event]), options).events;
      expect(parsed.map((entry) => entry.id)).toEqual([id]);
      expect(importEvents({ events: [event] }, parsed)).toMatchObject({ added: 0, duplicates: 1 });
    }
  });

  it('gives an event without a UID the same id each time, so it isn’t added twice', () => {
    const file = calendar(
      ['DTSTAMP:20261017T080000Z', 'DTSTART:20261017T090000', 'SUMMARY:Dentist'],
      ['DTSTART:20261017T090000', 'SUMMARY:Gym'],
      ['DTSTART:20261018T090000', 'SUMMARY:Dentist'],
      ['DTSTART:20261017T090000', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Dentist'],
    );
    const ids = parseIcs(file, options).events.map((event) => event.id);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^ics-[0-9a-z]+$/);
    // The same file again, written at another time.
    const again = parseIcs(file.replace('DTSTAMP:20261017T080000Z', 'DTSTAMP:20261018T120000Z'), {
      ...options,
    }).events;
    expect(again.map((event) => event.id)).toEqual(ids);
    const first = importEvents({ events: [] }, parseIcs(file, options).events);
    expect(importEvents(first.state, again)).toMatchObject({ added: 0, duplicates: 4 });
  });

  it('turns down files that aren’t calendars, or have no events', () => {
    expect(parseIcs('hello', options).error).toBe('This doesn’t look like a calendar (.ics) file.');
    expect(parseIcs(calendar(), options).error).toBe('There are no events in this file.');
  });
});

describe('lastStart', () => {
  /** How the last start was worked out before (audit 3 C-2): every time up to COUNT, one by one. */
  function everyTimeUpTo(draft: EventDraft, count: number): IsoDate | null {
    if (count > 5000) return null;
    const daysPer: Record<Repeat, number> = {
      none: 0,
      daily: 1,
      weekly: 7,
      monthly: 62,
      yearly: 366 * 8,
    };
    const end = Math.min(
      toDayNumber(draft.startDate) + daysPer[draft.repeat] * count,
      toDayNumber('9999-12-31'),
    );
    const starts = occurrencesBetween(
      { events: [{ id: 'count', ...draft }] },
      draft.startDate,
      fromDayNumber(end),
    ).filter((occurrence) => occurrence.start >= draft.startDate);
    return starts[count - 1]?.start ?? null;
  }

  it('gives what working out every time gave, for every kind of repeat', () => {
    const next = random(2026);
    const between = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
    const startOf = (repeat: Repeat): IsoDate => {
      // Mostly now, and some near the years 1000 and 9999, where dates stop.
      const pick = next();
      const year =
        pick < 0.7 ? between(1990, 2100) : pick < 0.85 ? between(9980, 9999) : between(1000, 1100);
      // 29 February, for some yearly ones: in a leap year (one after a century that isn't).
      if (repeat === 'yearly' && next() < 0.3) {
        const leap = 4 * between(250, 2499);
        return makeDate(isLeapYear(leap) ? leap : leap + 4, 2, 29);
      }
      const month = between(1, 12);
      // Half the time, the days that some months don't have.
      const day = next() < 0.5 ? between(29, 31) : between(1, 28);
      return makeDate(year, month, Math.min(day, daysInMonth(year, month)));
    };
    const countOf = (): number => {
      const pick = next();
      return pick < 0.45 ? between(1, 30) : pick < 0.85 ? between(1, 500) : between(1, 5000);
    };
    const repeats = ['daily', 'weekly', 'monthly', 'yearly'] as const;
    const cases: [Repeat, IsoDate, number][] = Array.from({ length: 400 }, (_, index) => {
      const repeat = repeats[index % 4] ?? 'daily';
      return [repeat, startOf(repeat), countOf()];
    });
    // The longest COUNT, and one more (for ever); after 29 February 2096, the next is in 2104.
    for (const repeat of repeats) {
      for (const start of ['2026-01-31', '2026-10-17', '2096-02-29', '9990-12-31']) {
        cases.push([repeat, start, 5000], [repeat, start, 5001]);
      }
    }
    for (const [repeat, startDate, count] of cases) {
      const draft: EventDraft = { ...base, startDate, endDate: startDate, repeat };
      expect(lastStart(draft, count), `${repeat} from ${startDate}, COUNT=${count}`).toBe(
        everyTimeUpTo(draft, count),
      );
    }
    // The old way takes a second or two for all of them, longer on a busy computer.
  }, 30_000);

  it('ends at UNTIL if a file gives an earlier one too', () => {
    // Files shouldn't have both (RFC 5545); before, this one repeated for ever.
    const weekly: EventDraft = { ...base, repeat: 'weekly', repeatUntil: '2026-10-31' };
    expect(lastStart(weekly, 10)).toBe('2026-10-31');
    expect(lastStart(weekly, 2)).toBe('2026-10-24');
    expect(lastStart(weekly, 6000)).toBe('2026-10-31');
  });
});

describe('helpers', () => {
  it('reads durations', () => {
    expect(parseDuration('-PT15M')).toBe(-15);
    expect(parseDuration('PT9H')).toBe(540);
    expect(parseDuration('-P1DT15H')).toBe(-2340);
    expect(parseDuration('P1W')).toBe(10080);
    expect(parseDuration('-PT0S')).toBe(0);
    expect(parseDuration('-P0DT0H30M0S')).toBe(-30);
    expect(parseDuration('P')).toBeNull();
    expect(parseDuration('PT')).toBeNull();
    expect(parseDuration('15 minutes')).toBeNull();
  });

  it('unescapes text', () => {
    expect(unescapeText('a\\, b\\; c\\nd\\Ne\\\\f')).toBe('a, b; c\nd\ne\\f');
  });
});
