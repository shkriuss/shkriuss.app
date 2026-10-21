import { describe, expect, it } from 'vitest';
import {
  addSuggested,
  byCategory,
  currencyOf,
  dayLabel,
  emptyCategories,
  emptyEntries,
  emptySettings,
  entriesIn,
  formatMoney,
  isCategoriesState,
  isEntriesState,
  LIMITS,
  monthLabel,
  readCategory,
  readEntry,
  removeCategory,
  removeEntry,
  saveCategory,
  saveEntry,
  setCurrency,
  shiftMonth,
  suggestedDay,
  SUGGESTED,
  summary,
  toCsv,
  toEntryForm,
  withSettings,
  type CategoriesState,
  type Entry,
  type EntriesState,
} from './budget.ts';

const categories: CategoriesState = {
  categories: [
    { id: 'food', name: 'Groceries', limit: 400 },
    { id: 'fun', name: 'Fun', limit: 100 },
    { id: 'home', name: 'Home', limit: null },
  ],
};
const entry = (overrides: Partial<Entry>): Entry => ({
  id: 'e',
  kind: 'expense',
  amount: 10,
  date: '2026-10-21',
  category: 'food',
  note: '',
  ...overrides,
});
const entries = (...list: Entry[]): EntriesState => ({ entries: list });

describe('categories', () => {
  it('reads the form, with or without a limit', () => {
    expect(readCategory({ name: ' Pets ', limit: '' }, 'p', categories)).toEqual({
      category: { id: 'p', name: 'Pets', limit: null },
    });
    expect(readCategory({ name: 'Pets', limit: '50.5' }, 'p', categories).category?.limit).toBe(
      50.5,
    );
  });

  it('says what’s wrong', () => {
    expect(readCategory({ name: '', limit: '-5' }, 'p', categories).problems).toEqual({
      name: 'Enter a name for the category.',
      limit: 'Enter an amount above 0.',
    });
    expect(readCategory({ name: 'groceries', limit: '' }, 'p', categories).problems).toEqual({
      name: 'You already have a category with that name.',
    });
    // Its own name is fine when changing it.
    expect(readCategory({ name: 'Groceries', limit: '500' }, 'food', categories).category).toEqual({
      id: 'food',
      name: 'Groceries',
      limit: 500,
    });
    expect(
      readCategory({ name: 'x'.repeat(LIMITS.name + 1), limit: '' }, 'p', categories).problems,
    ).toEqual({ name: `Use ${LIMITS.name} characters or fewer.` });
  });

  it('adds, changes and removes categories', () => {
    let state = saveCategory(emptyCategories(), { id: 'a', name: 'A', limit: null });
    state = saveCategory(state, { id: 'b', name: 'B', limit: 5 });
    state = saveCategory(state, { id: 'a', name: 'A2', limit: 1 });
    expect(state.categories).toEqual([
      { id: 'a', name: 'A2', limit: 1 },
      { id: 'b', name: 'B', limit: 5 },
    ]);
    expect(removeCategory(state, 'a').categories.map((category) => category.id)).toEqual(['b']);
  });

  it('adds the suggested ones that aren’t there yet', () => {
    let next = 0;
    const state = addSuggested(categories, () => `s${(next += 1)}`);
    expect(state.categories.map((category) => category.name)).toEqual([
      'Groceries',
      'Fun',
      'Home',
      ...SUGGESTED.filter((name) => !['Groceries', 'Fun', 'Home'].includes(name)),
    ]);
    expect(state.categories.at(-1)).toEqual({ id: 's5', name: 'Other', limit: null });
  });

  it('checks saved categories', () => {
    expect(isCategoriesState(categories)).toBe(true);
    expect(isCategoriesState({ categories: [{ id: 'a', name: 'A', limit: 0 }] })).toBe(false);
    expect(isCategoriesState({})).toBe(false);
  });
});

