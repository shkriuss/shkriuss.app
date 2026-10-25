/**
 * Budget's data and rules, kept separate from the page so they're easy to
 * test. Every function returns new data instead of changing the old.
 *
 * Three lists, saved and synced separately:
 * - categories: a name and, optionally, a limit for each month;
 * - entries: an expense or a refund (money back for an expense: it comes off
 *   the spending), each in a category or none, or income; with an amount, a
 *   day and a note;
 * - settings: the currency amounts are shown in, and the monthly reminder.
 *   Each is saved only once changed (US dollars and no reminder until then),
 *   so a new device has nothing that could win over another device's choice
 *   when they first sync.
 *
 * A month is "YYYY-MM". Categories don't belong to a month: their limits are
 * the same every month.
 */
import {
  addDays,
  daysInMonth,
  isIsoDate,
  isIsoTime,
  makeDate,
  parts,
  toStamp,
  type IsoDate,
  type IsoTime,
  type Stamp,
} from '@shkriuss/dates';
import type { Notice } from '@shkriuss/push';
import {
  CURRENCIES,
  decimalText,
  formatMoney,
  parseDecimal,
  type Currency,
} from '@shkriuss/ui/numbers';
import { DATE_LOCALE } from '@shkriuss/ui/locale';

export type Kind = 'expense' | 'income' | 'refund';
export const KINDS: readonly Kind[] = ['expense', 'income', 'refund'];

/** Expenses and refunds are in a category (or "No category"); income isn't. */
export const hasCategory = (kind: Kind): boolean => kind !== 'income';

export interface Category {
  id: string;
  name: string;
  /** The most to spend in it each month, or null for none. */
  limit: number | null;
}

export interface CategoriesState {
  categories: Category[];
}

/** The categories' data version. */
export const CATEGORIES_VERSION = 1;

export interface Entry {
  id: string;
  kind: Kind;
  amount: number;
  date: IsoDate;
  /** For an expense or a refund: its category's id, or null. Always null for income. */
  category: string | null;
  note: string;
}

export interface EntriesState {
  entries: Entry[];
}

/**
 * The entries' data version. Version 2 added refunds. What version 1 saved
 * reads the same (migrateEntries), and a Budget on another device that's
 * still version 1 waits for its update instead of syncing refunds it can't
 * read.
 */
export const ENTRIES_VERSION = 2;

/**
 * `entries`: the most Budget keeps, so they fit on the device and in the
 * sync copy (measured in budget.test.ts: "room for every entry").
 */
export const LIMITS = { name: 30, note: 100, categories: 50, entries: 6000, amount: 1e9 };

export const emptyCategories = (): CategoriesState => ({ categories: [] });
export const emptyEntries = (): EntriesState => ({ entries: [] });

/** What "Add suggested categories" adds (none have a limit until one is set). */
export const SUGGESTED = [
  'Groceries',
  'Eating out',
  'Home',
  'Bills',
  'Transport',
  'Health',
  'Fun',
  'Other',
] as const;

/** Rounds away the tiny errors of decimal sums (0.1 + 0.2). */
const tidy = (value: number): number => Math.round(value * 100) / 100;

// ---------- Checking ----------

/**
 * A saved amount. The form never saves 0, but older versions could (0.001
 * was kept as 0), so 0 is still read: refusing it would make all of Budget
 * unreadable on that device.
 */
const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= LIMITS.amount;

function isCategory(value: unknown): value is Category {
  if (typeof value !== 'object' || value === null) return false;
  const { id, name, limit } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id !== '' &&
    typeof name === 'string' &&
    (limit === null || isAmount(limit))
  );
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const { id, kind, amount, date, category, note } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id !== '' &&
    KINDS.includes(kind as Kind) &&
    isAmount(amount) &&
    isIsoDate(date) &&
    (category === null || (hasCategory(kind as Kind) && typeof category === 'string')) &&
    typeof note === 'string'
  );
}

/** True when saved categories have the shape Budget expects (limits apply when saving, not here). */
export function isCategoriesState(value: unknown): value is CategoriesState {
  if (typeof value !== 'object' || value === null) return false;
  const { categories } = value as Record<string, unknown>;
  return Array.isArray(categories) && categories.every(isCategory);
}

