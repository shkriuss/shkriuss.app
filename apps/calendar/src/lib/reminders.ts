/**
 * Reminders: when they go off, and which are due. The choices the event
 * editor offers, and what they're called, are in reminder-choices.ts.
 *
 * A reminder is a number of minutes before an event starts (see
 * CalendarEvent.reminder). Times are "floating" local times, like the events.
 */
import { addDays, addMinutes, toStamp, type Stamp } from './dates.ts';
import {
  compareOccurrences,
  occurrencesBetween,
  type CalendarState,
  type Occurrence,
} from './events.ts';

/** Reminders missed while Calendar was closed still show if they're this recent. */
export const LOOKBACK_MINUTES = 12 * 60;

/** When an occurrence starts: its start time, or midnight for all-day events. */
export const startStamp = (occurrence: Occurrence): Stamp =>
  toStamp(occurrence.start, occurrence.event.startTime ?? '00:00');

/** When an occurrence's reminder goes off. */
export const reminderStamp = (occurrence: Occurrence): Stamp =>
  addMinutes(startStamp(occurrence), -(occurrence.event.reminder ?? 0));

/** When an occurrence is over (an hour after the start if it has no end time). */
export function finishStamp(occurrence: Occurrence): Stamp {
  const { event, end } = occurrence;
  if (event.startTime === null) return toStamp(addDays(end, 1));
  if (event.endTime !== null) return toStamp(end, event.endTime);
  return addMinutes(startStamp(occurrence), 60);
}

export interface DueReminder {
  occurrence: Occurrence;
  /** When it went off. */
  at: Stamp;
}

/**
 * Reminders that went off after `after` and up to `until`, oldest first.
 * Ones older than `lookback` minutes, or for events already over, are left out.
 */
export function dueReminders(
  state: CalendarState,
  after: Stamp,
  until: Stamp,
  lookback = LOOKBACK_MINUTES,
): DueReminder[] {
  const earliest = addMinutes(until, -lookback);
  const from = after > earliest ? after : earliest;
  if (from >= until) return [];

  const due: DueReminder[] = [];
  for (const event of state.events) {
    if (event.reminder === null) continue;
    // A reminder at `at` belongs to an occurrence starting `reminder` minutes later.
    const firstDay = addMinutes(from, event.reminder).slice(0, 10);
    const lastDay = addMinutes(until, event.reminder).slice(0, 10);
    for (const occurrence of occurrencesBetween({ events: [event] }, firstDay, lastDay)) {
      const at = reminderStamp(occurrence);
      if (at > from && at <= until && finishStamp(occurrence) > until) due.push({ occurrence, at });
    }
  }
  return due.sort(
    (a, b) =>
      (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || compareOccurrences(a.occurrence, b.occurrence),
  );
}
