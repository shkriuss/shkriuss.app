/**
 * Notes' page behaviour: connects pages/index.astro to the rules in
 * lib/notes.ts and saves everything on the device.
 *
 * Two views: the list (titles only), and one note in the editor. "#note=<id>"
 * in the address opens a note, so the back button returns to the list.
 * Typing is saved a moment after the last key press, and straight away when
 * leaving the note or the page.
 *
 * When sync is on and a note was changed on two devices at once, both
 * versions are kept (the second as its own note).
 */
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import { PAGE_SIZE, shownCount, waitForTyping } from '@shkriuss/ui/long-lists';
import {
  clearProblem,
  reportSave,
  saveProblem,
  showProblem,
  type ReportSaveOptions,
} from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { watchTextLimit } from '@shkriuss/ui/text-limit';
import { site } from 'virtual:shkriuss/site';
import {
  addNote,
  dropEmptyNotes,
  dropIfEmpty,
  editedLabel,
  editNote,
  emptyState,
  isEmpty,
  isNotesState,
  keepOtherVersion,
  keptVersion,
  MAX_NOTES,
  migrateNotes,
  NOTES_VERSION,
  notesCount,
  removeNote,
  restoreNote,
  secondVersion,
  setPinned,
  titleOf,
  visibleNotes,
  withSavedNote,
  type Note,
  type NotesState,
} from '../lib/notes.ts';
import { required } from '@shkriuss/ui/dom';

const store = createStore<NotesState>({
  key: 'notes',
  version: NOTES_VERSION,
  fallback: emptyState,
  validate: isNotesState,
  migrate: migrateNotes,
});

/** Typing is saved this long after the last key press. */
const SAVE_DELAY_MS = 400;
/** Search results are read out this long after the last key press. */
const ANNOUNCE_DELAY_MS = 700;

const noteIdOf = (hash: string): string | null => /^#note=([\w-]{1,64})$/.exec(hash)?.[1] ?? null;

/**
 * A new note left empty is dropped as the page goes away (audit F3-9). This
 * tab remembers which, so if the page was being reloaded, opening it again
 * doesn't say the note is missing (sessionStorage: this tab only, and gone
 * with it).
 */
const DROPPED_KEY = 'shkriuss-device:notes-dropped';
function rememberDropped(id: string): void {
  try {
    sessionStorage.setItem(DROPPED_KEY, id);
  } catch {
    // Not kept: a reload then says the note isn't on this device.
  }
}
function wasDropped(id: string): boolean {
  try {
    return sessionStorage.getItem(DROPPED_KEY) === id;
  } catch {
    return false;
  }
}

