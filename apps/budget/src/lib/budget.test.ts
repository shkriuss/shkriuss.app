import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '@shkriuss/dates';
import { footprint, sampleText } from '@shkriuss/sync/testing';
import { appSecret, Device, pretendBrowser } from '../../../../tests/unit/sync-devices.ts';
import { nextFireTime } from '../../../../packages/push/src/schedule.ts';
import { MAX_SEALED_CHARS } from '../../../../packages/sync/src/validate.ts';
import {
  addSuggested,
  budgetLine,
  byCategory,
  CATEGORIES_VERSION,
  currencyOf,
  dayChoiceLabel,
  dayLabel,
  emptyCategories,
  emptyEntries,
  emptySettings,
  entriesCount,
  entriesIn,
  ENTRIES_VERSION,
  entryYears,
  formatMoney,
  isCategoriesState,
  isEntriesState,
  LIMITS,
  migrateEntries,
  monthLabel,
  nextReminder,
  readCategory,
  readEntry,
  removeCategory,
  removeEntry,
  removeYear,
  reminderDue,
  reminderNotices,
  reminderOf,
  reminderSentence,
  roomNote,
  saveCategory,
  saveEntry,
  setCurrency,
  setReminder,
  shiftMonth,
  suggestedDay,
  SUGGESTED,
  summary,
  toCategoryForm,
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
    expect(
      readCategory({ name: 'Rent', limit: '0.001' }, 'p', categories, { locale: 'en-US' }).problems,
    ).toEqual({
      limit: 'Enter at least 0.01.',
    });
    expect(readCategory({ name: 'groceries', limit: '' }, 'p', categories).problems).toEqual({
      name: 'You already have a category with that name.',
    });
    // Accents and spaces aside too, as in the other apps (audit 3 J-12).
    const cafe = { categories: [{ id: 'c', name: 'Café', limit: null }] };
    expect(readCategory({ name: ' cafe ', limit: '' }, 'p', cafe).problems).toEqual({
      name: 'You already have a category with that name.',
    });
    expect(readCategory({ name: 'CAFE', limit: '' }, 'c', cafe).category?.name).toBe('CAFE');
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

  it('lets a category keep a name it shares with another', () => {
    const twins = {
      categories: [...categories.categories, { id: 'food-2', name: 'groceries', limit: null }],
    };
    expect(readCategory({ name: 'Groceries', limit: '300' }, 'food-2', twins).category).toEqual({
      id: 'food-2',
      name: 'Groceries',
      limit: 300,
    });
    // A new name is still checked, and so is a new category.
    expect(readCategory({ name: 'Fun', limit: '' }, 'food-2', twins).problems).toEqual({
      name: 'You already have a category with that name.',
    });
    expect(readCategory({ name: 'Groceries', limit: '' }, 'new', twins).problems).toEqual({
      name: 'You already have a category with that name.',
    });
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
    // Older versions could save a limit of 0 (from 0.001): it's still read.
    expect(isCategoriesState({ categories: [{ id: 'a', name: 'A', limit: 0 }] })).toBe(true);
    expect(isCategoriesState({ categories: [{ id: 'a', name: 'A', limit: -1 }] })).toBe(false);
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
    expect(toEntryForm(readEntry(form, 'x', 0, categories).entry as Entry, 'en-US')).toEqual({
      ...form,
      note: 'Bread',
    });
  });

  // Audit F2-1: "2,000" was saved as 2.00.
  it('reads thousands the way the person’s language writes them', () => {
    const amount = (text: string, locale: string) =>
      readEntry({ ...form, amount: text }, 'x', 0, categories, { locale }).entry?.amount;
    expect(amount('2,000', 'en-US')).toBe(2000);
    expect(amount('1,500.50', 'en-US')).toBe(1500.5);
    expect(amount('12,50', 'en-US')).toBe(12.5);
    expect(amount('1.500', 'de-DE')).toBe(1500);
    expect(amount('1,500', 'de-DE')).toBe(1.5);
    expect(amount('١٬٥٠٠', 'ar-EG')).toBe(1500);
    expect(amount('١٢٫٥٠', 'ar-EG')).toBe(12.5);
    expect(
      readCategory({ name: 'Rent', limit: '1,200' }, 'r', categories, { locale: 'en-US' }).category
        ?.limit,
    ).toBe(1200);
    // Shown in the form again, then saved unchanged: the same amount.
    const saved = readEntry({ ...form, amount: '1.234,5' }, 'x', 0, categories, {
      locale: 'de-DE',
    }).entry as Entry;
    expect(toEntryForm(saved, 'de-DE').amount).toBe('1234,5');
    expect(
      readEntry(toEntryForm(saved, 'de-DE'), 'x', 0, categories, { locale: 'de-DE' }).entry,
    ).toEqual(saved);
    const rent = { id: 'r', name: 'Rent', limit: 1200.5 };
    expect(toCategoryForm(rent, 'de-DE')).toEqual({ name: 'Rent', limit: '1200,5' });
  });

  // Audit 3 F2-3: in French (and wherever thousands are grouped with a space),
  // "1.500" was saved as 1.50, though an amount is never kept to three decimals.
  it('asks again about an amount that could be thousands or decimals', () => {
    const amount = (text: string, locale: string) =>
      readEntry({ ...form, amount: text }, 'x', 0, categories, { locale });
    expect(amount('1.500', 'fr-FR').problems).toEqual({
      amount: 'Enter 1500 or 1,5 to show which you mean.',
    });
    expect(amount('12.500', 'de-AT').problems).toEqual({
      amount: 'Enter 12500 or 12,5 to show which you mean.',
    });
    expect(
      readCategory({ name: 'Rent', limit: '1.200' }, 'r', categories, { locale: 'pl-PL' }).problems,
    ).toEqual({ limit: 'Enter 1200 or 1,2 to show which you mean.' });
    // Typed the way the language writes it, or with two decimals: as before.
    expect(amount('1 500', 'fr-FR').entry?.amount).toBe(1500);
    expect(amount('1,5', 'fr-FR').entry?.amount).toBe(1.5);
    expect(amount('1.50', 'fr-FR').entry?.amount).toBe(1.5);
    expect(amount('1.500', 'de-DE').entry?.amount).toBe(1500);
    expect(amount('1.500', 'en-US').entry?.amount).toBe(1.5);
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
    expect(
      readEntry({ ...form, amount: '0.004' }, 'x', 0, categories, { locale: 'en-US' }).problems,
    ).toEqual({
      amount: 'Enter at least 0.01.',
    });
    // Rounded to the cent as written (1.005 * 100 is 100.49999999999999). In
    // English: "1.005" is 1005 in German, and asked again in French (audit 3 J-5).
    const english = { locale: 'en-US' };
    expect(readEntry({ ...form, amount: '1.005' }, 'x', 0, categories, english).entry?.amount).toBe(
      1.01,
    );
    expect(readEntry({ ...form, amount: '0.005' }, 'x', 0, categories, english).entry?.amount).toBe(
      0.01,
    );
    expect(
      readEntry({ ...form, amount: '1.234,50' }, 'x', 0, categories, { locale: 'en-US' }).problems,
    ).toEqual({
      amount: 'Enter a number, like 12.50 or 12,50.',
    });
    expect(readEntry({ ...form, amount: '2000000000' }, 'x', 0, categories).problems).toEqual({
      amount: 'Enter a smaller amount.',
    });
    // Audit 5 F2-5: one too long to be a number at all (it reads as
    // infinite) was called "not a number", with the right message at hand.
    const endless = '9'.repeat(400);
    expect(readEntry({ ...form, amount: endless }, 'x', 0, categories).problems).toEqual({
      amount: 'Enter a smaller amount.',
    });
    expect(readCategory({ name: 'Rent', limit: endless }, 'p', categories).problems).toEqual({
      limit: 'Enter a smaller amount.',
    });
    expect(readEntry({ ...form, amount: `-${endless}` }, 'x', 0, categories).problems).toEqual({
      amount: 'Enter an amount above 0.',
    });
    expect(readEntry(form, 'x', LIMITS.entries, categories).problems).toEqual({
      amount: `You can keep up to ${new Intl.NumberFormat().format(LIMITS.entries)} entries. To make room, delete a year (under Currency and spreadsheet).`,
    });
    // Audit 3 F2-5: with more than that (two devices' entries put together by
    // sync), every change was refused. A change adds none, so it's fine.
    expect(readEntry(form, 'x', null, categories).entry?.amount).toBe(12.5);
  });

  // Audit 5 F2-3: an iPhone's text boxes count a flag or a family emoji as
  // one character, so a full box was refused on saving: a note of 20 family
  // emoji counted 160, and was "Use 100 characters or fewer."
  it('counts characters as people see them, as an iPhone’s text boxes do', () => {
    const family = '👨‍👩‍👧';
    const flag = '🇬🇪';
    const note = (text: string) => readEntry({ ...form, note: text }, 'x', 0, categories);
    expect(note(family.repeat(20)).entry?.note).toBe(family.repeat(20));
    expect(note(flag.repeat(LIMITS.note)).entry?.note).toBe(flag.repeat(LIMITS.note));
    expect(note(flag.repeat(LIMITS.note + 1)).problems).toEqual({
      note: `Use ${LIMITS.note} characters or fewer.`,
    });
    const name = (text: string) => readCategory({ name: text, limit: '' }, 'p', categories);
    expect(name(flag.repeat(LIMITS.name)).category?.name).toBe(flag.repeat(LIMITS.name));
    expect(name(family.repeat(LIMITS.name + 1)).problems).toEqual({
      name: `Use ${LIMITS.name} characters or fewer.`,
    });
    // One letter under thousands of accents is one character, but not without a limit.
    const zalgo = `Z${'̶'.repeat(2000)}`;
    expect(name(zalgo).problems).toEqual({ name: `Use ${LIMITS.name} characters or fewer.` });
  });

  // Audit F2-13: yen kept cents, so 0.01 yen was saved and shown as "¥0",
  // and two entries of 0.5 showed as ¥1 and ¥1, adding up to ¥1.
  it('keeps amounts to their currency’s own decimals', () => {
    const yen = { currency: 'JPY', locale: 'en-US' } as const;
    expect(readEntry({ ...form, amount: '0.5' }, 'x', 0, categories, yen).entry?.amount).toBe(1);
    expect(readEntry({ ...form, amount: '1500.4' }, 'x', 0, categories, yen).entry?.amount).toBe(
      1500,
    );
    expect(readEntry({ ...form, amount: '0.4' }, 'x', 0, categories, yen).problems).toEqual({
      amount: 'Enter at least 1.',
    });
    expect(readCategory({ name: 'Rent', limit: '80000.5' }, 'r', categories, yen).category).toEqual(
      {
        id: 'r',
        name: 'Rent',
        limit: 80_001,
      },
    );
    // Two entries of 0.5 yen: ¥1 each, ¥2 in all.
    const twice = ['a', 'b'].map(
      (id) => readEntry({ ...form, amount: '0.5' }, id, 0, categories, yen).entry as Entry,
    );
    expect(summary(twice, categories).spent).toBe(2);
    // Dollars keep their cents.
    expect(
      readEntry({ ...form, amount: '0.5' }, 'x', 0, categories, { currency: 'USD' }).entry?.amount,
    ).toBe(0.5);
  });

  it('reads a refund, in a category like an expense', () => {
    expect(readEntry({ ...form, kind: 'refund' }, 'x', 0, categories).entry).toMatchObject({
      kind: 'refund',
      amount: 12.5,
      category: 'food',
    });
    expect(
      readEntry({ ...form, kind: 'refund', category: '' }, 'x', 0, categories).entry?.category,
    ).toBeNull();
    expect(readEntry({ ...form, kind: 'gift' }, 'x', 0, categories).problems).toEqual({
      kind: 'Choose expense, income or refund.',
    });
    expect(isEntriesState(entries(entry({ kind: 'refund' })))).toBe(true);
    expect(isEntriesState(entries(entry({ kind: 'refund', category: null })))).toBe(true);
  });

  it('reads what version 1 saved, which had no refunds', () => {
    expect(ENTRIES_VERSION).toBe(2);
    const saved = entries(entry({}), entry({ id: 'i', kind: 'income', category: null }));
    expect(migrateEntries(saved, 1)).toEqual(saved);
    expect(migrateEntries({ entries: [{ id: 'a' }] }, 1)).toBeUndefined();
    expect(migrateEntries(null, 1)).toBeUndefined();
    expect(migrateEntries(saved, 3)).toBeUndefined();
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
    expect(isEntriesState(entries(entry({ amount: 0 })))).toBe(true);
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
      // Groceries and Fun: not "No category" or the deleted one.
      spentWithLimit: 255.1,
    });
    expect(summary([], emptyCategories())).toEqual({
      income: 0,
      spent: 0,
      left: 0,
      budgeted: null,
      spentWithLimit: 0,
    });
  });

  // Audit F2-7: rent in a category with no limit put the month "over budget".
  it('holds only spending in categories with a limit against the budget', () => {
    const home: CategoriesState = {
      categories: [
        { id: 'food', name: 'Groceries', limit: 400 },
        { id: 'home', name: 'Home', limit: null },
      ],
    };
    const month = [
      entry({ id: 'rent', amount: 1500, category: 'home' }),
      entry({ id: 'shop', amount: 100, category: 'food' }),
    ];
    expect(budgetLine(summary(month, home), 'USD', 'en-US')).toEqual({
      text: '$300.00 left of the $400.00 budgeted ($1,500.00 more spent without a limit)',
      over: false,
    });
    const over = [...month, entry({ id: 'feast', amount: 350, category: 'food' })];
    expect(budgetLine(summary(over, home), 'USD', 'en-US')).toEqual({
      text: '$50.00 over the $400.00 budgeted ($1,500.00 more spent without a limit)',
      over: true,
    });
    // Only spending with a limit: nothing more to say.
    expect(budgetLine(summary(month.slice(1), home), 'USD', 'en-US')).toEqual({
      text: '$300.00 left of the $400.00 budgeted',
      over: false,
    });
    expect(budgetLine(summary(month, emptyCategories()), 'USD', 'en-US')).toBeNull();
  });

  it('shows spending against each category’s limit', () => {
    expect(byCategory(entriesIn(october, '2026-10'), categories)).toEqual([
      { category: categories.categories[0], spent: 120.1, left: 279.9 },
      { category: categories.categories[1], spent: 135, left: -35 },
      { category: categories.categories[2], spent: 0, left: null },
      { category: null, spent: 40.1, left: null },
    ]);
  });

  // Audit F2-11: 3.30 spent, then refunded as 1.10 and 2.20, showed "Spent -$0.00".
  it('never adds up to -0, which would show as "-$0.00"', () => {
    const evened = [
      entry({ id: 'a', amount: 3.3 }),
      entry({ id: 'b', kind: 'refund', amount: 1.1 }),
      entry({ id: 'c', kind: 'refund', amount: 2.2 }),
    ];
    const totals = summary(evened, categories);
    expect(Object.is(totals.spent, 0)).toBe(true);
    expect(Object.is(totals.spentWithLimit, 0)).toBe(true);
    expect(formatMoney(totals.spent, 'USD', { locale: 'en-US' })).toBe('$0.00');
    expect(formatMoney(totals.left, 'USD', { signed: true, locale: 'en-US' })).toBe('$0.00');
    expect(Object.is(byCategory(evened, categories)[0]?.spent, 0)).toBe(true);
  });

  // Audit 5 F2-2: "Spent" added the amounts as decimals and rounded once at
  // the end, the categories after each amount, so with thousands of
  // billion-dollar entries they disagreed by cents (3,000,000,000,029.30
  // against the right 3,000,000,000,030.00), and the budget line was off too.
  it('adds up thousands of the biggest amounts to the cent, the month and its categories alike', () => {
    const big: CategoriesState = { categories: [{ id: 'c', name: 'Big', limit: 1e9 }] };
    const many = (count: number, amount: number, kind: Entry['kind'] = 'expense') =>
      Array.from({ length: count }, (_, index) =>
        entry({ id: `${kind}-${amount}-${index}`, kind, amount, category: 'c' }),
      );
    const month = [...many(3000, LIMITS.amount), ...many(3000, 0.01)];
    const totals = summary(month, big);
    expect(totals.spent).toBe(3_000_000_000_030);
    expect(totals.spentWithLimit).toBe(3_000_000_000_030);
    expect(byCategory(month, big)[0]?.spent).toBe(3_000_000_000_030);
    expect(budgetLine(totals, 'USD', 'en-US')).toEqual({
      text: '$2,999,000,000,030.00 over the $1,000,000,000.00 budgeted',
      over: true,
    });
    // 2,000 of $999,999,999.99 and 4,000 of $0.01: $2,000,000,000,020.00.
    const milder = [...many(2000, LIMITS.amount - 0.01), ...many(4000, 0.01)];
    expect(summary(milder, big).spent).toBe(2_000_000_000_020);
    expect(byCategory(milder, big)[0]?.spent).toBe(2_000_000_000_020);
    // Income and refunds add up the same way, and "Left" follows.
    const mixed = [
      ...many(2000, LIMITS.amount, 'income'),
      ...many(2000, 0.01, 'income'),
      ...many(1000, 0.01, 'refund'),
      ...many(1000, LIMITS.amount),
    ];
    expect(summary(mixed, big)).toMatchObject({
      income: 2_000_000_000_020,
      spent: 999_999_999_990,
      left: 1_000_000_000_030,
    });
    expect(byCategory(mixed, big)[0]?.spent).toBe(999_999_999_990);
  });

  it('takes refunds off their category’s spending, and off what was spent', () => {
    const withRefunds = saveEntry(
      saveEntry(october, entry({ id: 'r', kind: 'refund', amount: 40, category: 'fun' })),
      entry({ id: 's', kind: 'refund', amount: 0.1, category: null, date: '2026-10-09' }),
    );
    const month = entriesIn(withRefunds, '2026-10');
    // Fun was $35 over its limit: the refund brings it back under.
    expect(byCategory(month, categories)).toEqual([
      { category: categories.categories[0], spent: 120.1, left: 279.9 },
      { category: categories.categories[1], spent: 95, left: 5 },
      { category: categories.categories[2], spent: 0, left: null },
      { category: null, spent: 40, left: null },
    ]);
    expect(summary(month, categories)).toEqual({
      income: 2000,
      spent: 255.1,
      left: 1744.9,
      budgeted: 500,
      spentWithLimit: 215.1,
    });
    // A refund for something bought the month before: less than nothing spent.
    const refundOnly = [entry({ kind: 'refund', amount: 30, category: 'food' })];
    expect(summary(refundOnly, categories).spent).toBe(-30);
    expect(byCategory(refundOnly, categories)[0]).toMatchObject({ spent: -30, left: 430 });
    // "No category" shows while it has entries, even if they add up to 0.
    const evened = [
      entry({ id: 'a', category: null }),
      entry({ id: 'b', kind: 'refund', category: null }),
    ];
    expect(byCategory(evened, emptyCategories())).toEqual([
      { category: null, spent: 0, left: null },
    ]);
  });
});

