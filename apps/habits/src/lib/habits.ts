/**
 * Habits' data and rules, kept separate from the page so they're easy to test.
 * Every function returns new data instead of changing the old.
 *
 * Two lists, saved and synced separately:
 * - habits: a name and the days of the week it's planned for;
 * - checks: one per habit per day it was done. A check's id is made from the
 *   habit and the date, so marking the same day done on two devices is the
 *   same check, never a conflict.
 *
 * A habit can have a reminder: a time of day, on the days it's planned for.
 */
import {
  addDays,
  isIsoDate,
  isIsoTime,
  toStamp,
  weekday,
  type IsoDate,
  type IsoTime,
  type Stamp,
} from '@shkriuss/dates';
import type { Notice } from '@shkriuss/push';
import { withEdits } from '@shkriuss/sync/edits';
import { DATE_LOCALE } from '@shkriuss/ui/locale';
import { foldText } from '@shkriuss/ui/text';

export interface Habit {
  id: string;
  name: string;
  /** Days of the week it's planned for: 1 = Monday … 7 = Sunday (at least one). */
  days: number[];
  /** A reminder at this time ("20:00") on planned days not done yet; none if missing. */
  reminder?: IsoTime;
}

export interface HabitsState {
  habits: Habit[];
}

export interface Check {
  /** checkId(habit, date) */
  id: string;
  habit: string;
  date: IsoDate;
}

export interface ChecksState {
  checks: Check[];
}

/** The data versions of the habits and of the check marks. */
export const HABITS_VERSION = 1;
export const CHECKS_VERSION = 1;

export const MAX_NAME_LENGTH = 60;
export const MAX_HABITS = 50;
/**
 * The most check marks Habits keeps, so they fit on the device and in the
 * sync copy (measured in habits.test.ts: "room for every check mark"):
 * enough for 10 habits ticked every day for over 2½ years. To make room, the
 * person deletes the check marks from a year (audit F1-5).
 */
export const MAX_CHECKS = 10_000;
export const EVERY_DAY: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
/** How many days back (today included) the edit form can mark done. */
export const EDITABLE_DAYS = 14;
/** Streaks look back at most this far (about 10 years). */
const LOOKBACK_DAYS = 3660;

export const emptyHabits = (): HabitsState => ({ habits: [] });
export const emptyChecks = (): ChecksState => ({ checks: [] });

export const checkId = (habit: string, date: IsoDate): string => `${habit}~${date}`;

const isDays = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) &&
  new Set(value).size === value.length;

function isHabit(value: unknown): value is Habit {
  if (typeof value !== 'object' || value === null) return false;
  const { id, name, days, reminder } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof name === 'string' &&
    isDays(days) &&
    (reminder === undefined || isIsoTime(reminder))
  );
}

function isCheck(value: unknown): value is Check {
  if (typeof value !== 'object' || value === null) return false;
  const { id, habit, date } = value as Record<string, unknown>;
  return (
    typeof habit === 'string' && habit.length > 0 && isIsoDate(date) && id === checkId(habit, date)
  );
}

/** True when saved habits have the shape Habits expects (limits apply when adding, not here). */
export function isHabitsState(value: unknown): value is HabitsState {
  if (typeof value !== 'object' || value === null) return false;
  const { habits } = value as Record<string, unknown>;
  return Array.isArray(habits) && habits.every(isHabit);
}

export function isChecksState(value: unknown): value is ChecksState {
  if (typeof value !== 'object' || value === null) return false;
  const { checks } = value as Record<string, unknown>;
  return Array.isArray(checks) && checks.every(isCheck);
}

/**
 * An error message for a habit's name, or undefined when it's fine.
 * `editing` is the habit being renamed (its own name doesn't count as taken).
 */
export function nameError(name: string, state: HabitsState, editing?: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Enter a name for the habit.';
  if (trimmed.length > MAX_NAME_LENGTH) return `Use ${MAX_NAME_LENGTH} characters or fewer.`;
  // Capitals, accents and extra spaces don't make another name, as in the
  // other apps: "Café" is "cafe" (audit 3 J-12).
  const wanted = foldText(trimmed);
  const taken = state.habits.some(
    (habit) => habit.id !== editing && foldText(habit.name) === wanted,
  );
  if (taken) return 'You already have a habit with that name.';
  if (editing === undefined && state.habits.length >= MAX_HABITS) {
    return `You can have up to ${MAX_HABITS} habits.`;
  }
  return undefined;
}

/** Adds a habit planned for every day. Returns the same state if the name isn't valid. */
export function addHabit(state: HabitsState, name: string, id: string): HabitsState {
  if (nameError(name, state)) return state;
  return { habits: [...state.habits, { id, name: name.trim(), days: [...EVERY_DAY] }] };
}

/**
 * Renames a habit, changes its days and/or its reminder (null = no reminder,
 * left out = as it was). Returns the same state if they aren't valid.
 */
