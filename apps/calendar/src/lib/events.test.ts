import { describe, expect, it } from 'vitest';
import { addEvent } from './editing.ts';
import {
  draftProblems,
  emptyState,
  isCalendarState,
  MAX_TITLE_LENGTH,
  migrateState,
  occurrencesBetween,
  onDay,
  secondVersion,
  timeLabel,
  type CalendarState,
  type EventDraft,
} from './events.ts';

const draft = (overrides: Partial<EventDraft> = {}): EventDraft => ({
  title: 'Dentist',
  startDate: '2026-10-17',
  endDate: '2026-10-17',
  startTime: '09:00',
  endTime: '10:00',
  repeat: 'none',
  repeatUntil: null,
  reminder: null,
  notes: '',
  ...overrides,
});

const withEvents = (...drafts: EventDraft[]): CalendarState =>
  drafts.reduce((state, d, index) => addEvent(state, d, `e${index}`), emptyState());

const starts = (state: CalendarState, from: string, to: string) =>
  occurrencesBetween(state, from, to).map((o) => `${o.start}:${o.event.title}`);

describe('draftProblems', () => {
  it('accepts a normal event', () => {
    expect(draftProblems(draft())).toEqual({});
    expect(draftProblems(draft({ startTime: null, endTime: null }))).toEqual({});
    expect(draftProblems(draft({ endTime: null }))).toEqual({});
  });

  it('explains each problem', () => {
    expect(draftProblems(draft({ title: '  ' })).title).toMatch(/Enter a title/);
    expect(draftProblems(draft({ title: 'x'.repeat(101) })).title).toMatch(/100/);
    expect(draftProblems(draft({ startDate: '2026-02-30' })).startDate).toBeTruthy();
    expect(draftProblems(draft({ endDate: '2026-10-16' })).endDate).toMatch(/on or after/);
    expect(draftProblems(draft({ endTime: '08:00' })).endTime).toMatch(/after the start/);
    expect(draftProblems(draft({ endTime: '09:00' })).endTime).toMatch(/after the start/);
    expect(draftProblems(draft({ startTime: '25:00' })).startTime).toBeTruthy();
    expect(draftProblems(draft({ startTime: null, endTime: '10:00' })).endTime).toBeTruthy();
    expect(draftProblems(draft({ notes: 'x'.repeat(1001) })).notes).toBeTruthy();
  });

  it('allows an overnight event that ends the next day', () => {
    expect(
      draftProblems(draft({ startTime: '22:00', endTime: '02:00', endDate: '2026-10-18' })),
    ).toEqual({});
  });

  it('checks repeat settings', () => {
    expect(draftProblems(draft({ repeatUntil: '2026-12-01' })).repeatUntil).toBeTruthy();
    expect(
      draftProblems(draft({ repeat: 'weekly', repeatUntil: '2026-10-01' })).repeatUntil,
    ).toMatch(/on or after/);
    expect(draftProblems(draft({ repeat: 'daily', endDate: '2026-10-18' })).endDate).toMatch(
      /before it repeats/,
    );
    expect(draftProblems(draft({ repeat: 'weekly', endDate: '2026-10-23' }))).toEqual({});
    // Overnight: it ends the next day, before the next one starts.
    const shift = { startTime: '22:00', endTime: '06:00', endDate: '2026-10-18' } as const;
    expect(draftProblems(draft({ ...shift, repeat: 'daily' }))).toEqual({});
    expect(draftProblems(draft({ ...shift, repeat: 'daily', endTime: '22:30' })).endDate).toMatch(
      /before it repeats/,
    );
    expect(
      draftProblems(draft({ ...shift, repeat: 'weekly', endDate: '2026-10-24', endTime: '08:00' })),
    ).toEqual({});
  });
});

describe('reminders', () => {
  it('accepts reminders from 4 weeks before to the start', () => {
    expect(draftProblems(draft({ reminder: 0 }))).toEqual({});
    expect(draftProblems(draft({ reminder: 40320 }))).toEqual({});
    expect(draftProblems(draft({ reminder: 40321 })).reminder).toBeTruthy();
    expect(draftProblems(draft({ reminder: -5 })).reminder).toBeTruthy();
    expect(draftProblems(draft({ reminder: 1.5 })).reminder).toBeTruthy();
  });

  it('lets all-day events remind later on the first day', () => {
    const allDay = { startTime: null, endTime: null };
    expect(draftProblems(draft({ ...allDay, reminder: -540 }))).toEqual({});
    expect(draftProblems(draft({ ...allDay, reminder: -1439 }))).toEqual({});
    expect(draftProblems(draft({ ...allDay, reminder: -1440 })).reminder).toBeTruthy();
  });
});

describe('saved data from older versions', () => {
  it('adds "no reminder" to events saved by version 1', () => {
    const { reminder: _, ...old } = { id: 'a', ...draft() };
    const migrated = migrateState({ events: [old] }, 1);
    expect(isCalendarState(migrated)).toBe(true);
    expect(migrated).toEqual({ events: [{ ...old, reminder: null }] });
    expect(isCalendarState({ events: [old] })).toBe(false);
  });

  it('gives up on data it does not know', () => {
    expect(migrateState({ events: 'nope' }, 1)).toBeUndefined();
    expect(migrateState({ events: [] }, 7)).toBeUndefined();
    expect(migrateState(null, 1)).toBeUndefined();
  });
});

describe('isCalendarState', () => {
  it('validates saved data', () => {
    expect(isCalendarState(withEvents(draft()))).toBe(true);
    expect(isCalendarState({ events: [{ ...draft(), id: 'x', startDate: 'nope' }] })).toBe(false);
    expect(isCalendarState({ events: [draft()] })).toBe(false); // no id
    expect(isCalendarState(null)).toBe(false);
  });
});

