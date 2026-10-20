/**
 * Tasks' page behaviour: connects pages/index.astro to the rules in
 * lib/tasks.ts and lib/lists.ts and saves everything on the device.
 *
 * "Add" puts a task in what's being shown (a list, or Important). Ticking a
 * task's box marks it done (a repeating one moves on to its next date);
 * unticking it under "Done" brings it back. Tapping a title opens the task.
 * When sync is on, the newest change to each task and list wins.
 */
import { today as todayOf } from '@shkriuss/dates';
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  addList,
  emptyLists,
  isListsState,
  listName,
  listProblem,
  LISTS_VERSION,
  MAX_LISTS,
  removeList,
  renameList,
  sortedLists,
  type List,
  type ListsState,
} from '../lib/lists.ts';
import {
  addTask,
  completeTask,
  doneTasks,
  draftOf,
  draftProblems,
  dueText,
  emptyTasks,
  formatDay,
  inView,
  isTasksState,
  MAX_TASKS,
  moveTasks,
  newTask,
  NO_LIST,
  openGroups,
  openPerList,
  removeTask,
  removeTasks,
  reopenTask,
  REPEAT_SHORT,
  taskFromDraft,
  tasksCount,
  TASKS_VERSION,
  updateTask,
  WHEN_LABELS,
  whenOf,
  type DraftField,
  type Task,
  type TaskDraft,
  type TasksState,
  type View,
  type When,
} from '../lib/tasks.ts';
import { mountReminders } from './reminders.ts';

const tasksStore = createStore<TasksState>({
  key: 'tasks',
  version: TASKS_VERSION,
  fallback: emptyTasks,
  validate: isTasksState,
});

const listsStore = createStore<ListsState>({
  key: 'task-lists',
  version: LISTS_VERSION,
  fallback: emptyLists,
  validate: isListsState,
});

