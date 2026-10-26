import { describe, expect, it } from 'vitest';
import { ALL_DAY_REMINDERS, reminderLabel, TIMED_REMINDERS } from './reminder-choices.ts';

describe('reminderLabel', () => {
  const time = (t: string) => `[${t}]`;

  it('names every choice for timed events', () => {
    expect(TIMED_REMINDERS.map((m) => reminderLabel(m, false, time))).toEqual([
      'At the start time',
      '5 minutes before',
      '10 minutes before',
      '15 minutes before',
      '30 minutes before',
      '1 hour before',
      '2 hours before',
      '1 day before',
      '1 week before',
    ]);
    expect(reminderLabel(90, false, time)).toBe('1 hour 30 minutes before');
    expect(reminderLabel(1441, false, time)).toBe('1 day 1 minute before');
  });

  it('names every choice for all-day events, with the time of day', () => {
    expect(ALL_DAY_REMINDERS.map((m) => reminderLabel(m, true, time))).toEqual([
      'On the day at [09:00]',
      '1 day before at [09:00]',
      '2 days before at [09:00]',
      '1 week before at [09:00]',
    ]);
    expect(reminderLabel(0, true, time)).toBe('On the day at [00:00]');
    expect(reminderLabel(-1439, true, time)).toBe('On the day at [23:59]');
    expect(reminderLabel(1, true, time)).toBe('1 day before at [23:59]');
  });
});
