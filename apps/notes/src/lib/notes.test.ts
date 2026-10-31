import { describe, expect, it } from 'vitest';
import {
  addNote,
  dropEmptyNotes,
  dropIfEmpty,
  editedLabel,
  editNote,
  EMPTY_NOTE_MS,
  emptyState,
  isNotesState,
  MAX_BODY_LENGTH,
  MAX_NOTES,
  MAX_TITLE_LENGTH,
  migrateNotes,
  notesCount,
  removeNote,
  restoreNote,
  keepOtherVersion,
  keptVersion,
  secondVersion,
  setPinned,
  titleOf,
  visibleNotes,
  withSavedNote,
  type Note,
  type NotesState,
} from './notes.ts';

const note = (id: string, title: string, body = '', updated = 1000, pinned = false): Note => ({
  id,
  title,
  body,
  created: 1000,
  updated,
  pinned,
});

describe('writing notes', () => {
  it('adds an empty note, then edits its title and body', () => {
    let state = addNote(emptyState(), 'a', 1000);
    expect(state.notes).toEqual([note('a', '')]);
    state = editNote(state, 'a', { title: 'Shopping' }, 2000);
    state = editNote(state, 'a', { body: 'Milk\nEggs' }, 3000);
    expect(state.notes[0]).toEqual(note('a', 'Shopping', 'Milk\nEggs', 3000));
  });

  it('counts a note as edited only when something changed', () => {
    const state: NotesState = { notes: [note('a', 'Same', 'Body')] };
    expect(editNote(state, 'a', { title: 'Same', body: 'Body' }, 5000).notes).toEqual(state.notes);
  });

  it('cuts very long text, and stops adding notes at the limit', () => {
    const long = editNote(
      { notes: [note('a', '')] },
      'a',
      { title: 't'.repeat(MAX_TITLE_LENGTH + 5), body: 'x'.repeat(MAX_BODY_LENGTH + 5) },
      2,
    );
    expect(long.notes[0]?.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(long.notes[0]?.body).toHaveLength(MAX_BODY_LENGTH);
    const full: NotesState = {
      notes: Array.from({ length: MAX_NOTES }, (_, index) => note(`n${index}`, 'x')),
    };
    expect(addNote(full, 'one-more', 1)).toBe(full);
  });

  it('brings back a note deleted elsewhere while it’s typed in, even at the limit (audit 5 F3-8)', () => {
    // The page adds the note back, then puts the typing on it: at 2,000
    // notes, addNote left it out, and the typing was never saved.
    const full: NotesState = {
      notes: Array.from({ length: MAX_NOTES }, (_, index) => note(`n${index}`, 'x')),
    };
    const typed = editNote(
      restoreNote(full, 'typed-here', 5000),
      'typed-here',
      { body: 'kept' },
      5000,
    );
    expect(typed.notes).toHaveLength(MAX_NOTES + 1);
    expect(typed.notes[0]).toEqual({ ...note('typed-here', '', 'kept', 5000), created: 5000 });
    // "New note" still stops at the limit.
    expect(addNote(typed, 'one-more', 1)).toBe(typed);
  });

  it('keeps all a title box let in, counted as Safari counts (audit 4 F3-4)', () => {
    // Safari's maxlength counts characters as people see them, so its box
    // takes 120 thumbs-up with a skin tone, which JavaScript counts as 480.
    const state: NotesState = { notes: [note('a', '')] };
    const thumbs = '👍🏽'.repeat(120);
    expect(editNote(state, 'a', { title: thumbs }, 2).notes[0]?.title).toBe(thumbs);
    const hindi = 'नमस्ते दुनिया '.repeat(14);
    expect(editNote(state, 'a', { title: hindi }, 2).notes[0]?.title).toBe(hindi);
    // Never half an emoji: before, 199 letters and an emoji kept half of it.
    const nearly = `${'a'.repeat(199)}😀`;
    expect(editNote(state, 'a', { title: nearly }, 2).notes[0]?.title).toBe(nearly);
    expect(editNote(state, 'a', { title: `${nearly}😀` }, 2).notes[0]?.title).toBe(nearly);
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
    const state: NotesState = {
      notes: [note('a', ' ', '  \n '), note('b', '', 'Only a body'), note('c', 'Only a title')],
    };
    expect(dropIfEmpty(state, 'a').notes.map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(dropIfEmpty(state, 'b')).toBe(state);
    expect(dropIfEmpty(state, 'c')).toBe(state);
    expect(dropIfEmpty(state, 'missing')).toBe(state);
  });

  it('keeps an older note that was emptied, so nothing is deleted without asking (audit 5 F3-7)', () => {
    // Written in once (its edits are later than its making), cleared to be
    // rewritten later: it stays, with its pin. A note made on this page and
    // emptied again goes, as before: nothing is lost with it.
    const emptied = editNote(
      { notes: [note('old', 'Was written', 'then cleared', 1000, true)] },
      'old',
      { title: '', body: ' ' },
      2000,
    );
    expect(dropIfEmpty(emptied, 'old')).toBe(emptied);
    expect(dropIfEmpty(emptied, 'old', new Set(['old'])).notes).toEqual([]);
    const untouched = { notes: [{ ...note('new', '', '', 3000), created: 3000 }] };
    expect(dropIfEmpty(untouched, 'new').notes).toEqual([]);
  });

  it('puts back a note as the device has it, for typing that couldn’t be saved (audit 4 F3-1)', () => {
    const saved: NotesState = { notes: [note('a', 'Diary', 'Start'), note('b', 'Keep')] };
    const typed: NotesState = {
      notes: [note('a', 'Diary', 'Start more', 2000), note('b', 'Keep'), note('c', 'New', 'Hi')],
    };
    expect(withSavedNote(typed, saved, 'a').notes).toEqual([
      note('a', 'Diary', 'Start'),
      note('b', 'Keep'),
      note('c', 'New', 'Hi'),
    ]);
    // Never saved: it goes.
    expect(withSavedNote(typed, saved, 'c').notes.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('keeps the other device’s version as a second note while typing goes on here', () => {
    const before = { notes: [note('a', 'Trip', 'Mine')] };
    const typedFrom = { title: 'Trip', body: 'Mine' };
    // Changed in another tab: nothing kept a second version yet.
    const state = { notes: [note('a', 'Trip', 'Theirs', 5, false)] };
    expect(keepOtherVersion(before, state, 'a', typedFrom, 'b')).toEqual({
      notes: [
        note('a', 'Trip', 'Theirs', 5, false),
        note('b', 'Trip (second version)', 'Theirs', 5, false),
      ],
    });
    expect(keepOtherVersion(before, state, 'gone', typedFrom, 'b')).toBe(state);
  });

  it('puts the other device’s version in the second note a sync just kept (audit 3 F3-4)', () => {
    // The sync kept this device's saved text as a second note, and the note
    // has the other device's text now: the typing goes on from this
    // device's text, so that second note gets the other device's instead.
    const before = { notes: [note('a', 'Trip', 'Pack bags and tickets')] };
    const typedFrom = { title: 'Trip', body: 'Pack bags and tickets' };
    const synced = {
      notes: [
        note('a', 'Trip', 'Pack bags and passports', 5),
        note('s', 'Trip (second version)', 'Pack bags and tickets'),
      ],
    };
    expect(keepOtherVersion(before, synced, 'a', typedFrom, 'b')).toEqual({
      notes: [
        note('a', 'Trip', 'Pack bags and passports', 5),
        note('s', 'Trip (second version)', 'Pack bags and passports', 5),
      ],
    });
    // A second version that was there before isn't the sync's: a new one is added.
    const older = { notes: [...before.notes, note('s', 'Trip (second version)', typedFrom.body)] };
    expect(keepOtherVersion(older, synced, 'a', typedFrom, 'b').notes).toHaveLength(3);
  });

  it('makes a second version of a note changed on two devices', () => {
    expect(secondVersion(note('a', ' Plan ', 'Mine', 5, true), 'b')).toEqual(
      note('b', 'Plan (second version)', 'Mine', 5, true),
    );
    expect(secondVersion(note('a', '', 'Mine'), 'b').title).toBe('Second version');
    expect(secondVersion(note('a', 't'.repeat(MAX_TITLE_LENGTH)), 'b').title).toBe(
      `${'t'.repeat(MAX_TITLE_LENGTH - 17)} (second version)`,
    );
    // A long title is cut between whole characters, not inside an emoji (audit F3-9).
    const family = '👨‍👩‍👧';
    expect(secondVersion(note('a', family.repeat(25)), 'b').title).toBe(
      `${family.repeat(22)} (second version)`,
    );
  });

  it('finds the text shown here, kept as a second version by a sync', () => {
    // The note open here was changed on another device too (audit F3-6).
    const before = { notes: [note('a', 'Groceries', 'Milk')] };
    const shown = { title: 'Groceries', body: 'Milk' };
    const kept = note('b', 'Groceries (second version)', 'Milk');
    const after = { notes: [note('a', 'Groceries', 'Bread', 2000), kept] };
    expect(keptVersion(before, after, 'a', shown)).toBe(kept);
    // Changed on the other device only, or not at all: nothing was kept.
    const theirs = { notes: [note('a', 'Groceries', 'Bread', 2000)] };
    expect(keptVersion(before, theirs, 'a', shown)).toBeUndefined();
    expect(keptVersion(before, before, 'a', shown)).toBeUndefined();
    // A second version that was there already isn't this one.
    expect(keptVersion(after, after, 'a', shown)).toBeUndefined();
  });

  it('drops notes left empty a while ago, but not one opened, new, or emptied on purpose', () => {
    // A page closed in a new note left it behind (audit F3-9): never written
    // in, so it's still as it was made.
    const now = 100 * EMPTY_NOTE_MS;
    const old = now - EMPTY_NOTE_MS - 1;
    const untouched = (id: string, title: string, body: string, at: number): Note => ({
      ...note(id, title, body, at),
      created: at,
    });
    const state = {
      notes: [
        untouched('a', '', '', old),
        untouched('b', ' ', '\n', old),
        note('c', 'Written', '', old),
        untouched('d', '', '', old),
        untouched('e', '', '', now - 60_000),
        // Written in long ago, then cleared: kept (audit 5 F3-7).
        note('f', '', '', old),
      ],
    };
    expect(dropEmptyNotes(state, 'd', now).notes.map((entry) => entry.id)).toEqual([
      'c',
      'd',
      'e',
      'f',
    ]);
    const tidy = { notes: [note('c', 'Written', '', old)] };
    expect(dropEmptyNotes(tidy, null, now)).toBe(tidy);
  });
});

describe('notes saved by version 1', () => {
  it('splits the old text: first line the title, the rest the body', () => {
    const old = {
      notes: [
        { id: 'a', text: '\n  Shopping \n\nMilk\nEggs', created: 1, updated: 2, pinned: true },
        { id: 'b', text: '', created: 1, updated: 2, pinned: false },
        { id: 'c', text: 'Just a title', created: 1, updated: 2, pinned: false },
      ],
    };
    const migrated = migrateNotes(old, 1);
    expect(isNotesState(migrated)).toBe(true);
    expect(migrated?.notes).toEqual([
      { id: 'a', title: 'Shopping', body: 'Milk\nEggs', created: 1, updated: 2, pinned: true },
      { id: 'b', title: '', body: '', created: 1, updated: 2, pinned: false },
      { id: 'c', title: 'Just a title', body: '', created: 1, updated: 2, pinned: false },
    ]);
  });

  it('keeps a first line too long for a title in the text', () => {
    const long = 'x'.repeat(250);
    const migrated = migrateNotes(
      { notes: [{ id: 'a', text: `${long}\nMore`, created: 1, updated: 2, pinned: false }] },
      1,
    );
    expect(migrated?.notes[0]).toMatchObject({ title: '', body: `${long}\nMore` });
  });

  it('gives up on anything else', () => {
    expect(migrateNotes({ notes: [] }, 3)).toBeUndefined();
    expect(migrateNotes(null, 1)).toBeUndefined();
    expect(migrateNotes({ notes: 'x' }, 1)).toBeUndefined();
    expect(isNotesState(migrateNotes({ notes: [{ id: 'a' }] }, 1))).toBe(false);
  });
});

describe('what the list shows', () => {
  it('shows the title, or the start of the body without one', () => {
    expect(titleOf(note('a', '  Shopping   list '))).toBe('Shopping list');
    expect(titleOf(note('b', '', '\n  First line \nSecond'))).toBe('First line');
    expect(titleOf(note('c', ''))).toBe('');
  });

  it('shortens long titles without breaking emoji', () => {
    const title = titleOf(note('a', '😀'.repeat(100)));
    expect([...title]).toHaveLength(80);
    expect(title.endsWith('😀…')).toBe(true);
    // Nor emoji made of several (a family, a flag, a skin tone), nor accents (audit F3-9).
    for (const character of ['👨‍👩‍👧', '🇬🇪', '👍🏽', 'e\u0301']) {
      expect(titleOf(note('a', character.repeat(100)))).toBe(`${character.repeat(79)}…`);
    }
  });

  it('lists pinned notes first, then the most recently edited', () => {
    const state: NotesState = {
      notes: [
        note('old', 'Old', '', 1),
        note('new', 'New', '', 3),
        note('pinned', 'Pinned', '', 2, true),
      ],
    };
    expect(visibleNotes(state).map((entry) => entry.id)).toEqual(['pinned', 'new', 'old']);
  });

  it('finds notes with every word in the title or body, ignoring case and accents', () => {
    const state: NotesState = {
      notes: [
        note('a', 'Café', 'on Main Street'),
        note('b', 'Coffee beans'),
        note('c', 'Food', 'Street food'),
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
    expect(isNotesState({ notes: [note('a', 'Hi', 'There', 5, true)] })).toBe(true);
  });

  it('refuses anything else', () => {
    for (const value of [
      null,
      [],
      {},
      { notes: {} },
      { notes: [{ ...note('a', 'Hi'), id: '' }] },
      { notes: [{ ...note('a', 'Hi'), title: 3 }] },
      { notes: [{ ...note('a', 'Hi'), body: undefined }] },
      { notes: [{ id: 'a', text: 'Version 1', created: 1, updated: 1, pinned: false }] },
      { notes: [{ ...note('a', 'Hi'), updated: Number.NaN }] },
      { notes: [{ ...note('a', 'Hi'), pinned: 'yes' }] },
    ]) {
      expect(isNotesState(value), JSON.stringify(value)).toBe(false);
    }
  });
});
