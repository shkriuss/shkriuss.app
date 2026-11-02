/**
 * Tasks' page behaviour: connects pages/index.astro to the rules in
 * lib/tasks.ts and lib/lists.ts and saves everything on the device.
 *
 * "Add" puts a task in what's being shown (a list, or Important). Ticking a
 * task's box marks it done (a repeating one moves on to its next date);
 * unticking it under "Done" brings it back. A task's steps fold out under
 * it and can be ticked there. Tapping a title opens the task. When sync is
 * on, the newest change to each task and list wins.
 *
 * The rest has files of its own (audit 5 J-3): what's shown (All, Important
 * or a list) in views.ts; "My order", where tasks are moved by dragging
 * their handle, in order.ts; the task form in task-form.ts (its steps in
 * step-edits.ts); adding, renaming and deleting lists in list-editor.ts;
 * reminders in reminders.ts. The form and the list editor load after the
 * page itself (later.ts), so opening the page loads less (audit 5 J-2).
 */
import { today as todayOf } from '@shkriuss/dates';
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { focusSpot, keepFocus } from '@shkriuss/ui/keep-focus';
import { onNewDay } from '@shkriuss/ui/new-day';
import { PAGE_SIZE, shownCount, waitForTyping } from '@shkriuss/ui/long-lists';
import { clearProblem, focusProblem, reportSave, showProblem } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { watchTextLimit } from '@shkriuss/ui/text-limit';
import { site } from 'virtual:shkriuss/site';
import {
  emptyLists,
  isListsState,
  listName,
  LISTS_VERSION,
  type ListsState,
} from '../lib/lists.ts';
import {
  addTask,
  completeTask,
  defaultViewSettings,
  doneTasks,
  dueText,
  emptyTasks,
  formatDay,
  isTasksState,
  isViewSettings,
  matchesSearch,
  MAX_TASKS,
  migrateTasks,
  newTask,
  NO_LIST,
  openGroups,
  orderedTasks,
  removeTasks,
  reopenTask,
  searchWords,
  repeatText,
  stepsText,
  tasksCount,
  TASKS_VERSION,
  tickStep,
  VIEW_SETTINGS_VERSION,
  WHEN_LABELS,
  whenOf,
  type Task,
  type TasksState,
  type ViewSettings,
  type When,
} from '../lib/tasks.ts';
import { later, whenIdle } from './later.ts';
import type { ListEditor } from './list-editor.ts';
import { mountOrder } from './order.ts';
import { mountReminders } from './reminders.ts';
import type { TaskForm } from './task-form.ts';
import { mountViews } from './views.ts';
import { required } from '@shkriuss/ui/dom';

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

/** Search results are read out this long after the last key press. */
const ANNOUNCE_DELAY_MS = 700;

