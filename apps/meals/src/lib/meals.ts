/**
 * Meals' data and rules, kept separate from the page so they're easy to test.
 * Every function returns new data instead of changing the old.
 *
 * Three lists, saved and synced separately:
 * - your meals: dishes you make, each with its ingredients and notes;
 * - the plan: what you'll eat on a day, at breakfast, lunch, dinner or as a
 *   snack. A planned meal is just a name: it uses the ingredients of your
 *   meal with the same name (capitals and accents don't matter), so a meal
 *   added later, or renamed, still matches;
 * - shopping: what's ticked off on a week's shopping list, and what was
 *   added to it by hand. The list itself is made from that week's planned
 *   meals. A tick's id is made from the week and the ingredient, so ticking
 *   the same thing on two devices is the same tick, never a conflict.
 */
import {
  addDays,
  compareDates,
  daysBetween,
  isIsoDate,
  weekday,
  type IsoDate,
} from '@shkriuss/dates';
import { secondVersionName } from '@shkriuss/sync';

export const LIMITS = { name: 100, ingredient: 100, notes: 5000 } as const;
export const MAX_INGREDIENTS = 60;
export const MAX_MEALS = 500;
export const MAX_PLANNED = 5000;
export const MAX_SHOPPING = 2000;
/** Shopping lists older than this many weeks are let go. */
export const SHOPPING_WEEKS_KEPT = 8;

// ---------- Text ----------

/** For comparing names: without capitals, accents or extra spaces. */
export const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim().replace(/\s+/g, ' ');

/** Alphabetical order, without minding case or accents. */
export const byText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/** Trimmed, with runs of spaces made one. */
const tidy = (text: string): string => text.trim().replace(/\s+/g, ' ');

/** At most `max` characters (never in the middle of an emoji). */
const cut = (text: string, max: number): string => [...text].slice(0, max).join('').trimEnd();

const length = (text: string): number => [...text].length;

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

// ---------- Meals of the day ----------

export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABELS: Record<Slot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};
const isSlot = (value: unknown): value is Slot => SLOTS.includes(value as Slot);

// ---------- Weeks ----------

/** The first day of the week `date` is in; `firstDay` is 1 (Monday) … 7 (Sunday). */
export const weekStartOf = (date: IsoDate, firstDay: number): IsoDate =>
  addDays(date, -((weekday(date) - firstDay + 7) % 7));

/** The 7 days of the week starting on `start`. */
export const weekDays = (start: IsoDate): IsoDate[] =>
  Array.from({ length: 7 }, (_, index) => addDays(start, index));

const inWeek = (date: IsoDate, start: IsoDate): boolean => {
  const day = daysBetween(start, date);
  return day >= 0 && day < 7;
};

// ---------- Your meals ----------

export interface Meal {
  id: string;
  name: string;
  /** One per line on the page, e.g. "Onions", "500 g minced beef". */
  ingredients: string[];
  /** How to make it, where the recipe is… */
  notes: string;
}

export interface MealsState {
  meals: Meal[];
}

export const MEALS_VERSION = 1;
export const emptyMeals = (): MealsState => ({ meals: [] });

function isMeal(value: unknown): value is Meal {
  if (typeof value !== 'object' || value === null) return false;
  const meal = value as Record<string, unknown>;
  return (
    typeof meal['id'] === 'string' &&
    typeof meal['name'] === 'string' &&
    Array.isArray(meal['ingredients']) &&
    meal['ingredients'].every((ingredient) => typeof ingredient === 'string') &&
    typeof meal['notes'] === 'string'
  );
}

export const isMealsState = (value: unknown): value is MealsState =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as MealsState).meals) &&
  (value as MealsState).meals.every(isMeal);

/** Your meals, in alphabetical order. */
export const sortedMeals = (state: MealsState): Meal[] =>
  [...state.meals].sort((a, b) => byText(a.name, b.name));

/** Your meal called `name`, if there is one. */
export function findMeal(state: MealsState, name: string): Meal | undefined {
  const key = fold(name);
  return key === '' ? undefined : state.meals.find((meal) => fold(meal.name) === key);
}

/** Ingredients typed one per line: tidied, without empty lines or the same one twice. */
export function parseIngredients(text: string): string[] {
  const seen = new Set<string>();
  const ingredients: string[] = [];
  for (const line of text.split('\n')) {
    const ingredient = cut(tidy(line), LIMITS.ingredient);
    const key = fold(ingredient);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    ingredients.push(ingredient);
  }
  return ingredients;
}

