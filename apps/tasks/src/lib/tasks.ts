/**
 * Tasks' data and rules, kept separate from the page so they're easy to
 * test. Every function returns a new state instead of changing the old one.
 *
 * A task has a title and, if you like, notes, steps (smaller things to do
 * in it, each with its own tick), a date (and a time), a repeat, a
 * reminder, a list and an "important" star. A done task keeps the moment it
 * was finished. A repeating task that's done moves on to its next date with
 * its steps unticked, and a done copy of it is kept.
 */
import {
  addDays,
  addMinutes,
  compareDates,
  daysBetween,
  isIsoDate,
  isIsoTime,
  parts,
  sameDayInMonth,
  toStamp,
  weekday,
  type IsoDate,
  type IsoTime,
  type Stamp,
} from '@shkriuss/dates';
import type { Notice } from '@shkriuss/push';

export const REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const;
export type Repeat = (typeof REPEATS)[number];
/** In the form. */
export const REPEAT_LABELS: Record<Repeat, string> = {
  none: 'Doesn’t repeat',
  daily: 'Daily',
  weekdays: 'Every weekday (Monday to Friday)',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/** Repeats that can skip some ("every 2 weeks"), and what they count. */
export const EVERY_UNITS: Partial<Record<Repeat, [one: string, many: string]>> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};
export const MAX_EVERY = 99;

/** "day" or "days", for "Repeat every … days" in the form ("" if it doesn't count). */
export function everyUnit(repeat: string, every: number): string {
  const units = EVERY_UNITS[repeat as Repeat];
  return units ? units[every === 1 ? 0 : 1] : '';
}

/** How a task repeats, on the task in the list: "Every week", "Every 2 weeks", "Weekdays". */
export function repeatText(repeat: Repeat, every: number): string {
  if (repeat === 'none') return '';
  if (repeat === 'weekdays') return 'Weekdays';
  return every === 1
    ? `Every ${everyUnit(repeat, 1)}`
    : `Every ${every} ${everyUnit(repeat, every)}`;
}

/** Reminders: minutes before the task's time. */
export const REMINDERS = [0, 10, 30, 60, 1440] as const;
export const REMINDER_LABELS: Record<(typeof REMINDERS)[number], string> = {
  0: 'At the time',
  10: '10 minutes before',
  30: '30 minutes before',
  60: '1 hour before',
  1440: '1 day before',
};
/** A task with a date but no time is reminded about at this time. */
export const DEFAULT_REMINDER_TIME: IsoTime = '09:00';
export const REMINDER_BODY = 'Tap to open Tasks.';

/** A task's list when it has none. Lists themselves: ./lists.ts. */
export const NO_LIST = '';

/** A smaller thing to do inside a task ("Book the hotel"), with its own tick. */
export interface Step {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  steps: Step[];
  /** A list's id, or NO_LIST. */
  list: string;
  important: boolean;
  /** The day it's due, or null. Time, repeat and reminder need one. */
  date: IsoDate | null;
  time: IsoTime | null;
  repeat: Repeat;
  /** Every how many days, weeks, months or years it repeats (1 for "every week"). */
  every: number;
  /** Minutes before its time to remind, or null for no reminder. */
  reminder: number | null;
  /** When it was done (ms since 1970), or null while it's still to do. */
  done: number | null;
  /** When it was added and last changed (ms since 1970). */
  created: number;
  updated: number;
}

export interface TasksState {
  tasks: Task[];
}

/** Version 2 added steps; version 3, repeats like "every 2 weeks". */
export const TASKS_VERSION = 3;
export const MAX_TASKS = 5000;
export const MAX_STEPS = 50;
export const LIMITS = { title: 300, notes: 5000, step: 200 };

export const emptyTasks = (): TasksState => ({ tasks: [] });

