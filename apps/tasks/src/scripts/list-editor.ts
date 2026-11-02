/**
 * Tasks: adding, renaming and deleting lists (deleting one asks what to do
 * with its tasks). Split from tasks.ts (audit J-7). It loads after the page
 * itself (later() in tasks.ts), so the page starts with less to load
 * (audit 5 J-2): the page's "New list" and "Rename or delete this list"
 * buttons call add() and edit() once it has.
 */
import { required } from '@shkriuss/ui/dom';
import { focusSpot, returnFocus, type FocusSpot } from '@shkriuss/ui/keep-focus';
import { focusProblem } from '@shkriuss/ui/problem';
import { watchTextLimits } from '@shkriuss/ui/text-limit';
import {
  addList,
  listName,
  listProblem,
  MAX_LISTS,
  removeList,
  renameList,
  sortedLists,
  type List,
  type ListsState,
} from '../lib/lists.ts';
import {
  moveTasks,
  NO_LIST,
  removeListTasks,
  tasksCount,
  type TasksState,
  type View,
} from '../lib/tasks.ts';

/** When deleting a list: its tasks go too. */
const DELETE_TASKS = 'delete';
/** Said in the form when its list was deleted on another device or in another tab. */
const GONE =
  'This list was deleted on another device or in another tab. Saving a change brings it back.';

/** What the list editor needs from the page (tasks.ts). */
export interface ListsPage {
  lists(): ListsState;
  tasks(): TasksState;
  view(): View;
  /** Shows another view (drawn at the next save). */
  setView(view: View): void;
  /** Save and redraw; false if saving didn't work. */
  saveLists(next: ListsState): boolean;
  saveTasks(next: TasksState): boolean;
  announce(text: string): void;
  /** A message in the page's notice, read out too. */
  say(text: string): void;
  /** Where focus goes when there's nowhere better. */
  viewHeading: HTMLElement;
}

export interface ListEditor {
  /** "New list": the form for one. `from` is the button tapped, where focus goes back to. */
  add(from: HTMLElement): void;
  /** "Rename or delete this list": the form for the list shown. */
  edit(from: HTMLElement): void;
  /** After changes from another device or tab: says in the form if its list was deleted there. */
  refresh(): void;
}