/** What the meal form holds, as typed. */
export interface MealDraft {
  name: string;
  /** One per line. */
  ingredients: string;
  notes: string;
}

export type MealField = 'name' | 'ingredients' | 'notes' | 'form';

export const mealDraftOf = (meal?: Meal): MealDraft => ({
  name: meal?.name ?? '',
  ingredients: meal?.ingredients.join('\n') ?? '',
  notes: meal?.notes ?? '',
});

/** What's wrong with the form, if anything. `editing` is the meal being changed. */
export function mealProblems(
  state: MealsState,
  draft: MealDraft,
  editing?: string,
): Partial<Record<MealField, string>> {
  const problems: Partial<Record<MealField, string>> = {};
  const name = tidy(draft.name);
  const same = findMeal(state, name);
  if (name === '') problems.name = 'Give the meal a name.';
  else if (length(name) > LIMITS.name) problems.name = `Use at most ${LIMITS.name} characters.`;
  else if (same && same.id !== editing) problems.name = `You already have “${same.name}”.`;
  if (parseIngredients(draft.ingredients).length > MAX_INGREDIENTS) {
    problems.ingredients = `Up to ${MAX_INGREDIENTS} ingredients.`;
  }
  if (length(draft.notes) > LIMITS.notes) {
    problems.notes = `Use at most ${LIMITS.notes.toLocaleString('en')} characters.`;
  }
  if (editing === undefined && state.meals.length >= MAX_MEALS) {
    problems.form = `You have ${MAX_MEALS} meals, as many as Meals keeps. Delete one to add another.`;
  }
  return problems;
}

export const mealFromDraft = (draft: MealDraft, id: string): Meal => ({
  id,
  name: tidy(draft.name),
  ingredients: parseIngredients(draft.ingredients),
  notes: draft.notes.trim(),
});

export const addMeal = (state: MealsState, meal: Meal): MealsState => ({
  meals: [...state.meals, meal],
});

export const updateMeal = (state: MealsState, meal: Meal): MealsState => ({
  meals: state.meals.map((entry) => (entry.id === meal.id ? meal : entry)),
});

export const removeMeal = (state: MealsState, id: string): MealsState => ({
  meals: state.meals.filter((meal) => meal.id !== id),
});

/** Changed on two devices at once: this device's version, kept as a meal of its own. */
export const secondVersion = (meal: Meal, id: string): Meal => ({
  ...meal,
  id,
  name: secondVersionName(meal.name, LIMITS.name),
});

/** "4 ingredients", or "No ingredients yet". */
export const ingredientsText = (meal: Meal): string =>
  meal.ingredients.length === 0
    ? 'No ingredients yet'
    : plural(meal.ingredients.length, 'ingredient');

// ---------- The plan ----------

export interface Planned {
  id: string;
  date: IsoDate;
  slot: Slot;
  name: string;
}

export interface PlanState {
  planned: Planned[];
}

export const PLAN_VERSION = 1;
export const emptyPlan = (): PlanState => ({ planned: [] });

function isPlanned(value: unknown): value is Planned {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['id'] === 'string' &&
    isIsoDate(entry['date']) &&
    isSlot(entry['slot']) &&
    typeof entry['name'] === 'string'
  );
}

export const isPlanState = (value: unknown): value is PlanState =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as PlanState).planned) &&
  (value as PlanState).planned.every(isPlanned);

const bySlot = (a: Planned, b: Planned): number => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);

/** What's planned on `date`: breakfast first, then lunch, dinner and snacks. */
export const plannedOn = (state: PlanState, date: IsoDate): Planned[] =>
  state.planned.filter((entry) => entry.date === date).sort(bySlot);

/** What's planned in the week starting on `start`, day by day. */
export const plannedInWeek = (state: PlanState, start: IsoDate): Planned[] =>
  state.planned
    .filter((entry) => inWeek(entry.date, start))
    .sort((a, b) => compareDates(a.date, b.date) || bySlot(a, b));

/** What the "Add a meal" form holds. */
export interface PlanDraft {
  name: string;
  date: IsoDate;
  slot: Slot;
}

export type PlanField = 'name' | 'form';