const oneOf = <T extends string | number>(value: unknown, options: readonly T[]): value is T =>
  (options as readonly unknown[]).includes(value);
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isStep(value: unknown): value is Step {
  if (typeof value !== 'object' || value === null) return false;
  const step = value as Record<string, unknown>;
  return (
    typeof step['id'] === 'string' &&
    step['id'].length > 0 &&
    typeof step['title'] === 'string' &&
    typeof step['done'] === 'boolean'
  );
}

function isTask(value: unknown): value is Task {
  if (typeof value !== 'object' || value === null) return false;
  const task = value as Record<string, unknown>;
  return (
    typeof task['id'] === 'string' &&
    task['id'].length > 0 &&
    typeof task['title'] === 'string' &&
    typeof task['notes'] === 'string' &&
    Array.isArray(task['steps']) &&
    task['steps'].every(isStep) &&
    typeof task['list'] === 'string' &&
    typeof task['important'] === 'boolean' &&
    (task['date'] === null || isIsoDate(task['date'])) &&
    (task['time'] === null || isIsoTime(task['time'])) &&
    oneOf(task['repeat'], REPEATS) &&
    Number.isInteger(task['every']) &&
    (task['every'] as number) >= 1 &&
    (task['reminder'] === null || oneOf(task['reminder'], REMINDERS)) &&
    (task['done'] === null || isTime(task['done'])) &&
    isTime(task['created']) &&
    isTime(task['updated'])
  );
}

/**
 * True when saved data has the shape Tasks expects. Only the shape: limits
 * apply when adding and editing, so tasks merged from several devices are
 * never rejected.
 */
export function isTasksState(value: unknown): value is TasksState {
  if (typeof value !== 'object' || value === null) return false;
  const { tasks } = value as Record<string, unknown>;
  return Array.isArray(tasks) && tasks.every(isTask);
}

/** Turns tasks saved by an older version into today's shape (undefined if it can't). */
export function migrateTasks(old: unknown, version: number): TasksState | undefined {
  if (version < 1 || version > 2 || typeof old !== 'object' || old === null) return undefined;
  const { tasks } = old as Record<string, unknown>;
  if (!Array.isArray(tasks)) return undefined;
  // Version 1 had no steps; neither version 1 nor 2 had "every".
  return {
    tasks: tasks.map((task: unknown) =>
      typeof task === 'object' && task !== null
        ? { ...(version === 1 ? { steps: [] } : {}), ...task, every: 1 }
        : task,
    ) as Task[],
  };
}

// ---------- The form ----------

/** What the form holds, as typed. */
export interface TaskDraft {
  title: string;
  notes: string;
  /** Steps as typed (empty ones are dropped when saving). */
  steps: Step[];
  list: string;
  important: boolean;
  date: string;
  time: string;
  repeat: string;
  /** Every how many (days, weeks…), as typed. */
  every: string;
  /** Minutes before, as text, or "" for none. */
  reminder: string;
}

export type DraftField = 'title' | 'date' | 'time' | 'every' | 'form';

/** "Every" as typed: a whole number from 1 to MAX_EVERY, or undefined. */
export function parseEvery(text: string): number | undefined {
  const every = Number(text.trim());
  return /^\d+$/.test(text.trim()) && every >= 1 && every <= MAX_EVERY ? every : undefined;
}

/** What's wrong with the form, by field (empty when it can be saved). */
export function draftProblems(draft: TaskDraft): Partial<Record<DraftField, string>> {
  const problems: Partial<Record<DraftField, string>> = {};
  if (draft.title.trim() === '') problems.title = 'Give it a title.';
  if (draft.date !== '' && !isIsoDate(draft.date)) {
    problems.date = 'Choose a date, or leave it empty.';
  } else if (draft.date === '') {
    if (draft.time !== '') problems.date = 'Choose a date for the time, or clear the time.';
    else if (draft.repeat !== 'none') problems.date = 'Choose the first date, so it can repeat.';
    else if (draft.reminder !== '') problems.date = 'Choose a date to be reminded on.';
  }
  if (draft.time !== '' && !isIsoTime(draft.time)) {
    problems.time = 'Choose a time, or leave it empty.';
  }
  if (EVERY_UNITS[draft.repeat as Repeat] && parseEvery(draft.every) === undefined) {
    problems.every = `Write a number from 1 to ${MAX_EVERY}.`;
  }
  return problems;
}

