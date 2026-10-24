/**
 * Reminders' data and rules, kept separate from the page so they're easy to
 * test. Every function returns new data instead of changing the old.
 *
 * A reminder is some text, a day and a time, and how often it repeats. Times
 * are "floating", like Calendar's events: 9:00 stays 9:00 in another time
 * zone. One that doesn't repeat can be ticked done (or put off); one that
 * repeats just moves on to its next time. The same rules as Calendar and the
 * notification service: monthly ones on the 31st skip shorter months, and
 * 29 February comes round only in leap years.
 */
import {
  addDays,
  addMinutes,
  daysBetween,
  daysInMonth,
  isIsoDate,
  isIsoTime,
  makeDate,
  parts,
  toStamp,
  weekday,
  type IsoDate,
  type IsoTime,
  type Stamp,
} from '@shkriuss/dates';
import type { Notice } from '@shkriuss/push';
import { secondVersionName } from '@shkriuss/sync';
import { DATE_LOCALE } from '@shkriuss/ui/locale';

export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
export const REPEATS: readonly Repeat[] = [
  'none',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'yearly',
];
/** The choices in the form. */
export const REPEAT_CHOICES: Record<Repeat, string> = {
  none: 'Doesn’t repeat',
  daily: 'Every day',
  weekdays: 'Every weekday (Monday to Friday)',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

export interface Reminder {
  id: string;
  text: string;
  /** The first time (the only one if it doesn't repeat)… */
  date: IsoDate;
  time: IsoTime;
  repeat: Repeat;
  /** …and, for one that doesn't repeat, when it was ticked done. */
  done: Stamp | null;
}

export interface RemindersState {
  reminders: Reminder[];
}

/** The reminders' data version. */
export const REMINDERS_VERSION = 1;

export const MAX_TEXT_LENGTH = 120;
export const MAX_REMINDERS = 300;

export const emptyReminders = (): RemindersState => ({ reminders: [] });

// ---------- Checking ----------

const isStamp = (value: unknown): value is Stamp =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) &&
  isIsoDate(value.slice(0, 10)) &&
  isIsoTime(value.slice(11));

function isReminder(value: unknown): value is Reminder {
  if (typeof value !== 'object' || value === null) return false;
  const { id, text, date, time, repeat, done } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof text === 'string' &&
    isIsoDate(date) &&
    isIsoTime(time) &&
    REPEATS.includes(repeat as Repeat) &&
    (done === null || isStamp(done))
  );
}

/** True when saved reminders have the shape Reminders expects (limits apply when adding, not here). */
export function isRemindersState(value: unknown): value is RemindersState {
  if (typeof value !== 'object' || value === null) return false;
  const { reminders } = value as Record<string, unknown>;
  return Array.isArray(reminders) && reminders.every(isReminder);
}

export interface Draft {
  text: string;
  date: string;
  time: string;
  repeat: Repeat;
}

export type Problems = Partial<Record<'text' | 'date' | 'time', string>>;

/**
 * What's wrong with a reminder as typed, field by field. A reminder that
 * doesn't repeat must still be to come (`now`); `editing` is the one being
 * changed, if any (it doesn't count towards the limit).
 */
export function problems(
  draft: Draft,
  state: RemindersState,
  now: Stamp,
  editing?: string,
): Problems {
  const found: Problems = {};
  const text = draft.text.trim();
  if (text === '') found.text = 'Write what to be reminded of.';
  else if (text.length > MAX_TEXT_LENGTH)
    found.text = `Use ${MAX_TEXT_LENGTH} characters or fewer.`;
  else if (editing === undefined && state.reminders.length >= MAX_REMINDERS) {
    found.text = `You can have up to ${MAX_REMINDERS} reminders.`;
  }
  if (!isIsoDate(draft.date)) found.date = 'Choose a day.';
  if (!isIsoTime(draft.time)) found.time = 'Choose a time.';
  else if (!found.date && draft.repeat === 'none' && toStamp(draft.date, draft.time) <= now) {
    found.time = 'Choose a time that’s still to come.';
  }
  return found;
}

// ---------- Changing ----------

/** Adds a reminder (already checked with problems()). */
export const addReminder = (state: RemindersState, reminder: Reminder): RemindersState => ({
  reminders: [...state.reminders, reminder],
});

/** Changes a reminder's text, time or repeat. A done one comes back, as it's set again. */
export const updateReminder = (
  state: RemindersState,
  id: string,
  draft: Draft,
): RemindersState => ({
  reminders: state.reminders.map((reminder) =>
    reminder.id === id
      ? {
          ...reminder,
          text: draft.text.trim(),
          date: draft.date,
          time: draft.time,
          repeat: draft.repeat,
          done: null,
        }
      : reminder,
  ),
});