export function isEntriesState(value: unknown): value is EntriesState {
  if (typeof value !== 'object' || value === null) return false;
  const { entries } = value as Record<string, unknown>;
  return Array.isArray(entries) && entries.every(isEntry);
}

/** Entries saved by an older version, in this version's shape (version 1's are the same). */
export const migrateEntries = (old: unknown, version: number): EntriesState | undefined =>
  version === 1 && isEntriesState(old) ? old : undefined;

/** How the forms are read: amounts as typed in `locale` (the browser's own when left out). */
export interface ReadOptions {
  locale?: string | undefined;
}

/**
 * A typed amount: null when empty, NaN when it isn't a number. "12,50" is
 * 12.5, and "1,500" is 1500 in English (parseDecimal).
 */
const parseAmount = (text: string, { locale }: ReadOptions): number | null =>
  parseDecimal(text, locale);

/** What's wrong with a typed amount, or undefined (empty is fine when `optional`). */
function amountProblem(text: string, optional: boolean, options: ReadOptions): string | undefined {
  const value = parseAmount(text, options);
  if (value === null) return optional ? undefined : 'Enter an amount.';
  if (!Number.isFinite(value)) return 'Enter a number, like 12.50 or 12,50.';
  if (value <= 0) return 'Enter an amount above 0.';
  // Amounts are kept to the cent, so one that rounds to 0 would be saved as 0.
  if (tidy(value) <= 0) return 'Enter at least 0.01.';
  if (value > LIMITS.amount) return 'Enter a smaller amount.';
  return undefined;
}

// ---------- Categories ----------

export interface CategoryForm {
  name: string;
  limit: string;
}

export type CategoryProblems = Partial<Record<keyof CategoryForm, string>>;

