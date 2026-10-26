/**
 * The reminders the event editor offers, and what each is called. Apart
 * from reminders.ts, so they load only with the editor, not when the page
 * starts (audit 3 J-11).
 *
 * A reminder is a number of minutes before an event starts (see
 * CalendarEvent.reminder).
 */
import type { IsoTime } from './dates.ts';

/** Choices for events with a time, in minutes before the start. */
export const TIMED_REMINDERS = [0, 5, 10, 15, 30, 60, 120, 1440, 10080] as const;
/** Choices for all-day events: 9:00 on the day, or 1 day, 2 days or 1 week before at 9:00. */
export const ALL_DAY_REMINDERS = [-540, 900, 2340, 9540] as const;
/** What the reminder list switches to when an event changes between all-day and timed. */
export const DEFAULT_REMINDER = { timed: 15, allDay: -540 } as const;

const count = (value: number, word: string): string => `${value} ${word}${value === 1 ? '' : 's'}`;

/** Minutes after midnight as "HH:MM". */
const clock = (minutes: number): IsoTime =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** For example "15 minutes before", "1 hour 30 minutes before" or "1 day before at 9:00 AM". */
export function reminderLabel(
  minutes: number,
  allDay: boolean,
  formatTime: (time: IsoTime) => string,
): string {
  if (allDay) {
    // Minutes after midnight on the first day (negative = days before).
    const offset = -minutes;
    const days = Math.floor(offset / 1440);
    const at = formatTime(clock(offset - days * 1440));
    if (days === 0) return `On the day at ${at}`;
    const before = -days % 7 === 0 ? count(-days / 7, 'week') : count(-days, 'day');
    return `${before} before at ${at}`;
  }
  if (minutes === 0) return 'At the start time';
  if (minutes % 10080 === 0) return `${count(minutes / 10080, 'week')} before`;
  const parts = [
    [Math.floor(minutes / 1440), 'day'],
    [Math.floor((minutes % 1440) / 60), 'hour'],
    [minutes % 60, 'minute'],
  ] as const;
  const text = parts.filter(([value]) => value > 0).map(([value, word]) => count(value, word));
  return `${text.join(' ')} before`;
}
