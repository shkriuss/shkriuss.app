/**
 * Shelf's categories. It starts with a few (food, clothes, tech…); any of
 * them can be renamed or removed, and you can add your own.
 *
 * Only your changes are saved, not the whole list: a category you added, or
 * a starting one you renamed or removed. A new device has the starting list
 * without saving anything, so when it syncs it never brings back a category
 * you removed on another device, or undoes a rename.
 */
import { cutToLength, foldText } from '@shkriuss/ui/text';
import { byText } from './items.ts';

export interface Category {
  id: string;
  name: string;
}

export const STARTING_CATEGORIES: readonly Category[] = [
  { id: 'food', name: 'Food and drink' },
  { id: 'clothes', name: 'Clothes and shoes' },
  { id: 'tech', name: 'Tech and appliances' },
  { id: 'care', name: 'Personal care' },
  { id: 'personal', name: 'Personal items' },
  { id: 'home', name: 'Home' },
  { id: 'other', name: 'Other' },
];

/** A category you added, or a starting one you renamed or removed. */
export interface CategoryChange extends Category {
  /** A starting category you removed (one you added is simply deleted). */
  removed: boolean;
}

export interface CategoriesState {
  changes: CategoryChange[];
}

export const CATEGORIES_VERSION = 1;
export const MAX_CATEGORIES = 100;
export const CATEGORY_NAME_MAX = 50;

export const noChanges = (): CategoriesState => ({ changes: [] });

const isStarting = (id: string): boolean => STARTING_CATEGORIES.some((entry) => entry.id === id);

function isChange(value: unknown): value is CategoryChange {
  if (typeof value !== 'object' || value === null) return false;
  const change = value as Record<string, unknown>;
  return (
    typeof change['id'] === 'string' &&
    change['id'].length > 0 &&
    typeof change['name'] === 'string' &&
    typeof change['removed'] === 'boolean'
  );
}

/** True when saved data has the shape Shelf expects. */
export function isCategoriesState(value: unknown): value is CategoriesState {
  if (typeof value !== 'object' || value === null) return false;
  const { changes } = value as Record<string, unknown>;
  return Array.isArray(changes) && changes.every(isChange);
}

/** The categories there are now, in alphabetical order. */
export function categoriesOf(state: CategoriesState): Category[] {
  const changes = new Map(state.changes.map((change) => [change.id, change]));
  const starting = STARTING_CATEGORIES.map(
    (entry) => changes.get(entry.id) ?? { ...entry, removed: false },
  );
  const added = state.changes.filter((change) => !isStarting(change.id));
  return [...starting, ...added]
    .filter((entry) => !entry.removed)
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => byText(a.name, b.name) || (a.id < b.id ? -1 : 1));
}

/** A category's name, or "" when it has none or the category is gone. */
export const categoryName = (categories: readonly Category[], id: string): string =>
  categories.find((entry) => entry.id === id)?.name ?? '';

/** A name cut as Safari's text boxes count, never an emoji in half (audit 4 F3-4). */
const cutName = (name: string): string => cutToLength(name.trim(), CATEGORY_NAME_MAX).trim();

/**
 * What's wrong with a name for a category, or null if it can be saved.
 * `id` is the category being renamed (null for a new one).
 */
export function categoryProblem(
  state: CategoriesState,
  name: string,
  id: string | null,
): string | null {
  const categories = categoriesOf(state);
  const wanted = foldText(cutName(name));
  if (wanted === '') return 'Give it a name.';
  const same = categories.find((entry) => entry.id !== id && foldText(entry.name) === wanted);
  if (same) return `You already have a category called “${same.name}”.`;
  if (id === null && categories.length >= MAX_CATEGORIES) {
    return `You can have up to ${MAX_CATEGORIES} categories. Delete one to add another.`;
  }
  return null;
}

/** Puts in a change, replacing any earlier one for the same category. */
function withChange(state: CategoriesState, change: CategoryChange): CategoriesState {
  if (!state.changes.some((entry) => entry.id === change.id)) {
    return { changes: [...state.changes, change] };
  }
  return { changes: state.changes.map((entry) => (entry.id === change.id ? change : entry)) };
}

/** Adds a category of your own. The same state when there are already MAX_CATEGORIES. */
export function addCategory(state: CategoriesState, id: string, name: string): CategoriesState {
  if (categoriesOf(state).length >= MAX_CATEGORIES) return state;
  return withChange(state, { id, name: cutName(name), removed: false });
}

/** Renames a category (one deleted on another device meanwhile comes back). */
export const renameCategory = (state: CategoriesState, id: string, name: string): CategoriesState =>
  withChange(state, { id, name: cutName(name), removed: false });

/** Removes a category: one you added is deleted; a starting one is marked removed. */
export function removeCategory(state: CategoriesState, id: string): CategoriesState {
  if (!isStarting(id)) return { changes: state.changes.filter((entry) => entry.id !== id) };
  const name = categoryName(categoriesOf(state), id) || categoryName(STARTING_CATEGORIES, id);
  return withChange(state, { id, name, removed: true });
}
