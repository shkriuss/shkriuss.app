/**
 * Reminders' page behaviour: connects pages/index.astro to the rules in
 * lib/reminders.ts, saves on the device, and syncs when sync is on.
 * Notifications: notify.ts.
 */
import { nowStamp } from '@shkriuss/dates';
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  addReminder,
  clearDone,
  emptyReminders,
  groups,
  inAnHour,
  isRemindersState,
  nextFullHour,
  nextTime,
  problems,
  putOff,
  REPEATS,
  removeReminder,
  repeatLabel,
  secondVersion,
  setDone,
  tomorrowAt,
  updateReminder,
  whenInSentence,
  whenLabel,
  type Draft,
  type Item,
  type Problems,
  type RemindersState,
  type Repeat,
} from '../lib/reminders.ts';
import { mountNotify } from './notify.ts';

const store = createStore<RemindersState>({
  key: 'reminders',
  version: 1,
  fallback: emptyReminders,
  validate: isRemindersState,
});

/** How often the list is brought up to date (what's overdue, what's next). */
const REFRESH_MS = 20_000;
const COULD_NOT_SAVE = 'Couldn’t save. Your browser may be blocking storage.';
const GROUPS = [
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
  ['later', 'Later'],
] as const;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Reminders: missing element ${selector}`);
  return element;
}

/** A form with text, date, time and repeat fields (adding, and changing). */
function formFields(form: HTMLFormElement) {
  const field = <T extends HTMLElement>(name: string) => required<T>(form, `[name="${name}"]`);
  const text = field<HTMLInputElement>('text');
  const date = field<HTMLInputElement>('date');
  const time = field<HTMLInputElement>('time');
  const repeat = field<HTMLSelectElement>('repeat');
  const inputs = { text, date, time };

  /** Shows what's wrong; focuses the first field with a problem. Returns true if anything is. */
  function show(found: Problems): boolean {
    for (const [name, input] of Object.entries(inputs)) {
      const problem = found[name as keyof Problems];
      required<HTMLElement>(form, `[data-error-for="${name}"]`).textContent = problem ?? '';
      if (problem) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    const first = (['text', 'date', 'time'] as const).find((name) => found[name]);
    if (first) inputs[first].focus();
    return first !== undefined;
  }

  return {
    text,
    show,
    draft: (): Draft => ({
      text: text.value,
      date: date.value,
      time: time.value,
      repeat: REPEATS.find((entry) => entry === repeat.value) ?? 'none',
    }),
    fill(values: { text: string; date: string; time: string; repeat: Repeat }): void {
      text.value = values.text;
      date.value = values.date;
      time.value = values.time;
      repeat.value = values.repeat;
      show({});
    },
  };
}

export function mountReminders(root: Document): void {
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const addForm = required<HTMLFormElement>(root, '[data-add-form]');
  const add = formFields(addForm);
  const empty = required<HTMLElement>(root, '[data-empty]');
  const groupsBox = required<HTMLElement>(root, '[data-groups]');
  const groupTemplate = required<HTMLTemplateElement>(root, '[data-group-template]');
  const reminderTemplate = required<HTMLTemplateElement>(root, '[data-reminder-template]');
  const doneSection = required<HTMLDetailsElement>(root, '[data-done-section]');
  const doneCount = required<HTMLElement>(root, '[data-done-count]');
  const doneList = required<HTMLUListElement>(root, '[data-done-list]');
  const editDialog = required<HTMLDialogElement>(root, '[data-edit-dialog]');
  const editForm = required<HTMLFormElement>(editDialog, '[data-edit-form]');
  const edit = formFields(editForm);
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteText = required<HTMLElement>(deleteDialog, '[data-delete-text]');

  let state = store.load();
  let now = nowStamp();
  /** The reminder in the change form. */
  let editing: string | null = null;

  const announce = (message: string): void => {
    announcer.textContent = message;
  };
  const find = (id: string | null | undefined) =>
    state.reminders.find((reminder) => reminder.id === id);

  /** Saves, shows the change, and tells the notification service and other devices. */
  function save(next: RemindersState, message: string): void {
    state = next;
    announce(store.save(state) ? message : COULD_NOT_SAVE);
    render();
    notify.changed();
    sync.changed();
  }

  // ---------- The list ----------

  function renderItem(item: Item, kind: 'overdue' | 'upcoming' | 'done'): HTMLLIElement {
    const { reminder, at } = item;
    const fragment = reminderTemplate.content.cloneNode(true) as DocumentFragment;
    const li = required<HTMLLIElement>(fragment, 'li');
    li.dataset['id'] = reminder.id;
    li.classList.toggle('reminder--done', kind === 'done');
    li.classList.toggle('reminder--overdue', kind === 'overdue');

    const repeats = reminder.repeat !== 'none';
    if (repeats) {
      required<HTMLElement>(li, '[data-check]').remove();
    } else {
      required<HTMLElement>(li, '[data-repeats-mark]').remove();
      required<HTMLInputElement>(li, '[data-done]').checked = kind === 'done';
      required<HTMLElement>(li, '[data-done-label]').textContent = `${reminder.text}: done`;
    }
    required<HTMLElement>(li, '[data-action="edit"]').textContent = reminder.text;
    required<HTMLElement>(li, '[data-when]').textContent =
      kind === 'done' ? `Done ${whenInSentence(at, now)}` : whenLabel(at, now);
    const repeatTag = required<HTMLElement>(li, '[data-repeat-tag]');
    if (repeats)
      required<HTMLElement>(repeatTag, '[data-repeat]').textContent = repeatLabel(reminder);
    else repeatTag.remove();

    const later = required<HTMLElement>(li, '[data-later]');
    if (kind === 'overdue') {
      required<HTMLElement>(later, '[data-action="in-an-hour"]').setAttribute(
        'aria-label',
        `${reminder.text}: remind me in 1 hour`,
      );
      required<HTMLElement>(later, '[data-action="tomorrow"]').setAttribute(
        'aria-label',
        `${reminder.text}: remind me tomorrow`,
      );
    } else {
      later.remove();
    }
    return li;
  }

  function render(): void {
    now = nowStamp();
    // Keep keyboard focus on the same control after drawing the list again.
    const active = root.activeElement;
    const focusId = active?.closest<HTMLElement>('li[data-id]')?.dataset['id'];
    const focusAction =
      active?.getAttribute('data-action') ?? (active?.matches('[data-done]') ? 'done' : null);

    const found = groups(state, now);
    groupsBox.replaceChildren(
      ...GROUPS.filter(([key]) => found[key].length > 0).map(([key, title]) => {
        const fragment = groupTemplate.content.cloneNode(true) as DocumentFragment;
        const group = required<HTMLElement>(fragment, 'div');
        required<HTMLElement>(group, '[data-group-title]').textContent = title;
        required<HTMLElement>(group, '[data-group-list]').replaceChildren(
          ...found[key].map((item) => renderItem(item, key === 'overdue' ? 'overdue' : 'upcoming')),
        );
        return group;
      }),
    );
    empty.hidden = state.reminders.length > 0;
    doneSection.hidden = found.done.length === 0;
    doneCount.textContent = String(found.done.length);
    doneList.replaceChildren(...found.done.map((item) => renderItem(item, 'done')));

    if (focusId && focusAction) focusOn(focusId, focusAction);
  }

  /** Focuses a reminder's control (its tick box, or its text if it has none). */
  function focusOn(id: string, action: string): boolean {
    const item = root.querySelector<HTMLElement>(`li[data-id="${CSS.escape(id)}"]`);
    const control =
      item?.querySelector<HTMLElement>(
        action === 'done' ? '[data-done]' : `[data-action="${CSS.escape(action)}"]`,
      ) ?? item?.querySelector<HTMLElement>('[data-done], [data-action="edit"]');
    control?.focus();
    return Boolean(control);
  }

  /** After a reminder moved away: focus the one now in its place, or the form. */
  function focusNear(list: Element, index: number): void {
    const items = [...list.querySelectorAll<HTMLElement>('li[data-id]')];
    const next = items[Math.min(index, items.length - 1)];
    if (!next?.dataset['id'] || !focusOn(next.dataset['id'], 'done')) add.text.focus();
  }

  // ---------- Adding ----------

  function resetAdd(): void {
    const suggested = nextFullHour(nowStamp());
    add.fill({ text: '', date: suggested.date, time: suggested.time, repeat: 'none' });
  }

  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const draft = add.draft();
    if (add.show(problems(draft, state, nowStamp()))) return;
    const reminder = { id: crypto.randomUUID(), ...draft, text: draft.text.trim(), done: null };
    const at = nextTime(reminder, nowStamp());
    save(
      addReminder(state, reminder),
      at ? `Reminder set: ${reminder.text}, ${whenInSentence(at, now)}.` : 'Reminder set.',
    );
    resetAdd();
    add.text.focus();
    notify.offerNotifications();
  });

  // ---------- Done, later, and changing ----------

  function listOf(element: Element): Element {
    return element.closest('[data-done-list]') ?? groupsBox;
  }

  root.addEventListener('change', (event) => {
    const box = (event.target as Element).closest<HTMLInputElement>('[data-done]');
    const item = box?.closest<HTMLElement>('li[data-id]');
    const reminder = find(item?.dataset['id']);
    if (!box || !item || !reminder) return;
    const list = listOf(item);
    const index = [...list.querySelectorAll('li[data-id]')].indexOf(item);
    save(
      setDone(state, reminder.id, box.checked ? nowStamp() : null),
      box.checked ? `${reminder.text}: done.` : `${reminder.text}: not done.`,
    );
    focusNear(list, index);
  });

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-action]');
    const action = button?.dataset['action'];
    const reminder = find(button?.closest<HTMLElement>('li[data-id]')?.dataset['id']);
    if (action === 'clear-done') {
      save(clearDone(state), 'Cleared the done reminders.');
      add.text.focus();
      return;
    }
    if (!reminder) return;
    if (action === 'edit') openEditor(reminder.id);
    if (action === 'in-an-hour' || action === 'tomorrow') {
      const until =
        action === 'in-an-hour'
          ? inAnHour(nowStamp())
          : tomorrowAt(reminder, nowStamp().slice(0, 10));
      save(
        putOff(state, reminder.id, until),
        `${reminder.text}: ${whenInSentence(until, nowStamp())}.`,
      );
      focusOn(reminder.id, 'done');
    }
  });

  function openEditor(id: string): void {
    const reminder = find(id);
    if (!reminder) return;
    editing = id;
    edit.fill(reminder);
    editDialog.showModal();
  }

  editForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const reminder = find(editing);
    if (!reminder) {
      editDialog.close();
      return;
    }
    const draft = edit.draft();
    if (edit.show(problems(draft, state, nowStamp(), reminder.id))) return;
    editDialog.close();
    save(updateReminder(state, reminder.id, draft), `Saved ${draft.text.trim()}.`);
    focusOn(reminder.id, 'edit');
  });

  editForm.addEventListener('click', (event) => {
    const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset[
      'action'
    ];
    if (action === 'cancel') editDialog.close();
    if (action === 'delete') {
      const reminder = find(editing);
      if (!reminder) return;
      deleteText.textContent = reminder.text;
      deleteDialog.returnValue = '';
      deleteDialog.showModal();
    }
  });

  editDialog.addEventListener('close', () => {
    editing = null;
  });

  deleteDialog.addEventListener('close', () => {
    const reminder = find(editing);
    if (deleteDialog.returnValue !== 'confirm' || !reminder) return;
    editDialog.close();
    save(removeReminder(state, reminder.id), `Deleted ${reminder.text}.`);
    add.text.focus();
  });

  // ---------- Keeping up ----------

  function reload(): void {
    state = store.load();
    // The reminder being changed was deleted on another device or tab.
    if (editing !== null && !find(editing)) editDialog.close();
    render();
    notify.changed();
  }

  // As time goes by, reminders become overdue or move on to their next time.
  const refresh = (): void => {
    if (nowStamp() !== now) render();
  };
  window.setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  // If Reminders is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key === store.key) reload();
  });

  // Sync between devices through the shkriuss account (if turned on). The
  // newest change to each reminder wins; one changed on two devices at once
  // is kept in both versions.
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store,
        items: (value) => value.reminders,
        withItems: (value, reminders) => ({ ...value, reminders }),
        conflictCopy: (mine) => secondVersion(mine, crypto.randomUUID()),
      }),
    ],
    onChange: reload,
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  const notify = mountNotify(root, { state: () => state, announce });

  resetAdd();
  render();
}
