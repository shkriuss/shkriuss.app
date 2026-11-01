/**
 * Habits' page behaviour: connects pages/index.astro to the rules in
 * lib/habits.ts, saves on the device, and syncs both lists (habits and check
 * marks) when sync is on. "Delete check marks from a year…" deletes a year's
 * check marks, to make room. Reminders: reminders.ts.
 */
import { addDays, firstDayOfWeek, isIsoTime, today, weekday, type IsoDate } from '@shkriuss/dates';
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import { onNewDay } from '@shkriuss/ui/new-day';
import { clearProblem, focusProblem, reportSave, showProblem } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { watchTextLimit, watchTextLimits } from '@shkriuss/ui/text-limit';
import { site } from 'virtual:shkriuss/site';
import {
  addHabit,
  bestStreak,
  CHECKS_VERSION,
  checksCount,
  checksProblem,
  checkYears,
  currentStreak,
  dayLabel,
  doneDates,
  EDITABLE_DAYS,
  editHabit,
  emptyChecks,
  emptyHabits,
  HABITS_VERSION,
  isChecksState,
  isHabitsState,
  isPlanned,
  nameError,
  recentDays,
  removeHabit,
  removeYear,
  roomNote,
  scheduleLabel,
  setDone,
  streakLabel,
  timeLabel,
  weekdayName,
  weekOrder,
  type ChecksState,
  type Habit,
  type HabitDraft,
  type HabitsState,
} from '../lib/habits.ts';
import { mountReminders } from './reminders.ts';
import { DATE_LOCALE } from '@shkriuss/ui/locale';
import { required } from '@shkriuss/ui/dom';

const habitsStore = createStore<HabitsState>({
  key: 'habits',
  version: HABITS_VERSION,
  fallback: emptyHabits,
  validate: isHabitsState,
});

const checksStore = createStore<ChecksState>({
  key: 'habit-checks',
  version: CHECKS_VERSION,
  fallback: emptyChecks,
  validate: isChecksState,
});

/** A new reminder starts at this time (it can be changed straight away). */
const DEFAULT_REMINDER = '20:00';

const dateFormat = new Intl.DateTimeFormat(DATE_LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

const dateOf = (date: IsoDate): number => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
};

