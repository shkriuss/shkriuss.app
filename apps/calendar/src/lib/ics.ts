/**
 * Export events as an iCalendar (.ics) file, the standard format that Google
 * Calendar, Apple Calendar, Outlook and others can import (RFC 5545).
 *
 * Times are "floating" (no time zone), the same as in the app: 09:00 stays
 * 09:00 wherever the file is opened.
 */
import { addDays, type IsoDate, type IsoTime } from './dates.ts';
import type { CalendarEvent } from './events.ts';

const FREQ: Record<CalendarEvent['repeat'], string | null> = {
  none: null,
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};

/** Escapes text values (RFC 5545 §3.3.11). */
export function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Splits lines longer than 75 bytes, never inside a character (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const pieces: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = pieces.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + bytes > limit) {
      pieces.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  pieces.push(current);
  return pieces.join('\r\n ');
}

const compactDate = (date: IsoDate): string => date.replaceAll('-', '');
const compactDateTime = (date: IsoDate, time: IsoTime | '23:59:59'): string =>
  `${compactDate(date)}T${time.replaceAll(':', '').padEnd(6, '0')}`;

function stampOf(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

function eventLines(event: CalendarEvent, stamp: string, domain: string): string[] {
  const allDay = event.startTime === null;
  const lines = ['BEGIN:VEVENT', `UID:${event.id}@${domain}`, `DTSTAMP:${stamp}`];

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${compactDate(event.startDate)}`);
    // All-day end dates are exclusive in iCalendar: the day after the last day.
    lines.push(`DTEND;VALUE=DATE:${compactDate(addDays(event.endDate, 1))}`);
  } else {
    lines.push(`DTSTART:${compactDateTime(event.startDate, event.startTime as IsoTime)}`);
    if (event.endTime !== null) {
      lines.push(`DTEND:${compactDateTime(event.endDate, event.endTime)}`);
    } else if (event.endDate !== event.startDate) {
      lines.push(`DTEND:${compactDateTime(event.endDate, '23:59:59')}`);
    }
  }

  const freq = FREQ[event.repeat];
  if (freq) {
    const until = event.repeatUntil
      ? `;UNTIL=${allDay ? compactDate(event.repeatUntil) : compactDateTime(event.repeatUntil, '23:59:59')}`
      : '';
    lines.push(`RRULE:FREQ=${freq}${until}`);
  }

  lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
  lines.push('END:VEVENT');
  return lines;
}

/** The complete .ics file for these events. */
export function toIcs(
  events: readonly CalendarEvent[],
  options: { now?: Date; domain?: string } = {},
): string {
  const stamp = stampOf(options.now ?? new Date());
  const domain = options.domain ?? 'calendar.shkriuss.app';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//shkriuss.app//Calendar//EN',
    'CALSCALE:GREGORIAN',
    ...events.flatMap((event) => eventLines(event, stamp, domain)),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