describe('entries', () => {
  const form = {
    kind: 'expense',
    amount: '12.5',
    date: '2026-10-21',
    category: 'food',
    note: ' Bread ',
  };

  it('reads the form', () => {
    expect(readEntry(form, 'x', 0, categories)).toEqual({
      entry: {
        id: 'x',
        kind: 'expense',
        amount: 12.5,
        date: '2026-10-21',
        category: 'food',
        note: 'Bread',
      },
    });
    // Income has no category; an unknown category is none.
    expect(readEntry({ ...form, kind: 'income' }, 'x', 0, categories).entry?.category).toBeNull();
    expect(readEntry({ ...form, category: 'gone' }, 'x', 0, categories).entry?.category).toBeNull();
    expect(toEntryForm(readEntry(form, 'x', 0, categories).entry as Entry)).toEqual({
      ...form,
      note: 'Bread',
    });
  });

  it('says what’s wrong', () => {
    expect(readEntry({ ...form, amount: '', date: '' }, 'x', 0, categories).problems).toEqual({
      amount: 'Enter an amount.',
      date: 'Choose a day.',
    });
    expect(readEntry({ ...form, amount: '0' }, 'x', 0, categories).problems).toEqual({
      amount: 'Enter an amount above 0.',
    });
    expect(readEntry({ ...form, amount: '2000000000' }, 'x', 0, categories).problems).toEqual({
      amount: 'Enter a smaller amount.',
    });
    expect(readEntry(form, 'x', LIMITS.entries, categories).problems).toEqual({
      amount: `You can keep up to ${LIMITS.entries} entries.`,
    });
  });

  it('adds, changes and removes entries', () => {
    let state = saveEntry(emptyEntries(), entry({ id: 'a' }));
    state = saveEntry(state, entry({ id: 'b', amount: 5 }));
    state = saveEntry(state, entry({ id: 'a', amount: 7 }));
    expect(state.entries.map((item) => `${item.id}:${item.amount}`)).toEqual(['a:7', 'b:5']);
    expect(removeEntry(state, 'a').entries.map((item) => item.id)).toEqual(['b']);
  });

  it('checks saved entries', () => {
    expect(isEntriesState(entries(entry({})))).toBe(true);
    expect(isEntriesState(entries(entry({ kind: 'income', category: 'food' })))).toBe(false);
    expect(isEntriesState(entries(entry({ amount: -1 })))).toBe(false);
  });
});

describe('months', () => {
  it('moves between months', () => {
    expect(shiftMonth('2026-10', -1)).toBe('2026-09');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(suggestedDay('2026-10', '2026-10-21')).toBe('2026-10-21');
    expect(suggestedDay('2026-09', '2026-10-21')).toBe('2026-09-01');
  });

  const october = entries(
    entry({ id: 'a', date: '2026-10-02', amount: 120.1 }),
    entry({ id: 'b', date: '2026-10-05', amount: 60, category: 'fun' }),
    entry({ id: 'c', date: '2026-10-05', amount: 75, category: 'fun' }),
    entry({ id: 'd', date: '2026-10-01', kind: 'income', amount: 2000, category: null }),
    entry({ id: 'e', date: '2026-10-07', amount: 30.2, category: null }),
    entry({ id: 'f', date: '2026-10-08', amount: 9.9, category: 'deleted' }),
    entry({ id: 'g', date: '2026-09-30', amount: 500 }),
  );

  it('lists a month’s entries, the latest first', () => {
    expect(entriesIn(october, '2026-10').map((item) => item.id)).toEqual([
      'f',
      'e',
      'c',
      'b',
      'a',
      'd',
    ]);
  });

  it('adds up income, spending and what’s left', () => {
    expect(summary(entriesIn(october, '2026-10'), categories)).toEqual({
      income: 2000,
      spent: 295.2,
      left: 1704.8,
      budgeted: 500,
    });
    expect(summary([], emptyCategories())).toEqual({
      income: 0,
      spent: 0,
      left: 0,
      budgeted: null,
    });
  });

  it('shows spending against each category’s limit', () => {
    expect(byCategory(entriesIn(october, '2026-10'), categories)).toEqual([
      { category: categories.categories[0], spent: 120.1, left: 279.9 },
      { category: categories.categories[1], spent: 135, left: -35 },
      { category: categories.categories[2], spent: 0, left: null },
      { category: null, spent: 40.1, left: null },
    ]);
  });
});

describe('words and money', () => {
  it('formats money, months and days', () => {
    expect(formatMoney(1234.5, 'USD', { locale: 'en-US' })).toBe('$1,234.50');
    expect(formatMoney(-35, 'EUR', { signed: true, locale: 'en-US' })).toBe('-€35.00');
    expect(formatMoney(2000, 'GEL', { signed: true, locale: 'en-US' })).toMatch(
      /^\+GEL\s2,000\.00$/,
    );
    expect(monthLabel('2026-10', 'en-US')).toBe('October 2026');
    expect(dayLabel('2026-10-21', 'en-US')).toBe('Wed, Oct 21');
  });
});

describe('spreadsheet', () => {
  it('has a row for each entry, expenses negative, safe to open', () => {
    expect(
      toCsv(
        entries(
          entry({ id: 'a', date: '2026-10-02', note: 'Milk, "fresh"' }),
          entry({
            id: 'b',
            date: '2026-10-03',
            kind: 'income',
            amount: 2000,
            category: null,
            note: '=pay',
          }),
        ),
        categories,
      ).split('\r\n'),
    ).toEqual([
      'Date,Type,Amount,Category,Note',
      "2026-10-03,Income,2000,,'=pay",
      '2026-10-02,Expense,-10,Groceries,"Milk, ""fresh"""',
      '',
    ]);
  });
});

describe('settings', () => {
  it('uses dollars until another currency is chosen', () => {
    expect(currencyOf(emptySettings())).toBe('USD');
    expect(currencyOf(setCurrency(emptySettings(), 'GEL'))).toBe('GEL');
    expect(withSettings([{ id: 'currency', currency: 'XYZ' }]).settings).toEqual([]);
  });
});
