/**
 * Your lists ("Work", "Home", "Shopping"…). There are none to begin with:
 * tasks without a list are simply in "All". A list can be renamed or
 * deleted at any time.
 */
import { byText, fold } from './tasks.ts';

export interface List {
  id: string;
  name: string;
}

export interface ListsState {
  lists: List[];
}

export const LISTS_VERSION = 1;
export const MAX_LISTS = 100;
export const LIST_NAME_MAX = 50;

export const emptyLists = (): ListsState => ({ lists: [] });

function isList(value: unknown): value is List {
  if (typeof value !== 'object' || value === null) return false;
  const list = value as Record<string, unknown>;
  return (
    typeof list['id'] === 'string' && list['id'].length > 0 && typeof list['name'] === 'string'
  );
}

/** True when saved data has the shape Tasks expects. */
export function isListsState(value: unknown): value is ListsState {
  if (typeof value !== 'object' || value === null) return false;
  const { lists } = value as Record<string, unknown>;
  return Array.isArray(lists) && lists.every(isList);
}

/** The lists in alphabetical order. */
export const sortedLists = (state: ListsState): List[] =>
  [...state.lists].sort((a, b) => byText(a.name, b.name) || (a.id < b.id ? -1 : 1));

/** A list's name, or "" when there's no such list (any more). */
export const listName = (state: ListsState, id: string): string =>
  state.lists.find((list) => list.id === id)?.name ?? '';

const cutName = (name: string): string => name.trim().slice(0, LIST_NAME_MAX).trim();

/**
 * What's wrong with a name for a list, or null if it can be saved. `id` is
 * the list being renamed (null for a new one).
 */
export function listProblem(state: ListsState, name: string, id: string | null): string | null {
  const wanted = fold(cutName(name));
  if (wanted === '') return 'Give it a name.';
  const same = state.lists.find((list) => list.id !== id && fold(list.name) === wanted);
  if (same) return `You already have a list called “${same.name}”.`;
  if (id === null && state.lists.length >= MAX_LISTS) {
    return `You can have up to ${MAX_LISTS} lists. Delete one to add another.`;
  }
  return null;
}

/** Adds a list. The same state when there are already MAX_LISTS. */
export function addList(state: ListsState, id: string, name: string): ListsState {
  if (state.lists.length >= MAX_LISTS) return state;
  return { lists: [...state.lists, { id, name: cutName(name) }] };
}

/** Renames a list (one deleted on another device meanwhile comes back). */
export function renameList(state: ListsState, id: string, name: string): ListsState {
  const list = { id, name: cutName(name) };
  if (!state.lists.some((entry) => entry.id === id)) return { lists: [...state.lists, list] };
  return { lists: state.lists.map((entry) => (entry.id === id ? list : entry)) };
}

export const removeList = (state: ListsState, id: string): ListsState => ({
  lists: state.lists.filter((list) => list.id !== id),
});
