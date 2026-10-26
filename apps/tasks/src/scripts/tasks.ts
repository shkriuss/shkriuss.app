/**
 * Tasks' page behaviour: connects pages/index.astro to the rules in
 * lib/tasks.ts and lib/lists.ts and saves everything on the device.
 *
 * "Add" puts a task in what's being shown (a list, or Important). Ticking a
 * task's box marks it done (a repeating one moves on to its next date);
 * unticking it under "Done" brings it back. A task's steps fold out under
 * it and can be ticked there. Tapping a title opens the task. In "My order",
 * tasks are moved by dragging their handle (or Move up / Move down, or the
 * arrow keys on the handle); the order is the order of the saved tasks.
 * When sync is on, the newest change to each task and list wins.
 *
 * The steps in the task form are in step-edits.ts; adding, renaming and
 * deleting lists, in list-editor.ts; reminders, in reminders.ts.
 */
import { today as todayOf } from '@shkriuss/dates';
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { focusSpot, keepFocus, returnFocus, type FocusSpot } from '@shkriuss/ui/keep-focus';
import { PAGE_SIZE, shownCount, waitForTyping } from '@shkriuss/ui/long-lists';
import { clearProblem, focusProblem, reportSave, showProblem } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  emptyLists,
  isListsState,
  listName,
  LISTS_VERSION,
  sortedLists,
  type List,
  type ListsState,
} from '../lib/lists.ts';
import {
  addTask,
  completeTask,
  defaultViewSettings,
  doneTasks,
  draftOf,
  draftProblems,
  dueText,
  editedTask,
  emptyTasks,
  formatDay,
  inView,
  isTasksState,
  isViewSettings,
  matchesSearch,
  MAX_TASKS,
  migrateTasks,
  moveTask,
  newTask,
  NO_LIST,
  openGroups,
  openPerList,
  orderedTasks,
  removeTask,
  removeTasks,
  reopenTask,
  searchWords,
  repeatText,
  everyUnit,
  parseEvery,
  stepsText,
  tasksCount,
  TASKS_VERSION,
  tickStep,
  updateTask,
  VIEW_SETTINGS_VERSION,
  WHEN_LABELS,
  whenOf,
  type DraftField,
  type Task,
  type TaskDraft,
  type TasksState,
  type View,
  type ViewSettings,
  type When,
} from '../lib/tasks.ts';
import { mountListEditor } from './list-editor.ts';
import { mountReminders } from './reminders.ts';
import { mountStepEdits } from './step-edits.ts';
import { required, showFieldProblems } from '@shkriuss/ui/dom';

const tasksStore = createStore<TasksState>({
  key: 'tasks',
  version: TASKS_VERSION,
  fallback: emptyTasks,
  validate: isTasksState,
  migrate: migrateTasks,
});

const listsStore = createStore<ListsState>({
  key: 'task-lists',
  version: LISTS_VERSION,
  fallback: emptyLists,
  validate: isListsState,
});

/** How tasks are shown on this device (by date or in your own order); not synced. */
const viewStore = createStore<ViewSettings>({
  key: 'task-view',
  version: VIEW_SETTINGS_VERSION,
  fallback: defaultViewSettings,
  validate: isViewSettings,
});

/** Form fields with a place for a problem, in the order they appear. */
const FIELD_ORDER: DraftField[] = ['title', 'date', 'time', 'every'];
/** How often to look for a new day (the groups change at midnight). */
const NEW_DAY_CHECK_MS = 60_000;
/** A handle has to move this far (px) before it counts as dragging, not a tap. */
const DRAG_START_PX = 6;
/** While dragging this close (px) to the top or bottom of the screen, it scrolls. */
const SCROLL_EDGE_PX = 64;
const SCROLL_STEP_PX = 16;
/** Search results are read out this long after the last key press. */
const ANNOUNCE_DELAY_MS = 700;