export function mountHabits(root: Document): void {
  const form = required<HTMLFormElement>(root, '[data-add-form]');
  const input = required<HTMLInputElement>(form, 'input[name="name"]');
  const error = required<HTMLElement>(form, '[data-error-for="name"]');
  const todayText = required<HTMLElement>(root, '[data-today]');
  const list = required<HTMLUListElement>(root, '[data-habits]');
  const empty = required<HTMLElement>(root, '[data-empty]');
  const habitTemplate = required<HTMLTemplateElement>(root, '[data-habit-template]');
  const dayTemplate = required<HTMLTemplateElement>(root, '[data-day-template]');
  const checkTemplate = required<HTMLTemplateElement>(root, '[data-check-template]');
  const announcer = required<HTMLElement>(root, '[data-announcer]');

  const editDialog = required<HTMLDialogElement>(root, '[data-edit-dialog]');
  const editForm = required<HTMLFormElement>(editDialog, '[data-edit-form]');
  const editName = required<HTMLInputElement>(editForm, 'input[name="name"]');
  const nameErrorText = required<HTMLElement>(editForm, '[data-error-for="name"]');
  const daysErrorText = required<HTMLElement>(editForm, '[data-error-for="days"]');
  const remindBox = required<HTMLInputElement>(editForm, 'input[name="remind"]');
  const reminderField = required<HTMLElement>(editForm, '[data-reminder-field]');
  const reminderInput = required<HTMLInputElement>(editForm, 'input[name="reminder"]');
  const reminderErrorText = required<HTMLElement>(editForm, '[data-error-for="reminder"]');
  const dayChecks = required<HTMLElement>(editForm, '[data-day-checks]');
  const pastDays = required<HTMLElement>(editForm, '[data-past-days]');
  const pastErrorText = required<HTMLElement>(editForm, '[data-error-for="past"]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteName = required<HTMLElement>(deleteDialog, '[data-delete-name]');
  const roomText = required<HTMLElement>(root, '[data-room-note]');
  const deleteYearButton = required<HTMLButtonElement>(root, '[data-action="delete-year"]');
  const yearStatus = required<HTMLElement>(root, '[data-year-status]');
  const yearDialog = required<HTMLDialogElement>(root, '[data-year-dialog]');
  const yearForm = required<HTMLFormElement>(yearDialog, '[data-year-form]');
  const yearSelect = required<HTMLSelectElement>(yearForm, '[data-year-select]');
  const yearText = required<HTMLElement>(yearForm, '[data-year-text]');
  const yearConfirm = required<HTMLElement>(yearForm, '[data-year-confirm]');

  // A paste longer than a box takes is cut by the browser: say so (audit 5 F1-4).
  const addLimit = watchTextLimit(input);
  const editLimits = watchTextLimits(editForm);

  const weekStart = firstDayOfWeek(navigator.language);
  let habits = habitsStore.load();
  let checks = checksStore.load();
  let day = today();
  /** The habit in the edit dialog. */
  let editing: string | null = null;
  /** The edit form as it opened, to tell what the person changed (see editHabit). */
  let opened: HabitDraft | null = null;
  /** "Habits is full", shown when a check mark couldn't be added; taken away once one is. */
  let full: string | null = null;

  const announce = (message: string): void => {
    announcer.textContent = message;
  };
  const find = (id: string | null | undefined): Habit | undefined =>
    habits.habits.find((habit) => habit.id === id);

  /** Saves and shows the change; false (and the person is told) if it couldn't be saved. */
  function save(next: { habits?: HabitsState; checks?: ChecksState }): boolean {
    let ok = true;
    if (next.habits) {
      habits = next.habits;
      ok = habitsStore.save(habits) && ok;
    }
    if (next.checks) {
      checks = next.checks;
      ok = checksStore.save(checks) && ok;
    }
    const saved = reportSave(ok);
    if (saved && full !== null && !checksProblem(checks)) {
      clearProblem(full);
      full = null;
    }
    render();
    reminders.changed();
    sync.changed();
    return saved;
  }

  // ---------- The list ----------

  function renderDay(date: IsoDate, planned: boolean, done: boolean): HTMLElement {
    const fragment = dayTemplate.content.cloneNode(true) as DocumentFragment;
    const cell = required<HTMLElement>(fragment, '.day');
    required<HTMLElement>(cell, '[data-day-name]').textContent = weekdayName(
      weekday(date),
      'narrow',
    );
    cell.classList.toggle('day--done', done);
    cell.classList.toggle('day--off', !planned && !done);
    cell.classList.toggle('day--today', date === day);
    return cell;
  }

  function renderHabit(habit: Habit): HTMLLIElement {
    const fragment = habitTemplate.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    item.dataset['id'] = habit.id;
    const done = doneDates(checks, habit.id);
    const doneToday = done.has(day);

    required<HTMLElement>(item, '[data-name]').textContent = habit.name;
    required<HTMLElement>(item, '[data-schedule]').textContent = scheduleLabel(
      habit.days,
      weekStart,
    );
    const reminder = required<HTMLElement>(item, '[data-reminder]');
    reminder.hidden = !habit.reminder;
    if (habit.reminder) {
      required<HTMLElement>(reminder, '[data-reminder-time]').textContent =
        `Reminder at ${timeLabel(habit.reminder)}`;
    }
    required<HTMLElement>(item, '[data-action="edit"]').setAttribute(
      'aria-label',
      `Edit ${habit.name}`,
    );
    const doneButton = required<HTMLButtonElement>(item, '[data-action="done"]');
    doneButton.setAttribute('aria-pressed', String(doneToday));
    doneButton.setAttribute('aria-label', `${habit.name}: done today`);
    required<HTMLElement>(item, '[data-not-planned]').hidden = isPlanned(habit, day);
    required<HTMLElement>(item, '[data-streak]').textContent = streakLabel(
      currentStreak(habit, done, day),
      bestStreak(habit, done, day),
    );

    const week = recentDays(habit, done, day);
    required<HTMLElement>(item, '[data-week]').replaceChildren(
      ...week.map((entry) => renderDay(entry.date, entry.planned, entry.done)),
    );
    const count = week.filter((entry) => entry.done).length;
    required<HTMLElement>(item, '[data-week-summary]').textContent =
      `Last 7 days: done ${count} ${count === 1 ? 'time' : 'times'}.`;
    return item;
  }

  /**
   * Draws the list again, with keyboard focus on the same button (or, if its
   * habit is gone, the one like it next to it, or "New habit": audit 3 G-3).
   */
  function render(): void {
    keepFocus(draw, input);
  }

  function draw(): void {
    todayText.textContent = dateFormat.format(dateOf(day));
    list.replaceChildren(...habits.habits.map(renderHabit));
    empty.hidden = habits.habits.length > 0;
    const room = roomNote(checks.checks.length);
    roomText.hidden = room === null;
    roomText.textContent = room ?? '';
  }

  /**
   * Today, read afresh at a tap. The page looks for a new day once a minute,
   * so for up to a minute after midnight "today" was still yesterday, and
   * "Done today" ticked yesterday (audit 5 F1-7).
   */
  function todayNow(): IsoDate {
    const now = today();
    if (now !== day) {
      day = now;
      render();
    }
    return now;
  }

  // ---------- Adding ----------

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = nameError(input.value, habits);
    if (message) {
      error.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      focusProblem(input, message);
      return;
    }
    const name = input.value.trim();
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    input.value = '';
    addLimit.clear();
    if (save({ habits: addHabit(habits, name, crypto.randomUUID()) })) announce(`Added ${name}.`);
  });

  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true' && !nameError(input.value, habits)) {
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    }
  });

  // ---------- Done today, and editing ----------

  list.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    const habit = find(button?.closest<HTMLElement>('[data-id]')?.dataset['id']);
    if (!button || !habit) return;
    if (button.dataset['action'] === 'edit') {
      openEditor(habit);
      return;
    }
    todayNow();
    const done = !doneDates(checks, habit.id).has(day);
    // Full: says how to make room (in the notice at the top, read out).
    const problem = done ? checksProblem(checks) : undefined;
    if (problem) {
      full = problem;
      showProblem(problem);
      return;
    }
    if (save({ checks: setDone(checks, habit.id, day, done) })) {
      announce(done ? `${habit.name}: done today.` : `${habit.name}: not done today.`);
    }
  });

  function checkbox(label: string, value: string, checked: boolean): HTMLLabelElement {
    const fragment = checkTemplate.content.cloneNode(true) as DocumentFragment;
    const element = required<HTMLLabelElement>(fragment, 'label');
    const box = required<HTMLInputElement>(element, 'input');
    box.value = value;
    box.checked = checked;
    // Remembered, so saving only changes what was changed here.
    box.dataset['was'] = String(checked);
    required<HTMLElement>(element, '[data-check-label]').textContent = label;
    return element;
  }

  function showReminderField(): void {
    reminderField.hidden = !remindBox.checked;
    reminderInput.disabled = !remindBox.checked;
  }

  /** The edit form's name, planned days and reminder, as they are now. */
  const formDraft = (): HabitDraft => ({
    name: editName.value,
    days: [...dayChecks.querySelectorAll<HTMLInputElement>('input:checked')].map((box) =>
      Number(box.value),
    ),
    reminder: remindBox.checked ? reminderInput.value : null,
  });

  function openEditor(habit: Habit): void {
    // The last two weeks to tick end today.
    todayNow();
    editing = habit.id;
    editLimits.clear();
    editName.value = habit.name;
    editName.removeAttribute('aria-invalid');
    nameErrorText.textContent = '';
    daysErrorText.textContent = '';
    remindBox.checked = habit.reminder !== undefined;
    reminderInput.value = habit.reminder ?? DEFAULT_REMINDER;
    reminderInput.removeAttribute('aria-invalid');
    reminderErrorText.textContent = '';
    pastErrorText.textContent = '';
    showReminderField();
    dayChecks.replaceChildren(
      ...weekOrder(weekStart).map((weekDay) =>
        checkbox(weekdayName(weekDay, 'long'), String(weekDay), habit.days.includes(weekDay)),
      ),
    );
    const done = doneDates(checks, habit.id);
    pastDays.replaceChildren(
      ...Array.from({ length: EDITABLE_DAYS }, (_, index) => {
        const date = addDays(day, -index);
        return checkbox(dayLabel(date, day), date, done.has(date));
      }),
    );
    opened = formDraft();
    editDialog.showModal();
  }

  editForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const habit = find(editing);
    if (!habit) {
      editDialog.close();
      return;
    }
    const edited = formDraft();
    const { name, days, reminder } = edited;
    const nameProblem = nameError(name, habits, habit.id, opened?.name);
    nameErrorText.textContent = nameProblem ?? '';
    editName.toggleAttribute('aria-invalid', nameProblem !== undefined);
    daysErrorText.textContent = days.length === 0 ? 'Choose at least one day.' : '';
    const reminderProblem = reminder !== null && !isIsoTime(reminder);
    reminderErrorText.textContent = reminderProblem ? 'Choose a time for the reminder.' : '';
    reminderInput.toggleAttribute('aria-invalid', reminderProblem);
    if (nameProblem) {
      focusProblem(editName, nameProblem);
      return;
    }
    if (days.length === 0) {
      focusProblem(dayChecks.querySelector<HTMLInputElement>('input'));
      return;
    }
    if (reminderProblem) {
      focusProblem(reminderInput);
      return;
    }

    let nextChecks = checks;
    for (const box of pastDays.querySelectorAll<HTMLInputElement>('input')) {
      if (String(box.checked) !== box.dataset['was']) {
        nextChecks = setDone(nextChecks, habit.id, box.value, box.checked);
      }
    }
    // Full: days ticked here wait until there's room.
    const added = nextChecks.checks.length - checks.checks.length;
    const pastProblem = added > 0 ? checksProblem(checks, added) : undefined;
    pastErrorText.textContent = pastProblem ?? '';
    if (pastProblem) {
      focusProblem(pastDays.querySelector<HTMLInputElement>('input'), pastProblem);
      return;
    }
    editDialog.close();
    // A sync while the form was open may have changed the habit on another
    // device: keep that, and put on only what was changed here.
    const next = editHabit(habits, habit.id, opened ?? edited, edited);
    const saved = next.habits.find((entry) => entry.id === habit.id)?.name ?? name.trim();
    if (save({ habits: next, checks: nextChecks })) announce(`Saved ${saved}.`);
    if (reminder !== null) reminders.offerNotifications();
  });

  remindBox.addEventListener('change', () => {
    showReminderField();
    if (remindBox.checked && !reminderInput.value) reminderInput.value = DEFAULT_REMINDER;
  });

  editForm.addEventListener('click', (event) => {
    const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset[
      'action'
    ];
    if (action === 'cancel') editDialog.close();
    if (action === 'delete') {
      const habit = find(editing);
      if (!habit) return;
      deleteName.textContent = habit.name;
      deleteDialog.returnValue = '';
      deleteDialog.showModal();
    }
  });

  editDialog.addEventListener('close', () => {
    editing = null;
    opened = null;
  });

  deleteDialog.addEventListener('close', () => {
    const habit = find(editing);
    if (deleteDialog.returnValue !== 'confirm' || !habit) return;
    editDialog.close();
    if (save(removeHabit(habits, checks, habit.id))) announce(`Deleted ${habit.name}.`);
    input.focus();
  });

  // ---------- Deleting a year's check marks, to make room ----------

  /** How many check marks the year chosen has (0 if it has none now). */
  const yearCount = (year: string): number =>
    checkYears(checks).find((entry) => entry.year === year)?.count ?? 0;

  /** The year the dialog shows, and how many check marks it says go. */
  let shownYear = { year: '', count: 0 };

  /** Says what deleting the year chosen removes. */
  function showYear(): void {
    const year = yearSelect.value;
    shownYear = { year, count: yearCount(year) };
    const count = checksCount(shownYear.count);
    yearText.textContent = `The ${count} from ${year} will be deleted, for every habit. Streaks then count only the days that are kept. With sync on, they’re deleted on your other devices too. This can’t be undone.`;
    yearConfirm.textContent = `Delete ${count}`;
  }

  /** The years with check marks to choose from (the year chosen stays chosen while it has any). */
  function fillYears(): void {
    const chosen = yearSelect.value;
    const years = checkYears(checks);
    yearSelect.replaceChildren(
      ...years.map(({ year, count }) => new Option(`${year} (${checksCount(count)})`, year)),
    );
    // Else the first, the earliest year: the oldest check marks are the likeliest to go.
    if (years.some(({ year }) => year === chosen)) yearSelect.value = chosen;
    showYear();
  }

  deleteYearButton.addEventListener('click', () => {
    if (checks.checks.length === 0) {
      yearStatus.textContent = 'There are no check marks to delete.';
      return;
    }
    yearStatus.textContent = '';
    yearSelect.replaceChildren();
    fillYears();
    yearDialog.showModal();
    yearSelect.focus();
  });

  yearSelect.addEventListener('change', showYear);

  yearForm.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-action="cancel"]')) yearDialog.close();
  });

  yearForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const year = yearSelect.value;
    const count = yearCount(year);
    yearDialog.close();
    deleteYearButton.focus();
    if (count === 0) return;
    // Like unticking them one by one, so other devices delete them too.
    if (save({ checks: removeYear(checks, year) })) {
      announce(`Deleted ${checksCount(count)} from ${year}.`);
    }
  });

  // ---------- Keeping up ----------

  function reload(): void {
    habits = habitsStore.load();
    checks = checksStore.load();
    // The habit being edited was deleted on another device or tab: its form
    // closes, saying why, as Notes does (audit 3 G-6).
    if (editing !== null && !find(editing)) {
      if (deleteDialog.open) deleteDialog.close();
      editDialog.close();
      showProblem('That habit was deleted on another device.');
    }
    // The year chosen changed on another device or tab: the dialog closes,
    // and says why, so its button doesn't delete another year, or more than
    // it said, as in Budget, Repairs and Trades (audit 4 F2-1, audit 7 G-1).
    if (yearDialog.open) {
      const { year, count } = shownYear;
      const now = yearCount(year);
      if (now === count) fillYears();
      else {
        yearDialog.close();
        deleteYearButton.focus();
        showProblem(
          now === 0
            ? `The check marks from ${year} were deleted on another device.`
            : `${year} has ${checksCount(now)} now, after changes on another device. Nothing was deleted.`,
        );
      }
    }
    render();
    reminders.changed();
  }

  // A new day while Habits is open (or when it comes back on screen).
  onNewDay((now) => {
    day = now;
    render();
    // The reminders are worked out from today, so they're uploaded again, as
    // in Water. Else the open page takes the notification service's copy for
    // an old one, and both send them (audit 3 F1-6).
    reminders.changed();
  });

  // If Habits is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key === habitsStore.key || event.key === checksStore.key) reload();
  });

  // Sync between devices through the shkriuss account (if turned on). A day's
  // check mark has the same id on every device, so marks never conflict; for
  // a habit's name and days, the newest change wins.
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store: habitsStore,
        items: (value) => value.habits,
        withItems: (value, list) => ({ ...value, habits: list }),
      }),
      syncedStore({
        store: checksStore,
        items: (value) => value.checks,
        withItems: (value, list) => ({ ...value, checks: list }),
      }),
    ],
    onChange: reload,
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  const reminders = mountReminders(root, {
    habits: () => habits,
    checks: () => checks,
    announce,
  });

  render();
}