export const removeReminder = (state: RemindersState, id: string): RemindersState => ({
  reminders: state.reminders.filter((reminder) => reminder.id !== id),
});

/** Ticks a reminder that doesn't repeat done (at `when`), or not done (null). */
export const setDone = (state: RemindersState, id: string, when: Stamp | null): RemindersState => ({
  reminders: state.reminders.map((reminder) =>
    reminder.id === id && reminder.repeat === 'none' ? { ...reminder, done: when } : reminder,
  ),
});

/** Puts off a reminder that doesn't repeat until `until`. */
export const putOff = (state: RemindersState, id: string, until: Stamp): RemindersState => ({
  reminders: state.reminders.map((reminder) =>
    reminder.id === id && reminder.repeat === 'none'
      ? { ...reminder, date: until.slice(0, 10), time: until.slice(11), done: null }
      : reminder,
  ),
});

export const clearDone = (state: RemindersState): RemindersState => ({
  reminders: state.reminders.filter((reminder) => reminder.done === null),
});

/**
 * Changed on two devices at once: this device's version becomes a reminder
 * of its own, next to the other device's (packages/sync, conflictCopy).
 */
export const secondVersion = (reminder: Reminder, id: string): Reminder => ({
  ...reminder,
  id,
  text: secondVersionName(reminder.text, MAX_TEXT_LENGTH),
});

// ---------- When ----------

/** The next full hour after `now`: what the form suggests. */
export function nextFullHour(now: Stamp): { date: IsoDate; time: IsoTime } {
  const next = addMinutes(now.slice(0, 14) + '00', 60);
  return { date: next.slice(0, 10), time: next.slice(11) };
}

/** In an hour from `now`, to the minute. */
export const inAnHour = (now: Stamp): Stamp => addMinutes(now, 60);

/** The day after `today`, at the reminder's own time. */
export const tomorrowAt = (reminder: Reminder, today: IsoDate): Stamp =>
  toStamp(addDays(today, 1), reminder.time);

/** How far ahead next times are looked for (more than enough for 29 February). */
const MAX_YEARS = 8;

/** The first time a reminder comes on or after `from`, or null if it never does again. */
export function nextTime(reminder: Reminder, from: Stamp): Stamp | null {
  const { date, time, repeat } = reminder;
  const first = toStamp(date, time);
  const on = (day: IsoDate): Stamp => toStamp(day, time);
  if (repeat === 'weekdays') {
    // The first Monday to Friday from the start (or from `from`, if later).
    const begin = first >= from ? first : from;
    for (let offset = 0; offset < 8; offset += 1) {
      const day = addDays(begin.slice(0, 10), offset);
      if (weekday(day) <= 5 && on(day) >= begin) return on(day);
    }
    return null;
  }
  if (first >= from) return first;
  const fromDate = from.slice(0, 10);

  switch (repeat) {
    case 'none':
      return null;
    case 'daily':
    case 'weekly': {
      const step = repeat === 'daily' ? 1 : 7;
      const day = addDays(date, Math.ceil(daysBetween(date, fromDate) / step) * step);
      return on(day) >= from ? on(day) : on(addDays(day, step));
    }
    case 'monthly': {
      const { day } = parts(date);
      const start = parts(fromDate);
      for (let index = 0; index < MAX_YEARS * 12; index += 1) {
        const month = start.month - 1 + index;
        const year = start.year + Math.floor(month / 12);
        const inYear = (month % 12) + 1;
        if (day > daysInMonth(year, inYear)) continue;
        const next = on(makeDate(year, inYear, day));
        if (next >= from) return next;
      }
      return null;
    }
    case 'yearly': {
      const { month, day } = parts(date);
      for (let year = parts(fromDate).year; year <= parts(fromDate).year + MAX_YEARS; year += 1) {
        if (day > daysInMonth(year, month)) continue;
        const next = on(makeDate(year, month, day));
        if (next >= from) return next;
      }
      return null;
    }
  }
}

export interface Item {
  reminder: Reminder;
  /** Its next time (for one done, when it was ticked done). */
  at: Stamp;
}

export interface Groups {
  /** Ones that don't repeat, whose time has passed and that aren't done. */
  overdue: Item[];
  today: Item[];
  tomorrow: Item[];
  later: Item[];
  /** Done ones, last ticked first. */
  done: Item[];
}