const COULD_NOT_SAVE = 'Couldn’t save. Is this browser in private mode, or is storage blocked?';
/** Form fields with a place for a problem, in the order they appear. */
const FIELD_ORDER: DraftField[] = ['title', 'date', 'time'];
/** When deleting a list: its tasks go too. */
const DELETE_TASKS = 'delete';
/** How often to look for a new day (the groups change at midnight). */
const NEW_DAY_CHECK_MS = 60_000;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Tasks: missing element ${selector}`);
  return element;
}

const keyOf = (view: View): string => (typeof view === 'string' ? view : `list:${view.list}`);
const viewOf = (key: string): View =>
  key === 'all' || key === 'important' ? key : { list: key.slice('list:'.length) };

export function mountTasks(root: Document): void {
  const addForm = required<HTMLFormElement>(root, '[data-add-form]');
  const addInput = required<HTMLInputElement>(addForm, '[name="title"]');
  const addError = required<HTMLElement>(addForm, '[data-add-error]');
  const viewHeading = required<HTMLElement>(root, '[data-view-heading]');
  const message = required<HTMLElement>(root, '[data-message]');
  const viewList = required<HTMLUListElement>(root, '[data-views]');
  const editListButton = required<HTMLButtonElement>(root, '[data-action="edit-list"]');
  const empty = required<HTMLElement>(root, '[data-empty]');
  const groupsBox = required<HTMLElement>(root, '[data-groups]');
  const doneSection = required<HTMLDetailsElement>(root, '[data-done-section]');
  const doneSummary = required<HTMLElement>(root, '[data-done-summary]');
  const doneList = required<HTMLUListElement>(root, '[data-done-list]');
  const groupTemplate = required<HTMLTemplateElement>(root, '[data-group-template]');
  const taskTemplate = required<HTMLTemplateElement>(root, '[data-task-template]');
  const viewTemplate = required<HTMLTemplateElement>(root, '[data-view-template]');
  const announcer = required<HTMLElement>(root, '[data-announcer]');

  const editor = required<HTMLDialogElement>(root, '[data-task-dialog]');
  const form = required<HTMLFormElement>(editor, '[data-task-form]');
  const listField = required<HTMLElement>(form, '[data-list-field]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteName = required<HTMLElement>(deleteDialog, '[data-delete-name]');

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
  const clearDialog = required<HTMLDialogElement>(root, '[data-clear-dialog]');
  const clearText = required<HTMLElement>(clearDialog, '[data-clear-text]');

  let tasks = tasksStore.load();
  let lists = listsStore.load();
  let view: View = 'all';
  let day = todayOf();
  /** The task open in the form, where focus goes back to, and the task just saved. */
  let editingId: string | null = null;
  let opener: HTMLElement | null = null;
  let savedId: string | null = null;
  /** The same for the list form (null: a new list). */
  let editingListId: string | null = null;
  let listOpener: HTMLElement | null = null;
  let savedListId: string | null = null;

  const announce = (text: string): void => {
    announcer.textContent = text;
  };
  const say = (text: string | null): void => {
    message.hidden = text === null;
    message.textContent = text ?? '';
  };
  const find = (id: string | null): Task | undefined => tasks.tasks.find((task) => task.id === id);
  const viewName = (shown: View): string =>
    shown === 'all'
      ? 'All tasks'
      : shown === 'important'
        ? 'Important'
        : listName(lists, shown.list);
  const openCount = (shown: View): number =>
    tasks.tasks.filter((task) => task.done === null && inView(task, shown)).length;
  /** A task's checkbox or title on the page, wherever it is. */
  const control = (id: string, selector: string): HTMLElement | null =>
    root.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] ${selector}`);

  function saveTasks(next: TasksState): boolean {
    tasks = next;
    const saved = tasksStore.save(tasks);
    say(saved ? null : COULD_NOT_SAVE);
    reminders.changed();
    sync.changed();
    render();
    return saved;
  }

  function saveLists(next: ListsState): boolean {
    lists = next;
    const saved = listsStore.save(lists);
    say(saved ? null : COULD_NOT_SAVE);
    sync.changed();
    render();
    return saved;
  }

  // ---------- The list ----------

  function renderTask(task: Task): HTMLLIElement {
    const fragment = taskTemplate.content.cloneNode(true) as DocumentFragment;
    const row = required<HTMLLIElement>(fragment, 'li');
    row.dataset['id'] = task.id;
    const done = task.done !== null;
    row.classList.toggle('task--done', done);
    required<HTMLInputElement>(row, '[data-done]').checked = done;
    required<HTMLElement>(row, '[data-done-label]').textContent = `Done: ${task.title}`;
    const edit = required<HTMLButtonElement>(row, '[data-action="edit"]');
    edit.textContent = task.title;
    edit.setAttribute('aria-label', `Edit ${task.title}`);

    const due = required<HTMLElement>(row, '[data-due]');
    due.textContent = dueText(task, day);
    due.classList.toggle('task__due--overdue', !done && whenOf(task, day) === 'overdue');
    required<HTMLElement>(row, '[data-star]').hidden = !task.important;
    required<HTMLElement>(row, '[data-repeat-tag]').hidden = task.repeat === 'none';
    required<HTMLElement>(row, '[data-repeat]').textContent = REPEAT_SHORT[task.repeat];
    const reminder = !done && task.date !== null && task.reminder !== null;
    required<HTMLElement>(row, '[data-reminder-tag]').hidden = !reminder;
    // In a list, its name would only repeat the heading.
    const list = typeof view === 'string' ? listName(lists, task.list) : '';
    required<HTMLElement>(row, '[data-list-tag]').hidden = list === '';
    required<HTMLElement>(row, '[data-list-name]').textContent = list;
    required<HTMLElement>(row, '[data-meta]').hidden =
      !task.important && task.date === null && task.repeat === 'none' && list === '';
    required<HTMLElement>(row, '[data-notes]').textContent = task.notes;
    return row;
  }

  function renderGroup(when: When, groupTasks: Task[]): HTMLElement {
    const fragment = groupTemplate.content.cloneNode(true) as DocumentFragment;
    const group = required<HTMLElement>(fragment, 'div');
    required<HTMLElement>(group, '[data-group-title]').textContent = WHEN_LABELS[when];
    required<HTMLElement>(group, '[data-group-tasks]').replaceChildren(
      ...groupTasks.map(renderTask),
    );
    return group;
  }

  function renderViews(): void {
    const perList = openPerList(tasks);
    const choices: { view: View; name: string; count: number }[] = [
      { view: 'all', name: 'All', count: openCount('all') },
      { view: 'important', name: 'Important', count: openCount('important') },
      ...sortedLists(lists).map((list: List) => ({
        view: { list: list.id },
        name: list.name,
        count: perList.get(list.id) ?? 0,
      })),
    ];
    // Keep focus on the same choice when the buttons are made again.
    const focused = (root.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-view]')
      ?.dataset['view'];
    viewList.replaceChildren(
      ...choices.map((choice) => {
        const fragment = viewTemplate.content.cloneNode(true) as DocumentFragment;
        const entry = required<HTMLLIElement>(fragment, 'li');
        const button = required<HTMLButtonElement>(entry, '[data-view]');
        button.dataset['view'] = keyOf(choice.view);
        button.setAttribute('aria-pressed', String(keyOf(choice.view) === keyOf(view)));
        required<HTMLElement>(entry, '[data-view-name]').textContent = choice.name;
        required<HTMLElement>(entry, '[data-view-count]').textContent = String(choice.count);
        return entry;
      }),
    );
    if (focused) {
      viewList.querySelector<HTMLElement>(`[data-view="${CSS.escape(focused)}"]`)?.focus();
    }
  }

  function render(): void {
    // A list deleted (here or on another device) can't stay shown.
    if (typeof view !== 'string' && listName(lists, view.list) === '') view = 'all';
    renderViews();
    viewHeading.textContent = viewName(view);
    editListButton.hidden = typeof view === 'string';

    const groups = openGroups(tasks, view, day);
    groupsBox.replaceChildren(...groups.map((group) => renderGroup(group.when, group.tasks)));
    const done = doneTasks(tasks, view);
    empty.hidden = groups.length > 0;
    empty.textContent =
      done.length > 0 ? 'All done here.' : 'Nothing to do here. Add a task above.';
    doneSection.hidden = done.length === 0;
    doneSummary.textContent = `Done (${done.length})`;
    doneList.replaceChildren(...done.map(renderTask));
  }

  // ---------- Adding, and ticking off ----------

  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = addInput.value;
    let problem: string | null = null;
    if (title.trim() === '') problem = 'Write what you need to do.';
    else if (tasks.tasks.length >= MAX_TASKS) {
      problem = `You can keep up to ${tasksCount(MAX_TASKS)}. Delete some done ones to add more.`;
    }
    addError.textContent = problem ?? '';
    if (problem) {
      addInput.setAttribute('aria-invalid', 'true');
      addInput.focus();
      return;
    }
    addInput.removeAttribute('aria-invalid');
    const task = newTask(title, crypto.randomUUID(), Date.now(), {
      list: typeof view === 'string' ? NO_LIST : view.list,
      important: view === 'important',
    });
    if (saveTasks(addTask(tasks, task))) {
      announce(`Added ${task.title}. Tap it to give it a date or a reminder.`);
    }
    addInput.value = '';
    addInput.focus();
  });

  addInput.addEventListener('input', () => {
    if (addInput.value.trim() === '') return;
    addError.textContent = '';
    addInput.removeAttribute('aria-invalid');
  });

  function markDone(task: Task): void {
    // Where focus goes once it leaves the list: the next task, or the one before.
    const rows = [...groupsBox.querySelectorAll<HTMLElement>('[data-id]')];
    const index = rows.findIndex((row) => row.dataset['id'] === task.id);
    const neighbour = (rows[index + 1] ?? rows[index - 1])?.dataset['id'];
    const { state, next } = completeTask(tasks, task.id, Date.now(), day, crypto.randomUUID());
    saveTasks(state);
    if (next) {
      control(task.id, '[data-done]')?.focus();
      announce(`Done: ${task.title}. Next: ${formatDay(next, day)}.`);
      return;
    }
    const nextBox = neighbour ? control(neighbour, '[data-done]') : null;
    (nextBox ?? viewHeading).focus();
    announce(`Done: ${task.title}.`);
  }

  function markToDo(task: Task): void {
    saveTasks(reopenTask(tasks, task.id, Date.now()));
    control(task.id, '[data-done]')?.focus();
    announce(`${task.title} is to do again.`);
  }

  for (const box of [groupsBox, doneList]) {
    box.addEventListener('change', (event) => {
      const checkbox = (event.target as Element).closest<HTMLInputElement>('[data-done]');
      const task = find(checkbox?.closest<HTMLElement>('[data-id]')?.dataset['id'] ?? null);
      if (!checkbox || !task) return;
      if (checkbox.checked) markDone(task);
      else markToDo(task);
    });
    box.addEventListener('click', (event) => {
      const id = (event.target as Element)
        .closest('[data-action="edit"]')
        ?.closest<HTMLElement>('[data-id]')?.dataset['id'];
      const task = find(id ?? null);
      if (task) openEditor(task);
    });
  }

  // ---------- What's shown ----------

  viewList.addEventListener('click', (event) => {
    const key = (event.target as Element).closest<HTMLElement>('[data-view]')?.dataset['view'];
    if (key === undefined) return;
    view = viewOf(key);
    render();
    announce(`${viewName(view)}: ${tasksCount(openCount(view))} to do.`);
  });

  required<HTMLButtonElement>(root, '[data-action="clear-done"]').addEventListener('click', () => {
    const count = doneTasks(tasks, view).length;
    clearText.textContent =
      count === 1
        ? 'The done task shown here will be removed. This can’t be undone.'
        : `The ${count} done tasks shown here will be removed. This can’t be undone.`;
    clearDialog.returnValue = '';
    clearDialog.showModal();
  });

  clearDialog.addEventListener('close', () => {
    if (clearDialog.returnValue !== 'confirm') return;
    const done = doneTasks(tasks, view);
    saveTasks(removeTasks(tasks, new Set(done.map((task) => task.id))));
    announce(`Deleted ${done.length} done ${done.length === 1 ? 'task' : 'tasks'}.`);
    viewHeading.focus();
  });

  // ---------- The task form ----------

  const field = <T extends HTMLElement>(name: string): T => required<T>(form, `[name="${name}"]`);
  const textFields = ['title', 'date', 'time'] as const;

  function readDraft(): TaskDraft {
    const value = (name: string): string =>
      field<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name).value;
    return {
      title: value('title'),
      notes: value('notes'),
      list: value('list'),
      important: field<HTMLInputElement>('important').checked,
      date: value('date'),
      time: value('time'),
      repeat: value('repeat'),
      reminder: value('reminder'),
    };
  }

  function fillForm(draft: TaskDraft): void {
    for (const name of textFields) field<HTMLInputElement>(name).value = draft[name];
    field<HTMLTextAreaElement>('notes').value = draft.notes;
    field<HTMLSelectElement>('repeat').value = draft.repeat;
    field<HTMLSelectElement>('reminder').value = draft.reminder;
    field<HTMLInputElement>('important').checked = draft.important;
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

  /** Shows each problem next to its field. With `onlyClear`, only removes fixed ones. */
  function showProblems(problems: Partial<Record<DraftField, string>>, onlyClear = false): void {
    for (const name of [...FIELD_ORDER, 'form'] as DraftField[]) {
      const text = problems[name] ?? '';
      if (onlyClear && text) continue;
      required<HTMLElement>(form, `[data-error-for="${name}"]`).textContent = text;
      const input = form.querySelector<HTMLElement>(`[name="${name}"]`);
      if (text) input?.setAttribute('aria-invalid', 'true');
      else input?.removeAttribute('aria-invalid');
    }
  }

  function openEditor(task: Task): void {
    editingId = task.id;
    opener = root.activeElement instanceof HTMLElement ? root.activeElement : null;
    showProblems({});
    fillForm(draftOf(task));
    editor.showModal();
    field<HTMLInputElement>('title').focus();
  }

  // However the form closes (Save, Cancel, Escape), put focus somewhere useful.
  editor.addEventListener('close', () => {
    const saved = savedId ? control(savedId, '[data-action="edit"]') : null;
    (saved ?? (opener?.isConnected ? opener : viewHeading)).focus();
    savedId = null;
    opener = null;
  });

  // Clear a field's problem as soon as it's fixed.
  form.addEventListener('input', () => {
    if (form.querySelector('[aria-invalid="true"]')) showProblems(draftProblems(readDraft()), true);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (editingId === null) return;
    const draft = readDraft();
    const problems = draftProblems(draft);
    showProblems(problems);
    const first = FIELD_ORDER.find((name) => problems[name]);
    if (first) {
      form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    const task = taskFromDraft(draft, editingId, Date.now(), find(editingId));
    if (saveTasks(updateTask(tasks, task))) {
      announce(
        inView(task, view)
          ? `Saved ${task.title}.`
          : `Saved ${task.title}. It isn’t in ${viewName(view)} any more.`,
      );
    }
    if (task.reminder !== null) reminders.offerNotifications();
    savedId = task.id;
    editor.close();
  });

  required<HTMLButtonElement>(editor, '[data-action="cancel"]').addEventListener('click', () => {
    editor.close();
  });

  required<HTMLButtonElement>(editor, '[data-action="delete"]').addEventListener('click', () => {
    const task = find(editingId);
    if (!task) return;
    deleteName.textContent = task.title;
    deleteDialog.returnValue = '';
    // Opens on top of the form; "Cancel" goes back to it.
    deleteDialog.showModal();
  });

  deleteDialog.addEventListener('close', () => {
    const task = find(editingId);
    if (deleteDialog.returnValue !== 'confirm' || !task) return;
    editingId = null;
    opener = viewHeading;
    saveTasks(removeTask(tasks, task.id));
    announce(`Deleted ${task.title}.`);
    editor.close();
  });

  // ---------- Lists ----------

  function showListProblem(text: string | null): void {
    listError.textContent = text ?? '';
    if (text) listInput.setAttribute('aria-invalid', 'true');
    else listInput.removeAttribute('aria-invalid');
  }

  function openListEditor(list: List | null): void {
    editingListId = list?.id ?? null;
    listOpener = root.activeElement instanceof HTMLElement ? root.activeElement : null;
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
    (saved ?? (listOpener?.isConnected ? listOpener : viewHeading)).focus();
    savedListId = null;
    listOpener = null;
  });

  required<HTMLButtonElement>(root, '[data-action="add-list"]').addEventListener('click', () => {
    if (lists.lists.length >= MAX_LISTS) {
      say(`You have ${MAX_LISTS} lists, the most Tasks can keep. Delete one to add another.`);
      return;
    }
    openListEditor(null);
  });

  editListButton.addEventListener('click', () => {
    if (typeof view === 'string') return;
    const id = view.list;
    const list = lists.lists.find((entry) => entry.id === id);
    if (list) openListEditor(list);
  });

  listInput.addEventListener('input', () => {
    if (listInput.hasAttribute('aria-invalid')) {
      showListProblem(listProblem(lists, listInput.value, editingListId));
    }
  });

  listForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const problem = listProblem(lists, listInput.value, editingListId);
    showListProblem(problem);
    if (problem) {
      listInput.focus();
      return;
    }
    const id = editingListId ?? crypto.randomUUID();
    const added = editingListId === null;
    // A new list is shown straight away, ready for its tasks.
    if (added) view = { list: id };
    const next = added
      ? addList(lists, id, listInput.value)
      : renameList(lists, id, listInput.value);
    if (saveLists(next)) {
      announce(added ? `Added list ${listName(next, id)}.` : `Saved list ${listName(next, id)}.`);
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
    const name = listName(lists, editingListId ?? '');
    if (editingListId === null || name === '') return;
    const id = editingListId;
    const count = tasks.tasks.filter((task) => task.list === id).length;
    listDeleteName.textContent = name;
    // Its tasks can stay (without a list), move to another list, or go too.
    listTasksField.hidden = count === 0;
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
    const name = listName(lists, id ?? '');
    if (listDeleteDialog.returnValue !== 'confirm' || id === null || name === '') return;
    const choice = listTasks.value;
    const inList = tasks.tasks.filter((task) => task.list === id);
    if (inList.length > 0) {
      saveTasks(
        choice === DELETE_TASKS
          ? removeTasks(tasks, new Set(inList.map((task) => task.id)))
          : moveTasks(tasks, id, choice),
      );
    }
    saveLists(removeList(lists, id));
    announce(`Deleted list ${name}.`);
    editingListId = null;
    listOpener = viewHeading;
    listEditor.close();
  });

  // ---------- Elsewhere ----------

  /** After changes from another device or tab. */
  function refresh(): void {
    tasks = tasksStore.load();
    lists = listsStore.load();
    reminders.changed();
    render();
  }

  // If Tasks is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key === tasksStore.key || event.key === listsStore.key) refresh();
  });

  // At midnight, "Tomorrow" becomes "Today".
  const checkDay = (): void => {
    if (todayOf() === day) return;
    day = todayOf();
    render();
  };
  window.setInterval(checkDay, NEW_DAY_CHECK_MS);
  root.addEventListener('visibilitychange', () => {
    if (root.visibilityState === 'visible') checkDay();
  });

  const reminders = mountReminders(root, { tasks: () => tasks, announce });

  // Sync between devices through the shkriuss account (if turned on). For a
  // task or list changed on two devices at once, the newest change wins.
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store: tasksStore,
        items: (value) => value.tasks,
        withItems: (value, list) => ({ ...value, tasks: list }),
      }),
      syncedStore({
        store: listsStore,
        items: (value) => value.lists,
        withItems: (value, list) => ({ ...value, lists: list }),
      }),
    ],
    onChange: refresh,
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  render();
}