export function updateHabit(
  state: HabitsState,
  id: string,
  changes: { name: string; days: readonly number[]; reminder?: IsoTime | null },
): HabitsState {
  const days = [...new Set(changes.days)].sort((a, b) => a - b);
  const { reminder } = changes;
  if (nameError(changes.name, state, id) || !isDays(days)) return state;
  if (reminder !== undefined && reminder !== null && !isIsoTime(reminder)) return state;
  return {
    habits: state.habits.map((habit) => {
      if (habit.id !== id) return habit;
      const next: Habit = { id, name: changes.name.trim(), days };
      const time = reminder === undefined ? habit.reminder : reminder;
      if (time) next.reminder = time;
      return next;
    }),
  };
}

/** What the edit form changes on a habit (null: no reminder). */
export interface HabitDraft {
  name: string;
  days: number[];
  reminder: IsoTime | null;
}

export const draftOf = (habit: Habit): HabitDraft => ({
  name: habit.name,
  days: [...habit.days],
  reminder: habit.reminder ?? null,
});

/**
 * Saves the edit form. While it was open, a sync (or another tab) may have
 * changed the habit: only what was changed in the form goes on the habit as
 * it is now, so the other change stays (withEdits, audit F1-2). If that
 * isn't valid (another habit got the same name meanwhile), the form wins, as
 * it was checked. `opened` is the form as it opened, `edited` as it is now.
 * The same state if the habit is gone.
 */
export function editHabit(
  state: HabitsState,
  id: string,
  opened: HabitDraft,
  edited: HabitDraft,
): HabitsState {
  const habit = state.habits.find((entry) => entry.id === id);
  if (!habit) return state;
  const merged = updateHabit(state, id, withEdits(opened, edited, draftOf(habit)));
  return merged === state ? updateHabit(state, id, edited) : merged;
}

/** Removes a habit and its check marks. */
export function removeHabit(
  habits: HabitsState,
  checks: ChecksState,
  id: string,
): { habits: HabitsState; checks: ChecksState } {
  return {
    habits: { habits: habits.habits.filter((habit) => habit.id !== id) },
    checks: { checks: checks.checks.filter((check) => check.habit !== id) },
  };
}

/** The days a habit was done. */
export const doneDates = (checks: ChecksState, habit: string): Set<IsoDate> =>
  new Set(checks.checks.filter((check) => check.habit === habit).map((check) => check.date));

/** Marks a habit done (or not) on a date. */
export function setDone(
  checks: ChecksState,
  habit: string,
  date: IsoDate,
  done: boolean,
): ChecksState {
  const id = checkId(habit, date);
  const others = checks.checks.filter((check) => check.id !== id);
  return { checks: done ? [...others, { id, habit, date }] : others };
}

// ---------- Making room ----------

const number = (value: number, locale?: string): string =>
  new Intl.NumberFormat(locale).format(value);

/** "1 check mark", "3,650 check marks". */
export const checksCount = (count: number, locale?: string): string =>
  `${number(count, locale)} check ${count === 1 ? 'mark' : 'marks'}`;

/** Why `adding` more check marks can't be kept: Habits is full. Undefined while they fit. */
export const checksProblem = (
  checks: ChecksState,
  adding = 1,
  locale?: string,
): string | undefined =>
  checks.checks.length + adding > MAX_CHECKS
    ? `Habits keeps up to ${checksCount(MAX_CHECKS, locale)}. To make room, delete the check marks from a year (under Check marks).`
    : undefined;

/**
 * What the page says once Habits is nearly full (over 90% of the check marks
 * it keeps): how many more fit, and how to make room. Null until then.
 */
export function roomNote(count: number, locale?: string): string | null {
  if (count <= MAX_CHECKS * 0.9) return null;
  const left = MAX_CHECKS - count;
  const start =
    left > 0
      ? `Habits is nearly full: there’s room for ${number(left, locale)} more check ${left === 1 ? 'mark' : 'marks'} (it keeps up to ${number(MAX_CHECKS, locale)}).`
      : `Habits is full: it keeps up to ${checksCount(MAX_CHECKS, locale)}.`;
  return `${start} To make room, use “Delete check marks from a year…” under Check marks, below.`;
}

export interface YearCount {
  /** "2025". */
  year: string;
  count: number;
}

const yearOf = (date: IsoDate): string => date.slice(0, 4);