const cut = (text: string, max: number): string => text.trim().slice(0, max);

/** The task a (checked) draft describes. Keeps `created` and `done` from the task it changes. */
export function taskFromDraft(draft: TaskDraft, id: string, now: number, existing?: Task): Task {
  const date = isIsoDate(draft.date) ? draft.date : null;
  const repeat = date && oneOf(draft.repeat, REPEATS) ? draft.repeat : 'none';
  const reminder = Number(draft.reminder);
  return {
    id,
    title: cut(draft.title, LIMITS.title),
    notes: draft.notes.trim().slice(0, LIMITS.notes),
    steps: draft.steps
      .map((step) => ({ ...step, title: cut(step.title, LIMITS.step) }))
      .filter((step) => step.title !== '')
      .slice(0, MAX_STEPS),
    list: draft.list,
    important: draft.important,
    date,
    time: date && isIsoTime(draft.time) ? draft.time : null,
    repeat,
    every: EVERY_UNITS[repeat] ? (parseEvery(draft.every) ?? 1) : 1,
    reminder: date && draft.reminder !== '' && oneOf(reminder, REMINDERS) ? reminder : null,
    done: existing?.done ?? null,
    created: existing?.created ?? now,
    updated: now,
  };
}

/** The form's values for a task, to edit it. */
export const draftOf = (task: Task): TaskDraft => ({
  title: task.title,
  notes: task.notes,
  steps: task.steps.map((step) => ({ ...step })),
  list: task.list,
  important: task.important,
  date: task.date ?? '',
  time: task.time ?? '',
  repeat: task.repeat,
  every: String(task.every),
  reminder: task.reminder === null ? '' : String(task.reminder),
});

/** A task with only a title (the quick "Add" box). */
export const newTask = (
  title: string,
  id: string,
  now: number,
  options: { list?: string; important?: boolean } = {},
): Task => ({
  id,
  title: cut(title, LIMITS.title),
  notes: '',
  steps: [],
  list: options.list ?? NO_LIST,
  important: options.important ?? false,
  date: null,
  time: null,
  repeat: 'none',
  every: 1,
  reminder: null,
  done: null,
  created: now,
  updated: now,
});

// ---------- Changes ----------

/** Adds a task. The same state when there are already MAX_TASKS. */
export function addTask(state: TasksState, task: Task): TasksState {
  if (state.tasks.length >= MAX_TASKS) return state;
  return { tasks: [task, ...state.tasks] };
}

/** Puts in the changed task (added back if it was deleted on another device meanwhile). */
export function updateTask(state: TasksState, task: Task): TasksState {
  if (!state.tasks.some((entry) => entry.id === task.id)) return { tasks: [task, ...state.tasks] };
  return { tasks: state.tasks.map((entry) => (entry.id === task.id ? task : entry)) };
}

export function removeTask(state: TasksState, id: string): TasksState {
  return { tasks: state.tasks.filter((task) => task.id !== id) };
}

/** Ticks a task's step, or unticks it. */
export function tickStep(
  state: TasksState,
  taskId: string,
  stepId: string,
  done: boolean,
  now: number,
): TasksState {
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task?.steps.some((step) => step.id === stepId && step.done !== done)) return state;
  const steps = task.steps.map((step) => (step.id === stepId ? { ...step, done } : step));
  return updateTask(state, { ...task, steps, updated: now });
}

