/**
 * Notes' data and rules, kept separate from the page so they're easy to test.
 * Every function returns a new state instead of changing the old one.
 *
 * A note is plain text. Its first line is its title, as in most notes apps,
 * so there's only one box to type in.
 */

export interface Note {
  id: string;
  text: string;
  /** When it was written and last edited (ms since 1970). */
  created: number;
  updated: number;
  /** Pinned notes are listed first. */
  pinned: boolean;
}

export interface NotesState {
  notes: Note[];
}

/** About 50 pages of text. */
export const MAX_TEXT_LENGTH = 100_000;
export const MAX_NOTES = 2000;
const TITLE_LENGTH = 80;
const SNIPPET_LENGTH = 160;

export const emptyState = (): NotesState => ({ notes: [] });

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) return false;
  const { id, text, created, updated, pinned } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof text === 'string' &&
    isTime(created) &&
    isTime(updated) &&
    typeof pinned === 'boolean'
  );
}

/**
 * True when saved data has the shape Notes expects. Only the shape: limits
 * apply when adding and editing, so notes merged from several devices are
 * never rejected.
 */
export function isNotesState(value: unknown): value is NotesState {
  if (typeof value !== 'object' || value === null) return false;
  const { notes } = value as Record<string, unknown>;
  return Array.isArray(notes) && notes.every(isNote);
}

/** Adds a new, empty note. Returns the same state when there are already MAX_NOTES. */
export function addNote(state: NotesState, id: string, now: number): NotesState {
  if (state.notes.length >= MAX_NOTES) return state;
  return { notes: [{ id, text: '', created: now, updated: now, pinned: false }, ...state.notes] };
}

/** Changes a note's text (cut to MAX_TEXT_LENGTH). It counts as edited only if the text changed. */
export function editNote(state: NotesState, id: string, text: string, now: number): NotesState {
  const next = text.slice(0, MAX_TEXT_LENGTH);
  return {
    notes: state.notes.map((note) =>
      note.id === id && note.text !== next ? { ...note, text: next, updated: now } : note,
    ),
  };
}

export function setPinned(state: NotesState, id: string, pinned: boolean): NotesState {
  return {
    notes: state.notes.map((note) => (note.id === id ? { ...note, pinned } : note)),
  };
}

export function removeNote(state: NotesState, id: string): NotesState {
  return { notes: state.notes.filter((note) => note.id !== id) };
}

export const isEmpty = (note: Note): boolean => note.text.trim() === '';

/** Removes a note if nothing was written in it (when leaving it). */
export function dropIfEmpty(state: NotesState, id: string): NotesState {
  const note = state.notes.find((entry) => entry.id === id);
  return note && isEmpty(note) ? removeNote(state, id) : state;
}

const linesOf = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

/** Cuts text to `max` characters (never in the middle of an emoji), adding "…". */
function shorten(text: string, max: number): string {
  const characters = [...text];
  return characters.length <= max
    ? text
    : `${characters
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/** A note's title: its first line ("" while it's empty). */
export const titleOf = (note: Note): string => shorten(linesOf(note.text)[0] ?? '', TITLE_LENGTH);

/** The start of the rest of the note, for the list. */
export const snippetOf = (note: Note): string =>
  shorten(linesOf(note.text).slice(1).join(' '), SNIPPET_LENGTH);

/** Text for searching: lower case and without accents, so "cafe" finds "Café". */
const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/**
 * The notes to list: those containing every word of the search, pinned
 * first, then the most recently edited.
 */
export function visibleNotes(state: NotesState, search = ''): Note[] {
  const words = fold(search).split(/\s+/).filter(Boolean);
  return state.notes
    .filter((note) => {
      const text = fold(note.text);
      return words.every((word) => text.includes(word));
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.updated - a.updated || (a.id < b.id ? -1 : 1),
    );
}

/** When a note was edited: the time if today, else the date ("14:05", "12 Oct", "12 Oct 2025"). */
export function editedLabel(updated: number, now: number, locale?: string): string {
  const date = new Date(updated);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
}

export const notesCount = (count: number): string => `${count} ${count === 1 ? 'note' : 'notes'}`;