/** The years with check marks, the earliest first, with how many each has. */
export function checkYears(checks: ChecksState): YearCount[] {
  const counts = new Map<string, number>();
  for (const check of checks.checks) {
    counts.set(yearOf(check.date), (counts.get(yearOf(check.date)) ?? 0) + 1);
  }
  return [...counts]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

/**
 * Deletes every habit's check marks from a year ("2025"). Streaks then count
 * only the days that are kept: one that ran through that year starts after it.
 */
export const removeYear = (checks: ChecksState, year: string): ChecksState => ({
  checks: checks.checks.filter((check) => yearOf(check.date) !== year),
});

export const isPlanned = (habit: Habit, date: IsoDate): boolean =>
  habit.days.includes(weekday(date));

/**
 * Planned days in a row that were done, up to today. Today counts once it's
 * done, but doesn't break the streak while it's still to do. Days that
 * aren't planned are skipped.
 */
export function currentStreak(habit: Habit, done: Set<IsoDate>, today: IsoDate): number {
  let day = isPlanned(habit, today) && !done.has(today) ? addDays(today, -1) : today;
  let count = 0;
  for (let step = 0; step < LOOKBACK_DAYS; step += 1) {
    if (isPlanned(habit, day)) {
      if (!done.has(day)) break;
      count += 1;
    }
    day = addDays(day, -1);
  }
  return count;
}

/** The longest run of planned days done in a row, up to today. */
export function bestStreak(habit: Habit, done: Set<IsoDate>, today: IsoDate): number {
  let first = today;
  for (const date of done) if (date < first) first = date;
  let day = first < addDays(today, -LOOKBACK_DAYS) ? addDays(today, -LOOKBACK_DAYS) : first;
  let run = 0;
  let best = 0;
  while (day <= today) {
    if (isPlanned(habit, day)) {
      if (done.has(day)) {
        run += 1;
        best = Math.max(best, run);
      } else if (day !== today) {
        run = 0;
      }
    }
    day = addDays(day, 1);
  }
  return best;
}

export interface Day {
  date: IsoDate;
  planned: boolean;
  done: boolean;
}

/** The last `count` days, oldest first, ending today. */
export function recentDays(habit: Habit, done: Set<IsoDate>, today: IsoDate, count = 7): Day[] {
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(today, index - count + 1);
    return { date, planned: isPlanned(habit, date), done: done.has(date) };
  });
}

/** "3-day streak · best 7 days", "Best streak: 7 days", or "No streak yet". */
export function streakLabel(current: number, best: number): string {
  const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`;
  if (current > 0)
    return best > current ? `${current}-day streak · best ${days(best)}` : `${current}-day streak`;
  return best > 0 ? `Best streak: ${days(best)}` : 'No streak yet';
}

/** The days of the week in the order a week starts in (firstDay 1 = Monday … 7 = Sunday). */
export const weekOrder = (firstDay: number): number[] =>
  Array.from({ length: 7 }, (_, index) => ((firstDay - 1 + index) % 7) + 1);

/** A weekday's name: 1 = Monday … 7 = Sunday ("Mon"; "Monday" with style "long", "M" with "narrow"). */
export function weekdayName(
  day: number,
  style: 'narrow' | 'short' | 'long' = 'short',
  locale = DATE_LOCALE,
): string {
  // 1 January 2024 was a Monday.
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(
    Date.UTC(2024, 0, day),
  );
}

/** "Every day", "Weekdays", "Weekends", or the days in week order ("Mon, Wed, Fri"). */
export function scheduleLabel(days: readonly number[], firstDay = 1, locale = DATE_LOCALE): string {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((day) => set.has(day))) return 'Weekdays';
  if (set.size === 2 && set.has(6) && set.has(7)) return 'Weekends';
  return weekOrder(firstDay)
    .filter((day) => set.has(day))
    .map((day) => weekdayName(day, 'short', locale))
    .join(', ');
}

/** "Today", "Yesterday", or a date like "Friday 16 October". */
export function dayLabel(date: IsoDate, today: IsoDate, locale = DATE_LOCALE): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(Date.UTC(year, month - 1, day));
}

/** A time of day for people: "8:00 PM", or "20:00" where that's how times are written. */
export function timeLabel(time: IsoTime, locale = DATE_LOCALE): string {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(Date.UTC(2024, 0, 1, hour, minute));
}

/** What a reminder says under the habit's name (the same every time it's sent). */
export const REMINDER_BODY = 'Time for this habit. Tap to open Habits.';

const doneOn = (checks: ChecksState, habit: string, date: IsoDate): boolean =>
  checks.checks.some((check) => check.id === checkId(habit, date));

/**
 * The reminders, for the notification service (@shkriuss/push): one a week
 * for each planned day, at the reminder's time. A habit already done today
 * isn't reminded today (its next one is in a week).
 */
export function reminderNotices(
  habits: HabitsState,
  checks: ChecksState,
  today: IsoDate,
): Notice[] {
  return habits.habits.flatMap((habit) => {
    const { reminder } = habit;
    if (!reminder) return [];
    const doneToday = doneOn(checks, habit.id, today);
    return habit.days.map((day): Notice => {
      let date = addDays(today, (day - weekday(today) + 7) % 7);
      if (date === today && doneToday) date = addDays(today, 7);
      return {
        id: `${habit.id}~${day}`,
        start: toStamp(date, reminder),
        repeat: 'weekly',
        until: null,
        offset: 0,
        title: habit.name,
        body: REMINDER_BODY,
        tag: habit.id,
        url: '/',
      };
    });
  });
}

/**
 * Habits whose reminder time came after `from` and up to `to` (local times,
 * the same day as `to`), planned that day and not done yet.
 */
export function dueReminders(
  habits: HabitsState,
  checks: ChecksState,
  from: Stamp,
  to: Stamp,
): Habit[] {
  const date = to.slice(0, 10);
  return habits.habits.filter((habit) => {
    if (!habit.reminder || !isPlanned(habit, date) || doneOn(checks, habit.id, date)) return false;
    const due = toStamp(date, habit.reminder);
    return from < due && due <= to;
  });
}
