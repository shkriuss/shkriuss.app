/**
 * Notes' data and rules, kept separate from the page so they're easy to test.
 * Every function returns a new state instead of changing the old one.
 *
 * A note has a title and a body, both plain text.
 */
import { secondVersionName } from '@shkriuss/sync';
import { DATE_LOCALE } from '@shkriuss/ui/locale';
import { foldText } from '@shkriuss/ui/text';

export interface Note {
  id: string;
  title: string;
  body: string;
  /** When it was written and last edited (ms since 1970). */
  created: number;
  updated: number;
  /** Pinned notes are listed first. */
  pinned: boolean;
}

export interface NotesState {
  notes: Note[];
}

/** The data version saved with notes (version 1 had one text, its first line the title). */
export const NOTES_VERSION = 2;
export const MAX_TITLE_LENGTH = 200;
/** About 50 pages of text. */
export const MAX_BODY_LENGTH = 100_000;
export const MAX_NOTES = 2000;
const LIST_TITLE_LENGTH = 80;

export const emptyState = (): NotesState => ({ notes: [] });

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isNote(value: unknown): value is Note {
  if (typeof value !== 'object' || value === null) return false;
  const { id, title, body, created, updated, pinned } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof title === 'string' &&
    typeof body === 'string' &&
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

/** Splits version 1's text: the first line that isn't blank is the title, the rest the body. */
function splitText(text: string): { title: string; body: string } {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first === -1) return { title: '', body: '' };
  const title = (lines[first] ?? '').trim();
  // Too long for a title: it all stays in the text, so nothing is cut off later.
  if (title.length > MAX_TITLE_LENGTH) return { title: '', body: lines.slice(first).join('\n') };
  const rest = lines.slice(first + 1);
  while (rest.length > 0 && rest[0]?.trim() === '') rest.shift();
  return { title, body: rest.join('\n') };
}

/** Turns notes saved by an older version into today's shape (undefined if it can't). */
export function migrateNotes(old: unknown, version: number): NotesState | undefined {
  if (version !== 1 || typeof old !== 'object' || old === null) return undefined;
  const { notes } = old as Record<string, unknown>;
  if (!Array.isArray(notes)) return undefined;
  return {
    notes: notes.map((note: unknown) => {
      if (typeof note !== 'object' || note === null) return note as Note;
      const { text, ...rest } = note as Record<string, unknown>;
      return { ...rest, ...splitText(typeof text === 'string' ? text : '') } as unknown as Note;
    }),
  };
}

/** Adds a new, empty note. Returns the same state when there are already MAX_NOTES. */
export function addNote(state: NotesState, id: string, now: number): NotesState {
  if (state.notes.length >= MAX_NOTES) return state;
  return {
    notes: [{ id, title: '', body: '', created: now, updated: now, pinned: false }, ...state.notes],
  };
}

/**
 * Changes a note's title and/or body (cut to their limits). It counts as
 * edited only if something changed.
 */
