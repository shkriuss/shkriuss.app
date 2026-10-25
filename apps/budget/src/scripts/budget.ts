/**
 * Budget's page behaviour: connects pages/index.astro to the rules in
 * lib/budget.ts, saves on the device, and syncs the categories, entries and
 * settings when sync is on. "Delete a year…" deletes a year's entries, to
 * make room. The monthly reminder: reminders.ts.
 */
import { isIsoTime, nowStamp, today } from '@shkriuss/dates';
import { createStore, downloadFile } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import { focusProblem, reportSave } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { typedText } from '@shkriuss/ui/typed-text';
import { site } from 'virtual:shkriuss/site';
import {
  addSuggested,
  byCategory,
  CURRENCIES,
  currencyOf,
  dayLabel,
  emptyCategories,
  emptyEntries,
  emptySettings,
  entriesCount,
  entriesIn,
  CATEGORIES_VERSION,
  ENTRIES_VERSION,
  entryYears,
  formatMoney,
  hasCategory,
  isCategoriesState,
  isEntriesState,
  isSettingsState,
  KINDS,
  migrateEntries,
  monthLabel,
  monthOf,
  nextReminder,
  readCategory,
  readEntry,
  removeCategory,
  removeEntry,
  removeYear,
  REMINDER_DAYS,
  reminderOf,
  reminderSentence,
  roomNote,
  saveCategory,
  saveEntry,
  setCurrency,
  setReminder,
  shiftMonth,
  suggestedDay,
  summary,
  toCsv,
  toEntryForm,
  whenLabel,
  withSettings,
  type CategoriesState,
  type Category,
  type CategoryTotal,
  type EntriesState,
  type Entry,
  type Kind,
  type Reminder,
  type SettingsState,
} from '../lib/budget.ts';
import { mountReminders } from './reminders.ts';
import { required, showFieldProblems } from '@shkriuss/ui/dom';

const categoriesStore = createStore<CategoriesState>({
  key: 'budget-categories',
  version: CATEGORIES_VERSION,
  fallback: emptyCategories,
  validate: isCategoriesState,
});

const entriesStore = createStore<EntriesState>({
  key: 'budget',
  version: ENTRIES_VERSION,
  fallback: emptyEntries,
  validate: isEntriesState,
  migrate: migrateEntries,
});

const settingsStore = createStore<SettingsState>({
  key: 'budget-settings',
  version: 1,
  fallback: emptySettings,
  validate: isSettingsState,
});

/** Green for money in, red for money over. */
function tone(element: Element, amount: number): void {
  element.classList.toggle('win', amount > 0);
  element.classList.toggle('loss', amount < 0);
}

/** Shows a form's problems; focuses the first. Returns true if there are any. */
const showProblems = (
  form: HTMLFormElement,
  names: readonly string[],
  problems: Partial<Record<string, string>>,
): boolean => showFieldProblems(form, names, problems, { focusFirst: true });

