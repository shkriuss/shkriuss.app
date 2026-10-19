import { describe, expect, it } from 'vitest';
import {
  addCategory,
  categoriesOf,
  categoryName,
  categoryProblem,
  isCategoriesState,
  MAX_CATEGORIES,
  noChanges,
  removeCategory,
  renameCategory,
  STARTING_CATEGORIES,
  type CategoriesState,
} from './categories.ts';

const names = (state: CategoriesState) => categoriesOf(state).map((entry) => entry.name);

describe('categories', () => {
  it('starts with the usual ones, in alphabetical order', () => {
    expect(names(noChanges())).toEqual([
      'Clothes and shoes',
      'Food and drink',
      'Home',
      'Other',
      'Personal care',
      'Personal items',
      'Tech and appliances',
    ]);
  });

  it('adds, renames and removes your own', () => {
    let state = addCategory(noChanges(), 'books', '  Books ');
    expect(names(state)).toContain('Books');
    state = renameCategory(state, 'books', 'Books and magazines');
    expect(categoryName(categoriesOf(state), 'books')).toBe('Books and magazines');
    state = removeCategory(state, 'books');
    expect(names(state)).not.toContain('Books and magazines');
    // Nothing is left behind of a category you added.
    expect(state).toEqual(noChanges());
  });

  it('renames and removes the starting ones, saving only the change', () => {
    let state = renameCategory(noChanges(), 'food', 'Groceries');
    state = removeCategory(state, 'tech');
    expect(names(state)).toEqual([
      'Clothes and shoes',
      'Groceries',
      'Home',
      'Other',
      'Personal care',
      'Personal items',
    ]);
    expect(state.changes).toEqual([
      { id: 'food', name: 'Groceries', removed: false },
      { id: 'tech', name: 'Tech and appliances', removed: true },
    ]);
  });

  it('can remove every one of them', () => {
    let state = noChanges();
    for (const { id } of STARTING_CATEGORIES) state = removeCategory(state, id);
    expect(categoriesOf(state)).toEqual([]);
    expect(categoryName(categoriesOf(state), 'food')).toBe('');
  });

  it('explains what’s wrong with a name', () => {
    const state = addCategory(noChanges(), 'books', 'Books');
    expect(categoryProblem(state, 'Garden', null)).toBeNull();
    expect(categoryProblem(state, '   ', null)).toBe('Give it a name.');
    // Not twice, whatever the spelling.
    expect(categoryProblem(state, ' BOOKS', null)).toBe(
      'You already have a category called “Books”.',
    );
    expect(categoryProblem(state, 'hôme', null)).toBe('You already have a category called “Home”.');
    // Renaming a category to itself, in other letters, is fine.
    expect(categoryProblem(state, 'books', 'books')).toBeNull();
  });

  it('keeps to the most categories', () => {
    let state = noChanges();
    for (let index = 0; categoriesOf(state).length < MAX_CATEGORIES; index += 1) {
      state = addCategory(state, `c${index}`, `Category ${index}`);
    }
    expect(addCategory(state, 'one-more', 'One more')).toBe(state);
    expect(categoryProblem(state, 'One more', null)).toBe(
      `You can have up to ${MAX_CATEGORIES} categories. Delete one to add another.`,
    );
    // Renaming still works.
    expect(categoryProblem(state, 'Renamed', 'c0')).toBeNull();
  });

  it('checks saved data', () => {
    expect(isCategoriesState(renameCategory(noChanges(), 'food', 'Groceries'))).toBe(true);
    expect(isCategoriesState({ changes: [{ id: 'food', name: 'Food' }] })).toBe(false);
    expect(isCategoriesState({ changes: [{ id: '', name: 'Food', removed: false }] })).toBe(false);
    expect(isCategoriesState({})).toBe(false);
  });
});
