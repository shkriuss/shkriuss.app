/**
 * Calendar's page behaviour: connects the HTML in pages/index.astro to the
 * rules in lib/ and saves everything on the device. Reminders, importing, and
 * holidays and fasts have their own files (reminder-alerts.ts,
 * import-dialog.ts and special-days.ts).
 */
import { createStore, downloadFile } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { showFieldProblems } from '@shkriuss/ui/dom';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import { reportSave } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  addDays,
  daysBetween,
  daysInMonth,
  firstDayOfWeek,
  isIsoDate,
  isIsoTime,
  makeDate,
  minutesOf,
  monthGrid,
  parts,
  sameDayInMonth,
  shiftMonth,
  shiftTime,
  today,
  weekday,
  type IsoDate,
} from '../lib/dates.ts';
import {
  addEvent,
  DATA_VERSION,
  draftProblems,
  emptyState,
  isCalendarState,
  isValidReminder,
  MAX_EVENTS,
  migrateState,
  occurrencesBetween,
  onDay,
  removeEvent,
  secondVersion,
  timeLabel,
  updateEvent,
  type CalendarEvent,
  type CalendarState,
  type DraftField,
  type EventDraft,
  type Occurrence,
  type Repeat,
} from '../lib/events.ts';
import { isNotable, type SpecialDay } from '../lib/holidays.ts';
import {
  ALL_DAY_REMINDERS,
  DEFAULT_REMINDER,
  reminderLabel,
  TIMED_REMINDERS,
} from '../lib/reminders.ts';
import { mountImportDialog } from './import-dialog.ts';
import { mountPushReminders } from './push-reminders.ts';
import { mountReminderAlerts } from './reminder-alerts.ts';
import { mountSpecialDays } from './special-days.ts';
import {
  formatTime,
  longDate,
  longDateThisYear,
  monthFormat,
  plural,
  required,
  shortDate,
  utc,
  weekdayLong,
  weekdayNarrow,
  weekdayShort,
  type CalendarPage,
} from './shared.ts';

const store = createStore<CalendarState>({
  key: 'calendar',
  version: DATA_VERSION,
  fallback: emptyState,
  validate: isCalendarState,
  migrate: migrateState,
});

/** Days in the "Next 7 days" list (starting tomorrow). */
const UPCOMING_DAYS = 7;
/** Most dots shown under a day in the month grid. */
const MAX_DOTS = 3;
/** Form fields in the order they appear, for focusing the first problem. */
const FIELD_ORDER: DraftField[] = [
  'title',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
  'repeatUntil',
  'reminder',
  'notes',
];

