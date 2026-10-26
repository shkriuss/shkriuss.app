/**
 * The event editor: a new event, or changing or deleting one. It loads the
 * first time it opens (./calendar.ts), like the import dialog: most visits
 * only look at the calendar, and the page starts with less to load (audit 3
 * J-11).
 */
import { showFieldProblems } from '@shkriuss/ui/dom';
import { hasEdits } from '@shkriuss/sync/edits';
import { focusSpot, returnFocus, type FocusSpot } from '@shkriuss/ui/keep-focus';
import {
  addDays,
  daysBetween,
  isIsoDate,
  isIsoTime,
  minutesOf,
  shiftTime,
  type IsoDate,
} from '../lib/dates.ts';
import { addEvent, dayToShow, editEvent, removeEvent } from '../lib/editing.ts';
import {
  draftProblems,
  isValidReminder,
  MAX_EVENTS,
  type CalendarEvent,
  type DraftField,
  type EventDraft,
  type Repeat,
} from '../lib/events.ts';
import {
  ALL_DAY_REMINDERS,
  DEFAULT_REMINDER,
  reminderLabel,
  TIMED_REMINDERS,
} from '../lib/reminder-choices.ts';
import { formatTime, required, type CalendarPage } from './shared.ts';

/** Said in the editor when its event was deleted on another device or in another tab. */
const GONE =
  'This event was deleted on another device or in another tab. Saving a change brings it back.';

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

/** What the editor needs from the page, besides what the other parts do. */
export interface EditorPage extends CalendarPage {
  /** The day chosen in the month. */
  selected(): IsoDate;
  /** Chooses the day to show once an event is saved (saving draws it). */
  show(day: IsoDate): void;
  /** Asks to show notifications if the person hasn't been asked (after choosing a reminder). */
  offerNotifications(): void;
}

export interface EventEditor {
  /** Opens an event (null: a new one); focus goes back to `from` when it closes. */
  open(event: CalendarEvent | null, from: FocusSpot | null): void;
  /** After a change from another device or tab: says if the event open was deleted there. */
  refresh(): void;
}

