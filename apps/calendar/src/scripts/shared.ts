/**
 * Helpers shared by Calendar's page scripts (calendar.ts, reminder-alerts.ts
 * and import-dialog.ts).
 */
import { parts, type IsoDate, type IsoTime } from '../lib/dates.ts';
import type { CalendarState, Occurrence } from '../lib/events.ts';
import { DATE_LOCALE } from '@shkriuss/ui/locale';

export function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Calendar: missing element ${selector}`);
  return element;
}

// Dates are formatted as UTC midnight so the device's time zone can't shift them.
export const utc = (date: IsoDate): Date => {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day));
};
const formatter = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(DATE_LOCALE, { ...options, timeZone: 'UTC' });

export const monthFormat = formatter({ month: 'long', year: 'numeric' });
export const longDate = formatter({
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
export const longDateThisYear = formatter({ weekday: 'long', day: 'numeric', month: 'long' });
export const shortDate = formatter({ weekday: 'short', day: 'numeric', month: 'short' });
export const weekdayShort = formatter({ weekday: 'short' });
export const weekdayLong = formatter({ weekday: 'long' });
const timeFormat = formatter({ hour: 'numeric', minute: '2-digit' });

/** "14:30" in the person's preferred style, e.g. "2:30 PM". */
export const formatTime = (time: IsoTime): string => {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return timeFormat.format(new Date(Date.UTC(2000, 0, 1, hours, minutes)));
};

export const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/** What the main script (calendar.ts) shares with the reminder and import parts. */
export interface CalendarPage {
  /** The events as they are now. */
  state(): CalendarState;
  /** Saves events and redraws the page. False if the browser blocked saving. */
  save(next: CalendarState): boolean;
  /** Tells screen reader users what happened. */
  announce(message: string): void;
  /** A list item for an event (from the page's template); tapping it opens the event. */
  eventItem(occurrence: Occurrence, day: IsoDate, withDate: boolean): HTMLLIElement;
  /** Somewhere safe for keyboard focus when the element it was on goes away. */
  newEventButton: HTMLButtonElement;
}
