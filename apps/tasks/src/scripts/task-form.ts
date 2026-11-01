/**
 * Tasks: the form that opens from a task's title, where its title, notes,
 * steps (step-edits.ts), date, time, repeat, reminder, list and star are
 * changed, and where it's deleted. It loads after the page itself
 * (later() in tasks.ts), so the page starts with less to load (audit 5
 * J-2). Split from tasks.ts (audit 5 J-3).
 */
import { hasEdits } from '@shkriuss/sync/edits';
import { required, showFieldProblems } from '@shkriuss/ui/dom';
import { focusSpot, returnFocus, type FocusSpot } from '@shkriuss/ui/keep-focus';
import { watchTextLimit } from '@shkriuss/ui/text-limit';
import { sortedLists, type ListsState } from '../lib/lists.ts';
import {
  draftOf,
  draftProblems,
  editedTask,
  everyUnit,
  inView,
  NO_LIST,
  parseEvery,
  removeTask,
  updateTask,
  type DraftField,
  type Task,
  type TaskDraft,
  type TasksState,
  type View,
} from '../lib/tasks.ts';
import { mountStepEdits } from './step-edits.ts';

/** Form fields with a place for a problem, in the order they appear. */
const FIELD_ORDER: DraftField[] = ['title', 'date', 'time', 'every'];
/** Said in the form when its task was deleted on another device or in another tab. */
const GONE =
  'This task was deleted on another device or in another tab. Saving a change brings it back.';

/** What the form needs from the page (tasks.ts). */
export interface TaskFormPage {
  tasks(): TasksState;
  lists(): ListsState;
  view(): View;
  /** "All tasks", "Important", or the list's name: what's shown. */
  viewName(): string;
  /** Saves and draws the list again; false if saving didn't work. */
  saveTasks(next: TasksState): boolean;
  /** Shows the task at the next draw, however far down it is. */
  keepShown(id: string): void;
  /** A task's control on the page, wherever it is. */
  control(id: string, selector: string): HTMLElement | null;
  announce(text: string): void;
  /** Asks to show notifications if the person hasn't been asked (after choosing a reminder). */
  offerNotifications(): void;
  /** Where focus goes when there's nowhere better. */
  viewHeading: HTMLElement;
}

export interface TaskForm {
  /** Opens a task in the form; focus goes back to `from` (the title tapped) when it closes. */
  open(task: Task, from: FocusSpot | null): void;
  /** After changes from another device or tab: says in the form if its task was deleted there. */
  refresh(): void;
}

