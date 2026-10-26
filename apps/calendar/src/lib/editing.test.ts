import { describe, expect, it } from 'vitest';
import {
  addEvent,
  dayToShow,
  editEvent,
  importEvents,
  removeEvent,
  updateEvent,
} from './editing.ts';
import {
  emptyState,
  MAX_EVENTS,
  type CalendarEvent,
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

describe('importEvents', () => {
  it('adds new events and skips ones already there', () => {
    const state = withEvents(draft());
    const result = importEvents(state, [
      { id: 'e0', draft: draft({ title: 'Same id' }) },
      { id: 'new', draft: draft({ title: '  Gym ' }) },
      { id: 'new', draft: draft({ title: 'Twice in the file' }) },
      { id: 'bad', draft: draft({ title: '' }) },
    ]);
    expect(result).toMatchObject({ added: 1, duplicates: 2, overLimit: 0 });
    expect(result.state.events.map((e) => `${e.id}:${e.title}`)).toEqual(['e0:Dentist', 'new:Gym']);
  });

  it('stops at the event limit', () => {
    const full = {
      events: Array.from({ length: MAX_EVENTS - 1 }, (_, i) => ({ id: `x${i}`, ...draft() })),
    };
    const result = importEvents(full, [
      { id: 'a', draft: draft() },
      { id: 'b', draft: draft() },
    ]);
    expect(result).toMatchObject({ added: 1, overLimit: 1 });
    expect(result.state.events).toHaveLength(MAX_EVENTS);
  });

  it('returns the same state when nothing is added', () => {
    const state = withEvents(draft());
    expect(importEvents(state, []).state).toBe(state);
  });
});

describe('add, update and remove', () => {
  it('trims text and ignores invalid drafts', () => {
    const state = addEvent(
      emptyState(),
      draft({ title: '  Dentist  ', notes: ' bring card ' }),
      'a',
    );
    expect(state.events[0]).toMatchObject({ id: 'a', title: 'Dentist', notes: 'bring card' });
    expect(addEvent(state, draft({ title: '' }), 'b')).toBe(state);
  });

  it('updates and removes by id', () => {
    let state = withEvents(draft(), draft({ title: 'Gym' }));
    state = updateEvent(state, 'e1', draft({ title: 'Swim' }));
    expect(state.events.map((e) => e.title)).toEqual(['Dentist', 'Swim']);
    state = removeEvent(state, 'e0');
    expect(state.events.map((e) => e.id)).toEqual(['e1']);
  });

  // While the editor is open, a sync (or another tab) may change the event
  // (audit F1-2): saving puts on only what was changed in the editor.
  it('saves the editor on top of a change made elsewhere meanwhile', () => {
    const opened = draft({ reminder: 15 });
    const moved = updateEvent(withEvents(opened), 'e0', {
      ...opened,
      startTime: '14:00',
      endTime: '15:00',
      reminder: 60,
    });
    const notes = editEvent(moved, 'e0', opened, { ...opened, notes: 'Bring the X-ray' });
    expect(notes.events).toEqual([
      {
        ...opened,
        id: 'e0',
        startTime: '14:00',
        endTime: '15:00',
        reminder: 60,
        notes: 'Bring the X-ray',
      },
    ]);
    // Where both changed the same thing, the change here wins.
    const later = editEvent(moved, 'e0', opened, { ...opened, reminder: 30 });
    expect(later.events[0]).toMatchObject({ startTime: '14:00', reminder: 30 });
    // Changes that don't fit together (an end before the new start): the editor wins.
    const ends = editEvent(moved, 'e0', opened, { ...opened, endTime: '11:00' });
    expect(ends.events).toEqual([{ ...opened, id: 'e0', endTime: '11:00' }]);
    // Nothing changed here: nothing changes.
    expect(editEvent(moved, 'e0', opened, opened)).toEqual(moved);
  });

  it('puts back an event deleted elsewhere while it was being changed', () => {
    // A change wins over a deletion, as sync does (audit F1-3).
    const opened = draft();
    const deleted = removeEvent(withEvents(opened, draft({ title: 'Gym' })), 'e0');
    const saved = editEvent(deleted, 'e0', opened, { ...opened, notes: 'Bring the X-ray' });
    expect(saved.events).toEqual([
      { ...draft({ title: 'Gym' }), id: 'e1' },
      { ...opened, id: 'e0', notes: 'Bring the X-ray' },
    ]);
    expect(updateEvent(deleted, 'e0', draft({ title: '' }))).toBe(deleted);
  });
});

describe('dayToShow', () => {
  const weekly = { ...draft({ repeat: 'weekly' }), id: 'yoga' };

  it('shows the chosen day if a saved event is on it, else its next day', () => {
    const state = { events: [weekly] };
    // Saturdays from 17 October.
    expect(dayToShow(state, 'yoga', '2026-10-24')).toBe('2026-10-24');
    expect(dayToShow(state, 'yoga', '2026-10-20')).toBe('2026-10-24');
    // Not on any day in the year from the chosen one: its first day.
    const over = { events: [{ ...weekly, repeatUntil: '2026-10-31' }] };
    expect(dayToShow(over, 'yoga', '2026-12-01')).toBe('2026-10-17');
    expect(dayToShow(state, 'gone', '2026-12-01')).toBe('2026-12-01');
  });

  it('works out only the saved event’s days', () => {
    // Every event's, a year of them, took seconds with many events (audit F1-13).
    const other = new Proxy({} as CalendarEvent, {
      get: (_, property) => {
        if (property === 'id') return 'other';
        throw new Error('Another event was looked at');
      },
    });
    const state = { events: [other, weekly, other] };
    expect(dayToShow(state, 'yoga', '2026-10-20')).toBe('2026-10-24');
  });
});
