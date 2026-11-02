import { describe, expect, it, vi } from 'vitest';
import {
  addList,
  emptyLists,
  isListsState,
  LIST_NAME_MAX,
  listName,
  listProblem,
  MAX_LISTS,
  removeList,
  renameList,
  sortedLists,
} from './lists.ts';

describe('lists', () => {
  it('adds, renames and deletes lists, in alphabetical order', () => {
    let state = addList(emptyLists(), 'w', ' Work ');
    state = addList(state, 'h', 'home');
    state = addList(state, 's', 'Shopping');
    expect(sortedLists(state).map((list) => list.name)).toEqual(['home', 'Shopping', 'Work']);
    state = renameList(state, 'h', 'Home');
    expect(listName(state, 'h')).toBe('Home');
    state = removeList(state, 'w');
    expect(listName(state, 'w')).toBe('');
    // Renamed after it was deleted on another device: it comes back.
    expect(listName(renameList(state, 'w', 'Office'), 'w')).toBe('Office');
  });

  it('explains what’s wrong with a name', () => {
    const state = addList(emptyLists(), 'h', 'Home');
    expect(listProblem(state, 'Work', null)).toBeNull();
    expect(listProblem(state, '  ', null)).toBe('Give it a name.');
    expect(listProblem(state, ' HOME', null)).toBe('You already have a list called “Home”.');
    expect(listProblem(state, 'home', 'h')).toBeNull();
  });

  it('cuts a long name by whole characters, never half an emoji', () => {
    // .slice() kept half of the last emoji, which showed as "�" (audit 4 F3-4).
    const name = `${'a'.repeat(LIST_NAME_MAX - 1)}🎉`;
    expect(listName(addList(emptyLists(), 'p', name), 'p')).toBe(name);
    expect(listName(addList(emptyLists(), 'p', `${name}🎉 `), 'p')).toBe(name);
    expect(listName(renameList(emptyLists(), 'p', ` ${name}🎉`), 'p')).toBe(name);
  });

  it('keeps a name it didn’t change, however this browser counts it (audit 7 F1-1)', async () => {
    // 50 characters where it was typed; 150 in a browser that can't tell
    // "क्ष" is one. "Edit list", then Save, cut it there.
    const name = 'क्ष'.repeat(LIST_NAME_MAX);
    const state = { lists: [{ id: 'p', name }] };
    vi.stubGlobal(
      'Intl',
      Object.assign(Object.create(Intl) as typeof Intl, { Segmenter: undefined }),
    );
    vi.resetModules();
    try {
      const older = await import('./lists.ts');
      expect(older.renameList(state, 'p', name)).toEqual(state);
      expect(older.listProblem(state, name, 'p')).toBeNull();
      // A name typed here is still cut to the box's limit.
      expect(older.listName(older.renameList(state, 'p', 'x'.repeat(60)), 'p')).toBe(
        'x'.repeat(LIST_NAME_MAX),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('keeps to the most lists', () => {
    let state = emptyLists();
    for (let index = 0; index < MAX_LISTS; index += 1) {
      state = addList(state, `l${index}`, `L${index}`);
    }
    expect(addList(state, 'more', 'More')).toBe(state);
    expect(listProblem(state, 'More', null)).toBe(
      `You can have up to ${MAX_LISTS} lists. Delete one to add another.`,
    );
  });

  it('checks saved data', () => {
    expect(isListsState(addList(emptyLists(), 'h', 'Home'))).toBe(true);
    expect(isListsState({ lists: [{ id: '', name: 'Home' }] })).toBe(false);
    expect(isListsState({ lists: [{ id: 'h' }] })).toBe(false);
    expect(isListsState({})).toBe(false);
  });
});
