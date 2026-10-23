import { describe, expect, it } from 'vitest';
import type { CalendarEvent, EventDraft } from './events.ts';
import { parseDuration, parseIcs, unescapeText, type ParseOptions } from './ics-import.ts';
import { toIcs } from './ics.ts';

const options: ParseOptions = { timeZone: 'Asia/Tbilisi', makeId: () => 'new-id' };

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
        ['DTSTART:20261017T090000'],
      ),
      options,
    ).events.map((event) => event.id);
    expect(ids).toEqual(['abc', 'XYZ-1@example.com', 'new-id']);
  });

  it('turns down files that aren’t calendars, or have no events', () => {
    expect(parseIcs('hello', options).error).toBe('This doesn’t look like a calendar (.ics) file.');
    expect(parseIcs(calendar(), options).error).toBe('There are no events in this file.');
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