export function mountTaskForm(root: Document, page: TaskFormPage): TaskForm {
  const editor = required<HTMLDialogElement>(root, '[data-task-dialog]');
  const form = required<HTMLFormElement>(editor, '[data-task-form]');
  const listField = required<HTMLElement>(form, '[data-list-field]');
  const everyField = required<HTMLElement>(form, '[data-every-field]');
  const everyUnitText = required<HTMLElement>(form, '[data-every-unit]');
  const goneNote = required<HTMLElement>(form, '[data-gone-note]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteName = required<HTMLElement>(deleteDialog, '[data-delete-name]');

  /** The task open in the form, where focus goes back to, and the task just saved. */
  let editingId: string | null = null;
  /** The form as it opened, to tell what the person changed (see editedTask). */
  let openedDraft: TaskDraft | null = null;
  let opener: FocusSpot | null = null;
  let savedId: string | null = null;

  const find = (id: string | null): Task | undefined =>
    page.tasks().tasks.find((task) => task.id === id);
  const field = <T extends HTMLElement>(name: string): T => required<T>(form, `[name="${name}"]`);
  const textFields = ['title', 'date', 'time'] as const;
  // A paste longer than a box takes is cut by the browser: say so (audit 5
  // F1-4). The steps' boxes are watched as they're made (step-edits.ts).
  const limits = [field<HTMLInputElement>('title'), field<HTMLTextAreaElement>('notes')].map(
    (box) => watchTextLimit(box),
  );

  function readDraft(): TaskDraft {
    const value = (name: string): string =>
      field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name).value;
    return {
      title: value('title'),
      notes: value('notes'),
      steps: stepEdits.steps(),
      list: value('list'),
      important: field<HTMLInputElement>('important').checked,
      date: value('date'),
      time: value('time'),
      repeat: value('repeat'),
      every: value('every'),
      reminder: value('reminder'),
    };
  }

  function fillForm(draft: TaskDraft): void {
    for (const name of textFields) field<HTMLInputElement>(name).value = draft[name];
    field<HTMLTextAreaElement>('notes').value = draft.notes;
    stepEdits.fill(draft.steps);
    field<HTMLSelectElement>('repeat').value = draft.repeat;
    field<HTMLInputElement>('every').value = draft.every;
    showEvery();
    field<HTMLSelectElement>('reminder').value = draft.reminder;
    field<HTMLInputElement>('important').checked = draft.important;
    const lists = page.lists();
    const list = field<HTMLSelectElement>('list');
    list.replaceChildren(
      new Option('No list', NO_LIST),
      ...sortedLists(lists).map((entry) => new Option(entry.name, entry.id)),
    );
    list.value = draft.list;
    // In a list that's gone (deleted on another device): none.
    if (list.value !== draft.list) list.value = NO_LIST;
    listField.hidden = lists.lists.length === 0;
  }

  /** "Repeat every … weeks": only for repeats that count days, weeks, months or years. */
  function showEvery(): void {
    const repeat = field<HTMLSelectElement>('repeat').value;
    const unit = everyUnit(repeat, parseEvery(field<HTMLInputElement>('every').value) ?? 2);
    everyField.hidden = unit === '';
    everyUnitText.textContent = unit;
  }

  field<HTMLSelectElement>('repeat').addEventListener('change', showEvery);
  field<HTMLInputElement>('every').addEventListener('input', showEvery);

  const stepEdits = mountStepEdits(root, form, page.announce);

  /** Shows each problem next to its field; focuses the first. Returns true if there are any. */
  const showProblems = (problems: Partial<Record<DraftField, string>>, onlyClear = false) =>
    showFieldProblems(form, [...FIELD_ORDER, 'form'], problems, {
      onlyClear,
      focusFirst: !onlyClear,
    });

  function open(task: Task, from: FocusSpot | null): void {
    editingId = task.id;
    opener = from;
    for (const limit of limits) limit.clear();
    showProblems({});
    fillForm(draftOf(task));
    openedDraft = readDraft();
    goneNote.hidden = true;
    editor.showModal();
    field<HTMLInputElement>('title').focus();
  }

  // However the form closes (Save, Cancel, Escape), put focus somewhere useful:
  // on the task just saved, or where the form was opened from (its new copy,
  // if the list was drawn again meanwhile: audit 3 G-3).
  editor.addEventListener('close', () => {
    const saved = savedId ? page.control(savedId, '[data-action="edit"]') : null;
    if (saved) saved.focus();
    else if (opener) {
      // Focus left in the closed form goes nowhere.
      const active = root.activeElement;
      if (active instanceof HTMLElement && editor.contains(active)) active.blur();
      returnFocus(opener, page.viewHeading);
    } else page.viewHeading.focus();
    savedId = null;
    opener = null;
  });

  // Clear a field's problem as soon as it's fixed.
  form.addEventListener('input', () => {
    if (form.querySelector('[aria-invalid="true"]')) showProblems(draftProblems(readDraft()), true);
  });

  /** The form closes after its task was deleted, here or elsewhere. */
  function closeDeleted(message: string): void {
    editingId = null;
    opener = focusSpot(page.viewHeading);
    page.announce(message);
    editor.close();
  }

  /**
   * Says in the form when its task was deleted on another device or in
   * another tab. It stays open, as a change wins over a deletion, but Delete
   * and Save did nothing, or put the task back without a word (audit 4
   * F1-3). Read out in the dialog (audit 4 G-2).
   */
  function refresh(): void {
    const deleted = editor.open && editingId !== null && !find(editingId);
    if (goneNote.hidden === !deleted) return;
    goneNote.hidden = !deleted;
    goneNote.textContent = deleted ? GONE : '';
    if (deleted) page.announce(GONE);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (editingId === null) return;
    // A step still in "New step" is saved too (audit 6 F1-1), or, with no
    // room for it, the form stays open, saying so.
    if (!stepEdits.addTyped()) return;
    const draft = readDraft();
    // Deleted elsewhere, and nothing changed here: it stays deleted.
    if (!find(editingId) && openedDraft && !hasEdits(openedDraft, draft)) {
      closeDeleted(`${openedDraft.title} stays deleted: nothing in it was changed.`);
      return;
    }
    const problems = draftProblems(draft);
    if (showProblems(problems)) return;
    // A sync while the form was open may have changed the task on another
    // device: keep that, and put on only what was changed here.
    const task = editedTask(openedDraft ?? draft, draft, editingId, Date.now(), find(editingId));
    page.keepShown(task.id);
    if (page.saveTasks(updateTask(page.tasks(), task))) {
      page.announce(
        inView(task, page.view())
          ? `Saved ${task.title}.`
          : `Saved ${task.title}. It isn’t in ${page.viewName()} any more.`,
      );
    }
    if (task.reminder !== null) page.offerNotifications();
    savedId = task.id;
    editor.close();
  });

  required<HTMLButtonElement>(editor, '[data-action="cancel"]').addEventListener('click', () => {
    editor.close();
  });

  required<HTMLButtonElement>(editor, '[data-action="delete"]').addEventListener('click', () => {
    const task = find(editingId);
    if (!task) {
      if (openedDraft) closeDeleted(`${openedDraft.title} was already deleted.`);
      return;
    }
    deleteName.textContent = task.title;
    deleteDialog.returnValue = '';
    // Opens on top of the form; "Cancel" goes back to it.
    deleteDialog.showModal();
  });

  deleteDialog.addEventListener('close', () => {
    if (deleteDialog.returnValue !== 'confirm') return;
    const task = find(editingId);
    if (!task) {
      if (openedDraft) closeDeleted(`${openedDraft.title} was already deleted.`);
      return;
    }
    editingId = null;
    opener = focusSpot(page.viewHeading);
    if (page.saveTasks(removeTask(page.tasks(), task.id))) page.announce(`Deleted ${task.title}.`);
    editor.close();
  });

  return { open, refresh };
}
