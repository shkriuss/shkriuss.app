/**
 * Budget's page behaviour: connects pages/index.astro to the rules in
 * lib/budget.ts, saves on the device, and syncs the categories, entries and
 * settings when sync is on. Here: the month shown, its totals and lists,
 * the settings, the spreadsheet, and keeping up with other devices and
 * tabs. The forms (an entry, a category, "Delete this?") are in forms.ts,
 * and "Delete a year…", which deletes a year's entries to make room, in
 * delete-year.ts: each loads after the page, once it has nothing else to
 * do (later()), so opening Budget loads less (audit 5 J-2). The monthly
 * reminder: reminders.ts.
 */
import { isIsoTime, monthOf, nowStamp, today } from '@shkriuss/dates';
import { createStore, downloadFile } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import { focusProblem, RELOAD_TO_UPDATE, reportSave, showProblem } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { typedText } from '@shkriuss/ui/typed-text';
import { site } from 'virtual:shkriuss/site';
import {
  addSuggested,
  budgetLine,
  byCategory,
  CURRENCIES,
  currencyOf,
  dayLabel,
  emptyCategories,
  emptyEntries,
  emptySettings,
  entriesIn,
  CATEGORIES_VERSION,
  ENTRIES_VERSION,
  formatMoney,
  isCategoriesState,
  isEntriesState,
  isSettingsState,
  migrateEntries,
  monthLabel,
  nextReminder,
  REMINDER_DAYS,
  reminderOf,
  reminderSentence,
  roomNote,
  setCurrency,
  setReminder,
  shiftMonth,
  summary,
  toCsv,
  whenLabel,
  withSettings,
  type CategoriesState,
  type CategoryTotal,
  type EntriesState,
  type Entry,
  type Reminder,
  type SettingsState,
} from '../lib/budget.ts';
import { mountReminders } from './reminders.ts';
import { required } from '@shkriuss/ui/dom';
import type { DeleteYear } from './delete-year.ts';
import type { Forms } from './forms.ts';

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

/** A part of the page that loads after the page itself (later()). */
interface Later<T> {
  /** The part, once loaded. Before, it was never opened: nothing in it needs keeping up. */
  readonly now: T | null;
  /** Starts loading the part, without doing anything with it yet. */
  load(): void;
  /** Loads the part if need be, then does `act` with it (while loading, only the last asked). */
  use(act: (part: T) => void): void;
}

/**
 * A part of the page loaded with import() after the page itself: the forms
 * and "Delete a year…". Opening the page then loads less, and stays within
 * its size budget, as Repairs' parts do (audit 4 J-6, audit 5 J-2).
 */
function later<T>(load: () => Promise<T>): Later<T> {
  let now: T | null = null;
  let loading: Promise<void> | null = null;
  let next: ((part: T) => void) | null = null;
  const start = (): void => {
    loading ??= load().then(
      (part) => {
        now = part;
        next?.(part);
        next = null;
      },
      () => {
        // The next tap tries again. Said only when a tap is waiting for it.
        loading = null;
        if (next === null) return;
        next = null;
        showProblem(`Budget couldn’t open that. ${RELOAD_TO_UPDATE}`);
      },
    );
  };
  return {
    get now() {
      return now;
    },
    load: start,
    use(act) {
      if (now) {
        act(now);
        return;
      }
      next = act;
      start();
    },
  };
}

/** Runs `task` once the page has nothing else to do (soon after it opened). */
function whenIdle(task: () => void): void {
  // Safari has no requestIdleCallback: a moment after loading will do.
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout: 2000 });
  } else window.setTimeout(task, 500);
}