export function mountCalendar(root: Document): void {
  const monthTitle = required<HTMLElement>(root, '[data-month-title]');
  const weekdaysRow = required<HTMLTableRowElement>(root, '[data-weekdays]');
  const weeksBody = required<HTMLTableSectionElement>(root, '[data-weeks]');
  const dayHeading = required<HTMLElement>(root, '[data-day-heading]');
  const dayList = required<HTMLUListElement>(root, '[data-day-events]');
  const daySpecialList = required<HTMLUListElement>(root, '[data-day-special]');
  const dayEmpty = required<HTMLElement>(root, '[data-day-empty]');
  const upcomingList = required<HTMLUListElement>(root, '[data-upcoming]');
  const upcomingEmpty = required<HTMLElement>(root, '[data-upcoming-empty]');
  const newEventButton = required<HTMLButtonElement>(root, '[data-action="new-event"]');
  const template = required<HTMLTemplateElement>(root, '[data-event-template]');
  const announcer = required<HTMLElement>(root, '[data-announcer]');

  const editor = required<HTMLDialogElement>(root, '[data-event-dialog]');
  const form = required<HTMLFormElement>(editor, '[data-event-form]');
  const editorTitle = required<HTMLElement>(editor, '[data-dialog-title]');
  const repeatNote = required<HTMLElement>(editor, '[data-repeat-note]');
  const deleteButton = required<HTMLButtonElement>(editor, '[data-action="delete"]');
  const untilField = required<HTMLElement>(editor, '[data-until-field]');
  const timeFields = [...editor.querySelectorAll<HTMLElement>('[data-time-field]')];
  const input = <T extends HTMLElement>(name: string): T => required<T>(form, `[name="${name}"]`);
  const titleInput = input<HTMLInputElement>('title');
  const allDayInput = input<HTMLInputElement>('allDay');
  const startDateInput = input<HTMLInputElement>('startDate');
  const startTimeInput = input<HTMLInputElement>('startTime');
  const endDateInput = input<HTMLInputElement>('endDate');
  const endTimeInput = input<HTMLInputElement>('endTime');
  const repeatInput = input<HTMLSelectElement>('repeat');
  const repeatUntilInput = input<HTMLInputElement>('repeatUntil');
  const reminderInput = input<HTMLSelectElement>('reminder');
  const notesInput = input<HTMLTextAreaElement>('notes');

  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteMessage = required<HTMLElement>(deleteDialog, '[data-delete-message]');

  const weekStart = firstDayOfWeek(navigator.language);
  let state = store.load();
  let todayDate = today();
  let selected = todayDate;
  /** First day of the month on screen. */
  let viewMonth = shiftMonth(selected, 0);
  /** The event open in the editor (null for a new one). */
  let editingId: string | null = null;
  /** Where keyboard focus goes back to when the editor closes. */
  let opener: HTMLElement | null = null;
  /** The event just saved, so focus can go to it in the list. */
  let savedId: string | null = null;
  // Remembered so changing the start can move the end by the same amount.
  let lastStartDate = '';
  let lastStartTime = '';

  const announce = (message: string): void => {
    announcer.textContent = message;
  };

  const save = (next: CalendarState): boolean => {
    state = next;
    const saved = reportSave(store.save(state));
    render();
    // Update reminders for when Calendar is closed (if that's on).
    pushReminders.sync();
    // And the other devices (if sync is on).
    sync.changed();
    return saved;
  };

  const page: CalendarPage = {
    state: () => state,
    save,
    announce,
    eventItem,
    newEventButton,
  };
  const alerts = mountReminderAlerts(root, page);
  const pushReminders = mountPushReminders(root, page, () => {
    alerts.refreshStatus();
  });
  // Sync between devices through the shkriuss account (if turned on).
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store,
        items: (value) => value.events,
        withItems: (value, events) => ({ ...value, events }),
        // Changed on two devices at once: keep this device's version as its own event.
        conflictCopy: (mine) => secondVersion(mine, crypto.randomUUID()),
      }),
    ],
    onChange: () => {
      state = store.load();
      // Drawn again in the background: keyboard focus stays where it was (audit G-3).
      keepFocus(render, newEventButton);
      pushReminders.sync();
    },
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);
  // Holidays, days off and fasts in Georgia (shown unless turned off).
  const special = mountSpecialDays(root, () => keepFocus(render, newEventButton));

  // ---------- Showing the calendar ----------

  function renderWeekdays(): void {
    // 2024-01-01 was a Monday, so 2024-01-0N is ISO weekday N.
    const headers = Array.from({ length: 7 }, (_, index) => {
      const date = utc(makeDate(2024, 1, ((weekStart - 1 + index) % 7) + 1));
      const header = document.createElement('th');
      header.scope = 'col';
      // "Mon", or "M" when there's no room for that (large text): the page's CSS picks.
      const shown = (className: string, format: Intl.DateTimeFormat): HTMLSpanElement => {
        const span = document.createElement('span');
        span.className = className;
        span.setAttribute('aria-hidden', 'true');
        span.textContent = format.format(date);
        return span;
      };
      const full = document.createElement('span');
      full.className = 'visually-hidden';
      full.textContent = weekdayLong.format(date);
      header.append(
        shown('weekday__short', weekdayShort),
        shown('weekday__narrow', weekdayNarrow),
        full,
      );
      return header;
    });
    weekdaysRow.replaceChildren(...headers);
  }

  function dayLabel(date: IsoDate, count: number, days: readonly SpecialDay[]): string {
    const label = [longDate.format(utc(date))];
    if (date === todayDate) label.push('today');
    if (count > 0) label.push(plural(count, 'event'));
    label.push(...days.map(special.label));
    return label.join(', ');
  }

  function renderMonth(): void {
    const { year, month } = parts(viewMonth);
    const monthEnd = makeDate(year, month, daysInMonth(year, month));
    const occurrences = occurrencesBetween(state, viewMonth, monthEnd);
    const specials = special.between(viewMonth, monthEnd);
    // One day in the grid is reachable with Tab; arrow keys move between days.
    const tabbable = selected.startsWith(viewMonth.slice(0, 8)) ? selected : viewMonth;

    monthTitle.textContent = monthFormat.format(utc(viewMonth));
    const rows = monthGrid(viewMonth, weekStart).map((week) => {
      const row = document.createElement('tr');
      for (const date of week) {
        const cell = document.createElement('td');
        if (date) {
          const days = specials.get(date) ?? [];
          cell.append(dayButton(date, onDay(occurrences, date).length, tabbable, days));
        }
        row.append(cell);
      }
      return row;
    });
    weeksBody.replaceChildren(...rows);
  }

  function dayButton(
    date: IsoDate,
    count: number,
    tabbable: IsoDate,
    days: readonly SpecialDay[],
  ): HTMLButtonElement {
    const marks = special.marks(days);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day-cell';
    // A day off is underlined in red; a fast has a line along the bottom.
    button.classList.toggle('day-cell--off', marks.dayOff);
    button.classList.toggle('day-cell--fast', marks.fast);
    button.dataset['date'] = date;
    button.tabIndex = date === tabbable ? 0 : -1;
    button.setAttribute('aria-pressed', String(date === selected));
    if (date === todayDate) button.setAttribute('aria-current', 'date');
    button.setAttribute('aria-label', dayLabel(date, count, days));

    const number = document.createElement('span');
    number.className = 'day-cell__number';
    number.textContent = String(parts(date).day);
    const dots = document.createElement('span');
    dots.className = 'day-cell__dots';
    dots.setAttribute('aria-hidden', 'true');
    // An Orthodox holiday is a ring, before the dots for events.
    if (marks.feast) {
      const ring = document.createElement('span');
      ring.className = 'day-cell__ring';
      dots.append(ring);
    }
    for (let index = 0; index < Math.min(count, MAX_DOTS); index += 1) {
      const dot = document.createElement('span');
      dot.className = 'day-cell__dot';
      dots.append(dot);
    }
    button.append(number, dots);
    return button;
  }

  function eventItem(occurrence: Occurrence, day: IsoDate, withDate: boolean): HTMLLIElement {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    const { event } = occurrence;
    item.dataset['id'] = event.id;
    const time = timeLabel(occurrence, day, formatTime);
    const when = withDate ? `${shortDate.format(utc(day))} · ${time}` : time;
    required<HTMLElement>(item, '[data-when]').textContent = when;
    const title = required<HTMLElement>(item, '[data-title]');
    title.textContent = event.title;
    // A space between the time and the title (not shown: they're on separate
    // grid rows), so the button's text reads "All day Birthday", which its
    // name below starts with, and not "All dayBirthday" (WCAG 2.5.3).
    title.before(' ');
    required<HTMLElement>(item, '[data-repeat]').hidden = event.repeat === 'none';
    required<HTMLElement>(item, '[data-has-reminder]').hidden = event.reminder === null;
    const name = [when, event.title];
    if (event.repeat !== 'none') name.push('repeats');
    if (event.reminder !== null) name.push('with a reminder');
    required<HTMLButtonElement>(item, '[data-action="edit"]').setAttribute(
      'aria-label',
      name.join(', '),
    );
    return item;
  }

  function renderDay(): void {
    const sameYear = selected.slice(0, 4) === todayDate.slice(0, 4);
    const date = (sameYear ? longDateThisYear : longDate).format(utc(selected));
    dayHeading.textContent = selected === todayDate ? `Today, ${date}` : date;
    daySpecialList.replaceChildren(
      ...special.on(selected).map((day) => special.item(day, selected, false)),
    );
    const occurrences = occurrencesBetween(state, selected, selected);
    dayList.replaceChildren(...occurrences.map((o) => eventItem(o, selected, false)));
    dayEmpty.hidden = occurrences.length > 0;
  }

  function renderUpcoming(): void {
    const from = addDays(todayDate, 1);
    const to = addDays(todayDate, UPCOMING_DAYS);
    const occurrences = occurrencesBetween(state, from, to);
    // Holidays first on their day, then events; a long fast only where it starts.
    const items = [
      ...[...special.between(from, to)].flatMap(([date, days]) =>
        days.filter(isNotable).map((day) => ({ date, item: special.item(day, date, true) })),
      ),
      // An event already under way tomorrow is listed on tomorrow.
      ...occurrences.map((o) => {
        const date = o.start < from ? from : o.start;
        return { date, item: eventItem(o, date, true) };
      }),
    ];
    // Sorting keeps holidays before events on the same day (it's stable).
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    upcomingList.replaceChildren(...items.map(({ item }) => item));
    upcomingEmpty.hidden = occurrences.length > 0;
  }

  function render(): void {
    todayDate = today();
    renderMonth();
    renderDay();
    renderUpcoming();
    alerts.render();
  }

  function focusDay(date: IsoDate): void {
    weeksBody.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)?.focus();
  }

  function select(date: IsoDate): void {
    // Years 1000–9999 only (see lib/dates.ts).
    if (!isIsoDate(date)) return;
    selected = date;
    viewMonth = shiftMonth(date, 0);
    render();
  }

  function showMonth(offset: number): void {
    const month = shiftMonth(viewMonth, offset);
    // Select today in this month, or else the 1st.
    select(today().startsWith(month.slice(0, 8)) ? today() : month);
  }

  // ---------- The event editor ----------

  function syncFields(): void {
    const allDay = allDayInput.checked;
    for (const field of timeFields) field.hidden = allDay;
    startTimeInput.disabled = allDay;
    endTimeInput.disabled = allDay;
    const repeats = repeatInput.value !== 'none';
    untilField.hidden = !repeats;
    repeatUntilInput.disabled = !repeats;
  }

  /** Fills the reminder list with the choices for timed or all-day events. */
  function fillReminders(allDay: boolean, value: number | null): void {
    const choices: number[] = [...(allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS)];
    // A reminder from an imported file may not be one of the usual choices.
    if (value !== null && !choices.includes(value) && isValidReminder(value, allDay)) {
      choices.push(value);
      choices.sort((a, b) => a - b);
    }
    const option = (optionValue: string, label: string): HTMLOptionElement => {
      const created = document.createElement('option');
      created.value = optionValue;
      created.textContent = label;
      return created;
    };
    reminderInput.replaceChildren(
      option('', 'No reminder'),
      ...choices.map((minutes) =>
        option(String(minutes), reminderLabel(minutes, allDay, formatTime)),
      ),
    );
    reminderInput.value = value === null ? '' : String(value);
  }

  const readReminder = (): number | null =>
    reminderInput.value === '' ? null : Number(reminderInput.value);

  function readDraft(): EventDraft {
    const allDay = allDayInput.checked;
    const repeat = repeatInput.value as Repeat;
    return {
      title: titleInput.value,
      startDate: startDateInput.value,
      // A blank end date means a one-day event.
      endDate: endDateInput.value || startDateInput.value,
      startTime: allDay ? null : startTimeInput.value,
      endTime: allDay || !endTimeInput.value ? null : endTimeInput.value,
      repeat,
      repeatUntil: repeat === 'none' || !repeatUntilInput.value ? null : repeatUntilInput.value,
      reminder: readReminder(),
      notes: notesInput.value,
    };
  }

  /** Shows each problem next to its field; focuses the first. Returns true if there are any. */
  const showProblems = (problems: Partial<Record<DraftField, string>>, onlyClear = false) =>
    showFieldProblems(form, [...FIELD_ORDER, 'form'], problems, {
      onlyClear,
      focusFirst: !onlyClear,
    });

  function openEditor(event: CalendarEvent | null): void {
    editingId = event?.id ?? null;
    opener = root.activeElement instanceof HTMLElement ? root.activeElement : null;
    showProblems({});
    editorTitle.textContent = event ? 'Edit event' : 'New event';
    deleteButton.hidden = !event;
    repeatNote.hidden = !event || event.repeat === 'none';

    titleInput.value = event?.title ?? '';
    allDayInput.checked = event ? event.startTime === null : false;
    startDateInput.value = event?.startDate ?? selected;
    endDateInput.value = event?.endDate ?? selected;
    // Times to start from if an all-day event is changed to a timed one.
    startTimeInput.value = event?.startTime ?? '09:00';
    endTimeInput.value = event ? (event.endTime ?? (event.startTime ? '' : '10:00')) : '10:00';
    repeatInput.value = event?.repeat ?? 'none';
    repeatUntilInput.value = event?.repeatUntil ?? '';
    fillReminders(allDayInput.checked, event?.reminder ?? null);
    notesInput.value = event?.notes ?? '';
    lastStartDate = startDateInput.value;
    lastStartTime = startTimeInput.value;
    syncFields();
    editor.showModal();
    titleInput.focus();
  }

  // However the editor closes (Save, Cancel, Escape), put focus somewhere useful.
  editor.addEventListener('close', () => {
    const item = savedId
      ? dayList.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(savedId)}"] button`)
      : null;
    (item ?? (opener?.isConnected ? opener : newEventButton)).focus();
    savedId = null;
    opener = null;
  });

  /** The day to show after saving: the selected day if the event is on it, else its next day. */
  function dayToShow(next: CalendarState, id: string, start: IsoDate): IsoDate {
    const [first] = occurrencesBetween(next, selected, addDays(selected, 366)).filter(
      (occurrence) => occurrence.event.id === id,
    );
    if (!first) return start;
    // Sorted by start, so one starting on or before the selected day covers it.
    return first.start <= selected ? selected : first.start;
  }

  // Moving the start keeps the event the same length.
  startDateInput.addEventListener('change', () => {
    const start = startDateInput.value;
    const end = endDateInput.value;
    if (isIsoDate(lastStartDate) && isIsoDate(start) && isIsoDate(end)) {
      endDateInput.value = addDays(end, daysBetween(lastStartDate, start));
    } else if (isIsoDate(start) && (!isIsoDate(end) || end < start)) {
      endDateInput.value = start;
    }
    lastStartDate = start;
  });

  startTimeInput.addEventListener('change', () => {
    const start = startTimeInput.value;
    const end = endTimeInput.value;
    if (isIsoTime(lastStartTime) && isIsoTime(start) && isIsoTime(end)) {
      const moved = shiftTime(end, minutesOf(start) - minutesOf(lastStartTime));
      if (moved) endTimeInput.value = moved;
    }
    lastStartTime = start;
  });

  allDayInput.addEventListener('change', () => {
    syncFields();
    // "15 minutes before" means something else for an all-day event: switch to that kind's default.
    const allDay = allDayInput.checked;
    fillReminders(
      allDay,
      readReminder() === null ? null : allDay ? DEFAULT_REMINDER.allDay : DEFAULT_REMINDER.timed,
    );
  });
  repeatInput.addEventListener('change', syncFields);

  // Clear a field's error as soon as it is fixed.
  form.addEventListener('input', () => {
    if (form.querySelector('[aria-invalid="true"]')) showProblems(draftProblems(readDraft()), true);
  });

  form.addEventListener('submit', (submitEvent) => {
    submitEvent.preventDefault();
    const draft = readDraft();
    const problems = draftProblems(draft);
    if (!editingId && state.events.length >= MAX_EVENTS) {
      problems.form = `You can have up to ${MAX_EVENTS} events. Delete some to add more.`;
    }
    if (showProblems(problems)) return;

    const id = editingId ?? crypto.randomUUID();
    const next = editingId ? updateEvent(state, id, draft) : addEvent(state, draft, id);
    const day = dayToShow(next, id, draft.startDate);
    if (day !== selected) {
      selected = day;
      viewMonth = shiftMonth(day, 0);
    }
    if (save(next)) announce(`Saved ${draft.title.trim()}.`);
    // Asking now, right after choosing a reminder, makes the question clear.
    if (draft.reminder !== null) alerts.offerNotifications();
    savedId = id;
    editor.close();
  });

  required<HTMLButtonElement>(editor, '[data-action="cancel"]').addEventListener('click', () => {
    editor.close();
  });

  deleteButton.addEventListener('click', () => {
    const event = state.events.find((entry) => entry.id === editingId);
    if (!event) return;
    deleteMessage.textContent =
      event.repeat === 'none'
        ? `“${event.title}” will be removed.`
        : `“${event.title}” will be removed, including every time it repeats.`;
    deleteDialog.returnValue = '';
    // Opens on top of the editor; "Cancel" goes back to editing.
    deleteDialog.showModal();
  });

  deleteDialog.addEventListener('close', () => {
    const event = state.events.find((entry) => entry.id === editingId);
    if (deleteDialog.returnValue !== 'confirm' || !event) return;
    editingId = null;
    opener = newEventButton;
    if (save(removeEvent(state, event.id))) announce(`Deleted ${event.title}.`);
    editor.close();
  });

  // ---------- Buttons and keys ----------

  newEventButton.addEventListener('click', () => {
    openEditor(null);
  });

  // Tapping an event in any list (the day, the next 7 days, reminders) opens it.
  root.addEventListener('click', (clickEvent) => {
    const id = (clickEvent.target as Element)
      .closest('[data-action="edit"]')
      ?.closest<HTMLElement>('[data-id]')?.dataset['id'];
    const event = state.events.find((entry) => entry.id === id);
    if (event) openEditor(event);
  });

  required<HTMLButtonElement>(root, '[data-action="prev-month"]').addEventListener('click', () => {
    showMonth(-1);
  });
  required<HTMLButtonElement>(root, '[data-action="next-month"]').addEventListener('click', () => {
    showMonth(1);
  });
  required<HTMLButtonElement>(root, '[data-action="today"]').addEventListener('click', () => {
    select(today());
    announce(`Today: ${longDate.format(utc(selected))}.`);
  });

  weeksBody.addEventListener('click', (clickEvent) => {
    const date = (clickEvent.target as Element).closest<HTMLElement>('[data-date]')?.dataset[
      'date'
    ];
    if (!date) return;
    select(date);
    focusDay(date);
  });

  weeksBody.addEventListener('keydown', (keyEvent) => {
    const date = (keyEvent.target as Element).closest<HTMLElement>('[data-date]')?.dataset['date'];
    if (!date) return;
    const column = (weekday(date) - weekStart + 7) % 7;
    // Page Up/Down change month; with Shift, year.
    const months = keyEvent.shiftKey ? 12 : 1;
    const next: Record<string, () => IsoDate> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, -column),
      End: () => addDays(date, 6 - column),
      PageUp: () => sameDayInMonth(date, -months),
      PageDown: () => sameDayInMonth(date, months),
    };
    const move = next[keyEvent.key];
    if (!move) return;
    keyEvent.preventDefault();
    select(move());
    focusDay(selected);
  });

  // The answer shows under the buttons (and is read out).
  const exportStatus = required<HTMLElement>(root, '[data-export-status]');
  required<HTMLButtonElement>(root, '[data-action="export-ics"]').addEventListener('click', () => {
    if (state.events.length === 0) {
      exportStatus.textContent = 'There are no events to download yet.';
      return;
    }
    // Loaded when it's needed, like the import: the page starts with less to load.
    import('../lib/ics.ts').then(
      ({ toIcs }) => {
        downloadFile(`calendar-${today()}.ics`, toIcs(state.events), 'text/calendar');
        exportStatus.textContent = `Downloaded ${plural(state.events.length, 'event')}.`;
      },
      () => {
        exportStatus.textContent = 'Calendar couldn’t make the file. Please try again.';
      },
    );
  });

  // If Calendar is open in two tabs, keep them in sync.
  window.addEventListener('storage', (storageEvent) => {
    if (storageEvent.key === store.key) {
      state = store.load();
      keepFocus(render, newEventButton);
      pushReminders.sync();
    }
  });

  // Coming back to the app on a new day: move "today" along.
  root.addEventListener('visibilitychange', () => {
    if (root.visibilityState === 'visible' && today() !== todayDate) {
      if (selected === todayDate) selected = today();
      viewMonth = shiftMonth(selected, 0);
      keepFocus(render, newEventButton);
    }
  });

  mountImportDialog(root, page);

  renderWeekdays();
  render();
}
