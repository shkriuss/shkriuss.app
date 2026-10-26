/**
 * Adding, changing and deleting events (the event editor), and adding them
 * from a file (the import), as plain functions. Apart from events.ts, so
 * they load only with the editor and the import, not when the page starts
 * (audit 3 J-11). Every function returns new data instead of changing the
 * old.
 */
import { withEdits } from '@shkriuss/sync/edits';
import { addDays, type IsoDate } from './dates.ts';
import {
  draftProblems,
  MAX_EVENTS,
  occurrencesBetween,
  type CalendarEvent,
  type CalendarState,
  type EventDraft,
} from './events.ts';

function clean(draft: EventDraft): EventDraft {
  return { ...draft, title: draft.title.trim(), notes: draft.notes.trim() };
}

export function addEvent(state: CalendarState, draft: EventDraft, id: string): CalendarState {
  if (Object.keys(draftProblems(draft)).length > 0 || state.events.length >= MAX_EVENTS)
    return state;
  return { events: [...state.events, { id, ...clean(draft) }] };
}

/**
 * Puts in the changed event. One deleted on another device (or in another
 * tab) while it was being changed comes back with the change: a change wins
 * over a deletion, as sync does (audit F1-3).
 */
export function updateEvent(state: CalendarState, id: string, draft: EventDraft): CalendarState {
  if (Object.keys(draftProblems(draft)).length > 0) return state;
  const changed = { id, ...clean(draft) };
  if (!state.events.some((event) => event.id === id)) return { events: [...state.events, changed] };
  return { events: state.events.map((event) => (event.id === id ? changed : event)) };
}

/** An event's fields, as the editor holds them. */
export const draftOf = ({ id: _id, ...draft }: CalendarEvent): EventDraft => draft;

/**
 * Saves the editor. While it was open, a sync (or another tab) may have
 * changed the event: only what was changed in the editor goes on the event
 * as it is now, so the other change stays (withEdits, audit F1-2). If the
 * two don't fit together (say, an end time set here before a start moved
 * there), the editor wins, as it was checked. `opened` is the editor as it
 * opened, `edited` as it is now.
 */
export function editEvent(
  state: CalendarState,
  id: string,
  opened: EventDraft,
  edited: EventDraft,
): CalendarState {
  const current = state.events.find((event) => event.id === id);
  const merged = current ? withEdits(opened, edited, draftOf(current)) : edited;
  const draft = Object.keys(draftProblems(merged)).length === 0 ? merged : edited;
  return updateEvent(state, id, draft);
}

export function removeEvent(state: CalendarState, id: string): CalendarState {
  return { events: state.events.filter((event) => event.id !== id) };
}

/**
 * The day to show after an event is saved: the selected day if the event is
 * on it, else the next day it's on (within a year), else its first day.
 * Works out only this event's days: working out every event's for a year
 * made saving slow with many repeating events (audit F1-13).
 */
export function dayToShow(state: CalendarState, id: string, selected: IsoDate): IsoDate {
  const event = state.events.find((entry) => entry.id === id);
  if (!event) return selected;
  const [first] = occurrencesBetween({ events: [event] }, selected, addDays(selected, 366));
  if (!first) return event.startDate;
  // Sorted by start, so one starting on or before the selected day covers it.
  return first.start <= selected ? selected : first.start;
}

export interface ImportResult {
  state: CalendarState;
  added: number;
  /** Already in the calendar (same id). */
  duplicates: number;
  /** Left out because the calendar is full. */
  overLimit: number;
}

/** Adds events from a file, skipping ones already here (same id) and anything over the limit. */
export function importEvents(
  state: CalendarState,
  items: readonly { id: string; draft: EventDraft }[],
): ImportResult {
  const ids = new Set(state.events.map((event) => event.id));
  const added: CalendarEvent[] = [];
  let duplicates = 0;
  let overLimit = 0;
  for (const { id, draft } of items) {
    if (ids.has(id)) duplicates += 1;
    else if (Object.keys(draftProblems(draft)).length > 0) continue;
    else if (state.events.length + added.length >= MAX_EVENTS) overLimit += 1;
    else {
      ids.add(id);
      added.push({ id, ...clean(draft) });
    }
  }
  return {
    state: added.length ? { events: [...state.events, ...added] } : state,
    added: added.length,
    duplicates,
    overLimit,
  };
}