export function planProblems(
  state: PlanState,
  draft: PlanDraft,
  editing?: string,
): Partial<Record<PlanField, string>> {
  const problems: Partial<Record<PlanField, string>> = {};
  const name = tidy(draft.name);
  if (name === '') problems.name = 'Write what you’ll eat.';
  else if (length(name) > LIMITS.name) problems.name = `Use at most ${LIMITS.name} characters.`;
  if (!isIsoDate(draft.date) || !isSlot(draft.slot)) {
    problems.form = 'Choose a day and a meal of the day.';
  } else if (editing === undefined && state.planned.length >= MAX_PLANNED) {
    problems.form = `The plan holds ${MAX_PLANNED.toLocaleString('en')} meals at most. Remove some old ones first.`;
  }
  return problems;
}

export const plannedFromDraft = (draft: PlanDraft, id: string): Planned => ({
  id,
  date: draft.date,
  slot: draft.slot,
  name: tidy(draft.name),
});

export const addPlanned = (state: PlanState, entry: Planned): PlanState => ({
  planned: [...state.planned, entry],
});

export const updatePlanned = (state: PlanState, entry: Planned): PlanState => ({
  planned: state.planned.map((old) => (old.id === entry.id ? entry : old)),
});

export const removePlanned = (state: PlanState, id: string): PlanState => ({
  planned: state.planned.filter((entry) => entry.id !== id),
});

/** For a new meal on `date`: the first of breakfast, lunch and dinner still free, or dinner. */
export function defaultSlot(state: PlanState, date: IsoDate): Slot {
  const taken = new Set(plannedOn(state, date).map((entry) => entry.slot));
  return (['breakfast', 'lunch', 'dinner'] as const).find((slot) => !taken.has(slot)) ?? 'dinner';
}

/** After one of your meals is renamed: planned meals with the old name follow. */
export function renamePlanned(state: PlanState, from: string, to: string): PlanState {
  const key = fold(from);
  if (key === fold(to)) return state;
  return {
    planned: state.planned.map((entry) =>
      fold(entry.name) === key ? { ...entry, name: to } : entry,
    ),
  };
}

/**
 * Copies what's planned in the week starting on `from` to the week starting
 * on `to`, on the same days of the week. Returns the new plan and how many
 * meals were copied.
 */
export function copyWeek(
  state: PlanState,
  from: IsoDate,
  to: IsoDate,
  newId: () => string,
): { state: PlanState; copied: number } {
  const shift = daysBetween(from, to);
  const room = Math.max(0, MAX_PLANNED - state.planned.length);
  const copies = plannedInWeek(state, from)
    .slice(0, room)
    .map((entry) => ({ ...entry, id: newId(), date: addDays(entry.date, shift) }));
  return { state: { planned: [...state.planned, ...copies] }, copied: copies.length };
}

/** Names to suggest when planning: your meals, then other names planned before. */
export function suggestions(meals: MealsState, plan: PlanState): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  const add = (name: string) => {
    const key = fold(name);
    if (key === '' || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  for (const meal of sortedMeals(meals)) add(meal.name);
  const others: string[] = [];
  for (const entry of plan.planned) {
    if (!seen.has(fold(entry.name))) others.push(entry.name);
  }
  for (const name of others.sort(byText)) add(name);
  return names.slice(0, 300);
}

// ---------- Shopping ----------

export interface ShoppingItem {
  id: string;
  /** The first day of the week whose list it's on. */
  week: IsoDate;
  name: string;
  /** Added by hand (true), or a tick on an ingredient from the plan (false). */
  extra: boolean;
  done: boolean;
}

export interface ShoppingState {
  items: ShoppingItem[];
}

export const SHOPPING_VERSION = 1;
export const emptyShopping = (): ShoppingState => ({ items: [] });

function isShoppingItem(value: unknown): value is ShoppingItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item['id'] === 'string' &&
    isIsoDate(item['week']) &&
    typeof item['name'] === 'string' &&
    typeof item['extra'] === 'boolean' &&
    typeof item['done'] === 'boolean'
  );
}

export const isShoppingState = (value: unknown): value is ShoppingState =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as ShoppingState).items) &&
  (value as ShoppingState).items.every(isShoppingItem);

/** One line on a week's shopping list. */
export interface ShoppingRow {
  /** The ingredient (folded), or the id of something added by hand. */
  key: string;
  name: string;
  /** How many planned meals need it. */
  count: number;
  /** Your meals that need it. */
  meals: string[];
  extra: boolean;
  done: boolean;
}

const tickId = (week: IsoDate, key: string): string => `${week}:${key}`;