/**
 * The next date of a repeating task: the first one after its current date
 * that's also after today (so a task done late doesn't stay overdue).
 * `every` skips some: every 2 weeks counts on from its date in steps of 2
 * weeks. A monthly task on the 31st moves to the end of shorter months.
 */
export function nextDate(date: IsoDate, repeat: Repeat, today: IsoDate, every = 1): IsoDate {
  const after = compareDates(date, today) > 0 ? date : today;
  const days = (step: number): IsoDate =>
    addDays(date, (Math.floor(daysBetween(date, after) / step) + 1) * step);
  switch (repeat) {
    case 'none':
      return date;
    case 'daily':
      return days(every);
    case 'weekdays': {
      let next = addDays(after, 1);
      while (weekday(next) > 5) next = addDays(next, 1);
      return next;
    }
    case 'weekly':
      return days(7 * every);
    case 'monthly':
    case 'yearly': {
      const step = (repeat === 'monthly' ? 1 : 12) * every;
      const { year, month } = parts(date);
      const later = parts(after);
      // Start near `after`, not at `date`: a task can be years overdue.
      let months = Math.max(
        step,
        Math.floor(((later.year - year) * 12 + later.month - month) / step) * step,
      );
      while (compareDates(sameDayInMonth(date, months), after) <= 0) months += step;
      return sameDayInMonth(date, months);
    }
  }
}

/**
 * Marks a task done. A repeating one moves on to its next date instead, and
 * a done copy (with `copyId`) is kept. `next` is the new date, if it moved.
 */
export function completeTask(
  state: TasksState,
  id: string,
  now: number,
  today: IsoDate,
  copyId: string,
): { state: TasksState; next: IsoDate | null } {
  const task = state.tasks.find((entry) => entry.id === id);
  if (!task || task.done !== null) return { state, next: null };
  if (task.repeat === 'none' || task.date === null) {
    return { state: updateTask(state, { ...task, done: now, updated: now }), next: null };
  }
  const next = nextDate(task.date, task.repeat, today, task.every);
  const copy: Task = {
    ...task,
    id: copyId,
    repeat: 'none',
    every: 1,
    done: now,
    created: now,
    updated: now,
  };
  // The next time, its steps start again.
  const steps = task.steps.map((step) => ({ ...step, done: false }));
  const moved = updateTask(state, { ...task, date: next, steps, updated: now });
  return { state: { tasks: [copy, ...moved.tasks] }, next };
}

/** Marks a done task as still to do. */
export function reopenTask(state: TasksState, id: string, now: number): TasksState {
  const task = state.tasks.find((entry) => entry.id === id);
  if (!task || task.done === null) return state;
  return updateTask(state, { ...task, done: null, updated: now });
}

/** Moves the tasks of a list that goes to another list (NO_LIST for none). */
export function moveTasks(state: TasksState, from: string, to: string): TasksState {
  return { tasks: state.tasks.map((task) => (task.list === from ? { ...task, list: to } : task)) };
}

/** Deletes every task in `ids`. */
export function removeTasks(state: TasksState, ids: ReadonlySet<string>): TasksState {
  return { tasks: state.tasks.filter((task) => !ids.has(task.id)) };
}

// ---------- Showing them ----------

/** Which tasks to show: all of them, the important ones, or one list's. */
export type View = 'all' | 'important' | { list: string };

export function inView(task: Task, view: View): boolean {
  if (view === 'all') return true;
  if (view === 'important') return task.important;
  return task.list === view.list;
}

export const WHENS = ['overdue', 'today', 'tomorrow', 'later', 'someday'] as const;
export type When = (typeof WHENS)[number];
export const WHEN_LABELS: Record<When, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  later: 'Later',
  someday: 'No date',
};

export function whenOf(task: Task, today: IsoDate): When {
  if (task.date === null) return 'someday';
  const days = daysBetween(today, task.date);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days === 1 ? 'tomorrow' : 'later';
}