describe('secondVersion', () => {
  it('keeps this device’s version as its own event, with a title that still fits', () => {
    const [event] = withEvents(draft({ title: 'x'.repeat(MAX_TITLE_LENGTH) })).events;
    if (!event) throw new Error('Expected an event');
    const copy = secondVersion(event, 'copy');
    expect(copy).toEqual({ ...event, id: 'copy', title: `${'x'.repeat(83)} (second version)` });
    expect(isCalendarState({ events: [event, copy] })).toBe(true);
    expect(secondVersion({ ...event, title: 'Dentist' }, 'c').title).toBe(
      'Dentist (second version)',
    );
  });
});

describe('occurrencesBetween', () => {
  it('finds one-off events in range only', () => {
    const state = withEvents(draft());
    expect(starts(state, '2026-10-01', '2026-10-31')).toEqual(['2026-10-17:Dentist']);
    expect(starts(state, '2026-11-01', '2026-11-30')).toEqual([]);
  });

  it('includes multi-day events that started before the range', () => {
    const state = withEvents(
      draft({
        title: 'Trip',
        startDate: '2026-09-29',
        endDate: '2026-10-02',
        startTime: null,
        endTime: null,
      }),
    );
    const occurrences = occurrencesBetween(state, '2026-10-01', '2026-10-31');
    expect(occurrences).toHaveLength(1);
    expect(onDay(occurrences, '2026-10-02')).toHaveLength(1);
    expect(onDay(occurrences, '2026-10-03')).toHaveLength(0);
  });

  it('repeats daily, weekly, until a date', () => {
    const state = withEvents(
      draft({ title: 'Walk', repeat: 'daily', startDate: '2026-10-30', endDate: '2026-10-30' }),
      draft({
        title: 'Class',
        repeat: 'weekly',
        startDate: '2026-10-06',
        endDate: '2026-10-06',
        repeatUntil: '2026-10-20',
      }),
    );
    expect(starts(state, '2026-10-28', '2026-11-02')).toEqual([
      '2026-10-30:Walk',
      '2026-10-31:Walk',
      '2026-11-01:Walk',
      '2026-11-02:Walk',
    ]);
    expect(starts(state, '2026-10-01', '2026-10-31').filter((s) => s.endsWith('Class'))).toEqual([
      '2026-10-06:Class',
      '2026-10-13:Class',
      '2026-10-20:Class',
    ]);
  });

  it('repeats monthly, skipping months without that day', () => {
    const state = withEvents(
      draft({ title: 'Rent', repeat: 'monthly', startDate: '2026-01-31', endDate: '2026-01-31' }),
    );
    expect(starts(state, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-31:Rent',
      '2026-03-31:Rent',
      '2026-05-31:Rent',
    ]);
  });

  it('repeats yearly, on 29 February only in leap years', () => {
    const state = withEvents(
      draft({
        title: 'Birthday',
        repeat: 'yearly',
        startDate: '2024-02-29',
        endDate: '2024-02-29',
        startTime: null,
        endTime: null,
      }),
    );
    expect(starts(state, '2024-01-01', '2032-12-31')).toEqual([
      '2024-02-29:Birthday',
      '2028-02-29:Birthday',
      '2032-02-29:Birthday',
    ]);
  });

  it('finds weekly multi-day events that started in the previous week', () => {
    const state = withEvents(
      draft({
        title: 'Shift',
        repeat: 'weekly',
        startDate: '2026-10-03',
        endDate: '2026-10-05',
        startTime: null,
        endTime: null,
      }),
    );
    // The occurrence starting on 10 October covers 10–12 October.
    expect(starts(state, '2026-10-11', '2026-10-11')).toEqual(['2026-10-10:Shift']);
  });

  it('sorts all-day events first, then by time, then by title', () => {
    const state = withEvents(
      draft({ title: 'Late', startTime: '18:00', endTime: null }),
      draft({ title: 'B all day', startTime: null, endTime: null }),
      draft({ title: 'Early', startTime: '07:30', endTime: null }),
      draft({ title: 'A all day', startTime: null, endTime: null }),
    );
    expect(starts(state, '2026-10-17', '2026-10-17')).toEqual([
      '2026-10-17:A all day',
      '2026-10-17:B all day',
      '2026-10-17:Early',
      '2026-10-17:Late',
    ]);
  });
});

describe('timeLabel', () => {
  const format = (time: string) => `[${time}]`;
  const occurrenceOf = (d: EventDraft) => {
    const [occurrence] = occurrencesBetween(withEvents(d), d.startDate, d.endDate);
    if (!occurrence) throw new Error('Expected an occurrence');
    return occurrence;
  };

  it('describes one-day events', () => {
    expect(timeLabel(occurrenceOf(draft()), '2026-10-17', format)).toBe('[09:00] – [10:00]');
    expect(timeLabel(occurrenceOf(draft({ endTime: null })), '2026-10-17', format)).toBe('[09:00]');
    expect(
      timeLabel(occurrenceOf(draft({ startTime: null, endTime: null })), '2026-10-17', format),
    ).toBe('All day');
  });

  it('describes multi-day events on each day', () => {
    const occurrence = occurrenceOf(
      draft({ startTime: '22:00', endTime: '02:00', endDate: '2026-10-19' }),
    );
    expect(timeLabel(occurrence, '2026-10-17', format)).toBe('From [22:00]');
    expect(timeLabel(occurrence, '2026-10-18', format)).toBe('Continues');
    expect(timeLabel(occurrence, '2026-10-19', format)).toBe('Until [02:00]');
  });
});
