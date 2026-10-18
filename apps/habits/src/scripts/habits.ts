/**
 * Habits' page behaviour: connects pages/index.astro to the rules in
 * lib/habits.ts, saves on the device, and syncs both lists (habits and check
 * marks) when sync is on. Reminders: reminders.ts.
 */
import { addDays, firstDayOfWeek, isIsoTime, today, weekday, type IsoDate } from '@shkriuss/dates';
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  addHabit,
  bestStreak,
  currentStreak,
  dayLabel,
  doneDates,
  EDITABLE_DAYS,
  emptyChecks,
  emptyHabits,
  isChecksState,
  isHabitsState,
  isPlanned,
  nameError,
  recentDays,
  removeHabit,
  scheduleLabel,
  setDone,
  streakLabel,
  timeLabel,
  updateHabit,
  weekdayName,
  weekOrder,
  type ChecksState,
  type Habit,
  type HabitsState,
} from '../lib/habits.ts';
import { mountReminders } from './reminders.ts';

const habitsStore = createStore<HabitsState>({
  key: 'habits',
  version: 1,
  fallback: emptyHabits,
  validate: isHabitsState,
});

const checksStore = createStore<ChecksState>({
  key: 'habit-checks',
  version: 1,
  fallback: emptyChecks,
  validate: isChecksState,
});

/** A new reminder starts at this time (it can be changed straight away). */
const DEFAULT_REMINDER = '20:00';
/** How often to check whether the day has changed while Habits is open. */
const NEW_DAY_CHECK_MS = 60 * 1000;

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Habits: missing element ${selector}`);
  return element;
}

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
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteName = required<HTMLElement>(deleteDialog, '[data-delete-name]');

  const weekStart = firstDayOfWeek(navigator.language);
  let habits = habitsStore.load();
  let checks = checksStore.load();
  let day = today();
  /** The habit in the edit dialog. */
  let editing: string | null = null;

  const announce = (message: string): void => {
    announcer.textContent = message;
  };
  const find = (id: string | null | undefined): Habit | undefined =>
    habits.habits.find((habit) => habit.id === id);

  function save(next: { habits?: HabitsState; checks?: ChecksState }): void {
    let ok = true;
    if (next.habits) {
      habits = next.habits;
      ok = habitsStore.save(habits) && ok;
    }
    if (next.checks) {
      checks = next.checks;
      ok = checksStore.save(checks) && ok;
    }
    if (!ok) announce('Couldn’t save. Your browser may be blocking storage.');
    render();
    reminders.changed();
    sync.changed();
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

  function render(): void {
    // Keep keyboard focus on the same button after re-rendering.
    const active = root.activeElement;
    const focusId = active?.closest<HTMLElement>('[data-id]')?.dataset['id'];
    const focusAction = active?.getAttribute('data-action');

    todayText.textContent = dateFormat.format(dateOf(day));
    list.replaceChildren(...habits.habits.map(renderHabit));
    empty.hidden = habits.habits.length > 0;

    if (focusId && focusAction) {
      list
        .querySelector<HTMLElement>(
          `[data-id="${CSS.escape(focusId)}"] [data-action="${CSS.escape(focusAction)}"]`,
        )
        ?.focus();
    }
  }

  // ---------- Adding ----------

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = nameError(input.value, habits);
    if (message) {
      error.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    const name = input.value.trim();
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    input.value = '';
    save({ habits: addHabit(habits, name, crypto.randomUUID()) });
    announce(`Added ${name}.`);
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
    const done = !doneDates(checks, habit.id).has(day);
    save({ checks: setDone(checks, habit.id, day, done) });
    announce(done ? `${habit.name}: done today.` : `${habit.name}: not done today.`);
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

  function openEditor(habit: Habit): void {
    editing = habit.id;
    editName.value = habit.name;
    editName.removeAttribute('aria-invalid');
    nameErrorText.textContent = '';
    daysErrorText.textContent = '';
    remindBox.checked = habit.reminder !== undefined;
    reminderInput.value = habit.reminder ?? DEFAULT_REMINDER;
    reminderInput.removeAttribute('aria-invalid');
    reminderErrorText.textContent = '';
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
    editDialog.showModal();
  }

  editForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const habit = find(editing);
    if (!habit) {
      editDialog.close();
      return;
    }
    const name = editName.value;
    const days = [...dayChecks.querySelectorAll<HTMLInputElement>('input:checked')].map((box) =>
      Number(box.value),
    );
    const nameProblem = nameError(name, habits, habit.id);
    nameErrorText.textContent = nameProblem ?? '';
    editName.toggleAttribute('aria-invalid', nameProblem !== undefined);
    daysErrorText.textContent = days.length === 0 ? 'Choose at least one day.' : '';
    const reminder = remindBox.checked ? reminderInput.value : null;
    const reminderProblem = reminder !== null && !isIsoTime(reminder);
    reminderErrorText.textContent = reminderProblem ? 'Choose a time for the reminder.' : '';
    reminderInput.toggleAttribute('aria-invalid', reminderProblem);
    if (nameProblem) {
      editName.focus();
      return;
    }
    if (days.length === 0) {
      dayChecks.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    if (reminderProblem) {
      reminderInput.focus();
      return;
    }

    let nextChecks = checks;
    for (const box of pastDays.querySelectorAll<HTMLInputElement>('input')) {
      if (String(box.checked) !== box.dataset['was']) {
        nextChecks = setDone(nextChecks, habit.id, box.value, box.checked);
      }
    }
    editDialog.close();
    save({ habits: updateHabit(habits, habit.id, { name, days, reminder }), checks: nextChecks });
    announce(`Saved ${name.trim()}.`);
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
  });

  deleteDialog.addEventListener('close', () => {
    const habit = find(editing);
    if (deleteDialog.returnValue !== 'confirm' || !habit) return;
    editDialog.close();
    save(removeHabit(habits, checks, habit.id));
    announce(`Deleted ${habit.name}.`);
    input.focus();
  });

  // ---------- Keeping up ----------

  function reload(): void {
    habits = habitsStore.load();
    checks = checksStore.load();
    // The habit being edited was deleted on another device or tab.
    if (editing !== null && !find(editing)) editDialog.close();
    render();
    reminders.changed();
  }

  // A new day while Habits is open (or when it comes back on screen).
  const checkDay = (): void => {
    if (today() === day) return;
    day = today();
    render();
  };
  window.setInterval(checkDay, NEW_DAY_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDay();
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
