import { describe, expect, it } from 'vitest';
import { nextFireTime } from '../../../../packages/push/src/schedule.ts';
import {
  addSuggested,
  byCategory,
  currencyOf,
  dayChoiceLabel,
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
  nextReminder,
  readCategory,
  readEntry,
  removeCategory,
  removeEntry,
  reminderDue,
  reminderNotices,
  reminderOf,
  reminderSentence,
  saveCategory,
  saveEntry,
  setCurrency,
  setReminder,
  shiftMonth,
  suggestedDay,
  SUGGESTED,
  summary,
  toCsv,
  toEntryForm,
  whenLabel,
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
    expect(readCategory({ name: 'Rent', limit: '0.001' }, 'p', categories).problems).toEqual({
      limit: 'Enter at least 0.01.',
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

  it('reads the form, with a point or a comma before the cents', () => {
    expect(readEntry({ ...form, amount: '12,50' }, 'x', 0, categories).entry?.amount).toBe(12.5);
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
    // Kept to the cent, so it would be saved as 0, which saved data never holds.
    expect(readEntry({ ...form, amount: '0.004' }, 'x', 0, categories).problems).toEqual({
      amount: 'Enter at least 0.01.',
    });
    expect(readEntry({ ...form, amount: '1.234,50' }, 'x', 0, categories).problems).toEqual({
      amount: 'Enter a number, like 12.50 or 12,50.',
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

  it('keeps the currency and the reminder side by side', () => {
    const both = setReminder(setCurrency(emptySettings(), 'EUR'), {
      on: true,
      day: 'last',
      time: '20:00',
    });
    expect(currencyOf(both)).toBe('EUR');
    expect(reminderOf(both)).toEqual({ on: true, day: 'last', time: '20:00' });
    expect(currencyOf(setCurrency(both, 'GBP'))).toBe('GBP');
    expect(reminderOf(setCurrency(both, 'GBP')).on).toBe(true);
    // From sync: once each, and only ones that look right.
    expect(
      withSettings([
        { id: 'reminder', on: true, day: 29, time: '09:00' },
        { id: 'reminder', on: 'yes', day: 1, time: '09:00' },
        { id: 'currency', currency: 'EUR' },
        { id: 'currency', currency: 'GBP' },
      ]).settings,
    ).toEqual([{ id: 'currency', currency: 'EUR' }]);
  });
});

describe('monthly reminder', () => {
  const settings = (day: number | 'last', time = '09:00', on = true) =>
    setReminder(emptySettings(), { on, day, time });

  it('is off until it’s turned on', () => {
    expect(reminderOf(emptySettings())).toEqual({ on: false, day: 1, time: '09:00' });
    expect(reminderNotices(emptySettings(), '2026-10-21')).toEqual([]);
    expect(reminderDue(emptySettings(), '2026-11-01T08:59', '2026-11-01T09:00')).toBe(false);
    expect(nextReminder(emptySettings(), '2026-10-21T10:00')).toBeNull();
    // Days 29 to 31 aren't in every month: not allowed.
    expect(setReminder(emptySettings(), { on: true, day: 30, time: '09:00' })).toEqual(
      emptySettings(),
    );
    expect(setReminder(emptySettings(), { on: true, day: 1, time: '' })).toEqual(emptySettings());
  });

  it('is sent once a month', () => {
    expect(reminderNotices(settings(15, '18:30'), '2026-10-21')).toEqual([
      {
        id: 'reminder',
        start: '2026-10-15T18:30',
        repeat: 'monthly',
        until: null,
        offset: 0,
        title: 'Check your budget',
        body: 'Tap to see where your money went.',
        tag: 'budget',
        url: '/',
      },
    ]);
    // The last day: a day before each 1st, so February's is the 28th or 29th.
    expect(reminderNotices(settings('last', '20:00'), '2026-12-05')[0]).toMatchObject({
      start: '2027-01-01T20:00',
      repeat: 'monthly',
      offset: 1440,
    });
  });

  it('comes on the last day of every month, however long', () => {
    const [notice] = reminderNotices(settings('last', '20:00'), '2027-01-10');
    if (!notice) throw new Error('No reminder');
    const times: string[] = [];
    let after = Date.parse('2027-01-10T00:00:00+04:00');
    for (let index = 0; index < 3; index += 1) {
      after = nextFireTime(notice, 'Asia/Tbilisi', after) ?? Infinity;
      times.push(new Date(after).toISOString());
    }
    // 20:00 in Tbilisi is 16:00 UTC.
    expect(times).toEqual([
      '2027-01-31T16:00:00.000Z',
      '2027-02-28T16:00:00.000Z',
      '2027-03-31T16:00:00.000Z',
    ]);
  });

  it('knows when it’s due while Budget is open', () => {
    expect(reminderDue(settings(1), '2026-11-01T08:59', '2026-11-01T09:00')).toBe(true);
    expect(reminderDue(settings(1), '2026-11-01T09:00', '2026-11-01T09:01')).toBe(false);
    expect(reminderDue(settings(1), '2026-11-02T08:59', '2026-11-02T09:00')).toBe(false);
    expect(reminderDue(settings(1, '09:00', false), '2026-11-01T08:59', '2026-11-01T09:00')).toBe(
      false,
    );
    expect(reminderDue(settings('last'), '2028-02-29T08:59', '2028-02-29T09:00')).toBe(true);
    expect(reminderDue(settings('last'), '2027-02-28T08:59', '2027-02-28T09:00')).toBe(true);
    expect(reminderDue(settings('last'), '2026-10-30T08:59', '2026-10-30T09:00')).toBe(false);
  });

  it('says when it’s next', () => {
    expect(nextReminder(settings(21, '11:00'), '2026-10-21T10:00')).toBe('2026-10-21T11:00');
    expect(nextReminder(settings(21, '09:00'), '2026-10-21T10:00')).toBe('2026-11-21T09:00');
    expect(nextReminder(settings(1), '2026-12-15T10:00')).toBe('2027-01-01T09:00');
    expect(nextReminder(settings('last'), '2027-02-10T10:00')).toBe('2027-02-28T09:00');
    expect(nextReminder(settings('last'), '2026-10-31T10:00')).toBe('2026-11-30T09:00');
  });

  it('in words', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(dayChoiceLabel)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '28th',
    ]);
    expect(dayChoiceLabel('last')).toBe('Last day');
    expect(reminderSentence({ on: true, day: 1, time: '09:00' }, 'en-US')).toBe(
      'Reminder on the 1st of every month, at 9:00 AM.',
    );
    expect(reminderSentence({ on: true, day: 'last', time: '20:30' }, 'en-US')).toBe(
      'Reminder on the last day of every month, at 8:30 PM.',
    );
    expect(reminderSentence({ on: false, day: 1, time: '09:00' })).toBe(
      'The monthly reminder is off.',
    );
    expect(whenLabel('2026-11-01T09:00', 'en-US')).toBe('Sunday, November 1, at 9:00 AM');
  });
});