export function editNote(
  state: NotesState,
  id: string,
  changes: { title?: string; body?: string },
  now: number,
): NotesState {
  return {
    notes: state.notes.map((note) => {
      if (note.id !== id) return note;
      const title = (changes.title ?? note.title).slice(0, MAX_TITLE_LENGTH);
      const body = (changes.body ?? note.body).slice(0, MAX_BODY_LENGTH);
      return title === note.title && body === note.body
        ? note
        : { ...note, title, body, updated: now };
    }),
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

export const isEmpty = (note: Note): boolean => note.title.trim() === '' && note.body.trim() === '';

/** Removes a note if nothing was written in it (when leaving it). */
export function dropIfEmpty(state: NotesState, id: string): NotesState {
  const note = state.notes.find((entry) => entry.id === id);
  return note && isEmpty(note) ? removeNote(state, id) : state;
}

/** How long a note nothing is written in stays, if it isn't left (the page was closed in it). */
export const EMPTY_NOTE_MS = 10 * 60 * 1000;

/**
 * Removes notes nothing was written in for a while (EMPTY_NOTE_MS): left
 * behind when a page was closed in a new note before it could drop it
 * (audit F3-9). Not `keep` (the note the page opens), nor a newer one,
 * which may be open in another tab or on another device.
 */
export function dropEmptyNotes(state: NotesState, keep: string | null, now: number): NotesState {
  const notes = state.notes.filter(
    (note) => note.id === keep || !isEmpty(note) || note.updated > now - EMPTY_NOTE_MS,
  );
  return notes.length === state.notes.length ? state : { notes };
}

const characters = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * The longest start of `text` at most `max` long (as JavaScript counts),
 * never cut in the middle of a character as people see it: an emoji (also
 * a family, a flag or a skin tone), or a letter with its accent.
 */
function fitText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = 0;
  for (const { index, segment } of characters.segment(text)) {
    if (index + segment.length > max) break;
    end = index + segment.length;
  }
  return text.slice(0, end);
}

/** How much of a title fits before packages/sync adds " (second version)". */
const SECOND_VERSION_ROOM =
  MAX_TITLE_LENGTH - (secondVersionName('x', MAX_TITLE_LENGTH).length - 'x'.length);

/**
 * A note changed on two devices at once: this device's version, kept as a
 * second note next to the other device's (packages/sync, conflictCopy). A
 * long title is cut between whole characters first (audit F3-9).
 */
export const secondVersion = (note: Note, id: string): Note => ({
  ...note,
  id,
  title: secondVersionName(fitText(note.title.trim(), SECOND_VERSION_ROOM), MAX_TITLE_LENGTH),
});

/**
 * After a sync, with note `id` open (and not being typed in) showing
 * `shown`: if the sync kept that text as a second version (because the
 * note was changed on another device too) and the note has the other
 * device's text now, the second version (audit F3-6).
 */
export function keptVersion(
  before: NotesState,
  after: NotesState,
  id: string,
  shown: { title: string; body: string },
): Note | undefined {
  const note = after.notes.find((entry) => entry.id === id);
  if (!note || (note.title === shown.title && note.body === shown.body)) return undefined;
  const known = new Set(before.notes.map((entry) => entry.id));
  const title = secondVersion({ ...note, title: shown.title }, '').title;
  return after.notes.find(
    (entry) => !known.has(entry.id) && entry.title === title && entry.body === shown.body,
  );
}

/**
 * Note `id` changed on another device while it was being typed here, from
 * `typedFrom` (its text when the typing began): the other device's version,
 * in `after`, is kept as a second note, so the typing can go on in this one
 * without losing it. A sync may have kept a second note already (`before`
 * didn't have it), with this device's text from before the typing: that
 * one gets the other device's version instead, so there's one second
 * version, not two, and not an old copy of this text (audit 3 F3-4).
 * Otherwise it's a new note, with id `copyId`.
 */
export function keepOtherVersion(
  before: NotesState,
  after: NotesState,
  id: string,
  typedFrom: { title: string; body: string },
  copyId: string,
): NotesState {
  const note = after.notes.find((entry) => entry.id === id);
  if (!note) return after;
  const kept = keptVersion(before, after, id, typedFrom);
  if (!kept) return { notes: [...after.notes, secondVersion(note, copyId)] };
  return {
    notes: after.notes.map((entry) => (entry === kept ? secondVersion(note, kept.id) : entry)),
  };
}

/**
 * Cuts text to `max` characters as people see them, adding "…": never in
 * the middle of an emoji (also a family, a flag or a skin tone) or of a
 * letter and its accent (audit F3-9).
 */
function shorten(text: string, max: number): string {
  let count = 0;
  let cut = 0;
  for (const { index } of characters.segment(text)) {
    if (count === max - 1) cut = index;
    if (count === max) return `${text.slice(0, cut).trimEnd()}…`;
    count += 1;
  }
  return text;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * What the list shows for a note: its title or, without one, the start of
 * its body ("" while it's empty).
 */
export function titleOf(note: Note): string {
  const firstLine = note.body.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  return shorten(oneLine(note.title) || oneLine(firstLine), LIST_TITLE_LENGTH);
}

/**
 * The notes to list: those whose title or body contains every word of the
 * search, pinned first, then the most recently edited.
 */
export function visibleNotes(state: NotesState, search = ''): Note[] {
  const words = foldText(search).split(/\s+/).filter(Boolean);
  return state.notes
    .filter((note) => {
      const text = foldText(`${note.title}\n${note.body}`);
      return words.every((word) => text.includes(word));
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.updated - a.updated || (a.id < b.id ? -1 : 1),
    );
}

/** When a note was edited: the time if today, else the date ("14:05", "12 Oct", "12 Oct 2025"). */
export function editedLabel(updated: number, now: number, locale = DATE_LOCALE): string {
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
