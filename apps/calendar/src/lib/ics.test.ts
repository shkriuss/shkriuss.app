import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from './events.ts';
import { escapeText, foldLine, toIcs } from './ics.ts';

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'abc',
  title: 'Dentist',
  startDate: '2026-10-17',
  endDate: '2026-10-17',
  startTime: '09:00',
  endTime: '10:30',
  repeat: 'none',
  repeatUntil: null,
  notes: '',
  ...overrides,
});

const now = new Date('2026-10-17T02:03:04Z');
const linesOf = (ics: string) => ics.split('\r\n');

describe('toIcs', () => {
  it('writes a valid calendar wrapper with CRLF line endings', () => {
    const ics = toIcs([], { now });
    expect(ics).toBe(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//shkriuss.app//Calendar//EN\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n',
    );
  });

  it('writes a timed event with floating local times', () => {
    const lines = linesOf(toIcs([event()], { now }));
    expect(lines).toContain('UID:abc@calendar.shkriuss.app');
    expect(lines).toContain('DTSTAMP:20261017T020304Z');
    expect(lines).toContain('DTSTART:20261017T090000');
    expect(lines).toContain('DTEND:20261017T103000');
    expect(lines).toContain('SUMMARY:Dentist');
    expect(lines.some((line) => line.startsWith('DESCRIPTION'))).toBe(false);
  });

  it('writes all-day events with an exclusive end date', () => {
    const lines = linesOf(
      toIcs([event({ startTime: null, endTime: null, endDate: '2026-10-19' })], { now }),
    );
    expect(lines).toContain('DTSTART;VALUE=DATE:20261017');
    expect(lines).toContain('DTEND;VALUE=DATE:20261020');
  });

  it('writes repeat rules, with UNTIL in the same form as the start', () => {
    expect(linesOf(toIcs([event({ repeat: 'weekly' })], { now }))).toContain('RRULE:FREQ=WEEKLY');
    expect(
      linesOf(toIcs([event({ repeat: 'monthly', repeatUntil: '2027-01-31' })], { now })),
    ).toContain('RRULE:FREQ=MONTHLY;UNTIL=20270131T235959');
    expect(
      linesOf(
        toIcs(
          [event({ repeat: 'yearly', startTime: null, endTime: null, repeatUntil: '2030-10-17' })],
          { now },
        ),
      ),
    ).toContain('RRULE:FREQ=YEARLY;UNTIL=20301017');
  });

  it('escapes text and keeps notes', () => {
    const lines = linesOf(
      toIcs([event({ title: 'Lunch; Anna, Ben', notes: 'Line 1\nC:\\path' })], { now }),
    );
    expect(lines).toContain('SUMMARY:Lunch\\; Anna\\, Ben');
    expect(lines).toContain('DESCRIPTION:Line 1\\nC:\\\\path');
  });
});

describe('foldLine', () => {
  it('keeps short lines as they are', () => {
    expect(foldLine('SUMMARY:Short')).toBe('SUMMARY:Short');
  });

  it('folds long lines at 75 bytes without splitting characters', () => {
    const folded = foldLine(`SUMMARY:${'ბ'.repeat(40)}`); // Georgian letters are 3 bytes each
    const encoder = new TextEncoder();
    for (const piece of folded.split('\r\n'))
      expect(encoder.encode(piece).length).toBeLessThanOrEqual(75);
    expect(
      folded
        .split('\r\n')
        .map((piece, index) => (index ? piece.slice(1) : piece))
        .join(''),
    ).toBe(`SUMMARY:${'ბ'.repeat(40)}`);
    expect(
      folded
        .split('\r\n')
        .slice(1)
        .every((piece) => piece.startsWith(' ')),
    ).toBe(true);
  });
});

describe('escapeText', () => {
  it('escapes backslashes first', () => {
    expect(escapeText('a\\;b')).toBe('a\\\\\\;b');
  });
});