export function mountListEditor(root: Document, page: ListsPage): ListEditor {
  const viewList = required<HTMLUListElement>(root, '[data-views]');
  const listEditor = required<HTMLDialogElement>(root, '[data-list-dialog]');
  const listForm = required<HTMLFormElement>(listEditor, '[data-list-form]');
  const listTitle = required<HTMLElement>(listEditor, '[data-list-title]');
  const listInput = required<HTMLInputElement>(listForm, '[data-list-name-input]');
  const listError = required<HTMLElement>(listForm, '[data-list-error]');
  const goneNote = required<HTMLElement>(listForm, '[data-list-gone-note]');
  const deleteListButton = required<HTMLButtonElement>(listEditor, '[data-action="delete-list"]');
  const listDeleteDialog = required<HTMLDialogElement>(root, '[data-list-delete-dialog]');
  const listDeleteName = required<HTMLElement>(listDeleteDialog, '[data-list-delete-name]');
  const listTasksField = required<HTMLElement>(listDeleteDialog, '[data-list-tasks-field]');
  const listTasksCount = required<HTMLElement>(listDeleteDialog, '[data-list-tasks-count]');
  const listTasks = required<HTMLSelectElement>(listDeleteDialog, '[data-list-tasks]');
  // A paste longer than the box takes is cut by the browser: say so (audit 5 F1-4).
  const limits = watchTextLimits(listForm);

  /** The list in the form (null: a new list), where focus goes back to, and the list just saved. */
  let editingListId: string | null = null;
  let listOpener: FocusSpot | null = null;
  let savedListId: string | null = null;
  /** The list's name as the form opened, to tell if it was changed and to name it once it's gone. */
  let openedName = '';
  /** The tasks "Delete this list?" counted, as it opened: "Delete them too" deletes only these. */
  let countedTasks = new Set<string>();

  const exists = (id: string | null): boolean => page.lists().lists.some((list) => list.id === id);

  function showListProblem(text: string | null): void {
    listError.textContent = text ?? '';
    if (text) listInput.setAttribute('aria-invalid', 'true');
    else listInput.removeAttribute('aria-invalid');
  }

  function openListEditor(list: List | null, from: HTMLElement): void {
    editingListId = list?.id ?? null;
    openedName = list?.name ?? '';
    // The button tapped, not where focus is: Safari doesn't focus a button
    // that's tapped (audit 6 G-1).
    listOpener = focusSpot(from);
    limits.clear();
    showListProblem(null);
    goneNote.hidden = true;
    listTitle.textContent = list ? 'Edit list' : 'New list';
    deleteListButton.hidden = list === null;
    listInput.value = openedName;
    listEditor.showModal();
    listInput.focus();
  }

  // On the list just saved, or where the form was opened from. That button
  // may be hidden now ("Rename or delete this list", once the list was
  // deleted in another tab): then on the heading, where focus fell to the
  // page itself (audit 6 G-3).
  listEditor.addEventListener('close', () => {
    const saved = savedListId
      ? viewList.querySelector<HTMLElement>(`[data-view="${CSS.escape(`list:${savedListId}`)}"]`)
      : null;
    if (saved) saved.focus();
    else {
      // Focus left in the closed form goes nowhere.
      const active = root.activeElement;
      if (active instanceof HTMLElement && listEditor.contains(active)) active.blur();
      returnFocus(listOpener, page.viewHeading);
    }
    savedListId = null;
    listOpener = null;
  });

  /** The form closes after its list was deleted, here or elsewhere. */
  function closeDeleted(message: string): void {
    editingListId = null;
    listOpener = focusSpot(page.viewHeading);
    page.announce(message);
    listEditor.close();
  }

  /**
   * Says in the form when its list was deleted on another device or in
   * another tab. It stays open, as a change wins over a deletion, but
   * Delete did nothing, and Save put the list back without a word (audit 6
   * G-3), as the task form did before (audit 4 F1-3).
   */
  function refresh(): void {
    const deleted = listEditor.open && editingListId !== null && !exists(editingListId);
    if (goneNote.hidden === !deleted) return;
    goneNote.hidden = !deleted;
    goneNote.textContent = deleted ? GONE : '';
    if (deleted) page.announce(GONE);
  }

  listInput.addEventListener('input', () => {
    if (listInput.hasAttribute('aria-invalid')) {
      showListProblem(listProblem(page.lists(), listInput.value, editingListId));
    }
  });

  listForm.addEventListener('submit', (event) => {
    event.preventDefault();
    // Deleted elsewhere, and nothing changed here: it stays deleted.
    if (editingListId !== null && !exists(editingListId) && listInput.value === openedName) {
      closeDeleted(`${openedName} stays deleted: nothing in it was changed.`);
      return;
    }
    const lists = page.lists();
    const problem = listProblem(lists, listInput.value, editingListId);
    showListProblem(problem);
    if (problem) {
      focusProblem(listInput, problem);
      return;
    }
    const id = editingListId ?? crypto.randomUUID();
    const added = editingListId === null;
    // A new list is shown straight away, ready for its tasks.
    if (added) page.setView({ list: id });
    const next = added
      ? addList(lists, id, listInput.value)
      : renameList(lists, id, listInput.value);
    if (page.saveLists(next)) {
      page.announce(
        added ? `Added list ${listName(next, id)}.` : `Saved list ${listName(next, id)}.`,
      );
    }
    savedListId = id;
    listEditor.close();
  });

  required<HTMLButtonElement>(listEditor, '[data-action="cancel-list"]').addEventListener(
    'click',
    () => {
      listEditor.close();
    },
  );

  deleteListButton.addEventListener('click', () => {
    if (editingListId === null) return;
    if (!exists(editingListId)) {
      closeDeleted(`${openedName} was already deleted.`);
      return;
    }
    const lists = page.lists();
    const name = listName(lists, editingListId);
    const id = editingListId;
    const inList = page.tasks().tasks.filter((task) => task.list === id);
    countedTasks = new Set(inList.map((task) => task.id));
    const count = inList.length;
    listDeleteName.textContent = name;
    // Its tasks can stay (without a list), move to another list, or go too.
    listTasksField.hidden = count === 0;
    // Read out as the dialog opens: the message, and that there are tasks to
    // choose about (a hidden field's label would still be read: audit 5 G-3).
    listDeleteDialog.setAttribute(
      'aria-describedby',
      count === 0 ? 'list-delete-message' : 'list-delete-message list-tasks-label',
    );
    listTasksCount.textContent = tasksCount(count);
    listTasks.replaceChildren(
      new Option('Keep them, without a list', NO_LIST),
      ...sortedLists(lists)
        .filter((list) => list.id !== id)
        .map((list) => new Option(`Move them to ${list.name}`, list.id)),
      new Option('Delete them too', DELETE_TASKS),
    );
    listTasks.value = NO_LIST;
    listDeleteDialog.returnValue = '';
    // Opens on top of the form; "Cancel" goes back to it.
    listDeleteDialog.showModal();
  });

  listDeleteDialog.addEventListener('close', () => {
    const id = editingListId;
    if (listDeleteDialog.returnValue !== 'confirm' || id === null) return;
    // Deleted elsewhere while "Delete this list?" was open.
    if (!exists(id)) {
      closeDeleted(`${openedName} was already deleted.`);
      return;
    }
    const name = listName(page.lists(), id);
    const choice = listTasks.value;
    const tasks = page.tasks();
    const inList = tasks.tasks.filter((task) => task.list === id);
    let saved = true;
    let kept = 0;
    if (inList.length > 0) {
      // Only the tasks it counted go: one added to the list on another
      // device meanwhile stays, without a list (audit 7 F1-3).
      const removed = choice === DELETE_TASKS ? removeListTasks(tasks, id, countedTasks) : null;
      kept = removed?.kept ?? 0;
      saved = page.saveTasks(removed?.state ?? moveTasks(tasks, id, choice));
    }
    saved = page.saveLists(removeList(page.lists(), id)) && saved;
    const keptText =
      kept === 0
        ? ''
        : ` ${tasksCount(kept)} added to it on another device meanwhile ${kept === 1 ? 'was' : 'were'} kept, without a list.`;
    if (saved) page.announce(`Deleted list ${name}.${keptText}`);
    editingListId = null;
    listOpener = focusSpot(page.viewHeading);
    listEditor.close();
  });

  return {
    add(from) {
      if (page.lists().lists.length >= MAX_LISTS) {
        page.say(
          `You have ${MAX_LISTS} lists, the most Tasks can keep. Delete one to add another.`,
        );
        return;
      }
      openListEditor(null, from);
    },
    edit(from) {
      const view = page.view();
      if (typeof view === 'string') return;
      const list = page.lists().lists.find((entry) => entry.id === view.list);
      if (list) openListEditor(list, from);
    },
    refresh,
  };
}