export function mountEventEditor(root: Document, page: EditorPage): EventEditor {
  const dayList = required<HTMLUListElement>(root, '[data-day-events]');
  const editor = required<HTMLDialogElement>(root, '[data-event-dialog]');
  const form = required<HTMLFormElement>(editor, '[data-event-form]');
  const editorTitle = required<HTMLElement>(editor, '[data-dialog-title]');
  const repeatNote = required<HTMLElement>(editor, '[data-repeat-note]');
  const goneNote = required<HTMLElement>(editor, '[data-gone-note]');
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

  /** The event open in the editor (null for a new one). */
  let editingId: string | null = null;
  /** The editor as it opened, to tell what the person changed (see editEvent). */
  let openedDraft: EventDraft | null = null;
  /** Where keyboard focus goes back to when the editor closes. */
  let opener: FocusSpot | null = null;
  /** The event just saved, so focus can go to it in the list. */
  let savedId: string | null = null;
  // Remembered so changing the start can move the end by the same amount.
  let lastStartDate = '';
  let lastStartTime = '';

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

  function open(event: CalendarEvent | null, from: FocusSpot | null): void {
    // A second tap while the editor was loading: it's open already.
    if (editor.open) return;
    editingId = event?.id ?? null;
    opener = from;
    showProblems({});
    editorTitle.textContent = event ? 'Edit event' : 'New event';
    deleteButton.hidden = !event;
    repeatNote.hidden = !event || event.repeat === 'none';
    goneNote.hidden = true;

    const selected = page.selected();
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
    openedDraft = event ? readDraft() : null;
    editor.showModal();
    titleInput.focus();
  }

  // However the editor closes (Save, Cancel, Escape), put focus somewhere
  // useful: on the event just saved, or where the editor was opened from (its
  // new copy, if a list was drawn again meanwhile: audit 3 G-3).
  editor.addEventListener('close', () => {
    const item = savedId
      ? dayList.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(savedId)}"] button`)
      : null;
    if (item) item.focus();
    else if (opener) {
      // Focus left in the closed editor goes nowhere.
      const active = root.activeElement;
      if (active instanceof HTMLElement && editor.contains(active)) active.blur();
      returnFocus(opener, page.newEventButton);
    } else page.newEventButton.focus();
    savedId = null;
    opener = null;
  });

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

  /** Whether the event open was deleted on another device or in another tab. */
  const gone = (): boolean =>
    editingId !== null && !page.state().events.some((event) => event.id === editingId);

  /** The editor closes after its event was deleted, here or elsewhere. */
  function closeDeleted(message: string): void {
    editingId = null;
    opener = focusSpot(page.newEventButton);
    page.announce(message);
    editor.close();
  }

  /**
   * Says in the form when its event was deleted elsewhere. It stays open, as
   * a change wins over a deletion, but Delete and Save did nothing, or put
   * the event back without a word (audit 4 F1-3). Read out in the dialog
   * (audit 4 G-2).
   */
  function refresh(): void {
    const deleted = editor.open && gone();
    if (goneNote.hidden === !deleted) return;
    goneNote.hidden = !deleted;
    goneNote.textContent = deleted ? GONE : '';
    if (deleted) page.announce(GONE);
  }

  form.addEventListener('submit', (submitEvent) => {
    submitEvent.preventDefault();
    const state = page.state();
    const draft = readDraft();
    // Deleted elsewhere, and nothing changed here: it stays deleted.
    if (gone() && openedDraft && !hasEdits(openedDraft, draft)) {
      closeDeleted(`${openedDraft.title} stays deleted: nothing in it was changed.`);
      return;
    }
    const problems = draftProblems(draft);
    if (!editingId && state.events.length >= MAX_EVENTS) {
      problems.form = `You can have up to ${MAX_EVENTS} events. Delete some to add more.`;
    }
    if (showProblems(problems)) return;

    const id = editingId ?? crypto.randomUUID();
    // A sync while the editor was open may have changed the event on another
    // device: keep that, and put on only what was changed here.
    const next = editingId
      ? editEvent(state, id, openedDraft ?? draft, draft)
      : addEvent(state, draft, id);
    const saved = next.events.find((event) => event.id === id);
    page.show(dayToShow(next, id, page.selected()));
    // "Saved" only when it's in what was saved.
    if (page.save(next) && saved) page.announce(`Saved ${saved.title}.`);
    // Asking now, right after choosing a reminder, makes the question clear.
    if (draft.reminder !== null) page.offerNotifications();
    savedId = id;
    editor.close();
  });

  required<HTMLButtonElement>(editor, '[data-action="cancel"]').addEventListener('click', () => {
    editor.close();
  });

  deleteButton.addEventListener('click', () => {
    const event = page.state().events.find((entry) => entry.id === editingId);
    if (!event) {
      if (openedDraft) closeDeleted(`${openedDraft.title} was already deleted.`);
      return;
    }
    deleteMessage.textContent =
      event.repeat === 'none'
        ? `“${event.title}” will be removed.`
        : `“${event.title}” will be removed, including every time it repeats.`;
    deleteDialog.returnValue = '';
    // Opens on top of the editor; "Cancel" goes back to editing.
    deleteDialog.showModal();
  });

  deleteDialog.addEventListener('close', () => {
    if (deleteDialog.returnValue !== 'confirm') return;
    const state = page.state();
    const event = state.events.find((entry) => entry.id === editingId);
    if (!event) {
      if (openedDraft) closeDeleted(`${openedDraft.title} was already deleted.`);
      return;
    }
    editingId = null;
    opener = focusSpot(page.newEventButton);
    if (page.save(removeEvent(state, event.id))) page.announce(`Deleted ${event.title}.`);
    editor.close();
  });

  return { open, refresh };
}