/** Important first, then by date and time (no time first), then the newest. */
function byDue(a: Task, b: Task): number {
  return (
    Number(b.important) - Number(a.important) ||
    (a.date ?? '').localeCompare(b.date ?? '') ||
    (a.time ?? '').localeCompare(b.time ?? '') ||
    b.created - a.created ||
    (a.id < b.id ? -1 : 1)
  );
}

/** The tasks still to do in a view, by when they're due (only groups with tasks). */
export function openGroups(
  state: TasksState,
  view: View,
  today: IsoDate,
): { when: When; tasks: Task[] }[] {
  const open = state.tasks.filter((task) => task.done === null && inView(task, view)).sort(byDue);
  return WHENS.map((when) => ({
    when,
    tasks: open.filter((task) => whenOf(task, today) === when),
  })).filter((group) => group.tasks.length > 0);
}

/** The done tasks in a view, the most recently done first. */
export const doneTasks = (state: TasksState, view: View): Task[] =>
  state.tasks
    .filter((task) => task.done !== null && inView(task, view))
    .sort((a, b) => (b.done ?? 0) - (a.done ?? 0) || (a.id < b.id ? -1 : 1));

/** How many tasks are still to do in each list (NO_LIST: those without one). */
export function openPerList(state: TasksState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of state.tasks) {
    if (task.done === null) counts.set(task.list, (counts.get(task.list) ?? 0) + 1);
  }
  return counts;
}

const utc = (date: IsoDate): Date => {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day));
};

/** "14:30" or "2:30 PM", in the person's style. */
export function formatTime(time: IsoTime, locale?: string): string {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

/** "Today", "Tomorrow", "Yesterday", "Friday" (this week), or "Mon, 26 Oct" (with the year if not this one). */
export function formatDay(date: IsoDate, today: IsoDate, locale?: string): string {
  const days = daysBetween(today, date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(utc(date));
  }
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(utc(date));
}

/** When a task is due, for the list: "Today, 14:30". */
export function dueText(task: Task, today: IsoDate, locale?: string): string {
  if (task.date === null) return '';
  const day = formatDay(task.date, today, locale);
  return task.time ? `${day}, ${formatTime(task.time, locale)}` : day;
}

/** The moment a task's reminder is due, local time, or null if it has none. */
export function reminderAt(task: Task): Stamp | null {
  if (task.date === null || task.reminder === null) return null;
  return addMinutes(toStamp(task.date, task.time ?? DEFAULT_REMINDER_TIME), -task.reminder);
}

/** The reminders, for the notification service (@shkriuss/push): one for each task still to do. */
export const reminderNotices = (state: TasksState): Notice[] =>
  state.tasks.flatMap((task): Notice[] => {
    if (task.done !== null || task.date === null || task.reminder === null) return [];
    return [
      {
        id: task.id,
        start: toStamp(task.date, task.time ?? DEFAULT_REMINDER_TIME),
        repeat: 'none',
        until: null,
        offset: task.reminder,
        title: task.title,
        body: REMINDER_BODY,
        tag: task.id,
        url: '/',
      },
    ];
  });

/** Tasks still to do whose reminder came after `from` and up to `to` (local times). */
export const dueReminders = (state: TasksState, from: Stamp, to: Stamp): Task[] =>
  state.tasks.filter((task) => {
    const at = reminderAt(task);
    return task.done === null && at !== null && from < at && at <= to;
  });

/** Text for comparing: lower case and without accents. */
export const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();

/** Alphabetical order, without minding case or accents. */
export const byText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/** "1 of 4 steps", or "" without steps. */
export function stepsText(task: Task): string {
  const total = task.steps.length;
  if (total === 0) return '';
  const done = task.steps.filter((step) => step.done).length;
  return `${done} of ${total} ${total === 1 ? 'step' : 'steps'}`;
}

export const tasksCount = (count: number): string => `${count} ${count === 1 ? 'task' : 'tasks'}`;
