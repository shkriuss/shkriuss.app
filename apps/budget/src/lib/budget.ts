/**
 * Budget's data and rules, kept separate from the page so they're easy to
 * test. Every function returns new data instead of changing the old.
 *
 * Three lists, saved and synced separately:
 * - categories: a name and, optionally, a limit for each month;
 * - entries: an expense (in a category, or none) or income, with an amount,
 *   a day and a note;
 * - settings: the currency amounts are shown in. Saved only once changed
 *   (US dollars until then), so a new device has nothing that could win over
 *   another device's choice when they first sync.
 *
 * A month is "YYYY-MM". Categories don't belong to a month: their limits are
 * the same every month.
 */
import { isIsoDate, type IsoDate } from '@shkriuss/dates';

export type Kind = 'expense' | 'income';
export const KINDS: readonly Kind[] = ['expense', 'income'];

export interface Category {
  id: string;
  name: string;
  /** The most to spend in it each month, or null for none. */
  limit: number | null;
}

export interface CategoriesState {
  categories: Category[];
}

export interface Entry {
  id: string;
  kind: Kind;
  amount: number;
  date: IsoDate;
  /** For an expense: its category's id, or null. Always null for income. */
  category: string | null;
  note: string;
}

export interface EntriesState {
  entries: Entry[];
}

export const LIMITS = { name: 30, note: 100, categories: 50, entries: 5000, amount: 1e9 };

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

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= LIMITS.amount;

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
    (category === null || (kind === 'expense' && typeof category === 'string')) &&
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

/** A typed amount: null when empty, NaN when it isn't a number. */
const parseAmount = (text: string): number | null =>
  text.trim() === '' ? null : Number(text.trim());

/** What's wrong with a typed amount, or undefined (empty is fine when `optional`). */
function amountProblem(text: string, optional: boolean): string | undefined {
  const value = parseAmount(text);
  if (value === null) return optional ? undefined : 'Enter an amount.';
  if (!Number.isFinite(value) || value <= 0) return 'Enter an amount above 0.';
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
):
  | { category: Category; problems?: undefined }
  | { category?: undefined; problems: CategoryProblems } {
  const problems: CategoryProblems = {};
  const name = form.name.trim();
  const editing = state.categories.some((category) => category.id === id);
  if (name === '') problems.name = 'Enter a name for the category.';
  else if (name.length > LIMITS.name) problems.name = `Use ${LIMITS.name} characters or fewer.`;
  else if (
    state.categories.some(
      (category) => category.id !== id && category.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    problems.name = 'You already have a category with that name.';
  } else if (!editing && state.categories.length >= LIMITS.categories) {
    problems.name = `You can have up to ${LIMITS.categories} categories.`;
  }
  const limitProblem = amountProblem(form.limit, true);
  if (limitProblem) problems.limit = limitProblem;
  if (Object.keys(problems).length > 0) return { problems };
  const limit = parseAmount(form.limit);
  return { category: { id, name, limit: limit === null ? null : tidy(limit) } };
}

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
): { entry: Entry; problems?: undefined } | { entry?: undefined; problems: EntryProblems } {
  const problems: EntryProblems = {};
  const kind = KINDS.find((entry) => entry === form.kind);
  if (!kind) problems.kind = 'Choose expense or income.';
  const amountText = amountProblem(form.amount, false);
  if (amountText) problems.amount = amountText;
  else if (count >= LIMITS.entries)
    problems.amount = `You can keep up to ${LIMITS.entries} entries.`;
  if (!isIsoDate(form.date)) problems.date = 'Choose a day.';
  const category =
    kind === 'expense' && categories.categories.some((entry) => entry.id === form.category)
      ? form.category
      : null;
  const note = form.note.trim();
  if (note.length > LIMITS.note) problems.note = `Use ${LIMITS.note} characters or fewer.`;
  if (Object.keys(problems).length > 0 || !kind) return { problems };
  return {
    entry: { id, kind, amount: tidy(Number(form.amount)), date: form.date, category, note },
  };
}