const keyOf = (view: View): string => (typeof view === 'string' ? view : `list:${view.list}`);
const viewOf = (key: string): View =>
  key === 'all' || key === 'important' ? key : { list: key.slice('list:'.length) };

export function mountTasks(root: Document): void {
  const addForm = required<HTMLFormElement>(root, '[data-add-form]');
  const addInput = required<HTMLInputElement>(addForm, '[name="title"]');
  const addError = required<HTMLElement>(addForm, '[data-add-error]');
  const viewHeading = required<HTMLElement>(root, '[data-view-heading]');
  const viewList = required<HTMLUListElement>(root, '[data-views]');
  const editListButton = required<HTMLButtonElement>(root, '[data-action="edit-list"]');
  const empty = required<HTMLElement>(root, '[data-empty]');
  const groupsBox = required<HTMLElement>(root, '[data-groups]');
  const doneSection = required<HTMLDetailsElement>(root, '[data-done-section]');
  const doneSummary = required<HTMLElement>(root, '[data-done-summary]');
  const doneList = required<HTMLUListElement>(root, '[data-done-list]');
  const openMore = required<HTMLElement>(root, '[data-open-more]');
  const doneMore = required<HTMLElement>(root, '[data-done-more]');
  const groupTemplate = required<HTMLTemplateElement>(root, '[data-group-template]');
  const taskTemplate = required<HTMLTemplateElement>(root, '[data-task-template]');
  const viewTemplate = required<HTMLTemplateElement>(root, '[data-view-template]');
  const stepTemplate = required<HTMLTemplateElement>(root, '[data-step-template]');
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const searchInput = required<HTMLInputElement>(root, '[data-search]');
  const orderSelect = required<HTMLSelectElement>(root, '[data-order]');
  const moveHint = required<HTMLElement>(root, '[data-move-hint]');
  const orderedTemplate = required<HTMLTemplateElement>(root, '[data-ordered-template]');

  const editor = required<HTMLDialogElement>(root, '[data-task-dialog]');
  const form = required<HTMLFormElement>(editor, '[data-task-form]');
  const listField = required<HTMLElement>(form, '[data-list-field]');
  const everyField = required<HTMLElement>(form, '[data-every-field]');
  const everyUnitText = required<HTMLElement>(form, '[data-every-unit]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteName = required<HTMLElement>(deleteDialog, '[data-delete-name]');

  const clearDialog = required<HTMLDialogElement>(root, '[data-clear-dialog]');
  const clearText = required<HTMLElement>(clearDialog, '[data-clear-text]');

  let tasks = tasksStore.load();
  let lists = listsStore.load();
  let view: View = 'all';
  let settings = viewStore.load();
  /** What's typed in Search ("" for everything). */
  let search = '';
  /** Tasks to do, and done ones, shown so far ("Show more" adds a page: audit J-1). */
  let openShown = PAGE_SIZE;
  let doneShown = PAGE_SIZE;
  /** A task just added, saved, moved or ticked back to do: shown, however far down it is. */
  let reveal: string | null = null;
  let announceTimer: number | undefined;
  let day = todayOf();
  /** The task showing Move up / Move down, and the one being dragged. */
  let movingId: string | null = null;
  let drag: {
    id: string;
    row: HTMLElement;
    list: HTMLElement;
    pointerId: number;
    startY: number;
    moved: boolean;
  } | null = null;
  /** A drag ends with a click on the handle; that click isn't a tap. */
  let suppressClick = false;
  /** The task open in the form, where focus goes back to, and the task just saved. */
  let editingId: string | null = null;
  /** The form as it opened, to tell what the person changed (see editedTask). */
  let openedDraft: TaskDraft | null = null;
  let opener: FocusSpot | null = null;
  let savedId: string | null = null;
  /** Tasks whose steps are folded out in the list. */
  const openSteps = new Set<string>();

  const announce = (text: string): void => {
    announcer.textContent = text;
  };
  /** A message say() showed in the page's notice (read out too), taken away by the next save. */
  let said: string | null = null;
  const say = (text: string): void => {
    showProblem(text);
    said = text;
  };
  /** Tells the person if saving didn't work; once it does, takes say()'s message away. */
  const report = (saved: boolean): boolean => {
    if (reportSave(saved) && said !== null) {
      clearProblem(said);
      said = null;
    }
    return saved;
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
    const saved = report(tasksStore.save(tasks));
    reminders.changed();
    sync.changed();
    render();
    return saved;
  }

  function saveLists(next: ListsState): boolean {
    lists = next;
    const saved = report(listsStore.save(lists));
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
    required<HTMLElement>(row, '[data-repeat]').textContent = repeatText(task.repeat, task.every);
    const reminder = !done && task.date !== null && task.reminder !== null;
    required<HTMLElement>(row, '[data-reminder-tag]').hidden = !reminder;
    // In a list, its name would only repeat the heading.
    const list = typeof view === 'string' ? listName(lists, task.list) : '';
    required<HTMLElement>(row, '[data-list-tag]').hidden = list === '';
    required<HTMLElement>(row, '[data-list-name]').textContent = list;
    required<HTMLElement>(row, '[data-meta]').hidden =
      !task.important && task.date === null && task.repeat === 'none' && list === '';
    required<HTMLElement>(row, '[data-notes]').textContent = task.notes;

    // In "My order": the handle, and Move up / Move down once it's tapped.
    required<HTMLElement>(row, '[data-order-controls]').hidden = done || settings.order !== 'mine';
    const handle = required<HTMLElement>(row, '[data-handle]');
    handle.setAttribute('aria-label', `Move ${task.title}`);
    handle.setAttribute('aria-expanded', String(movingId === task.id));
    required<HTMLElement>(row, '[data-move-buttons]').hidden = movingId !== task.id;
    required<HTMLElement>(row, '[data-action="move-up"]').setAttribute(
      'aria-label',
      `Move ${task.title} up`,
    );
    required<HTMLElement>(row, '[data-action="move-down"]').setAttribute(
      'aria-label',
      `Move ${task.title} down`,
    );

    const steps = required<HTMLDetailsElement>(row, '[data-steps]');
    steps.hidden = task.steps.length === 0;
    steps.open = openSteps.has(task.id);
    required<HTMLElement>(steps, '[data-steps-of]').textContent = `Steps of ${task.title}:`;
    required<HTMLElement>(steps, '[data-steps-count]').textContent = stepsText(task);
    required<HTMLElement>(steps, '[data-steps-list]').replaceChildren(
      ...task.steps.map((step) => {
        const item = (stepTemplate.content.cloneNode(true) as DocumentFragment).firstElementChild;
        if (!(item instanceof HTMLLIElement)) throw new Error('Tasks: bad step template');
        const box = required<HTMLInputElement>(item, '[data-step-done]');
        box.dataset['stepId'] = step.id;
        box.checked = step.done;
        required<HTMLElement>(item, '[data-step-title]').textContent = step.title;
        return item;
      }),
    );
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

    // Changes from elsewhere end a drag.
    drag = null;
    const mine = settings.order === 'mine';
    orderSelect.value = settings.order;
    moveHint.hidden = !mine;
    // Never hidden by paging: the task with focus, or one just changed.
    const focused = (root.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-id]');
    const keep = [reveal, focused?.dataset['id'], movingId];
    reveal = null;
    let open: number;
    let openTotal: number;
    if (mine) {
      const ordered = orderedTasks(tasks, view, search);
      openShown = shownCount(
        ordered.map((task) => task.id),
        openShown,
        keep,
      );
      const fragment = orderedTemplate.content.cloneNode(true) as DocumentFragment;
      const list = required<HTMLElement>(fragment, '[data-ordered]');
      list.replaceChildren(...ordered.slice(0, openShown).map(renderTask));
      groupsBox.replaceChildren(...(ordered.length > 0 ? [list] : []));
      open = ordered.length;
      openTotal = ordered.length;
    } else {
      const groups = openGroups(tasks, view, day, search);
      const all = groups.flatMap((group) => group.tasks);
      openShown = shownCount(
        all.map((task) => task.id),
        openShown,
        keep,
      );
      // The first openShown tasks, in their groups.
      let left = openShown;
      const shownGroups = groups.flatMap((group) => {
        if (left <= 0) return [];
        const shownTasks = group.tasks.slice(0, left);
        left -= shownTasks.length;
        return [renderGroup(group.when, shownTasks)];
      });
      groupsBox.replaceChildren(...shownGroups);
      open = groups.length;
      openTotal = all.length;
    }
    openMore.hidden = openTotal <= openShown;
    const done = doneTasks(tasks, view, search);
    empty.hidden = open > 0;
    const searched = search.trim();
    if (searched === '') {
      empty.textContent =
        done.length > 0 ? 'All done here.' : 'Nothing to do here. Add a task above.';
    } else {
      empty.textContent =
        done.length > 0 ? `Nothing to do matches “${searched}”.` : `No tasks match “${searched}”.`;
    }
    doneSection.hidden = done.length === 0;
    doneSummary.textContent = `Done (${done.length})`;
    // Done tasks are drawn only while their list is open, a page at a time: there can be thousands.
    if (doneSection.open) {
      doneShown = shownCount(
        done.map((task) => task.id),
        doneShown,
        keep,
      );
    }
    doneList.replaceChildren(...(doneSection.open ? done.slice(0, doneShown).map(renderTask) : []));
    doneMore.hidden = !doneSection.open || done.length <= doneShown;
  }

  doneSection.addEventListener('toggle', () => {
    if (doneSection.open) render();
  });

  /** "Show more": the next page of tasks, with focus on the first of them. */
  function showMore(list: HTMLElement, done: boolean): void {
    const first = done ? doneShown : openShown;
    if (done) doneShown += PAGE_SIZE;
    else openShown += PAGE_SIZE;
    render();
    list.querySelectorAll<HTMLElement>('[data-action="edit"]')[first]?.focus();
  }
  required<HTMLElement>(openMore, '[data-action="more-open"]').addEventListener('click', () =>
    showMore(groupsBox, false),
  );
  required<HTMLElement>(doneMore, '[data-action="more-done"]').addEventListener('click', () =>
    showMore(doneList, true),
  );

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
      focusProblem(addInput, problem);
      return;
    }
    addInput.removeAttribute('aria-invalid');
    const task = newTask(title, crypto.randomUUID(), Date.now(), {
      list: typeof view === 'string' ? NO_LIST : view.list,
      important: view === 'important',
    });
    typedSearch.flush();
    // A search the new task doesn't match would hide it: clear the search.
    if (!matchesSearch(task, searchWords(search))) {
      search = '';
      searchInput.value = '';
    }
    reveal = task.id;
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
    const saved = saveTasks(state);
    if (next) {
      control(task.id, '[data-done]')?.focus();
      if (saved) announce(`Done: ${task.title}. Next: ${formatDay(next, day)}.`);
      return;
    }
    const nextBox = neighbour ? control(neighbour, '[data-done]') : null;
    (nextBox ?? viewHeading).focus();
    if (saved) announce(`Done: ${task.title}.`);
  }

  function tick(task: Task, stepId: string, done: boolean): void {
    const saved = saveTasks(tickStep(tasks, task.id, stepId, done, Date.now()));
    control(task.id, `[data-step-id="${CSS.escape(stepId)}"]`)?.focus();
    const ticked = find(task.id);
    const step = ticked?.steps.find((entry) => entry.id === stepId);
    if (!saved || !ticked || !step) return;
    announce(
      ticked.steps.every((entry) => entry.done)
        ? `${step.title}: done. All steps of ${ticked.title} are done.`
        : `${step.title}: ${done ? 'done' : 'not done'}. ${stepsText(ticked)}.`,
    );
  }

  function markToDo(task: Task): void {
    reveal = task.id;
    const saved = saveTasks(reopenTask(tasks, task.id, Date.now()));
    control(task.id, '[data-done]')?.focus();
    if (saved) announce(`${task.title} is to do again.`);
  }

  for (const box of [groupsBox, doneList]) {
    box.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      const task = find(target.closest<HTMLElement>('[data-id]')?.dataset['id'] ?? null);
      if (!task) return;
      const stepId = target.dataset['stepId'];
      if (stepId !== undefined) tick(task, stepId, target.checked);
      else if (target.matches('[data-done]')) {
        if (target.checked) markDone(task);
        else markToDo(task);
      }
    });
    // Remember which tasks have their steps folded out ("toggle" doesn't bubble).
    box.addEventListener(
      'toggle',
      (event) => {
        const steps = event.target as HTMLDetailsElement;
        const id = steps.closest<HTMLElement>('[data-id]')?.dataset['id'];
        if (!steps.matches('[data-steps]') || id === undefined) return;
        if (steps.open) openSteps.add(id);
        else openSteps.delete(id);
      },
      true,
    );
    box.addEventListener('click', (event) => {
      const id = (event.target as Element)
        .closest('[data-action="edit"]')
        ?.closest<HTMLElement>('[data-id]')?.dataset['id'];
      const task = find(id ?? null);
      if (task) openEditor(task);
    });
  }

  // ---------- My order: dragging, Move up / Move down, arrow keys ----------

  /** Moves a task, then puts focus back on the same control and says where it is. */
  function commitMove(
    task: Task,
    target: { before: string } | { after: string },
    focus: string,
  ): void {
    const next = moveTask(tasks, task.id, target);
    reveal = task.id;
    if (next !== tasks && !saveTasks(next)) {
      control(task.id, focus)?.focus();
      return;
    }
    control(task.id, focus)?.focus();
    const ordered = orderedTasks(tasks, view, search);
    const position = ordered.findIndex((entry) => entry.id === task.id) + 1;
    announce(`${task.title}: ${position} of ${ordered.length}.`);
  }

  /** One place up (-1) or down (1) among the tasks shown. */
  function moveBy(task: Task, step: -1 | 1, focus: string): void {
    const ordered = orderedTasks(tasks, view, search);
    const neighbour = ordered[ordered.findIndex((entry) => entry.id === task.id) + step];
    if (!neighbour) {
      announce(step < 0 ? `${task.title} is first already.` : `${task.title} is last already.`);
      return;
    }
    commitMove(task, step < 0 ? { before: neighbour.id } : { after: neighbour.id }, focus);
  }

  const taskOf = (element: Element): Task | undefined =>
    find(element.closest<HTMLElement>('[data-id]')?.dataset['id'] ?? null);

  groupsBox.addEventListener('pointerdown', (event) => {
    suppressClick = false;
    const handle = (event.target as Element).closest<HTMLElement>('[data-handle]');
    const row = handle?.closest<HTMLElement>('[data-id]');
    if (!handle || !row?.parentElement || event.button !== 0) return;
    drag = {
      id: row.dataset['id'] ?? '',
      row,
      list: row.parentElement,
      pointerId: event.pointerId,
      startY: event.clientY,
      moved: false,
    };
    handle.setPointerCapture(event.pointerId);
  });

  groupsBox.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.abs(event.clientY - drag.startY) < DRAG_START_PX) return;
      drag.moved = true;
      drag.row.classList.add('task--dragging');
      drag.list.classList.add('tasks--dragging');
    }
    event.preventDefault();
    // Past the middle of the task under the pointer: that task moves the
    // other way, so the dragged one (and its handle) stays where it is.
    for (const other of drag.list.children) {
      if (other === drag.row || !(other instanceof HTMLElement)) continue;
      const box = other.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom) continue;
      const middle = box.top + box.height / 2;
      const above =
        (other.compareDocumentPosition(drag.row) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
      if (above && event.clientY < middle) drag.list.insertBefore(other, drag.row.nextSibling);
      else if (!above && event.clientY > middle) drag.list.insertBefore(other, drag.row);
      break;
    }
    // Near the top or bottom of the screen: scroll, to reach tasks out of view.
    // (Straight away, not smoothly, to keep up with the finger.)
    if (event.clientY < SCROLL_EDGE_PX) {
      window.scrollBy({ top: -SCROLL_STEP_PX, behavior: 'instant' });
    } else if (event.clientY > window.innerHeight - SCROLL_EDGE_PX) {
      window.scrollBy({ top: SCROLL_STEP_PX, behavior: 'instant' });
    }
  });

  function endDrag(event: PointerEvent, cancelled: boolean): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { id, row, list, moved } = drag;
    drag = null;
    row.classList.remove('task--dragging');
    list.classList.remove('tasks--dragging');
    // Not moved: a tap, and the click that follows shows Move up / Move down.
    if (!moved) return;
    suppressClick = true;
    const task = find(id);
    if (cancelled || !task) {
      render();
      return;
    }
    const next = (row.nextElementSibling as HTMLElement | null)?.dataset['id'];
    const previous = (row.previousElementSibling as HTMLElement | null)?.dataset['id'];
    if (next) commitMove(task, { before: next }, '[data-handle]');
    else if (previous) commitMove(task, { after: previous }, '[data-handle]');
  }

  groupsBox.addEventListener('pointerup', (event) => endDrag(event, false));
  groupsBox.addEventListener('pointercancel', (event) => endDrag(event, true));

  groupsBox.addEventListener('click', (event) => {
    const clicked = (event.target as Element).closest<HTMLElement>(
      '[data-handle], [data-action="move-up"], [data-action="move-down"]',
    );
    const task = clicked ? taskOf(clicked) : undefined;
    if (!clicked || !task) return;
    if (clicked.matches('[data-handle]')) {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      movingId = movingId === task.id ? null : task.id;
      render();
      control(task.id, movingId ? '[data-action="move-up"]' : '[data-handle]')?.focus();
      return;
    }
    const up = clicked.matches('[data-action="move-up"]');
    moveBy(task, up ? -1 : 1, up ? '[data-action="move-up"]' : '[data-action="move-down"]');
  });

  groupsBox.addEventListener('keydown', (event) => {
    const handle = (event.target as Element).closest<HTMLElement>('[data-handle]');
    const task = handle ? taskOf(handle) : undefined;
    if (!task || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    moveBy(task, event.key === 'ArrowUp' ? -1 : 1, '[data-handle]');
  });

  orderSelect.addEventListener('change', () => {
    settings = { order: orderSelect.value === 'mine' ? 'mine' : 'date' };
    report(viewStore.save(settings));
    movingId = null;
    render();
    announce(
      settings.order === 'mine'
        ? 'Showing your own order. Drag a task by its handle to move it.'
        : 'Showing tasks by date.',
    );
  });

  // ---------- What's shown ----------

  /** How many tasks the search found, for screen readers. */
  function announceFound(): void {
    if (search.trim() === '') return;
    const found = orderedTasks(tasks, view, search).length + doneTasks(tasks, view, search).length;
    announce(`${tasksCount(found)} found.`);
  }

  /** A new search (or view) shows its first page again. */
  function firstPages(): void {
    openShown = PAGE_SIZE;
    doneShown = PAGE_SIZE;
  }

  // The list is drawn again once typing pauses, not at every key (audit J-1).
  const typedSearch = waitForTyping(() => {
    if (search === searchInput.value) return;
    search = searchInput.value;
    movingId = null;
    firstPages();
    render();
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(announceFound, ANNOUNCE_DELAY_MS);
  });
  searchInput.addEventListener('input', typedSearch);

  // Escape clears the search (as browsers do for search boxes, in every browser).
  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || searchInput.value === '') return;
    event.preventDefault();
    typedSearch.cancel();
    searchInput.value = '';
    search = '';
    firstPages();
    render();
    announce('Search cleared.');
  });

  viewList.addEventListener('click', (event) => {
    const key = (event.target as Element).closest<HTMLElement>('[data-view]')?.dataset['view'];
    if (key === undefined) return;
    view = viewOf(key);
    firstPages();
    render();
    announce(`${viewName(view)}: ${tasksCount(openCount(view))} to do.`);
  });

  required<HTMLButtonElement>(root, '[data-action="clear-done"]').addEventListener('click', () => {
    typedSearch.flush();
    const count = doneTasks(tasks, view, search).length;
    clearText.textContent =
      count === 1
        ? 'The done task shown here will be removed. This can’t be undone.'
        : `The ${count} done tasks shown here will be removed. This can’t be undone.`;
    clearDialog.returnValue = '';
    clearDialog.showModal();
  });

  clearDialog.addEventListener('close', () => {
    if (clearDialog.returnValue !== 'confirm') return;
    const done = doneTasks(tasks, view, search);
    if (saveTasks(removeTasks(tasks, new Set(done.map((task) => task.id))))) {
      announce(`Deleted ${done.length} done ${done.length === 1 ? 'task' : 'tasks'}.`);
    }
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

  const stepEdits = mountStepEdits(root, form, announce);

  /** Shows each problem next to its field; focuses the first. Returns true if there are any. */
  const showProblems = (problems: Partial<Record<DraftField, string>>, onlyClear = false) =>
    showFieldProblems(form, [...FIELD_ORDER, 'form'], problems, {
      onlyClear,
      focusFirst: !onlyClear,
    });

  function openEditor(task: Task): void {
    editingId = task.id;
    opener = focusSpot();
    showProblems({});
    fillForm(draftOf(task));
    openedDraft = readDraft();
    editor.showModal();
    field<HTMLInputElement>('title').focus();
  }

  // However the form closes (Save, Cancel, Escape), put focus somewhere useful:
  // on the task just saved, or where the form was opened from (its new copy,
  // if the list was drawn again meanwhile: audit 3 G-3).
  editor.addEventListener('close', () => {
    const saved = savedId ? control(savedId, '[data-action="edit"]') : null;
    if (saved) saved.focus();
    else if (opener) {
      // Focus left in the closed form goes nowhere.
      const active = root.activeElement;
      if (active instanceof HTMLElement && editor.contains(active)) active.blur();
      returnFocus(opener, viewHeading);
    } else viewHeading.focus();
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
    if (showProblems(problems)) return;
    // A sync while the form was open may have changed the task on another
    // device: keep that, and put on only what was changed here.
    const task = editedTask(openedDraft ?? draft, draft, editingId, Date.now(), find(editingId));
    reveal = task.id;
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
    opener = focusSpot(viewHeading);
    if (saveTasks(removeTask(tasks, task.id))) announce(`Deleted ${task.title}.`);
    editor.close();
  });

  // ---------- Lists ----------

  mountListEditor(root, {
    lists: () => lists,
    tasks: () => tasks,
    view: () => view,
    setView(next) {
      view = next;
    },
    saveLists,
    saveTasks,
    announce,
    say,
    viewHeading,
  });

  // ---------- Elsewhere ----------

  /** After changes from another device or tab: keyboard focus stays where it was (audit G-3). */
  function refresh(): void {
    tasks = tasksStore.load();
    lists = listsStore.load();
    reminders.changed();
    keepFocus(render, viewHeading);
  }

  // If Tasks is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key === viewStore.key) settings = viewStore.load();
    if (event.key === tasksStore.key || event.key === listsStore.key) refresh();
    else if (event.key === viewStore.key) keepFocus(render, viewHeading);
  });

  // At midnight, "Tomorrow" becomes "Today".
  const checkDay = (): void => {
    if (todayOf() === day) return;
    day = todayOf();
    keepFocus(render, viewHeading);
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
