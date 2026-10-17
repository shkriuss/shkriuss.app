/**
 * Notes' page behaviour: connects pages/index.astro to the rules in
 * lib/notes.ts and saves everything on the device.
 *
 * Two views: the list, and one note in the editor. "#note=<id>" in the
 * address opens a note, so the back button returns to the list. Typing is
 * saved a moment after the last key press, and straight away when leaving
 * the note or the page.
 */
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  addNote,
  dropIfEmpty,
  editedLabel,
  editNote,
  emptyState,
  isNotesState,
  MAX_NOTES,
  notesCount,
  removeNote,
  setPinned,
  snippetOf,
  titleOf,
  visibleNotes,
  type Note,
  type NotesState,
} from '../lib/notes.ts';

const store = createStore<NotesState>({
  key: 'notes',
  version: 1,
  fallback: emptyState,
  validate: isNotesState,
});

/** Typing is saved this long after the last key press. */
const SAVE_DELAY_MS = 400;
/** Search results are read out this long after the last key press. */
const ANNOUNCE_DELAY_MS = 700;

const noteIdOf = (hash: string): string | null => /^#note=([\w-]{1,64})$/.exec(hash)?.[1] ?? null;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Notes: missing element ${selector}`);
  return element;
}

export function mountNotes(root: Document): void {
  const listView = required<HTMLElement>(root, '[data-view="list"]');
  const editorView = required<HTMLElement>(root, '[data-view="editor"]');
  const newButton = required<HTMLButtonElement>(listView, '[data-action="new"]');
  const message = required<HTMLElement>(listView, '[data-message]');
  const searchField = required<HTMLElement>(listView, '[data-search-field]');
  const search = required<HTMLInputElement>(listView, '[data-search]');
  const empty = required<HTMLElement>(listView, '[data-empty]');
  const noResults = required<HTMLElement>(listView, '[data-no-results]');
  const list = required<HTMLUListElement>(listView, '[data-notes]');
  const template = required<HTMLTemplateElement>(root, '[data-note-template]');
  const heading = required<HTMLElement>(editorView, '#editor-heading');
  const text = required<HTMLTextAreaElement>(editorView, '[data-text]');
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
  /** A note that was just made, so the editor starts in the text box. */
  let creating: string | null = null;
  /** True once the list was shown: "All notes" then goes back instead of adding to history. */
  let listShown = false;
  let fromList = false;
  let saveTimer: number | undefined;
  let announceTimer: number | undefined;

  const announce = (text: string): void => {
    announcer.textContent = text;
  };
  const say = (text: string | null): void => {
    message.hidden = text === null;
    message.textContent = text ?? '';
  };
  const find = (id: string | null): Note | undefined => state.notes.find((note) => note.id === id);
  const titleText = (note: Note): string => titleOf(note) || 'New note';

  function save(next: NotesState): void {
    state = next;
    if (!store.save(state))
      say('Couldn’t save. Is this browser in private mode, or is storage blocked?');
    sync.changed();
  }

  // ---------- The list ----------

  function renderNote(note: Note, now: number): HTMLLIElement {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    item.dataset['id'] = note.id;
    const link = required<HTMLAnchorElement>(item, '[data-open]');
    link.href = `#note=${note.id}`;
    link.textContent = titleText(note);
    required<HTMLElement>(item, '[data-snippet]').textContent = snippetOf(note);
    required<HTMLElement>(item, '[data-pinned]').hidden = !note.pinned;
    required<HTMLElement>(item, '[data-edited]').textContent =
      `Edited ${editedLabel(note.updated, now)}`;
    return item;
  }

  function renderList(): void {
    const notes = visibleNotes(state, search.value);
    const now = Date.now();
    list.replaceChildren(...notes.map((note) => renderNote(note, now)));
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
    renderList();
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
    edited.textContent = note.text.trim() ? `Edited ${editedLabel(note.updated, Date.now())}` : '';
    document.title = `${titleText(note)} · ${pageTitle}`;
  }

  function openNote(note: Note): void {
    current = note.id;
    fromList = listShown;
    text.value = note.text;
    pinButton.setAttribute('aria-pressed', String(note.pinned));
    showEdited(note);
    listView.hidden = true;
    editorView.hidden = false;
    say(null);
    window.scrollTo(0, 0);
    // A new note starts in the text box; an existing one at its heading, so
    // the keyboard doesn't open just to read it.
    if (creating === note.id) text.focus();
    else heading.focus();
    creating = null;
  }

  /** Saves what's typed. If the note was deleted on another device meanwhile, it comes back. */
  function saveText(): void {
    if (current === null) return;
    const now = Date.now();
    const base = find(current) ? state : addNote(state, current, now);
    save(editNote(base, current, text.value, now));
    const note = find(current);
    if (note) showEdited(note);
  }

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

  /** After changes from another device or tab. */
  function refresh(): void {
    state = store.load();
    if (current === null) {
      if (!listView.hidden) renderList();
      return;
    }
    // Typing here is newer than what came in: keep it.
    if (saveTimer !== undefined) {
      flush();
      return;
    }
    const note = find(current);
    if (!note) {
      current = null;
      left = null;
      backToList();
      say('That note was deleted on another device.');
      announce('That note was deleted on another device.');
      return;
    }
    if (note.text !== text.value) {
      const { selectionStart, selectionEnd } = text;
      text.value = note.text;
      if (root.activeElement === text) {
        text.setSelectionRange(
          Math.min(selectionStart, note.text.length),
          Math.min(selectionEnd, note.text.length),
        );
      }
    }
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

  search.addEventListener('input', () => {
    renderList();
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      if (search.value.trim()) {
        announce(`${notesCount(visibleNotes(state, search.value).length)} found.`);
      }
    }, ANNOUNCE_DELAY_MS);
  });

  text.addEventListener('input', () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      saveText();
    }, SAVE_DELAY_MS);
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
        save(setPinned(state, note.id, !note.pinned));
        pinButton.setAttribute('aria-pressed', String(!note.pinned));
        announce(note.pinned ? 'Unpinned.' : 'Pinned to the top of the list.');
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
    save(removeNote(state, id));
    backToList();
    announce('Note deleted.');
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
      }),
    ],
    onChange: refresh,
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  renderList();
  route();
}