/** An entry as the form shows it. */
export const toEntryForm = (entry: Entry): EntryForm => ({
  kind: entry.kind,
  amount: String(entry.amount),
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
  spent: number;
  /** Income minus spending (negative when more was spent). */
  left: number;
  /** The categories' limits added up (null when none has one). */
  budgeted: number | null;
}

export function summary(entries: readonly Entry[], categories: CategoriesState): Summary {
  const total = (kind: Kind) =>
    tidy(entries.reduce((sum, entry) => (entry.kind === kind ? sum + entry.amount : sum), 0));
  const limits = categories.categories.flatMap((category) =>
    category.limit === null ? [] : [category.limit],
  );
  const income = total('income');
  const spent = total('expense');
  return {
    income,
    spent,
    left: tidy(income - spent),
    budgeted: limits.length === 0 ? null : tidy(limits.reduce((sum, limit) => sum + limit, 0)),
  };
}

export interface CategoryTotal {
  /** null: expenses without a category (or in one that was deleted). */
  category: Category | null;
  spent: number;
  /** What's left of the limit (negative when over), or null without one. */
  left: number | null;
}

/**
 * Spending in each category, in the categories' order, then "No category"
 * if anything was spent without one.
 */
export function byCategory(
  entries: readonly Entry[],
  categories: CategoriesState,
): CategoryTotal[] {
  const spent = new Map<string | null, number>();
  const known = new Set(categories.categories.map((category) => category.id));
  for (const entry of entries) {
    if (entry.kind !== 'expense') continue;
    const key = entry.category !== null && known.has(entry.category) ? entry.category : null;
    spent.set(key, tidy((spent.get(key) ?? 0) + entry.amount));
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
  if (none) totals.push({ category: null, spent: none, left: null });
  return totals;
}

// ---------- Money and dates for people ----------

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'GEL', 'CHF', 'JPY', 'CAD', 'AUD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** "$1,234.50"; with `signed`, "+$480.00" or "-$120.00". */
export function formatMoney(
  amount: number,
  currency: Currency,
  options: { signed?: boolean; locale?: string } = {},
): string {
  return new Intl.NumberFormat(options.locale, {
    style: 'currency',
    currency,
    signDisplay: options.signed ? 'exceptZero' : 'auto',
  }).format(amount);
}

/** "October 2026". */
export function monthLabel(month: string, locale?: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year, number - 1, 1));
}

/** "Wed, Oct 21". */
export function dayLabel(date: IsoDate, locale?: string): string {
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

/** Every entry as a CSV file, the latest first. Expenses are negative. */
export function toCsv(entries: EntriesState, categories: CategoriesState): string {
  const names = new Map(categories.categories.map((category) => [category.id, category.name]));
  const rows = [...entries.entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((entry) =>
      [
        entry.date,
        entry.kind === 'income' ? 'Income' : 'Expense',
        entry.kind === 'income' ? entry.amount : -entry.amount,
        entry.kind === 'income' ? '' : (names.get(entry.category ?? '') ?? ''),
        entry.note,
      ]
        .map(cell)
        .join(','),
    );
  return [['Date', 'Type', 'Amount', 'Category', 'Note'].join(','), ...rows].join('\r\n') + '\r\n';
}

// ---------- Settings ----------

export interface Setting {
  id: 'currency';
  currency: Currency;
}

export interface SettingsState {
  /** Only the settings ever changed. */
  settings: Setting[];
}

export const emptySettings = (): SettingsState => ({ settings: [] });

const isSetting = (value: unknown): value is Setting =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<string, unknown>)['id'] === 'currency' &&
  CURRENCIES.includes((value as Record<string, unknown>)['currency'] as Currency);

export function isSettingsState(value: unknown): value is SettingsState {
  if (typeof value !== 'object' || value === null) return false;
  const { settings } = value as Record<string, unknown>;
  return Array.isArray(settings) && settings.every(isSetting);
}

/** Settings from sync: the ones that look right. */
export const withSettings = (items: readonly unknown[]): SettingsState => ({
  settings: items.filter(isSetting).slice(0, 1),
});

export const currencyOf = (state: SettingsState): Currency =>
  state.settings.find((setting) => setting.id === 'currency')?.currency ?? 'USD';

export const setCurrency = (state: SettingsState, currency: Currency): SettingsState =>
  CURRENCIES.includes(currency) ? { settings: [{ id: 'currency', currency }] } : state;