export function mountBudget(root: Document): void {
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const monthHeading = required<HTMLElement>(root, '[data-month-heading]');
  const thisMonthButton = required<HTMLButtonElement>(root, '[data-action="this-month"]');
  const spentText = required<HTMLElement>(root, '[data-spent]');
  const incomeText = required<HTMLElement>(root, '[data-income]');
  const leftText = required<HTMLElement>(root, '[data-left]');
  const budgetRow = required<HTMLElement>(root, '[data-budget-line]');
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
  const roomText = required<HTMLElement>(root, '[data-room-note]');
  const reminderError = required<HTMLElement>(root, '[data-reminder-error]');
  const reminderNext = required<HTMLElement>(root, '[data-reminder-next]');
  const categoryTemplate = required<HTMLTemplateElement>(root, '[data-category-template]');
  const entryTemplate = required<HTMLTemplateElement>(root, '[data-entry-template]');

  let categories = categoriesStore.load();
  let entries = entriesStore.load();
  let settings = settingsStore.load();
  let month = monthOf(today());

  /**
   * Puts a message in a status line, the same message again too (a second
   * "Downloaded…"): a screen reader reads a status line only when it
   * changes, so then a no-break space, which can't be heard, goes on the
   * end (audit 5 G-8).
   */
  const say = (line: HTMLElement, message: string): void => {
    line.textContent = line.textContent === message ? `${message} ` : message;
  };
  const announce = (message: string): void => say(announcer, message);
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
    const totals = summary(monthEntries, categories, currencyOf(settings));
    spentText.textContent = money(totals.spent);
    incomeText.textContent = money(totals.income);
    leftText.textContent = money(totals.left, true);
    tone(leftText, totals.left);
    // Spending in the categories that have a limit, against the limits.
    const line = budgetLine(totals, currencyOf(settings));
    budgetRow.hidden = line === null;
    if (line && totals.budgeted !== null) {
      budgetProgress.max = totals.budgeted;
      budgetProgress.value = Math.min(totals.spentWithLimit, totals.budgeted);
      budgetRow.classList.toggle('total--over', line.over);
      budgetText.textContent = line.text;
    }

    noCategories.hidden = categories.categories.length > 0;
    categoryList.replaceChildren(
      ...byCategory(monthEntries, categories, currencyOf(settings)).map(renderCategory),
    );
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

  // ---------- The forms: forms.ts; "Delete a year…": delete-year.ts ----------

  const forms = later<Forms>(() =>
    import('./forms.ts').then(({ mountForms }) =>
      mountForms(root, {
        data: () => ({ categories, entries, settings }),
        month: () => month,
        showMonth(shown) {
          month = shown;
        },
        save,
        focusEntry: (id) => focusItem(entryList, id, addExpense),
        focusCategory: (id) => focusItem(categoryList, id, newCategoryButton),
      }),
    ),
  );

  const yearDeleter = later<DeleteYear>(() =>
    import('./delete-year.ts').then(({ mountDeleteYear }) =>
      mountDeleteYear(root, { entries: () => entries, save, say }),
    ),
  );

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
        forms.use((form) => form.openEntry(undefined, action === 'add-income' ? 'income' : 'expense'));
        break;
      case 'edit-entry':
        // As it is once the form has loaded.
        forms.use((form) => {
          const entry = findEntry(id);
          if (entry) form.openEntry(entry);
        });
        break;
      case 'new-category':
        forms.use((form) => form.openCategory(undefined));
        break;
      case 'edit-category':
        forms.use((form) => {
          const category = findCategory(id);
          if (category) form.openCategory(category);
        });
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
        forms.now?.askToDelete('entry');
        break;
      case 'delete-category':
        forms.now?.askToDelete('category');
        break;
      case 'delete-year':
        yearDeleter.use((deleter) => deleter.open());
        break;
      case 'csv': {
        // The answer shows under the button tapped (and is read out).
        const status =
          button?.closest('dialog, section')?.querySelector<HTMLElement>('[data-csv-status]') ??
          csvStatus;
        if (entries.entries.length === 0) {
          say(status, 'There’s nothing to download yet.');
          break;
        }
        downloadFile(`budget-${today()}.csv`, toCsv(entries, categories), 'text/csv');
        say(status, 'Downloaded your budget as a spreadsheet.');
        break;
      }
    }
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
    // A form whose entry or category was deleted there closes and says why
    // (audit 3 G-6); "Delete a year…" follows the year chosen (audit 4 F2-1).
    forms.now?.refresh();
    yearDeleter.now?.refresh();
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
  // The parts that load later load now, while nothing else goes on, so a
  // tap finds them here and opens the form at once, within the tap: an
  // iPhone raises its keyboard only for a field focused then (audit 4 J-6).
  whenIdle(() => {
    for (const part of [forms, yearDeleter]) part.load();
  });
}
