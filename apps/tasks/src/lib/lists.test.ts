import { describe, expect, it } from 'vitest';
import {
  addList,
  emptyLists,
  isListsState,
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
