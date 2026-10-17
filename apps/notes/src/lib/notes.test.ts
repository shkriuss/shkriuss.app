import { describe, expect, it } from 'vitest';
import {
  addNote,
  dropIfEmpty,
  editedLabel,
  editNote,
  emptyState,
  isNotesState,
  MAX_NOTES,
  MAX_TEXT_LENGTH,
  notesCount,
  removeNote,
  setPinned,
  snippetOf,
  titleOf,
  visibleNotes,
  type Note,
  type NotesState,
} from './notes.ts';

const note = (id: string, text: string, updated = 1000, pinned = false): Note => ({
  id,
  text,
  created: 1000,
  updated,
  pinned,
});

describe('writing notes', () => {
  it('adds an empty note, then edits it', () => {
    let state = addNote(emptyState(), 'a', 1000);
    expect(state.notes).toEqual([note('a', '')]);
    state = editNote(state, 'a', 'Shopping\nMilk', 2000);
    expect(state.notes[0]).toEqual({ ...note('a', 'Shopping\nMilk'), updated: 2000 });
  });

  it('counts a note as edited only when its text changed', () => {
    const state: NotesState = { notes: [note('a', 'Same')] };
    expect(editNote(state, 'a', 'Same', 5000)).toEqual(state);
  });

  it('cuts very long text, and stops adding notes at the limit', () => {
    const long = editNote({ notes: [note('a', '')] }, 'a', 'x'.repeat(MAX_TEXT_LENGTH + 5), 2);
    expect(long.notes[0]?.text).toHaveLength(MAX_TEXT_LENGTH);
    const full: NotesState = {
      notes: Array.from({ length: MAX_NOTES }, (_, index) => note(`n${index}`, 'x')),
    };
    expect(addNote(full, 'one-more', 1)).toBe(full);
  });

  it('pins, unpins and removes notes', () => {
    let state: NotesState = { notes: [note('a', 'A'), note('b', 'B')] };
    state = setPinned(state, 'b', true);
    expect(state.notes[1]?.pinned).toBe(true);
    expect(state.notes[1]?.updated).toBe(1000);
    state = removeNote(setPinned(state, 'b', false), 'a');
    expect(state.notes).toEqual([note('b', 'B')]);
  });

  it('drops a note left empty, and only an empty one', () => {
    const state: NotesState = { notes: [note('a', '  \n '), note('b', 'Keep')] };
    expect(dropIfEmpty(state, 'a').notes).toEqual([note('b', 'Keep')]);
    expect(dropIfEmpty(state, 'b')).toBe(state);
    expect(dropIfEmpty(state, 'missing')).toBe(state);
  });
});

describe('what the list shows', () => {
  it('uses the first line as the title and the rest as a snippet', () => {
    const shopping = note('a', '\n  Shopping   list \n\nMilk\n  Eggs  and   bread\n');
    expect(titleOf(shopping)).toBe('Shopping list');
    expect(snippetOf(shopping)).toBe('Milk Eggs and bread');
    expect(titleOf(note('b', ''))).toBe('');
    expect(snippetOf(note('b', 'Only a title'))).toBe('');
  });

  it('shortens long titles and snippets without breaking emoji', () => {
    const title = titleOf(note('a', `${'😀'.repeat(100)}`));
    expect([...title]).toHaveLength(80);
    expect(title.endsWith('😀…')).toBe(true);
    expect([...snippetOf(note('b', `Title\n${'word '.repeat(100)}`))]).toHaveLength(160);
  });

  it('lists pinned notes first, then the most recently edited', () => {
    const state: NotesState = {
      notes: [note('old', 'Old', 1), note('new', 'New', 3), note('pinned', 'Pinned', 2, true)],
    };
    expect(visibleNotes(state).map((entry) => entry.id)).toEqual(['pinned', 'new', 'old']);
  });

  it('finds notes containing every word, ignoring case and accents', () => {
    const state: NotesState = {
      notes: [
        note('a', 'Café on Main Street'),
        note('b', 'Coffee beans'),
        note('c', 'Street food'),
      ],
    };
    const found = (search: string) => visibleNotes(state, search).map((entry) => entry.id);
    expect(found('cafe')).toEqual(['a']);
    expect(found('  STREET ')).toEqual(['a', 'c']);
    expect(found('street main')).toEqual(['a']);
    expect(found('tea')).toEqual([]);
    expect(found('')).toHaveLength(3);
  });

  it('says when a note was edited', () => {
    const now = new Date(2026, 9, 17, 18, 0).getTime();
    expect(editedLabel(new Date(2026, 9, 17, 14, 5).getTime(), now, 'en-GB')).toBe('14:05');
    expect(editedLabel(new Date(2026, 9, 12, 9, 0).getTime(), now, 'en-GB')).toBe('12 Oct');
    expect(editedLabel(new Date(2025, 9, 12, 9, 0).getTime(), now, 'en-GB')).toBe('12 Oct 2025');
  });

  it('counts notes', () => {
    expect(notesCount(1)).toBe('1 note');
    expect(notesCount(0)).toBe('0 notes');
    expect(notesCount(12)).toBe('12 notes');
  });
});

describe('isNotesState', () => {
  it('accepts saved notes', () => {
    expect(isNotesState(emptyState())).toBe(true);
    expect(isNotesState({ notes: [note('a', 'Hi', 5, true)] })).toBe(true);
  });

  it('refuses anything else', () => {
    for (const value of [
      null,
      [],
      {},
      { notes: {} },
      { notes: [{ ...note('a', 'Hi'), id: '' }] },
      { notes: [{ ...note('a', 'Hi'), text: 3 }] },
      { notes: [{ ...note('a', 'Hi'), updated: Number.NaN }] },
      { notes: [{ ...note('a', 'Hi'), pinned: 'yes' }] },
    ]) {
      expect(isNotesState(value), JSON.stringify(value)).toBe(false);
    }
  });
});
