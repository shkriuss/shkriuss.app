/**
 * Tasks: adding, renaming and deleting lists (deleting one asks what to do
 * with its tasks). Split from tasks.ts (audit J-7). It loads after the page
 * itself (later() in tasks.ts), so the page starts with less to load
 * (audit 5 J-2): the page's "New list" and "Rename or delete this list"
 * buttons call add() and edit() once it has.
 */
import { required } from '@shkriuss/ui/dom';
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
  removeTasks,
  tasksCount,
  type TasksState,
  type View,
} from '../lib/tasks.ts';

/** When deleting a list: its tasks go too. */
const DELETE_TASKS = 'delete';

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
  /** "New list": the form for one. */
  add(): void;
  /** "Rename or delete this list": the form for the list shown. */
  edit(): void;
}

export function mountListEditor(root: Document, page: ListsPage): ListEditor {
  const viewList = required<HTMLUListElement>(root, '[data-views]');
  const listEditor = required<HTMLDialogElement>(root, '[data-list-dialog]');
  const listForm = required<HTMLFormElement>(listEditor, '[data-list-form]');
  const listTitle = required<HTMLElement>(listEditor, '[data-list-title]');
  const listInput = required<HTMLInputElement>(listForm, '[data-list-name-input]');
  const listError = required<HTMLElement>(listForm, '[data-list-error]');
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
  let listOpener: HTMLElement | null = null;
  let savedListId: string | null = null;

  function showListProblem(text: string | null): void {
    listError.textContent = text ?? '';
    if (text) listInput.setAttribute('aria-invalid', 'true');
    else listInput.removeAttribute('aria-invalid');
  }

  function openListEditor(list: List | null): void {
    editingListId = list?.id ?? null;
    listOpener = root.activeElement instanceof HTMLElement ? root.activeElement : null;
    limits.clear();
    showListProblem(null);
    listTitle.textContent = list ? 'Edit list' : 'New list';
    deleteListButton.hidden = list === null;
    listInput.value = list?.name ?? '';
    listEditor.showModal();
    listInput.focus();
  }

  listEditor.addEventListener('close', () => {
    const saved = savedListId
      ? viewList.querySelector<HTMLElement>(`[data-view="${CSS.escape(`list:${savedListId}`)}"]`)
      : null;
    (saved ?? (listOpener?.isConnected ? listOpener : page.viewHeading)).focus();
    savedListId = null;
    listOpener = null;
  });

  listInput.addEventListener('input', () => {
    if (listInput.hasAttribute('aria-invalid')) {
      showListProblem(listProblem(page.lists(), listInput.value, editingListId));
    }
  });

  listForm.addEventListener('submit', (event) => {
    event.preventDefault();
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
    const lists = page.lists();
    const name = listName(lists, editingListId ?? '');
    if (editingListId === null || name === '') return;
    const id = editingListId;
    const count = page.tasks().tasks.filter((task) => task.list === id).length;
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
    const name = listName(page.lists(), id ?? '');
    if (listDeleteDialog.returnValue !== 'confirm' || id === null || name === '') return;
    const choice = listTasks.value;
    const tasks = page.tasks();
    const inList = tasks.tasks.filter((task) => task.list === id);
    let saved = true;
    if (inList.length > 0) {
      saved = page.saveTasks(
        choice === DELETE_TASKS
          ? removeTasks(tasks, new Set(inList.map((task) => task.id)))
          : moveTasks(tasks, id, choice),
      );
    }
    saved = page.saveLists(removeList(page.lists(), id)) && saved;
    if (saved) page.announce(`Deleted list ${name}.`);
    editingListId = null;
    listOpener = page.viewHeading;
    listEditor.close();
  });

  return {
    add() {
      if (page.lists().lists.length >= MAX_LISTS) {
        page.say(
          `You have ${MAX_LISTS} lists, the most Tasks can keep. Delete one to add another.`,
        );
        return;
      }
      openListEditor(null);
    },
    edit() {
      const view = page.view();
      if (typeof view === 'string') return;
      const list = page.lists().lists.find((entry) => entry.id === view.list);
      if (list) openListEditor(list);
    },
  };
}