/** The reminders, by when they come next, soonest first. */
export function groups(state: RemindersState, now: Stamp): Groups {
  const today = now.slice(0, 10);
  const tomorrow = addDays(today, 1);
  const result: Groups = { overdue: [], today: [], tomorrow: [], later: [], done: [] };
  for (const reminder of state.reminders) {
    if (reminder.done !== null) {
      result.done.push({ reminder, at: reminder.done });
      continue;
    }
    const first = toStamp(reminder.date, reminder.time);
    if (reminder.repeat === 'none' && first < now) {
      result.overdue.push({ reminder, at: first });
      continue;
    }
    const at = nextTime(reminder, now);
    if (at === null) continue;
    const day = at.slice(0, 10);
    const group = day === today ? 'today' : day === tomorrow ? 'tomorrow' : 'later';
    result[group].push({ reminder, at });
  }
  const soonest = (a: Item, b: Item) => a.at.localeCompare(b.at);
  for (const key of ['overdue', 'today', 'tomorrow', 'later'] as const) result[key].sort(soonest);
  result.done.sort((a, b) => b.at.localeCompare(a.at));
  return result;
}

// ---------- Notifications ----------

/** What a notification says under the reminder's text (the same every time it's sent). */
export const REMINDER_BODY = 'Tap to open Reminders.';

/**
 * The reminders, for the notification service (@shkriuss/push). Every
 * weekday is one weekly reminder for each day from Monday to Friday.
 */
export function reminderNotices(state: RemindersState): Notice[] {
  return state.reminders.flatMap((reminder): Notice[] => {
    if (reminder.done !== null) return [];
    const notice = (id: string, date: IsoDate, repeat: Notice['repeat']): Notice => ({
      id,
      start: toStamp(date, reminder.time),
      repeat,
      until: null,
      offset: 0,
      title: reminder.text,
      body: REMINDER_BODY,
      tag: reminder.id,
      url: '/',
    });
    if (reminder.repeat !== 'weekdays') {
      return [notice(reminder.id, reminder.date, reminder.repeat)];
    }
    return [1, 2, 3, 4, 5].map((day) => {
      const date = addDays(reminder.date, (day - weekday(reminder.date) + 7) % 7);
      return notice(`${reminder.id}~${day}`, date, 'weekly');
    });
  });
}

/** Reminders that came after `from` and up to `to` (local times), not done. */
export const dueReminders = (state: RemindersState, from: Stamp, to: Stamp): Reminder[] =>
  state.reminders.filter((reminder) => {
    if (reminder.done !== null) return false;
    const at = nextTime(reminder, addMinutes(from, 1));
    return at !== null && at <= to;
  });

// ---------- Words for people ----------

const dateParts = (date: IsoDate) => {
  const { year, month, day } = parts(date);
  return Date.UTC(year, month - 1, day);
};

/** A time of day for people: "8:00 PM", or "20:00" where that's how times are written. */
export function timeLabel(time: IsoTime, locale = DATE_LOCALE): string {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(Date.UTC(2024, 0, 1, hour, minute));
}

/** "Today at 3:00 PM", "Tomorrow at …", "Yesterday at …", or "Friday, October 23 at …". */
export function whenLabel(at: Stamp, now: Stamp, locale = DATE_LOCALE): string {
  const date = at.slice(0, 10);
  const today = now.slice(0, 10);
  const time = timeLabel(at.slice(11), locale);
  if (date === today) return `Today at ${time}`;
  if (date === addDays(today, 1)) return `Tomorrow at ${time}`;
  if (date === addDays(today, -1)) return `Yesterday at ${time}`;
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  };
  if (date.slice(0, 4) !== today.slice(0, 4)) options.year = 'numeric';
  return `${new Intl.DateTimeFormat(locale, options).format(dateParts(date))} at ${time}`;
}

/** whenLabel() for the middle of a sentence: "today at 3:00 PM", "Friday, October 23 at …". */
export const whenInSentence = (at: Stamp, now: Stamp, locale = DATE_LOCALE): string =>
  whenLabel(at, now, locale).replace(/^(Today|Tomorrow|Yesterday) /, (word) => word.toLowerCase());

const ordinal = (day: number): string => {
  const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th' } as Record<string, string>;
  return `${day}${suffix[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(day)] ?? 'th'}`;
};

/** "Every day", "Every weekday", "Every Friday", "Every month on the 23rd", "Every year on October 23". */
export function repeatLabel(reminder: Reminder, locale = DATE_LOCALE): string {
  switch (reminder.repeat) {
    case 'none':
      return '';
    case 'daily':
      return 'Every day';
    case 'weekdays':
      return 'Every weekday';
    case 'weekly':
      return `Every ${new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(dateParts(reminder.date))}`;
    case 'monthly':
      return `Every month on the ${ordinal(parts(reminder.date).day)}`;
    case 'yearly':
      return `Every year on ${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateParts(reminder.date))}`;
  }
}