/**
 * The shopping list for the week starting on `week`: the ingredients of its
 * planned meals (each once, with how many meals need it) and what was added
 * by hand. What's still to buy comes first, in alphabetical order.
 */
export function shoppingList(
  plan: PlanState,
  meals: MealsState,
  shopping: ShoppingState,
  week: IsoDate,
): ShoppingRow[] {
  const rows = new Map<string, ShoppingRow>();
  for (const entry of plannedInWeek(plan, week)) {
    const meal = findMeal(meals, entry.name);
    if (!meal) continue;
    for (const ingredient of meal.ingredients) {
      const key = fold(ingredient);
      const row = rows.get(key) ?? {
        key,
        name: ingredient,
        count: 0,
        meals: [],
        extra: false,
        done: false,
      };
      row.count += 1;
      if (!row.meals.includes(meal.name)) row.meals.push(meal.name);
      rows.set(key, row);
    }
  }
  const list = [...rows.values()];
  for (const item of shopping.items) {
    if (item.week !== week) continue;
    if (item.extra) {
      list.push({
        key: item.id,
        name: item.name,
        count: 1,
        meals: [],
        extra: true,
        done: item.done,
      });
    } else {
      const row = rows.get(item.id.slice(week.length + 1));
      if (row) row.done = item.done;
    }
  }
  return list.sort((a, b) => Number(a.done) - Number(b.done) || byText(a.name, b.name));
}

/** Ticks a line off the week's list, or puts it back. */
export function setDone(
  shopping: ShoppingState,
  week: IsoDate,
  row: Pick<ShoppingRow, 'key' | 'name' | 'extra'>,
  done: boolean,
): ShoppingState {
  if (row.extra) {
    return {
      items: shopping.items.map((item) => (item.id === row.key ? { ...item, done } : item)),
    };
  }
  const id = tickId(week, row.key);
  const items = shopping.items.filter((item) => item.id !== id);
  if (done) items.push({ id, week, name: row.name, extra: false, done: true });
  return { items };
}

/** What's wrong with something to add to the list by hand, if anything. */
export function extraProblem(shopping: ShoppingState, name: string): string | null {
  const text = tidy(name);
  if (text === '') return 'Write what to buy.';
  if (length(text) > LIMITS.ingredient) return `Use at most ${LIMITS.ingredient} characters.`;
  if (shopping.items.length >= MAX_SHOPPING)
    return 'The shopping list is full. Tick some things off first.';
  return null;
}

export const addExtra = (
  shopping: ShoppingState,
  week: IsoDate,
  name: string,
  id: string,
): ShoppingState => ({
  items: [...shopping.items, { id, week, name: tidy(name), extra: true, done: false }],
});

export const removeExtra = (shopping: ShoppingState, id: string): ShoppingState => ({
  items: shopping.items.filter((item) => item.id !== id),
});

/** Lets go of lists from before `keepFrom` (a week's first day). The same object if none. */
export function pruneShopping(shopping: ShoppingState, keepFrom: IsoDate): ShoppingState {
  const items = shopping.items.filter((item) => compareDates(item.week, keepFrom) >= 0);
  return items.length === shopping.items.length ? shopping : { items };
}

/** "Onions ×2" */
export const rowText = (row: Pick<ShoppingRow, 'name' | 'count'>): string =>
  row.count > 1 ? `${row.name} ×${row.count}` : row.name;

/** What's still to buy, one per line, to paste into a message. */
export const shoppingText = (rows: readonly ShoppingRow[]): string =>
  rows
    .filter((row) => !row.done)
    .map(rowText)
    .join('\n');

// ---------- Showing dates ----------

const utc = (date: IsoDate): Date => new Date(`${date}T00:00:00Z`);

/** "Monday 19 October" (in the person's language). */
export const formatDay = (date: IsoDate, locale?: string): string =>
  new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(utc(date));

/** "19–25 October", "28 September – 4 October". */
export const formatWeek = (start: IsoDate, locale?: string): string =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).formatRange(
    utc(start),
    utc(addDays(start, 6)),
  );

/** "This week", "Next week", "Last week", or null for others. */
export function weekName(start: IsoDate, thisWeek: IsoDate): string | null {
  const weeks = daysBetween(thisWeek, start) / 7;
  if (weeks === 0) return 'This week';
  if (weeks === 1) return 'Next week';
  if (weeks === -1) return 'Last week';
  return null;
}