/** Reads the category form, or says what's wrong. `id` is the category being changed or added. */
export function readCategory(
  form: CategoryForm,
  id: string,
  state: CategoriesState,
  options: ReadOptions = {},
):
  | { category: Category; problems?: undefined }
  | { category?: undefined; problems: CategoryProblems } {
  const problems: CategoryProblems = {};
  const name = form.name.trim();
  const own = state.categories.find((category) => category.id === id);
  const editing = own !== undefined;
  // Its own name, unchanged, is fine even if another category has it too:
  // two devices that each added "Groceries" before they first synced.
  const unchanged = own?.name.toLowerCase() === name.toLowerCase();
  if (name === '') problems.name = 'Enter a name for the category.';
  else if (name.length > LIMITS.name) problems.name = `Use ${LIMITS.name} characters or fewer.`;
  else if (
    !unchanged &&
    state.categories.some(
      (category) => category.id !== id && category.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    problems.name = 'You already have a category with that name.';
  } else if (!editing && state.categories.length >= LIMITS.categories) {
    problems.name = `You can have up to ${LIMITS.categories} categories.`;
  }
  const limitProblem = amountProblem(form.limit, true, options);
  if (limitProblem) problems.limit = limitProblem;
  if (Object.keys(problems).length > 0) return { problems };
  const limit = parseAmount(form.limit, options);
  return { category: { id, name, limit: limit === null ? null : tidy(limit) } };
}

/** A category as its form shows it. */
export const toCategoryForm = (category: Category, locale?: string): CategoryForm => ({
  name: category.name,
  limit: category.limit === null ? '' : decimalText(category.limit, locale),
});

/** Adds a category, or puts a changed one in its place. */
export function saveCategory(state: CategoriesState, category: Category): CategoriesState {
  const exists = state.categories.some((entry) => entry.id === category.id);
  return {
    categories: exists
      ? state.categories.map((entry) => (entry.id === category.id ? category : entry))
      : [...state.categories, category],
  };
}

/** Removes a category. Its expenses stay, without a category (they show as "No category"). */
export const removeCategory = (state: CategoriesState, id: string): CategoriesState => ({
  categories: state.categories.filter((category) => category.id !== id),
});

/** Adds the suggested categories that aren't there yet (by name), with new ids. */
export function addSuggested(state: CategoriesState, newId: () => string): CategoriesState {
  const taken = new Set(state.categories.map((category) => category.name.toLowerCase()));
  const added = SUGGESTED.filter((name) => !taken.has(name.toLowerCase()))
    .slice(0, Math.max(0, LIMITS.categories - state.categories.length))
    .map((name) => ({ id: newId(), name, limit: null }));
  return { categories: [...state.categories, ...added] };
}

// ---------- Entries ----------

export interface EntryForm {
  kind: string;
  amount: string;
  date: string;
  category: string;
  note: string;
}

export type EntryProblems = Partial<Record<keyof EntryForm, string>>;

/** Reads the entry form, or says what's wrong. `count` is how many other entries there are. */
export function readEntry(
  form: EntryForm,
  id: string,
  count: number,
  categories: CategoriesState,
  options: ReadOptions = {},
): { entry: Entry; problems?: undefined } | { entry?: undefined; problems: EntryProblems } {
  const problems: EntryProblems = {};
  const kind = KINDS.find((entry) => entry === form.kind);
  if (!kind) problems.kind = 'Choose expense, income or refund.';
  const amountText = amountProblem(form.amount, false, options);
  if (amountText) problems.amount = amountText;
  else if (count >= LIMITS.entries) {
    problems.amount = `You can keep up to ${new Intl.NumberFormat().format(LIMITS.entries)} entries. To make room, delete a year (under Currency and spreadsheet).`;
  }
  if (!isIsoDate(form.date)) problems.date = 'Choose a day.';
  const category =
    kind && hasCategory(kind) && categories.categories.some((entry) => entry.id === form.category)
      ? form.category
      : null;
  const note = form.note.trim();
  if (note.length > LIMITS.note) problems.note = `Use ${LIMITS.note} characters or fewer.`;
  if (Object.keys(problems).length > 0 || !kind) return { problems };
  return {
    entry: {
      id,
      kind,
      amount: tidy(parseAmount(form.amount, options) ?? 0),
      date: form.date,
      category,
      note,
    },
  };
}

/** An entry as the form shows it (amounts as typed in `locale`, the browser's own when left out). */
export const toEntryForm = (entry: Entry, locale?: string): EntryForm => ({
  kind: entry.kind,
  amount: decimalText(entry.amount, locale),
  date: entry.date,
  category: entry.category ?? '',
  note: entry.note,
});

/** Adds an entry, or puts a changed one in its place. */
export function saveEntry(state: EntriesState, entry: Entry): EntriesState {
  const exists = state.entries.some((item) => item.id === entry.id);
  return {
    entries: exists
      ? state.entries.map((item) => (item.id === entry.id ? entry : item))
      : [...state.entries, entry],
  };
}

export const removeEntry = (state: EntriesState, id: string): EntriesState => ({
  entries: state.entries.filter((entry) => entry.id !== id),
});

// ---------- Making room ----------

export interface YearCount {
  /** "2024". */
  year: string;
  count: number;
}

const yearOf = (date: IsoDate): string => date.slice(0, 4);

/** The years that have entries, the earliest first, with how many each has (for "Delete a year"). */
export function entryYears(state: EntriesState): YearCount[] {
  const counts = new Map<string, number>();
  for (const entry of state.entries) {
    counts.set(yearOf(entry.date), (counts.get(yearOf(entry.date)) ?? 0) + 1);
  }
  return [...counts]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

/** Removes every entry of a year ("2024"): expenses, income and refunds. */
export const removeYear = (state: EntriesState, year: string): EntriesState => ({
  entries: state.entries.filter((entry) => yearOf(entry.date) !== year),
});

/** "1 entry", "312 entries". */
export const entriesCount = (count: number, locale?: string): string =>
  `${new Intl.NumberFormat(locale).format(count)} ${count === 1 ? 'entry' : 'entries'}`;

/**
 * What the page says once Budget is nearly full (over 90% of the entries it
 * keeps): how many more fit, and how to make room. Null until then.
 */
export function roomNote(count: number, locale?: string): string | null {
  if (count <= LIMITS.entries * 0.9) return null;
  const left = LIMITS.entries - count;
  const number = new Intl.NumberFormat(locale);
  const start =
    left > 0
      ? `Budget is nearly full: there’s room for ${number.format(left)} more ${left === 1 ? 'entry' : 'entries'} (it keeps up to ${number.format(LIMITS.entries)}).`
      : `Budget is full: it keeps up to ${entriesCount(LIMITS.entries, locale)}.`;
  return `${start} To make room, download the spreadsheet, then use “Delete a year…” under Currency and spreadsheet, below.`;
}

// ---------- Months ----------

export const monthOf = (date: IsoDate): string => date.slice(0, 7);

/** The month before or after ("2026-10" → "2026-09" with -1). */
export function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + number - 1 + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The day a new entry suggests in a month: today in this month, else its first day. */
export const suggestedDay = (month: string, today: IsoDate): IsoDate =>
  monthOf(today) === month ? today : `${month}-01`;

/** A month's entries, the latest first (on the same day, the one added last first). */
export const entriesIn = (state: EntriesState, month: string): Entry[] =>
  state.entries
    .filter((entry) => monthOf(entry.date) === month)
    .sort((a, b) => a.date.localeCompare(b.date))
    .reverse();

export interface Summary {
  income: number;
  /** Expenses minus refunds (below 0 when more was refunded, say for last month's buys). */
  spent: number;
  /** Income minus spending (negative when more was spent). */
  left: number;
  /** The categories' limits added up (null when none has one). */
  budgeted: number | null;
  /** What was spent in the categories that have a limit (refunds taken off). */
  spentWithLimit: number;
}

/** What an entry adds to the spending: an expense its amount, a refund takes its amount off. */
const spending = (entry: Entry): number =>
  entry.kind === 'expense' ? entry.amount : entry.kind === 'refund' ? -entry.amount : 0;

export function summary(entries: readonly Entry[], categories: CategoriesState): Summary {
  const limited = categories.categories.filter((category) => category.limit !== null);
  const withLimit = new Set(limited.map((category) => category.id));
  const income = tidy(
    entries.reduce((sum, entry) => (entry.kind === 'income' ? sum + entry.amount : sum), 0),
  );
  const spent = tidy(entries.reduce((sum, entry) => sum + spending(entry), 0));
  return {
    income,
    spent,
    left: tidy(income - spent),
    budgeted:
      limited.length === 0
        ? null
        : tidy(limited.reduce((sum, category) => sum + (category.limit ?? 0), 0)),
    spentWithLimit: tidy(
      entries.reduce(
        (sum, entry) =>
          entry.category !== null && withLimit.has(entry.category) ? sum + spending(entry) : sum,
        0,
      ),
    ),
  };
}

/**
 * The month's line against the budget, when any category has a limit: what
 * was spent in the categories that have one, against their limits added up.
 * What was spent without a limit (in a category with none, or in none) isn't
 * held against them: it's said besides. `over`: more was spent than budgeted.
 */
export function budgetLine(
  totals: Summary,
  currency: string,
  locale?: string,
): { text: string; over: boolean } | null {
  if (totals.budgeted === null) return null;
  const money = (amount: number) => formatMoney(amount, currency, { locale });
  const rest = tidy(totals.budgeted - totals.spentWithLimit);
  const budgeted = money(totals.budgeted);
  const line =
    rest >= 0
      ? `${money(rest)} left of the ${budgeted} budgeted`
      : `${money(-rest)} over the ${budgeted} budgeted`;
  const other = tidy(totals.spent - totals.spentWithLimit);
  return {
    text: other > 0 ? `${line} (${money(other)} more spent without a limit)` : line,
    over: rest < 0,
  };
}

export interface CategoryTotal {
  /** null: expenses and refunds without a category (or in one that was deleted). */
  category: Category | null;
  /** Expenses minus refunds. */
  spent: number;
  /** What's left of the limit (negative when over), or null without one. */
  left: number | null;
}

/**
 * Spending in each category (refunds taken off), in the categories' order,
 * then "No category" if anything was spent or refunded without one.
 */
export function byCategory(
  entries: readonly Entry[],
  categories: CategoriesState,
): CategoryTotal[] {
  const spent = new Map<string | null, number>();
  const known = new Set(categories.categories.map((category) => category.id));
  for (const entry of entries) {
    if (!hasCategory(entry.kind)) continue;
    const key = entry.category !== null && known.has(entry.category) ? entry.category : null;
    spent.set(key, tidy((spent.get(key) ?? 0) + spending(entry)));
  }
  const totals: CategoryTotal[] = categories.categories.map((category) => {
    const amount = spent.get(category.id) ?? 0;
    return {
      category,
      spent: amount,
      left: category.limit === null ? null : tidy(category.limit - amount),
    };
  });
  const none = spent.get(null);
  if (none !== undefined) totals.push({ category: null, spent: none, left: null });
  return totals;
}

// ---------- Money and dates for people ----------

// The currencies and formatMoney are shared with Trades and Repairs.
export { CURRENCIES, formatMoney, type Currency };

/** "October 2026". */
export function monthLabel(month: string, locale = DATE_LOCALE): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year, number - 1, 1));
}