export function mountTasks(root: Document): void {
  const addForm = required<HTMLFormElement>(root, '[data-add-form]');
  const addInput = required<HTMLInputElement>(addForm, '[name="title"]');
  const addError = required<HTMLElement>(addForm, '[data-add-error]');
  // A paste longer than the box takes is cut by the browser: say so (audit 5 F1-4).
  const addLimit = watchTextLimit(addInput);
  const addListButton = required<HTMLButtonElement>(root, '[data-action="add-list"]');
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
  const stepTemplate = required<HTMLTemplateElement>(root, '[data-step-template]');
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const searchInput = required<HTMLInputElement>(root, '[data-search]');
  const orderSelect = required<HTMLSelectElement>(root, '[data-order]');
  const moveHint = required<HTMLElement>(root, '[data-move-hint]');
  const orderedTemplate = required<HTMLTemplateElement>(root, '[data-ordered-template]');
  const clearDialog = required<HTMLDialogElement>(root, '[data-clear-dialog]');
  const clearText = required<HTMLElement>(clearDialog, '[data-clear-text]');

  let tasks = tasksStore.load();
  let lists = listsStore.load();
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
  /** A task's checkbox or title on the page, wherever it is. */
  const control = (id: string, selector: string): HTMLElement | null =>
    root.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] ${selector}`);
  /** Shows a task at the next draw, however far down it is. */
  const keepShown = (id: string): void => {
    reveal = id;
  };

  // What's shown: all tasks, the important ones, or a list (views.ts).
  const views = mountViews(root, {
    tasks: () => tasks,
    lists: () => lists,
    chosen() {
      firstPages();
      render();
    },
    announce,
  });
  const viewHeading = views.heading;

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
    const overdue = !done && whenOf(task, day) === 'overdue';
    due.classList.toggle('task__due--overdue', overdue);
    // By date, the "Overdue" heading says so; in My order, red alone would (audit 3 G-11).
    if (overdue && settings.order === 'mine') {
      const said = document.createElement('span');
      said.className = 'visually-hidden';
      said.textContent = ', overdue';
      due.append(said);
    }
    required<HTMLElement>(row, '[data-star]').hidden = !task.important;
    required<HTMLElement>(row, '[data-repeat-tag]').hidden = task.repeat === 'none';
    required<HTMLElement>(row, '[data-repeat]').textContent = repeatText(task.repeat, task.every);
    const reminder = !done && task.date !== null && task.reminder !== null;
    required<HTMLElement>(row, '[data-reminder-tag]').hidden = !reminder;
    // In a list, its name would only repeat the heading.
    const list = typeof views.view() === 'string' ? listName(lists, task.list) : '';
    required<HTMLElement>(row, '[data-list-tag]').hidden = list === '';
    required<HTMLElement>(row, '[data-list-name]').textContent = list;
    required<HTMLElement>(row, '[data-meta]').hidden =
      !task.important && task.date === null && task.repeat === 'none' && list === '';
    required<HTMLElement>(row, '[data-notes]').textContent = task.notes;

    // In "My order": the handle, and Move up / Move down once it's tapped.
    required<HTMLElement>(row, '[data-order-controls]').hidden = done || settings.order !== 'mine';
    const moving = order.moving() === task.id;
    const handle = required<HTMLElement>(row, '[data-handle]');
    handle.setAttribute('aria-label', `Move ${task.title}`);
    handle.setAttribute('aria-expanded', String(moving));
    required<HTMLElement>(row, '[data-move-buttons]').hidden = !moving;
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

  function render(): void {
    views.render();
    const view = views.view();
    // Changes from elsewhere end a drag.
    order.drawn();
    const mine = settings.order === 'mine';
    orderSelect.value = settings.order;
    moveHint.hidden = !mine;
    // Never hidden by paging: the task with focus, or one just changed.
    const focused = (root.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-id]');
    const keep = [reveal, focused?.dataset['id'], order.moving()];
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
    const view = views.view();
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
    addLimit.clear();
    addInput.focus();
  });

  addInput.addEventListener('input', () => {
    if (addInput.value.trim() === '') return;
    addError.textContent = '';
    addInput.removeAttribute('aria-invalid');
  });

  /**
   * Today, read afresh at a tap. The page looks for a new day once a minute,
   * so for up to a minute after midnight "today" was still yesterday, and a
   * repeating task ticked off then got today as its next date (audit 5 F1-7).
   */
  function todayNow(): void {
    const now = todayOf();
    if (now === day) return;
    day = now;
    render();
  }

  function markDone(task: Task): void {
    todayNow();
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
      const edit = (event.target as Element).closest('[data-action="edit"]');
      const id = edit?.closest<HTMLElement>('[data-id]')?.dataset['id'];
      const task = find(id ?? null);
      // The form may load first (the first tap after the page opened): by
      // then the task may have changed, or gone, on another device or tab.
      if (task) {
        // Focus goes back to the title tapped when the form closes. Safari
        // doesn't focus a button that's tapped or clicked, so where focus
        // was sent it to the heading at the top instead (audit 6 G-1).
        const from = focusSpot(edit);
        taskForm.use((form) => {
          form.open(find(task.id) ?? task, from);
          form.refresh();
        });
      }
    });
  }

  // ---------- My order: order.ts ----------

  const order = mountOrder(groupsBox, {
    tasks: () => tasks,
    view: views.view,
    search: () => search,
    find,
    saveTasks,
    render,
    keepShown,
    control,
    announce,
  });

  orderSelect.addEventListener('change', () => {
    settings = { order: orderSelect.value === 'mine' ? 'mine' : 'date' };
    report(viewStore.save(settings));
    order.reset();
    render();
    announce(
      settings.order === 'mine'
        ? 'Showing your own order. Drag a task by its handle to move it.'
        : 'Showing tasks by date.',
    );
  });

  // ---------- Searching, and deleting done tasks ----------

  /** How many tasks the search found, for screen readers. */
  function announceFound(): void {
    if (search.trim() === '') return;
    const view = views.view();
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
    order.reset();
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

  /** The done tasks "Delete done tasks?" counted, as it opened: Delete deletes only these. */
  let counted = new Set<string>();

  required<HTMLButtonElement>(root, '[data-action="clear-done"]').addEventListener('click', () => {
    typedSearch.flush();
    counted = new Set(doneTasks(tasks, views.view(), search).map((task) => task.id));
    const count = counted.size;
    clearText.textContent =
      count === 1
        ? 'The done task shown here will be removed. This can’t be undone.'
        : `The ${count} done tasks shown here will be removed. This can’t be undone.`;
    clearDialog.returnValue = '';
    clearDialog.showModal();
  });

  clearDialog.addEventListener('close', () => {
    if (clearDialog.returnValue !== 'confirm') return;
    // Only those it counted, if they're still done: a task ticked off on
    // another device meanwhile stays, and so does one made to do again
    // there (audit 7 F1-3).
    const done = doneTasks(tasks, views.view(), search).filter((task) => counted.has(task.id));
    if (saveTasks(removeTasks(tasks, new Set(done.map((task) => task.id))))) {
      announce(`Deleted ${done.length} done ${done.length === 1 ? 'task' : 'tasks'}.`);
    }
    viewHeading.focus();
  });

  // ---------- The task form and the lists: task-form.ts and list-editor.ts ----------

  const taskForm = later<TaskForm>(() =>
    import('./task-form.ts').then(({ mountTaskForm }) =>
      mountTaskForm(root, {
        tasks: () => tasks,
        lists: () => lists,
        view: views.view,
        viewName: () => views.name(),
        saveTasks,
        keepShown,
        control,
        announce,
        offerNotifications: () => reminders.offerNotifications(),
        viewHeading,
      }),
    ),
  );

  const listEditor = later<ListEditor>(() =>
    import('./list-editor.ts').then(({ mountListEditor }) =>
      mountListEditor(root, {
        lists: () => lists,
        tasks: () => tasks,
        view: views.view,
        setView: views.set,
        saveLists,
        saveTasks,
        announce,
        say,
        viewHeading,
      }),
    ),
  );

  addListButton.addEventListener('click', () =>
    listEditor.use((editor) => editor.add(addListButton)),
  );
  editListButton.addEventListener('click', () =>
    listEditor.use((editor) => editor.edit(editListButton)),
  );

  // ---------- Elsewhere ----------

  /** After changes from another device or tab: keyboard focus stays where it was (audit G-3). */
  function refresh(): void {
    tasks = tasksStore.load();
    lists = listsStore.load();
    reminders.changed();
    keepFocus(render, viewHeading);
    taskForm.now?.refresh();
    listEditor.now?.refresh();
  }

  // If Tasks is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key === viewStore.key) settings = viewStore.load();
    if (event.key === tasksStore.key || event.key === listsStore.key) refresh();
    else if (event.key === viewStore.key) keepFocus(render, viewHeading);
  });

  // At midnight, "Tomorrow" becomes "Today".
  onNewDay((now) => {
    day = now;
    keepFocus(render, viewHeading);
  }, root);

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
  // The parts that load later load now, while nothing else goes on, so a
  // tap finds them here and opens the form at once, within the tap: an
  // iPhone raises its keyboard only for a field focused then (audit 4 J-6).
  whenIdle(() => {
    taskForm.load();
    listEditor.load();
  });
}