export function mountNotes(root: Document): void {
  const listView = required<HTMLElement>(root, '[data-view="list"]');
  const editorView = required<HTMLElement>(root, '[data-view="editor"]');
  const newButton = required<HTMLButtonElement>(listView, '[data-action="new"]');
  const searchField = required<HTMLElement>(listView, '[data-search-field]');
  const search = required<HTMLInputElement>(listView, '[data-search]');
  const empty = required<HTMLElement>(listView, '[data-empty]');
  const noResults = required<HTMLElement>(listView, '[data-no-results]');
  const list = required<HTMLUListElement>(listView, '[data-notes]');
  const more = required<HTMLElement>(listView, '[data-more]');
  const template = required<HTMLTemplateElement>(root, '[data-note-template]');
  const titleField = required<HTMLInputElement>(editorView, '[data-title]');
  const bodyField = required<HTMLTextAreaElement>(editorView, '[data-body]');
  const edited = required<HTMLElement>(editorView, '[data-edited]');
  const pinButton = required<HTMLButtonElement>(editorView, '[data-action="pin"]');
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteName = required<HTMLElement>(deleteDialog, '[data-delete-name]');
  const pageTitle = document.title;
  // A paste longer than a box takes is cut by the browser: say so (audit F3-3).
  const limits = [watchTextLimit(titleField), watchTextLimit(bodyField)];

  let state = store.load();
  /** The note in the editor; null on the list. */
  let current: string | null = null;
  /** The note just left, to focus it in the list. */
  let left: string | null = null;
  /** A note that was just made, so the editor starts in the title box. */
  let creating: string | null = null;
  /** Notes made since this page opened: left empty, they go, as nothing is lost (dropIfEmpty). */
  const madeHere = new Set<string>();
  /** True once the list was shown: "All notes" then goes back instead of adding to history. */
  let listShown = false;
  let fromList = false;
  let saveTimer: number | undefined;
  let announceTimer: number | undefined;
  /** Notes shown so far ("Show more" adds a page: audit J-1). */
  let shown = PAGE_SIZE;
  /** The search the list was drawn for: a new one starts at the first page. */
  let searched = '';
  /** The message say() shows, to take it away when a note opens. */
  let said: string | null = null;

  const announce = (text: string): void => {
    announcer.textContent = text;
  };
  /** Shows a message in the page's notice (shown in both views, and read out), or takes it away. */
  const say = (text: string | null): void => {
    if (text !== null) showProblem(text);
    else if (said !== null) clearProblem(said);
    said = text;
  };
  const find = (id: string | null): Note | undefined => state.notes.find((note) => note.id === id);
  const titleText = (note: Note): string => titleOf(note) || 'New note';

  /** Saves `next`; false (and the person is told) if it couldn't be saved. */
  function save(next: NotesState, options?: ReportSaveOptions): boolean {
    state = next;
    const saved = reportSave(store.save(state), options);
    sync.changed();
    return saved;
  }

  // ---------- The list ----------

  function renderNote(note: Note): HTMLLIElement {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    item.dataset['id'] = note.id;
    const link = required<HTMLAnchorElement>(item, '[data-open]');
    link.href = `#note=${note.id}`;
    link.textContent = titleText(note);
    required<HTMLElement>(item, '[data-pinned]').hidden = !note.pinned;
    return item;
  }

  /** Draws the list; `keep` (a note just left) is shown however far down it is. */
  function renderList(keep: string | null = null): void {
    const notes = visibleNotes(state, search.value);
    if (search.value !== searched) shown = PAGE_SIZE;
    searched = search.value;
    // Never hidden by paging: that note, or the one with focus.
    const focused = (root.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-id]');
    shown = shownCount(
      notes.map((note) => note.id),
      shown,
      [keep, focused?.dataset['id']],
    );
    list.replaceChildren(...notes.slice(0, shown).map(renderNote));
    more.hidden = notes.length <= shown;
    const none = state.notes.length === 0;
    empty.hidden = !none;
    searchField.hidden = none && search.value === '';
    noResults.hidden = notes.length > 0 || none;
    noResults.textContent = `No notes match “${search.value.trim()}”.`;
  }

  function showList(focus: boolean): void {
    editorView.hidden = true;
    listView.hidden = false;
    listShown = true;
    document.title = pageTitle;
    renderList(left);
    if (!focus) return;
    // Back from a note: focus that note in the list, or "New note".
    const link =
      left === null
        ? null
        : list.querySelector<HTMLElement>(`[data-id="${CSS.escape(left)}"] [data-open]`);
    (link ?? newButton).focus();
  }

  // ---------- The editor ----------

  function showEdited(note: Note): void {
    edited.textContent = isEmpty(note) ? '' : `Edited ${editedLabel(note.updated, Date.now())}`;
    document.title = `${titleText(note)} · ${pageTitle}`;
  }

  function openNote(note: Note): void {
    current = note.id;
    unsaved = false;
    fromList = listShown;
    titleField.value = note.title;
    bodyField.value = note.body;
    for (const limit of limits) limit.clear();
    pinButton.setAttribute('aria-pressed', String(note.pinned));
    showEdited(note);
    listView.hidden = true;
    editorView.hidden = false;
    say(null);
    window.scrollTo(0, 0);
    // A new note starts in the title box; an existing one just opens, so
    // the keyboard doesn't pop up just to read it.
    if (creating === note.id) titleField.focus();
    else editorView.focus();
    creating = null;
  }

  /**
   * True while the open note has typing that couldn't be saved (the device
   * is full): the box is newer than what's saved, so a change saved
   * elsewhere mustn't put the saved text back in it (audit 4 F3-1).
   */
  let unsaved = false;

  /**
   * Saves what's typed. If the note was deleted on another device meanwhile,
   * it comes back with the typing, also at the limit of notes (audit 5 F3-8).
   */
  function saveText(): void {
    if (current === null) return;
    const now = Date.now();
    const base = find(current) ? state : restoreNote(state, current, now);
    // Saved after each pause in typing: a problem is read out once, not at every pause.
    const saved = save(
      editNote(base, current, { title: titleField.value, body: bodyField.value }, now),
      { repeat: false },
    );
    unsaved = !saved;
    const note = find(current);
    if (note) showEdited(note);
    if (!saved) edited.textContent = 'Not saved';
  }

  /**
   * What the note was, as saved, when the typing that's waiting to be saved
   * began: while typing couldn't be saved, from before that typing.
   */
  let typingFrom: { title: string; body: string } | null = null;

  /** Saves typing now instead of a moment later, or tries again what couldn't be saved. */
  function flush(): void {
    if (saveTimer === undefined && !unsaved) return;
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    saveText();
  }

  /**
   * Leaves the note in the editor (saving it), and drops it if it's a new
   * one left empty. Typing that still can't be saved goes then: the note
   * goes back to what the device has, so the list, the note opened again
   * and changes from elsewhere show that, and the person is told. Kept in
   * memory, it was lost later without a word, or taken for the saved note
   * (audit 4 F3-1). Gives what to tell them, or null.
   */
  function leaveNote(): string | null {
    if (current === null) return null;
    flush();
    left = current;
    current = null;
    let lost: string | null = null;
    if (unsaved) {
      unsaved = false;
      const note = find(left);
      if (note) lost = `Your last changes to “${titleText(note)}” are gone. ${saveProblem()}`;
      state = withSavedNote(state, store.load(), left);
    }
    const next = dropIfEmpty(state, left, madeHere);
    if (next !== state) save(next);
    return lost;
  }

  /** "All notes": back in history if the list came first, else straight to the list. */
  function backToList(): void {
    if (fromList) {
      history.back();
    } else {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      route();
    }
  }

  // ---------- Which view ----------

  function route(): void {
    const id = noteIdOf(location.hash);
    // Other links within the page (like "Skip to content") don't change the view.
    if (id === null && location.hash !== '' && location.hash !== '#') {
      if (current === null && !listShown) showList(false);
      return;
    }
    if (id !== null && id === current) return;
    const wasEditing = !editorView.hidden;
    const lost = leaveNote();
    const note = id === null ? undefined : find(id);
    if (note) {
      openNote(note);
      if (lost !== null) say(lost);
      return;
    }
    if (id !== null) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      if (!wasDropped(id)) say('That note isn’t on this device. It may have been deleted.');
    }
    showList(wasEditing);
    if (lost !== null) say(lost);
  }

  /** Puts a changed value into a field, keeping the cursor where it was. */
  function showValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    if (field.value === value) return;
    const { selectionStart, selectionEnd } = field;
    field.value = value;
    if (root.activeElement === field && selectionStart !== null && selectionEnd !== null) {
      field.setSelectionRange(
        Math.min(selectionStart, value.length),
        Math.min(selectionEnd, value.length),
      );
    }
  }

  /** After changes from another device or tab. */
  function refresh(): void {
    const before = state;
    state = store.load();
    if (current === null) {
      // Keyboard focus stays on the note it was on (audit G-3).
      if (!listView.hidden) keepFocus(() => renderList(), newButton);
      return;
    }
    // Typing here is newer than what came in: keep it, also typing that
    // couldn't be saved, which is tried again (audit 4 F3-1). If the note
    // changed on another device meanwhile, that version is kept as a second
    // note (the one a sync made, if it did: audit 3 F3-4).
    if (saveTimer !== undefined || unsaved) {
      const stored = find(current);
      if (
        stored &&
        typingFrom &&
        (stored.title !== typingFrom.title || stored.body !== typingFrom.body)
      ) {
        state = keepOtherVersion(before, state, current, typingFrom, crypto.randomUUID());
        announce('This note was changed on another device: that version is kept as a second note.');
      }
      flush();
      // Pinned or unpinned elsewhere: the button shows it (audit F3-9).
      const pinned = find(current)?.pinned;
      if (pinned !== undefined) pinButton.setAttribute('aria-pressed', String(pinned));
      return;
    }
    const note = find(current);
    if (!note) {
      current = null;
      left = null;
      backToList();
      say('That note was deleted on another device.');
      return;
    }
    // Changed on another device too: the sync kept the text shown here as a
    // second version, and the note has the other device's text now. Say so
    // where it shows, and read it out (audit F3-6).
    const shown = { title: titleField.value, body: bodyField.value };
    const kept = keptVersion(before, state, note.id, shown);
    showValue(titleField, note.title);
    showValue(bodyField, note.body);
    pinButton.setAttribute('aria-pressed', String(note.pinned));
    showEdited(note);
    if (kept) {
      say(
        `This note was also changed on another device. You’re now seeing that version. Yours is kept as a separate note: “${titleText(kept)}”.`,
      );
    }
  }

  // ---------- Events ----------

  newButton.addEventListener('click', () => {
    if (state.notes.length >= MAX_NOTES) {
      say(`You have ${notesCount(MAX_NOTES)}, the most Notes can keep. Delete some to add more.`);
      return;
    }
    const id = crypto.randomUUID();
    save(addNote(state, id, Date.now()));
    madeHere.add(id);
    creating = id;
    location.hash = `note=${id}`;
  });

  // The list is drawn again once typing pauses, not at every key (audit J-1).
  const typedSearch = waitForTyping(() => {
    if (search.value === searched) return;
    renderList();
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      if (search.value.trim()) {
        announce(`${notesCount(visibleNotes(state, search.value).length)} found.`);
      }
    }, ANNOUNCE_DELAY_MS);
  });
  search.addEventListener('input', typedSearch);

  required<HTMLButtonElement>(more, '[data-action="more"]').addEventListener('click', () => {
    const first = shown;
    shown += PAGE_SIZE;
    renderList();
    list.querySelectorAll<HTMLElement>('[data-open]')[first]?.focus();
  });

  editorView.addEventListener('input', () => {
    // Not after typing that couldn't be saved: the note in memory has that
    // typing, which was never saved (audit 4 F3-1).
    if (saveTimer === undefined && !unsaved) {
      const note = current === null ? undefined : find(current);
      typingFrom = note ? { title: note.title, body: note.body } : null;
    }
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      saveText();
    }, SAVE_DELAY_MS);
  });

  // Enter in the title goes on to the note.
  titleField.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    bodyField.focus();
  });

  editorView.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (!button || current === null) return;
    flush();
    const note = find(current);
    switch (button.dataset['action']) {
      case 'back':
        backToList();
        break;
      case 'pin':
        if (!note) return;
        pinButton.setAttribute('aria-pressed', String(!note.pinned));
        if (save(setPinned(state, note.id, !note.pinned))) {
          announce(note.pinned ? 'Unpinned.' : 'Pinned to the top of the list.');
        }
        break;
      case 'delete':
        if (!note) return;
        deleteName.textContent = titleText(note);
        deleteDialog.returnValue = '';
        deleteDialog.showModal();
        break;
    }
  });

  deleteDialog.addEventListener('close', () => {
    if (deleteDialog.returnValue !== 'confirm' || current === null) return;
    const id = current;
    const note = find(id);
    const typingLost = unsaved;
    current = null;
    unsaved = false;
    left = null;

    const beforeDelete = state;
    const saved = save(removeNote(state, id));
    // Not deleted: the note stays as the device has it. Typing that couldn't
    // be saved goes, and the person is told, as when a note is left (audit 4
    // F3-1): kept in memory, it showed as saved, and a reload lost it
    // without a word (audit 6 F3-3).
    if (!saved) state = withSavedNote(beforeDelete, store.load(), id);

    backToList();
    if (saved) announce('Note deleted.');
    else if (typingLost && note) {
      say(`Your last changes to “${titleText(note)}” are gone. ${saveProblem()}`);
    }
  });

  window.addEventListener('hashchange', () => route());

  // Save typing before the page is closed or hidden. A new note left empty
  // goes with the page, as it does when leaving it (audit F3-9).
  window.addEventListener('pagehide', () => {
    flush();
    if (current === null) return;
    const next = dropIfEmpty(state, current, madeHere);
    if (next === state) return;
    save(next);
    rememberDropped(current);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  /**
   * "Delete all data" in another tab (or a restore there, which starts by
   * deleting) removed the notes. Typing waiting to be saved here would have
   * put its note back, right after everything was said to be deleted (audit
   * 5 D-2): it goes, with the note, and the list shows what's saved now.
   */
  function dataDeleted(): void {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    unsaved = false;
    typingFrom = null;
    state = store.load();
    if (current === null) {
      if (!listView.hidden) keepFocus(() => renderList(), newButton);
      return;
    }
    current = null;
    left = null;
    backToList();
    say(
      'Your notes were deleted in another tab (“Delete all data”, or a restore replacing them). What was typed here is gone too.',
    );
  }

  // If Notes is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key !== store.key) return;
    if (event.newValue === null) dataDeleted();
    else refresh();
  });

  // Sync between devices through the shkriuss account (if turned on).
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store,
        items: (value) => value.notes,
        withItems: (value, notes) => ({ ...value, notes }),
        // Changed on two devices at once: keep this device's version as its own note.
        conflictCopy: (mine) => secondVersion(mine, crypto.randomUUID()),
      }),
    ],
    onChange: refresh,
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  // New notes left empty when a page was closed before it could drop them (audit F3-9).
  const tidy = dropEmptyNotes(state, noteIdOf(location.hash), Date.now());
  if (tidy !== state) save(tidy);
  renderList();
  route();
}
