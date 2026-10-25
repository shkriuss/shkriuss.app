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
  showProblem,
  type ReportSaveOptions,
} from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  addNote,
  dropIfEmpty,
  editedLabel,
  editNote,
  emptyState,
  isEmpty,
  isNotesState,
  keepOtherVersion,
  MAX_NOTES,
  migrateNotes,
  NOTES_VERSION,
  notesCount,
  removeNote,
  secondVersion,
  setPinned,
  titleOf,
  visibleNotes,
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

  let state = store.load();
  /** The note in the editor; null on the list. */
  let current: string | null = null;
  /** The note just left, to focus it in the list. */
  let left: string | null = null;
  /** A note that was just made, so the editor starts in the title box. */
  let creating: string | null = null;
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
    fromList = listShown;
    titleField.value = note.title;
    bodyField.value = note.body;
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

  /** Saves what's typed. If the note was deleted on another device meanwhile, it comes back. */
  function saveText(): void {
    if (current === null) return;
    const now = Date.now();
    const base = find(current) ? state : addNote(state, current, now);
    // Saved after each pause in typing: a problem is read out once, not at every pause.
    const saved = save(
      editNote(base, current, { title: titleField.value, body: bodyField.value }, now),
      { repeat: false },
    );
    const note = find(current);
    if (note) showEdited(note);
    if (!saved) edited.textContent = 'Not saved';
  }

  /** What the note was when the typing that's waiting to be saved began. */
  let typingFrom: { title: string; body: string } | null = null;

  /** Saves typing now instead of a moment later. */
  function flush(): void {
    if (saveTimer === undefined) return;
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    saveText();
  }

  /** Leaves the note in the editor (saving it), and drops it if nothing was written. */
  function leaveNote(): void {
    if (current === null) return;
    flush();
    left = current;
    current = null;
    const next = dropIfEmpty(state, left);
    if (next !== state) save(next);
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
    leaveNote();
    const note = id === null ? undefined : find(id);
    if (note) {
      openNote(note);
      return;
    }
    if (id !== null) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      say('That note isn’t on this device. It may have been deleted.');
    }
    showList(wasEditing);
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
    state = store.load();
    if (current === null) {
      // Keyboard focus stays on the note it was on (audit G-3).
      if (!listView.hidden) keepFocus(() => renderList(), newButton);
      return;
    }
    // Typing here is newer than what came in: keep it. If the note changed
    // on another device meanwhile, that version is kept as a second note.
    if (saveTimer !== undefined) {
      const stored = find(current);
      if (
        stored &&
        typingFrom &&
        (stored.title !== typingFrom.title || stored.body !== typingFrom.body)
      ) {
        state = keepOtherVersion(state, current, crypto.randomUUID());
        announce('This note was changed on another device: that version is kept as a second note.');
      }
      flush();
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
    showValue(titleField, note.title);
    showValue(bodyField, note.body);
    pinButton.setAttribute('aria-pressed', String(note.pinned));
    showEdited(note);
  }

  // ---------- Events ----------

  newButton.addEventListener('click', () => {
    if (state.notes.length >= MAX_NOTES) {
      say(`You have ${notesCount(MAX_NOTES)}, the most Notes can keep. Delete some to add more.`);
      return;
    }
    const id = crypto.randomUUID();
    save(addNote(state, id, Date.now()));
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
    if (saveTimer === undefined) {
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
    current = null;
    left = null;
    const saved = save(removeNote(state, id));
    backToList();
    if (saved) announce('Note deleted.');
  });

  window.addEventListener('hashchange', () => route());

  // Save typing before the page is closed or hidden.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // If Notes is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key === store.key) refresh();
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

  renderList();
  route();
}
