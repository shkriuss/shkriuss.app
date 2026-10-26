import { describe, expect, it } from 'vitest';
import { addEvent } from './editing.ts';
import { emptyState, type CalendarState, type EventDraft } from './events.ts';
import { dueReminders, LOOKBACK_MINUTES } from './reminders.ts';

const draft = (overrides: Partial<EventDraft> = {}): EventDraft => ({
  title: 'Dentist',
  startDate: '2026-10-17',
  endDate: '2026-10-17',
  startTime: '14:30',
  endTime: '15:30',
  repeat: 'none',
  repeatUntil: null,
  reminder: 15,
  notes: '',
  ...overrides,
});

const withEvents = (...drafts: EventDraft[]): CalendarState =>
  drafts.reduce((state, d, index) => addEvent(state, d, `e${index}`), emptyState());

/** Reminders as "when title"; looks back 10 weeks unless told otherwise. */
const due = (state: CalendarState, after: string, until: string, lookback = 100_000) =>
  dueReminders(state, after, until, lookback).map(
    ({ occurrence, at }) => `${at} ${occurrence.event.title}`,
  );

describe('dueReminders', () => {
  it('finds reminders that went off in the window', () => {
    const state = withEvents(draft(), draft({ title: 'No reminder', reminder: null }));
    expect(due(state, '2026-10-17T14:00', '2026-10-17T14:14')).toEqual([]);
    expect(due(state, '2026-10-17T14:00', '2026-10-17T14:15')).toEqual([
      '2026-10-17T14:15 Dentist',
    ]);
    // Already shown in an earlier check.
    expect(due(state, '2026-10-17T14:15', '2026-10-17T14:20')).toEqual([]);
  });

  it('finds reminders a day or a week ahead, and all-day reminders', () => {
    const state = withEvents(
      draft({ title: 'Flight', startDate: '2026-10-20', endDate: '2026-10-20', reminder: 1440 }),
      draft({
        title: 'Birthday',
        startDate: '2026-10-25',
        endDate: '2026-10-25',
        startTime: null,
        endTime: null,
        reminder: 9540, // a week before at 9:00
      }),
    );
    expect(due(state, '2026-10-18T08:00', '2026-10-19T15:00')).toEqual([
      '2026-10-18T09:00 Birthday',
      '2026-10-19T14:30 Flight',
    ]);
  });

  it('reminds for each time a repeating event happens, until it stops', () => {
    const state = withEvents(
      draft({
        title: 'Yoga',
        repeat: 'weekly',
        repeatUntil: '2026-10-24',
        startTime: '18:00',
        endTime: null,
        reminder: 60,
      }),
    );
    expect(due(state, '2026-10-17T16:00', '2026-10-17T17:30')).toEqual(['2026-10-17T17:00 Yoga']);
    expect(due(state, '2026-10-24T16:59', '2026-10-24T17:00')).toEqual(['2026-10-24T17:00 Yoga']);
    expect(due(state, '2026-10-31T16:00', '2026-10-31T18:00')).toEqual([]);
  });

  it('shows missed reminders only if recent and the event is not over', () => {
    const state = withEvents(
      draft({ title: 'Still on', startTime: '09:30', endTime: '11:00', reminder: 30 }),
      draft({ title: 'Over', startTime: '08:00', endTime: '08:30', reminder: 10 }),
      draft({ title: 'No end time', startTime: '09:45', endTime: null, reminder: 0 }),
      draft({
        title: 'Too long ago',
        startDate: '2026-10-16',
        endDate: '2026-10-18',
        startTime: '07:00',
        endTime: '20:00',
        reminder: 120,
      }),
    );
    // Calendar was last open the evening before.
    expect(due(state, '2026-10-16T21:00', '2026-10-17T10:00', LOOKBACK_MINUTES)).toEqual([
      '2026-10-17T09:00 Still on',
      '2026-10-17T09:45 No end time',
    ]);
  });

  it('skips reminders missed more than 12 hours ago', () => {
    const state = withEvents(
      draft({
        title: 'Trip',
        startDate: '2026-10-17',
        endDate: '2026-10-20',
        startTime: null,
        endTime: null,
        reminder: 900,
      }),
    );
    // Went off at 9:00 the day before; Calendar opened 13 hours later.
    expect(due(state, '2026-10-15T00:00', '2026-10-16T22:00', LOOKBACK_MINUTES)).toEqual([]);
    expect(due(state, '2026-10-15T00:00', '2026-10-16T20:59', LOOKBACK_MINUTES)).toEqual([
      '2026-10-16T09:00 Trip',
    ]);
  });

  it('does nothing when the clock goes backwards', () => {
    const state = withEvents(draft());
    expect(due(state, '2026-10-17T15:00', '2026-10-17T14:00')).toEqual([]);
  });
});