/** "Wed, Oct 21". */
export function dayLabel(date: IsoDate, locale = DATE_LOCALE): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year, month - 1, day));
}

// ---------- Spreadsheet ----------

/** A spreadsheet cell: quoted when needed, and never read as a formula. */
function cell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const KIND_LABELS: Record<Kind, string> = {
  expense: 'Expense',
  income: 'Income',
  refund: 'Refund',
};

/** Every entry as a CSV file, the latest first. Expenses are negative; income and refunds positive. */
export function toCsv(entries: EntriesState, categories: CategoriesState): string {
  const names = new Map(categories.categories.map((category) => [category.id, category.name]));
  const rows = [...entries.entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((entry) =>
      [
        entry.date,
        KIND_LABELS[entry.kind],
        entry.kind === 'expense' ? -entry.amount : entry.amount,
        hasCategory(entry.kind) ? (names.get(entry.category ?? '') ?? '') : '',
        entry.note,
      ]
        .map(cell)
        .join(','),
    );
  return [['Date', 'Type', 'Amount', 'Category', 'Note'].join(','), ...rows].join('\r\n') + '\r\n';
}

// ---------- Settings ----------

/** A day of the month for the reminder: 1 to 28 (in every month), or the last day. */
export type ReminderDay = number | 'last';
export const REMINDER_DAYS: readonly ReminderDay[] = [
  ...Array.from({ length: 28 }, (_, index) => index + 1),
  'last',
];

/** The monthly reminder to check the budget. */
export interface Reminder {
  on: boolean;
  day: ReminderDay;
  time: IsoTime;
}

export const DEFAULT_REMINDER: Reminder = { on: false, day: 1, time: '09:00' };

export type Setting = { id: 'currency'; currency: Currency } | ({ id: 'reminder' } & Reminder);

const SETTING_IDS: readonly Setting['id'][] = ['currency', 'reminder'];

export interface SettingsState {
  /** Only the settings ever changed. */
  settings: Setting[];
}

export const emptySettings = (): SettingsState => ({ settings: [] });

const isReminderDay = (value: unknown): value is ReminderDay =>
  REMINDER_DAYS.includes(value as ReminderDay);

function isSetting(value: unknown): value is Setting {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  switch (item['id']) {
    case 'currency':
      return CURRENCIES.includes(item['currency'] as Currency);
    case 'reminder':
      return (
        typeof item['on'] === 'boolean' && isReminderDay(item['day']) && isIsoTime(item['time'])
      );
    default:
      return false;
  }
}

export function isSettingsState(value: unknown): value is SettingsState {
  if (typeof value !== 'object' || value === null) return false;
  const { settings } = value as Record<string, unknown>;
  return Array.isArray(settings) && settings.every(isSetting);
}

/** Settings from sync: the ones that look right, once each, in a fixed order. */
export const withSettings = (items: readonly unknown[]): SettingsState => ({
  settings: SETTING_IDS.flatMap((id) => {
    const item = items.find((entry): entry is Setting => isSetting(entry) && entry.id === id);
    return item ? [item] : [];
  }),
});

const withSetting = (state: SettingsState, setting: Setting): SettingsState =>
  withSettings([...state.settings.filter((item) => item.id !== setting.id), setting]);

export const currencyOf = (state: SettingsState): Currency =>
  state.settings.find((setting) => setting.id === 'currency')?.currency ?? 'USD';

export const setCurrency = (state: SettingsState, currency: Currency): SettingsState =>
  CURRENCIES.includes(currency) ? withSetting(state, { id: 'currency', currency }) : state;

export function reminderOf(state: SettingsState): Reminder {
  const saved = state.settings.find((setting) => setting.id === 'reminder');
  if (!saved) return { ...DEFAULT_REMINDER };
  const { on, day, time } = saved;
  return { on, day, time };
}

/** Sets the reminder. Returns the same state if it isn't valid. */
export function setReminder(state: SettingsState, reminder: Reminder): SettingsState {
  const setting = { id: 'reminder' as const, ...reminder };
  return isSetting(setting) ? withSetting(state, setting) : state;
}

// ---------- The monthly reminder ----------

export const REMINDER_TITLE = 'Check your budget';
export const REMINDER_BODY = 'Tap to see where your money went.';
/** Reminders replace each other: only the latest shows. */
export const REMINDER_TAG = 'budget';

/** The day the reminder is on in this date's month. */
function reminderDate(day: ReminderDay, date: IsoDate): IsoDate {
  const { year, month } = parts(date);
  return makeDate(year, month, day === 'last' ? daysInMonth(year, month) : day);
}

/**
 * The reminder, for the notification service (@shkriuss/push): once a month.
 * The last day is sent as a day before the 1st, so it's right in every month,
 * however long.
 */
export function reminderNotices(settings: SettingsState, today: IsoDate): Notice[] {
  const reminder = reminderOf(settings);
  if (!reminder.on) return [];
  const { year, month } = parts(today);
  const last = reminder.day === 'last';
  const start = last
    ? toStamp(addDays(makeDate(year, month, daysInMonth(year, month)), 1), reminder.time)
    : toStamp(reminderDate(reminder.day, today), reminder.time);
  return [
    {
      id: 'reminder',
      start,
      repeat: 'monthly',
      until: null,
      offset: last ? 24 * 60 : 0,
      title: REMINDER_TITLE,
      body: REMINDER_BODY,
      tag: REMINDER_TAG,
      url: '/',
    },
  ];
}

/** Whether the reminder went off after `from` and up to `to` (local times, the same day as `to`). */
export function reminderDue(settings: SettingsState, from: Stamp, to: Stamp): boolean {
  const reminder = reminderOf(settings);
  if (!reminder.on) return false;
  const date = to.slice(0, 10);
  if (reminderDate(reminder.day, date) !== date) return false;
  const due = toStamp(date, reminder.time);
  return from < due && due <= to;
}

/** When the reminder goes off next, after `now` (local time), or null if it's off. */
export function nextReminder(settings: SettingsState, now: Stamp): Stamp | null {
  const reminder = reminderOf(settings);
  if (!reminder.on) return null;
  const date = now.slice(0, 10);
  const thisMonth = toStamp(reminderDate(reminder.day, date), reminder.time);
  if (thisMonth > now) return thisMonth;
  const { year, month } = parts(date);
  const nextMonth = addDays(makeDate(year, month, daysInMonth(year, month)), 1);
  return toStamp(reminderDate(reminder.day, nextMonth), reminder.time);
}

/** "1st", "2nd", "23rd"… or "Last day". */
export function dayChoiceLabel(day: ReminderDay): string {
  if (day === 'last') return 'Last day';
  const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th' } as Record<string, string>;
  return `${day}${suffix[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(day)] ?? 'th'}`;
}

/** "9:00 AM" (in the person's own style). */
export function timeLabel(time: IsoTime, locale = DATE_LOCALE): string {
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(Date.UTC(2024, 0, 1, hour, minute));
}

/** "Reminder on the 1st of every month, at 9:00 AM." or that it's off. */
export function reminderSentence(reminder: Reminder, locale = DATE_LOCALE): string {
  if (!reminder.on) return 'The monthly reminder is off.';
  const day = reminder.day === 'last' ? 'the last day' : `the ${dayChoiceLabel(reminder.day)}`;
  return `Reminder on ${day} of every month, at ${timeLabel(reminder.time, locale)}.`;
}

/** "Sunday, November 1, at 9:00 AM" */
export function whenLabel(stamp: Stamp, locale = DATE_LOCALE): string {
  const [date, time] = stamp.split('T') as [IsoDate, IsoTime];
  const { year, month, day } = parts(date);
  const dayText = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year, month - 1, day));
  return `${dayText}, at ${timeLabel(time, locale)}`;
}