describe('making room', () => {
  const years = entries(
    entry({ id: 'a', date: '2024-03-02' }),
    entry({ id: 'b', date: '2026-10-21', kind: 'income', category: null }),
    entry({ id: 'c', date: '2024-12-31', kind: 'refund' }),
    entry({ id: 'd', date: '2025-01-01' }),
  );

  it('lists the years with entries, and deletes one', () => {
    expect(entryYears(years)).toEqual([
      { year: '2024', count: 2 },
      { year: '2025', count: 1 },
      { year: '2026', count: 1 },
    ]);
    expect(entryYears(emptyEntries())).toEqual([]);
    expect(removeYear(years, '2024').entries.map((item) => item.id)).toEqual(['b', 'd']);
    expect(removeYear(years, '2023')).toEqual(years);
    expect(entriesCount(1, 'en-US')).toBe('1 entry');
    expect(entriesCount(1234, 'en-US')).toBe('1,234 entries');
  });

  it('says so once Budget is nearly full', () => {
    const number = (value: number) => new Intl.NumberFormat('en-US').format(value);
    const nearly = LIMITS.entries * 0.9;
    const makeRoom =
      'To make room, download the spreadsheet, then use “Delete a year…” under Currency and spreadsheet, below.';
    expect(roomNote(nearly, 'en-US')).toBeNull();
    expect(roomNote(nearly + 1, 'en-US')).toBe(
      `Budget is nearly full: there’s room for ${number(LIMITS.entries - nearly - 1)} more entries (it keeps up to ${number(LIMITS.entries)}). ${makeRoom}`,
    );
    expect(roomNote(LIMITS.entries - 1, 'en-US')).toContain('there’s room for 1 more entry (');
    expect(roomNote(LIMITS.entries, 'en-US')).toBe(
      `Budget is full: it keeps up to ${number(LIMITS.entries)} entries. ${makeRoom}`,
    );
  });

  // Every entry is saved on the device (in localStorage, about 5 MB for each
  // site), and with sync on, also goes into the copy that goes online.
  it('has room for every entry, on the device and in the sync copy', async () => {
    const ids = Array.from({ length: LIMITS.categories }, () => crypto.randomUUID());
    const list = Array.from({ length: LIMITS.entries }, (_, index): Entry => {
      const kind = index % 10 === 0 ? 'income' : index % 10 === 1 ? 'refund' : 'expense';
      return {
        id: crypto.randomUUID(),
        kind,
        amount: 1000 + ((index * 7919) % 99_000_000) / 100,
        date: addDays('2016-01-01', index % 3650),
        category: kind === 'income' ? null : (ids[index % ids.length] ?? null),
        // Long-ish notes: 60 of the 100 characters allowed.
        note: sampleText(60, index),
      };
    });
    const size = await footprint({
      app: 'budget',
      store: 'shkriuss:budget',
      version: ENTRIES_VERSION,
      data: { entries: list },
      items: list,
      // A quarter of them deleted ("Delete a year") less than 180 days ago.
      deleted: LIMITS.entries / 4,
    });
    expect(size.saved).toBeLessThan(2_000_000);
    expect(size.compressed).toBeLessThan(1_000_000);
    expect(size.sealed).toBeLessThan(MAX_SEALED_CHARS);
    // Safari allows 5 MiB (5,242,880 bytes), and counts 2 bytes for each
    // character of text with any character beyond Latin-1 (like ’ from an
    // iPhone's keyboard, or Georgian). Sync's own records are plain letters
    // and digits: 1 byte each. Some room is left for the rest.
    expect(2 * size.saved + size.syncState).toBeLessThan(4_500_000);
  }, 60_000);
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

  // Audit 4 F2-5: after switching dollars to yen, three $0.50 coffees showed
  // as ¥1, ¥1, ¥1, but "Spent" said ¥2; and saving one's form with only its
  // note changed saved its amount as 1.
  it('adds up amounts as they’re shown, and keeps one that wasn’t changed', () => {
    const coffees = ['a', 'b', 'c'].map((id) => entry({ id, amount: 0.5 }));
    const limits: CategoriesState = {
      categories: [{ id: 'food', name: 'Groceries', limit: 10.5 }],
    };
    const yen = summary(coffees, limits, 'JPY');
    expect(yen).toMatchObject({ spent: 3, budgeted: 11, spentWithLimit: 3 });
    expect(byCategory(coffees, limits, 'JPY')[0]).toMatchObject({ spent: 3, left: 8 });
    // In dollars, as before.
    expect(summary(coffees, limits)).toMatchObject({ spent: 1.5, budgeted: 10.5 });

    const options = { currency: 'JPY', locale: 'en-US' } as const;
    const coffee = coffees[0] as Entry;
    const form = { ...toEntryForm(coffee, 'en-US'), note: 'With Ana' };
    expect(readEntry(form, 'a', null, limits, { ...options, saved: coffee }).entry).toEqual({
      ...coffee,
      note: 'With Ana',
    });
    // Changed, it's kept as yen have it.
    expect(
      readEntry({ ...form, amount: '2.4' }, 'a', null, limits, { ...options, saved: coffee }).entry
        ?.amount,
    ).toBe(2);
    // So is a limit left as it was.
    expect(readCategory({ name: 'Food', limit: '10.5' }, 'food', limits, options).category).toEqual(
      { id: 'food', name: 'Food', limit: 10.5 },
    );
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
          entry({ id: 'c', date: '2026-10-04', kind: 'refund', amount: 4.5, note: 'Sour milk' }),
        ),
        categories,
        'en-US',
      ).split('\r\n'),
    ).toEqual([
      // A byte-order mark first, for Excel (audit 3 F2-6).
      '\uFEFFDate,Type,Amount,Category,Note',
      '2026-10-04,Refund,4.5,Groceries,Sour milk',
      "2026-10-03,Income,2000,,'=pay",
      '2026-10-02,Expense,-10,Groceries,"Milk, ""fresh"""',
      '',
    ]);
  });

  // Audit 4 F2-9: Excel splits a CSV file's cells at ";" where decimals are
  // written with a comma: every row was one cell, and a ";" in a note
  // started a new one, which could be a formula.
  it('is written as a spreadsheet in the person’s language reads it', () => {
    expect(
      toCsv(
        entries(entry({ id: 'a', date: '2026-10-02', amount: 4.5, note: 'Lunch;=1+1' })),
        categories,
        'de-DE',
      ).split('\r\n'),
    ).toEqual([
      '\uFEFFDate;Type;Amount;Category;Note',
      `2026-10-02;Expense;-4,5;Groceries;"Lunch;'=1+1"`,
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

  // A page asleep over midnight looked only at the new day (audit 4 F1-11).
  it('is due when the page wakes just after midnight, from the day before', () => {
    expect(reminderDue(settings('last', '23:59'), '2026-10-31T23:58', '2026-11-01T00:02')).toBe(
      true,
    );
    expect(reminderDue(settings(1, '23:59'), '2026-11-01T23:58', '2026-11-02T00:02')).toBe(true);
    // Just after midnight on the day itself, too.
    expect(reminderDue(settings(1, '00:00'), '2026-10-31T23:58', '2026-11-01T00:02')).toBe(true);
    // Not on a day it isn't on, nor twice: the minute before was checked already.
    expect(reminderDue(settings(1, '23:59'), '2026-10-31T23:58', '2026-11-01T00:02')).toBe(false);
    expect(reminderDue(settings('last', '23:59'), '2026-10-31T23:59', '2026-11-01T00:02')).toBe(
      false,
    );
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

describe('categories added on two devices before they first sync', () => {
  beforeEach(() => pretendBrowser('https://budget.shkriuss.app'));
  afterEach(() => vi.unstubAllGlobals());

  // Audit F2-6: each "Groceries" refused any change while the other existed.
  it('can each still be changed', async () => {
    const setup = {
      key: 'budget-categories',
      version: CATEGORIES_VERSION,
      fallback: emptyCategories,
      validate: isCategoriesState,
      items: (value: CategoriesState) => value.categories,
      withItems: (value: CategoriesState, list: CategoriesState['categories']) => ({
        ...value,
        categories: list,
      }),
    };
    const secret = appSecret();
    const phone = new Device('budget', secret, setup);
    const tablet = new Device('budget', secret, setup);
    // "Add suggested categories" on each, then sync turned on.
    phone.save(addSuggested(emptyCategories(), () => crypto.randomUUID()));
    tablet.save(addSuggested(emptyCategories(), () => crypto.randomUUID()));
    await phone.syncNow();
    await tablet.syncNow();
    await phone.syncNow();
    const twins = phone.value.categories.filter((category) => category.name === 'Groceries');
    expect(twins).toHaveLength(2);
    // A monthly limit on either, as the form sets it; a new name for one.
    for (const twin of twins) {
      expect(
        readCategory({ name: 'Groceries', limit: '400' }, twin.id, phone.value).category?.limit,
      ).toBe(400);
    }
    const second = twins[1] as CategoriesState['categories'][number];
    expect(readCategory({ name: 'Food', limit: '' }, second.id, phone.value).category).toEqual({
      id: second.id,
      name: 'Food',
      limit: null,
    });
  });
});