export function mountBudget(root: Document): void {
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const monthHeading = required<HTMLElement>(root, '[data-month-heading]');
  const thisMonthButton = required<HTMLButtonElement>(root, '[data-action="this-month"]');
  const spentText = required<HTMLElement>(root, '[data-spent]');
  const incomeText = required<HTMLElement>(root, '[data-income]');
  const leftText = required<HTMLElement>(root, '[data-left]');
  const budgetLine = required<HTMLElement>(root, '[data-budget-line]');
  const budgetProgress = required<HTMLProgressElement>(root, '[data-budget-progress]');
  const budgetText = required<HTMLElement>(root, '[data-budget-text]');
  const addExpense = required<HTMLButtonElement>(root, '[data-action="add-expense"]');
  const noCategories = required<HTMLElement>(root, '[data-no-categories]');
  const categoryList = required<HTMLUListElement>(root, '[data-categories]');
  const newCategoryButton = required<HTMLButtonElement>(root, '[data-action="new-category"]');
  const noEntries = required<HTMLElement>(root, '[data-no-entries]');
  const entryList = required<HTMLUListElement>(root, '[data-entries]');
  const currencySelect = required<HTMLSelectElement>(root, '[data-currency]');
  const reminderOn = required<HTMLInputElement>(root, '[data-reminder-on]');
  const reminderDay = required<HTMLSelectElement>(root, '[data-reminder="day"]');
  const reminderTime = required<HTMLInputElement>(root, '[data-reminder="time"]');
  const csvStatus = required<HTMLElement>(root, '[data-csv-status]');
  const deleteYearButton = required<HTMLButtonElement>(root, '[data-action="delete-year"]');
  const roomText = required<HTMLElement>(root, '[data-room-note]');
  const reminderError = required<HTMLElement>(root, '[data-reminder-error]');
  const reminderNext = required<HTMLElement>(root, '[data-reminder-next]');
  const categoryTemplate = required<HTMLTemplateElement>(root, '[data-category-template]');
  const entryTemplate = required<HTMLTemplateElement>(root, '[data-entry-template]');

  const entryDialog = required<HTMLDialogElement>(root, '[data-entry-dialog]');
  const entryForm = required<HTMLFormElement>(entryDialog, '[data-entry-form]');
  const entryTitle = required<HTMLElement>(entryDialog, '[data-entry-title]');
  const categoryField = required<HTMLElement>(entryForm, '[data-category-field]');
  const categorySelect = required<HTMLSelectElement>(entryForm, '[data-category-select]');
  const categoryDialog = required<HTMLDialogElement>(root, '[data-category-dialog]');
  const categoryForm = required<HTMLFormElement>(categoryDialog, '[data-category-form]');
  const categoryTitle = required<HTMLElement>(categoryDialog, '[data-category-title]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteTitle = required<HTMLElement>(deleteDialog, '[data-delete-title]');
  const deleteText = required<HTMLElement>(deleteDialog, '[data-delete-text]');
  const yearDialog = required<HTMLDialogElement>(root, '[data-year-dialog]');
  const yearForm = required<HTMLFormElement>(yearDialog, '[data-year-form]');
  const yearSelect = required<HTMLSelectElement>(yearForm, '[data-year-select]');
  const yearText = required<HTMLElement>(yearForm, '[data-year-text]');
  const yearConfirm = required<HTMLElement>(yearForm, '[data-year-confirm]');

  let categories = categoriesStore.load();
  let entries = entriesStore.load();
  let settings = settingsStore.load();
  let month = monthOf(today());
  /** What's in the forms: the entry or category being changed (null: a new one). */
  let editingEntry: string | null = null;
  let editingCategory: string | null = null;
  let deleting: { type: 'entry' | 'category'; id: string } | null = null;

  const announce = (message: string): void => {
    announcer.textContent = message;
  };
  const money = (amount: number, signed = false) =>
    formatMoney(amount, currencyOf(settings), { signed });
  const findEntry = (id: string | null | undefined) =>
    entries.entries.find((entry) => entry.id === id);
  const findCategory = (id: string | null | undefined) =>
    categories.categories.find((category) => category.id === id);
  /** "Income", or an expense's or a refund's category. */
  const categoryName = (entry: Entry) =>
    entry.kind === 'income' ? 'Income' : (findCategory(entry.category)?.name ?? 'No category');

  /** Saves, shows the change, and tells other devices. */
  function save(
    next: { categories?: CategoriesState; entries?: EntriesState; settings?: SettingsState },
    message: string,
  ): void {
    let ok = true;
    if (next.categories) {
      categories = next.categories;
      ok = categoriesStore.save(categories) && ok;
    }
    if (next.entries) {
      entries = next.entries;
      ok = entriesStore.save(entries) && ok;
    }
    if (next.settings) {
      settings = next.settings;
      ok = settingsStore.save(settings) && ok;
    }
    if (reportSave(ok)) announce(message);
    render();
    if (next.settings) reminders.changed();
    sync.changed();
  }

  // ---------- Showing it ----------

  function renderCategory(total: CategoryTotal): HTMLLIElement {
    const fragment = categoryTemplate.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    const nameButton = required<HTMLButtonElement>(item, '[data-action="edit-category"]');
    const { category, spent, left } = total;
    if (category) {
      item.dataset['id'] = category.id;
      nameButton.textContent = category.name;
    } else {
      const name = document.createElement('span');
      name.className = 'category__name';
      name.textContent = 'No category';
      nameButton.replaceWith(name);
    }
    required<HTMLElement>(item, '[data-spent]').textContent = money(spent);
    const progress = required<HTMLProgressElement>(item, '[data-progress]');
    const note = required<HTMLElement>(item, '[data-note]');
    if (category?.limit != null && left !== null) {
      progress.max = category.limit;
      progress.value = Math.min(spent, category.limit);
      note.textContent =
        left >= 0
          ? `${money(left)} left of ${money(category.limit)}`
          : `${money(-left)} over the ${money(category.limit)} limit`;
      item.classList.toggle('category--over', left < 0);
    } else {
      progress.remove();
      note.textContent = category ? 'No limit' : 'Expenses without a category';
    }
    return item;
  }

  function renderEntry(entry: Entry): HTMLLIElement {
    const fragment = entryTemplate.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    item.dataset['id'] = entry.id;
    const title = required<HTMLElement>(item, '[data-title]');
    // A refund says so, before its category (which keeps its own direction).
    if (entry.kind === 'refund') title.append('Refund · ', typedText(categoryName(entry)));
    else title.textContent = categoryName(entry);
    const meta = required<HTMLElement>(item, '[data-meta]');
    meta.textContent = dayLabel(entry.date);
    if (entry.note) meta.append(' · ', typedText(entry.note));
    const amount = required<HTMLElement>(item, '[data-amount]');
    // Money in (income, and refunds) is positive.
    const signed = entry.kind === 'expense' ? -entry.amount : entry.amount;
    amount.textContent = money(signed, true);
    if (entry.kind !== 'expense') tone(amount, signed);
    return item;
  }

  function render(): void {
    const current = monthOf(today());
    monthHeading.textContent = monthLabel(month);
    thisMonthButton.hidden = month === current;
    const room = roomNote(entries.entries.length);
    roomText.hidden = room === null;
    roomText.textContent = room ?? '';

    const monthEntries = entriesIn(entries, month);
    const totals = summary(monthEntries, categories);
    spentText.textContent = money(totals.spent);
    incomeText.textContent = money(totals.income);
    leftText.textContent = money(totals.left, true);
    tone(leftText, totals.left);
    budgetLine.hidden = totals.budgeted === null;
    if (totals.budgeted !== null) {
      budgetProgress.max = totals.budgeted;
      budgetProgress.value = Math.min(totals.spent, totals.budgeted);
      const rest = totals.budgeted - totals.spent;
      budgetLine.classList.toggle('total--over', rest < 0);
      budgetText.textContent =
        rest >= 0
          ? `${money(rest)} left of the ${money(totals.budgeted)} budgeted`
          : `${money(-rest)} over the ${money(totals.budgeted)} budgeted`;
    }

    noCategories.hidden = categories.categories.length > 0;
    categoryList.replaceChildren(...byCategory(monthEntries, categories).map(renderCategory));
    noEntries.hidden = monthEntries.length > 0;
    entryList.replaceChildren(...monthEntries.map(renderEntry));
    currencySelect.value = currencyOf(settings);
    renderReminder();
  }

  function renderReminder(): void {
    const reminder = reminderOf(settings);
    reminderOn.checked = reminder.on;
    if (reminderDay !== root.activeElement) reminderDay.value = String(reminder.day);
    if (reminderTime !== root.activeElement) {
      reminderTime.value = reminder.time;
      reminderError.textContent = '';
      reminderTime.removeAttribute('aria-invalid');
    }
    const next = nextReminder(settings, nowStamp());
    reminderNext.hidden = next === null;
    reminderNext.textContent = next ? `Next reminder: ${whenLabel(next)}.` : '';
  }

  /** After saving: focus a button in the list, or `fallback` if it isn't shown. */
  function focusItem(list: HTMLElement, id: string, fallback: HTMLElement): void {
    const button = list.querySelector<HTMLElement>(`li[data-id="${CSS.escape(id)}"] button`);
    (button ?? fallback).focus();
  }

  // ---------- Entries ----------

  const kindOf = (): Kind =>
    KINDS.find((kind) => kind === (entryForm.elements.namedItem('kind') as RadioNodeList).value) ??
    'expense';

  /** The form's title: what it adds (it follows the type chosen), or "Change entry". */
  function showTitle(): void {
    const adding = { expense: 'Add expense', income: 'Add income', refund: 'Add refund' };
    entryTitle.textContent = editingEntry ? 'Change entry' : adding[kindOf()];
  }

  function showCategoryField(): void {
    categoryField.hidden = !hasCategory(kindOf());
  }

  function openEntry(entry: Entry | undefined, kind: Kind = 'expense'): void {
    editingEntry = entry?.id ?? null;
    const values = entry
      ? toEntryForm(entry)
      : { kind, amount: '', date: suggestedDay(month, today()), category: '', note: '' };
    categorySelect.replaceChildren(
      new Option('No category', ''),
      ...categories.categories.map((category) => new Option(category.name, category.id)),
    );
    for (const [name, value] of Object.entries(values)) {
      (entryForm.elements.namedItem(name) as { value: string }).value = value;
    }
    required<HTMLElement>(entryForm, '[data-action="delete-entry"]').hidden = !entry;
    showProblems(entryForm, ['kind', 'amount', 'date', 'note'], {});
    showTitle();
    showCategoryField();
    entryDialog.showModal();
    // The amount first: the type is already chosen by the button tapped.
    (entryForm.elements.namedItem('amount') as HTMLInputElement).focus();
  }

  entryForm.addEventListener('change', (event) => {
    if ((event.target as HTMLInputElement).name !== 'kind') return;
    showTitle();
    showCategoryField();
  });

  entryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = (name: string) => (entryForm.elements.namedItem(name) as { value: string }).value;
    const read = readEntry(
      {
        kind: kindOf(),
        amount: value('amount'),
        date: value('date'),
        category: value('category'),
        note: value('note'),
      },
      editingEntry ?? crypto.randomUUID(),
      entries.entries.length - (editingEntry ? 1 : 0),
      categories,
    );
    if (!read.entry) {
      showProblems(entryForm, ['kind', 'amount', 'date', 'note'], read.problems);
      return;
    }
    const { entry } = read;
    entryDialog.close();
    // Show the month it's in.
    const moved = monthOf(entry.date) !== month;
    month = monthOf(entry.date);
    const what =
      entry.kind === 'income'
        ? `Saved ${money(entry.amount)} income`
        : entry.kind === 'refund'
          ? `Saved a ${money(entry.amount)} refund on ${categoryName(entry)}`
          : `Saved ${money(entry.amount)} on ${categoryName(entry)}`;
    save(
      { entries: saveEntry(entries, entry) },
      moved ? `${what}, in ${monthLabel(month)}.` : `${what}.`,
    );
    focusItem(entryList, entry.id, addExpense);
  });

  // ---------- Categories ----------

  function openCategory(category: Category | undefined): void {
    editingCategory = category?.id ?? null;
    categoryTitle.textContent = category ? 'Change category' : 'New category';
    (categoryForm.elements.namedItem('name') as HTMLInputElement).value = category?.name ?? '';
    (categoryForm.elements.namedItem('limit') as HTMLInputElement).value =
      category?.limit == null ? '' : String(category.limit);
    required<HTMLElement>(categoryForm, '[data-action="delete-category"]').hidden = !category;
    showProblems(categoryForm, ['name', 'limit'], {});
    categoryDialog.showModal();
  }

  categoryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const read = readCategory(
      {
        name: (categoryForm.elements.namedItem('name') as HTMLInputElement).value,
        limit: (categoryForm.elements.namedItem('limit') as HTMLInputElement).value,
      },
      editingCategory ?? crypto.randomUUID(),
      categories,
    );
    if (!read.category) {
      showProblems(categoryForm, ['name', 'limit'], read.problems);
      return;
    }
    const { category } = read;
    categoryDialog.close();
    save({ categories: saveCategory(categories, category) }, `Saved ${category.name}.`);
    focusItem(categoryList, category.id, newCategoryButton);
  });

  // ---------- Deleting ----------

  function askToDelete(type: 'entry' | 'category'): void {
    if (type === 'entry') {
      const entry = findEntry(editingEntry);
      if (!entry) return;
      deleting = { type, id: entry.id };
      deleteTitle.textContent = 'Delete this entry?';
      const refund = entry.kind === 'refund' ? ' refund' : '';
      deleteText.textContent = `${money(entry.amount)}${refund} (${categoryName(entry)}, ${dayLabel(entry.date)}) will be removed.`;
    } else {
      const category = findCategory(editingCategory);
      if (!category) return;
      deleting = { type, id: category.id };
      deleteTitle.textContent = 'Delete this category?';
      deleteText.textContent = `“${category.name}” will be removed. Its expenses stay, under “No category”.`;
    }
    deleteDialog.returnValue = '';
    deleteDialog.showModal();
  }

  deleteDialog.addEventListener('close', () => {
    const target = deleting;
    deleting = null;
    if (deleteDialog.returnValue !== 'confirm' || !target) return;
    if (target.type === 'entry') {
      const entry = findEntry(target.id);
      entryDialog.close();
      if (!entry) return;
      save({ entries: removeEntry(entries, entry.id) }, `Deleted the entry.`);
      addExpense.focus();
    } else {
      const category = findCategory(target.id);
      categoryDialog.close();
      if (!category) return;
      save({ categories: removeCategory(categories, category.id) }, `Deleted ${category.name}.`);
      newCategoryButton.focus();
    }
  });

  // ---------- Deleting a year ----------

  /** How many entries the year chosen has (0 if it has none now). */
  const yearCount = (year: string) =>
    entryYears(entries).find((entry) => entry.year === year)?.count ?? 0;

  /** Says what deleting the year chosen removes. */
  function showYear(): void {
    const year = yearSelect.value;
    const count = entriesCount(yearCount(year));
    yearText.textContent = `The ${count} from ${year} will be deleted: expenses, income and refunds. With sync on, they’re deleted on your other devices too. This can’t be undone.`;
    yearConfirm.textContent = `Delete ${count}`;
  }

  /** The years with entries to choose from (the year chosen stays chosen while it has any). */
  function fillYears(): void {
    const chosen = yearSelect.value;
    const years = entryYears(entries);
    yearSelect.replaceChildren(
      ...years.map(({ year, count }) => new Option(`${year} (${entriesCount(count)})`, year)),
    );
    // Else the first, the earliest year: the oldest entries are the likeliest to go.
    if (years.some(({ year }) => year === chosen)) yearSelect.value = chosen;
    showYear();
  }

  function openYears(): void {
    if (entries.entries.length === 0) {
      csvStatus.textContent = 'There are no entries to delete.';
      return;
    }
    yearSelect.replaceChildren();
    fillYears();
    required<HTMLElement>(yearForm, '[data-csv-status]').textContent = '';
    yearDialog.showModal();
    yearSelect.focus();
  }

  yearSelect.addEventListener('change', showYear);

  yearForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const year = yearSelect.value;
    const count = yearCount(year);
    yearDialog.close();
    deleteYearButton.focus();
    if (count === 0) return;
    // Like deleting entries one by one, so other devices delete them too.
    save({ entries: removeYear(entries, year) }, `Deleted ${entriesCount(count)} from ${year}.`);
  });

  // ---------- Everything else ----------

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-action]');
    const action = button?.dataset['action'];
    const id = button?.closest<HTMLElement>('li[data-id]')?.dataset['id'];
    switch (action) {
      case 'previous-month':
      case 'next-month':
        month = shiftMonth(month, action === 'previous-month' ? -1 : 1);
        render();
        announce(monthLabel(month));
        break;
      case 'this-month':
        month = monthOf(today());
        render();
        monthHeading.focus();
        break;
      case 'add-expense':
      case 'add-income':
        openEntry(undefined, action === 'add-income' ? 'income' : 'expense');
        break;
      case 'edit-entry':
        openEntry(findEntry(id));
        break;
      case 'new-category':
        openCategory(undefined);
        break;
      case 'edit-category':
        openCategory(findCategory(id));
        break;
      case 'suggested': {
        const before = categories.categories.length;
        const next = addSuggested(categories, () => crypto.randomUUID());
        save({ categories: next }, `Added ${next.categories.length - before} categories.`);
        categoryList.querySelector<HTMLElement>('button')?.focus();
        break;
      }
      case 'cancel':
        button?.closest('dialog')?.close();
        break;
      case 'delete-entry':
        askToDelete('entry');
        break;
      case 'delete-category':
        askToDelete('category');
        break;
      case 'delete-year':
        openYears();
        break;
      case 'csv': {
        // The answer shows under the button tapped (and is read out).
        const status =
          button?.closest('dialog, section')?.querySelector<HTMLElement>('[data-csv-status]') ??
          csvStatus;
        if (entries.entries.length === 0) {
          status.textContent = 'There’s nothing to download yet.';
          break;
        }
        downloadFile(`budget-${today()}.csv`, toCsv(entries, categories), 'text/csv');
        status.textContent = 'Downloaded your budget as a spreadsheet.';
        break;
      }
    }
  });

  entryDialog.addEventListener('close', () => {
    editingEntry = null;
  });
  categoryDialog.addEventListener('close', () => {
    editingCategory = null;
  });

  currencySelect.addEventListener('change', () => {
    const chosen = CURRENCIES.find((entry) => entry === currencySelect.value);
    if (!chosen || chosen === currencyOf(settings)) return;
    save({ settings: setCurrency(settings, chosen) }, `Amounts are shown in ${chosen} now.`);
  });

  // ---------- The monthly reminder ----------

  function commitReminder(): void {
    const time = reminderTime.value;
    const wrong = !isIsoTime(time);
    reminderError.textContent = wrong ? 'Choose a time for the reminder.' : '';
    if (wrong) reminderTime.setAttribute('aria-invalid', 'true');
    else reminderTime.removeAttribute('aria-invalid');
    if (wrong) {
      // Changed while in the field: read the problem out (focus stays there).
      if (root.activeElement === reminderTime) focusProblem(reminderTime);
      return;
    }
    const next: Reminder = {
      on: reminderOn.checked,
      day: REMINDER_DAYS.find((day) => String(day) === reminderDay.value) ?? 1,
      time,
    };
    if (JSON.stringify(reminderOf(settings)) === JSON.stringify(next)) return;
    save({ settings: setReminder(settings, next) }, reminderSentence(next));
    if (next.on) reminders.offerNotifications();
  }

  for (const control of [reminderOn, reminderDay, reminderTime]) {
    control.addEventListener('change', commitReminder);
  }

  // ---------- Keeping up ----------

  function reload(): void {
    categories = categoriesStore.load();
    entries = entriesStore.load();
    settings = settingsStore.load();
    // What's being changed was deleted on another device or tab.
    if (editingEntry !== null && !findEntry(editingEntry)) entryDialog.close();
    if (editingCategory !== null && !findCategory(editingCategory)) categoryDialog.close();
    if (yearDialog.open) {
      if (entries.entries.length === 0) yearDialog.close();
      else fillYears();
    }
    keepFocus(render, addExpense);
    reminders.changed();
  }

  // "This month" moves on with the calendar. The lists are drawn again only
  // in a new month, as that moves keyboard focus (audit G-3).
  let shownMonth = monthOf(today());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    renderReminder();
    if (monthOf(today()) === shownMonth) return;
    shownMonth = monthOf(today());
    keepFocus(render, addExpense);
  });

  // If Budget is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    const keys = [categoriesStore.key, entriesStore.key, settingsStore.key];
    if (event.key !== null && keys.includes(event.key)) reload();
  });

  // Sync between devices through the shkriuss account (if turned on). The
  // newest change to each entry, category and setting wins (an entry changed
  // on two devices at once isn't kept twice: that would count it twice).
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store: categoriesStore,
        items: (value) => value.categories,
        withItems: (value, list) => ({ ...value, categories: list }),
      }),
      syncedStore({
        store: entriesStore,
        items: (value) => value.entries,
        withItems: (value, list) => ({ ...value, entries: list }),
      }),
      syncedStore({
        store: settingsStore,
        items: (value) => value.settings,
        withItems: (_value, items) => withSettings(items),
      }),
    ],
    onChange: reload,
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  const reminders = mountReminders(root, { settings: () => settings, announce });

  render();
}
