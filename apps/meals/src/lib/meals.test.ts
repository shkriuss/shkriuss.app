import { describe, expect, it } from 'vitest';
import {
  addExtra,
  addMeal,
  addPlanned,
  copyWeek,
  defaultSlot,
  emptyMeals,
  emptyPlan,
  emptyShopping,
  extraProblem,
  findMeal,
  formatDay,
  formatWeek,
  ingredientsText,
  isMealsState,
  isPlanState,
  isShoppingState,
  MAX_INGREDIENTS,
  mealDraftOf,
  mealFromDraft,
  mealProblems,
  parseIngredients,
  plannedFromDraft,
  plannedInWeek,
  plannedOn,
  planProblems,
  pruneShopping,
  removeExtra,
  removeMeal,
  removePlanned,
  renamePlanned,
  secondVersion,
  setDone,
  shoppingList,
  shoppingText,
  sortedMeals,
  suggestions,
  updateMeal,
  updatePlanned,
  weekDays,
  weekName,
  weekStartOf,
  type Meal,
  type MealsState,
  type Planned,
  type PlanState,
  type Slot,
} from './meals.ts';

const meal = (name: string, ingredients: string[] = [], notes = ''): Meal => ({
  id: name.toLowerCase(),
  name,
  ingredients,
  notes,
});

const planned = (name: string, date: string, slot: Slot = 'dinner'): Planned => ({
  id: `${name}-${date}-${slot}`,
  date,
  slot,
  name,
});

const ids = () => {
  let next = 0;
  return () => `new-${(next += 1)}`;
};

// Monday 19 October 2026.
const MONDAY = '2026-10-19';

describe('weeks', () => {
  it('starts on the day weeks start where you are', () => {
    // Wednesday 21 October.
    expect(weekStartOf('2026-10-21', 1)).toBe(MONDAY);
    expect(weekStartOf('2026-10-21', 7)).toBe('2026-10-18');
    expect(weekStartOf(MONDAY, 1)).toBe(MONDAY);
    expect(weekStartOf('2026-10-25', 1)).toBe(MONDAY);
    expect(weekDays(MONDAY)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
  });

  it('names and shows weeks and days', () => {
    expect(weekName(MONDAY, MONDAY)).toBe('This week');
    expect(weekName('2026-10-26', MONDAY)).toBe('Next week');
    expect(weekName('2026-10-12', MONDAY)).toBe('Last week');
    expect(weekName('2026-11-02', MONDAY)).toBeNull();
    expect(formatDay(MONDAY, 'en-GB')).toBe('Monday 19 October');
    // Browsers differ in the spaces around the dash.
    const week = (start: string) => formatWeek(start, 'en-GB').replace(/\s+/g, ' ');
    expect(week(MONDAY)).toBe('19 – 25 October');
    expect(week('2026-09-28')).toBe('28 September – 4 October');
  });
});

describe('your meals', () => {
  const bolognese = meal('Bolognese', ['Spaghetti', 'Minced beef', 'Onions']);
  const state: MealsState = { meals: [meal('Soup'), bolognese] };

  it('reads ingredients one per line, tidied and each once', () => {
    expect(parseIngredients('  Onions \n\n500 g   minced beef\nonions\nÓnions\n')).toEqual([
      'Onions',
      '500 g minced beef',
    ]);
    expect(parseIngredients(`${'x'.repeat(150)}`)).toEqual(['x'.repeat(100)]);
  });

  it('checks the form', () => {
    const draft = { name: '', ingredients: '', notes: '' };
    expect(mealProblems(state, draft)).toEqual({ name: 'Give the meal a name.' });
    expect(mealProblems(state, { ...draft, name: 'x'.repeat(101) }).name).toBe(
      'Use at most 100 characters.',
    );
    expect(mealProblems(state, { ...draft, name: ' bolognese ' }).name).toBe(
      'You already have “Bolognese”.',
    );
    // Its own name is fine when it's the one being changed.
    expect(mealProblems(state, { ...draft, name: 'Bolognese' }, bolognese.id)).toEqual({});
    const many = Array.from({ length: MAX_INGREDIENTS + 1 }, (_, index) => `i${index}`);
    expect(mealProblems(state, { ...draft, name: 'Stew', ingredients: many.join('\n') })).toEqual({
      ingredients: `Up to ${MAX_INGREDIENTS} ingredients.`,
    });
    expect(mealProblems(state, { ...draft, name: 'Stew', notes: 'x'.repeat(5001) }).notes).toBe(
      'Use at most 5,000 characters.',
    );
  });

  it('adds, changes, finds and deletes meals', () => {
    const draft = { name: ' Chicken   curry ', ingredients: 'Chicken\nRice', notes: ' Spicy. ' };
    const curry = mealFromDraft(draft, 'c');
    expect(curry).toEqual({
      id: 'c',
      name: 'Chicken curry',
      ingredients: ['Chicken', 'Rice'],
      notes: 'Spicy.',
    });
    expect(mealDraftOf(curry)).toEqual({
      name: 'Chicken curry',
      ingredients: 'Chicken\nRice',
      notes: 'Spicy.',
    });
    let next = addMeal(state, curry);
    expect(sortedMeals(next).map((entry) => entry.name)).toEqual([
      'Bolognese',
      'Chicken curry',
      'Soup',
    ]);
    expect(findMeal(next, 'CHICKEN CURRY')).toBe(curry);
    expect(findMeal(next, '')).toBeUndefined();
    next = updateMeal(next, { ...curry, name: 'Curry' });
    expect(findMeal(next, 'curry')?.id).toBe('c');
    next = removeMeal(next, 'c');
    expect(findMeal(next, 'curry')).toBeUndefined();
    expect(ingredientsText(bolognese)).toBe('3 ingredients');
    expect(ingredientsText(meal('Toast', ['Bread']))).toBe('1 ingredient');
    expect(ingredientsText(meal('Toast'))).toBe('No ingredients yet');
  });

  it('keeps a second version under another name', () => {
    expect(secondVersion(bolognese, 'b2')).toEqual({
      ...bolognese,
      id: 'b2',
      name: 'Bolognese (second version)',
    });
  });

  it('accepts only what Meals saves', () => {
    expect(isMealsState(emptyMeals())).toBe(true);
    expect(isMealsState(state)).toBe(true);
    expect(isMealsState({ meals: [{ id: 'a', name: 'A', ingredients: 'x', notes: '' }] })).toBe(
      false,
    );
    expect(isMealsState(null)).toBe(false);
  });
});

describe('the plan', () => {
  const plan: PlanState = {
    planned: [
      planned('Bolognese', MONDAY, 'dinner'),
      planned('Porridge', MONDAY, 'breakfast'),
      planned('Soup', '2026-10-21', 'lunch'),
      planned('Toast', '2026-10-26', 'breakfast'),
    ],
  };

  it('lists a day’s meals in order, and a week’s by day', () => {
    expect(plannedOn(plan, MONDAY).map((entry) => entry.name)).toEqual(['Porridge', 'Bolognese']);
    expect(plannedInWeek(plan, MONDAY).map((entry) => entry.name)).toEqual([
      'Porridge',
      'Bolognese',
      'Soup',
    ]);
  });

  it('suggests the first free meal of the day', () => {
    expect(defaultSlot(plan, MONDAY)).toBe('lunch');
    expect(defaultSlot(plan, '2026-10-21')).toBe('breakfast');
    const full = addPlanned(plan, planned('Salad', MONDAY, 'lunch'));
    expect(defaultSlot(full, MONDAY)).toBe('dinner');
  });

  it('checks, adds, changes and removes planned meals', () => {
    expect(planProblems(plan, { name: ' ', date: MONDAY, slot: 'lunch' })).toEqual({
      name: 'Write what you’ll eat.',
    });
    expect(planProblems(plan, { name: 'Salad', date: 'monday', slot: 'lunch' })).toEqual({
      form: 'Choose a day and a meal of the day.',
    });
    const salad = plannedFromDraft({ name: '  Greek   salad', date: MONDAY, slot: 'lunch' }, 's');
    expect(salad).toEqual({ id: 's', date: MONDAY, slot: 'lunch', name: 'Greek salad' });
    let next = addPlanned(plan, salad);
    next = updatePlanned(next, { ...salad, slot: 'snack' });
    expect(plannedOn(next, MONDAY).map((entry) => entry.name)).toEqual([
      'Porridge',
      'Bolognese',
      'Greek salad',
    ]);
    next = removePlanned(next, 's');
    expect(next.planned).toHaveLength(4);
  });

  it('follows a meal that was renamed', () => {
    const next = renamePlanned(plan, 'bolognese', 'Spaghetti bolognese');
    expect(plannedOn(next, MONDAY).map((entry) => entry.name)).toEqual([
      'Porridge',
      'Spaghetti bolognese',
    ]);
    expect(renamePlanned(plan, 'Soup', 'SOUP')).toBe(plan);
  });

  it('copies a week to another, on the same days', () => {
    const { state, copied } = copyWeek(plan, MONDAY, '2026-10-26', ids());
    expect(copied).toBe(3);
    expect(plannedInWeek(state, '2026-10-26').map((entry) => [entry.date, entry.name])).toEqual([
      // Toast was there already.
      ['2026-10-26', 'Toast'],
      ['2026-10-26', 'Porridge'],
      ['2026-10-26', 'Bolognese'],
      ['2026-10-28', 'Soup'],
    ]);
    expect(state.planned.filter((entry) => entry.id.startsWith('new-'))).toHaveLength(3);
  });

  it('suggests your meals first, then other names planned before', () => {
    const meals: MealsState = { meals: [meal('Soup'), meal('Bolognese')] };
    expect(suggestions(meals, plan)).toEqual(['Bolognese', 'Soup', 'Porridge', 'Toast']);
  });

  it('accepts only what Meals saves', () => {
    expect(isPlanState(emptyPlan())).toBe(true);
    expect(isPlanState(plan)).toBe(true);
    expect(isPlanState({ planned: [{ ...planned('A', MONDAY), slot: 'tea' }] })).toBe(false);
  });
});

describe('shopping', () => {
  const meals: MealsState = {
    meals: [
      meal('Bolognese', ['Spaghetti', 'Minced beef', 'Onions']),
      meal('Soup', ['onions', 'Carrots']),
      meal('Porridge'),
    ],
  };
  const plan: PlanState = {
    planned: [
      planned('Bolognese', MONDAY),
      planned('soup', '2026-10-21', 'lunch'),
      planned('Bolognese', '2026-10-23'),
      planned('Porridge', MONDAY, 'breakfast'),
      planned('Takeaway', '2026-10-24'),
      // Next week: not on this week's list.
      planned('Soup', '2026-10-26'),
    ],
  };

  it('lists the week’s ingredients once each, with the meals that need them', () => {
    const rows = shoppingList(plan, meals, emptyShopping(), MONDAY);
    expect(rows.map((row) => [row.name, row.count, row.meals])).toEqual([
      ['Carrots', 1, ['Soup']],
      ['Minced beef', 2, ['Bolognese']],
      ['Onions', 3, ['Bolognese', 'Soup']],
      ['Spaghetti', 2, ['Bolognese']],
    ]);
    expect(shoppingText(rows)).toBe('Carrots\nMinced beef ×2\nOnions ×3\nSpaghetti ×2');
  });

  it('ticks things off, adds others by hand, and remembers each week apart', () => {
    let shopping = emptyShopping();
    let rows = shoppingList(plan, meals, shopping, MONDAY);
    const onions = rows.find((row) => row.name === 'Onions');
    if (!onions) throw new Error('No onions');
    shopping = setDone(shopping, MONDAY, onions, true);
    expect(shopping.items).toEqual([
      { id: `${MONDAY}:onions`, week: MONDAY, name: 'Onions', extra: false, done: true },
    ]);
    expect(extraProblem(shopping, '  ')).toBe('Write what to buy.');
    expect(extraProblem(shopping, 'x'.repeat(101))).toBe('Use at most 100 characters.');
    expect(extraProblem(shopping, 'Milk')).toBeNull();
    shopping = addExtra(shopping, MONDAY, ' Milk ', 'm');
    rows = shoppingList(plan, meals, shopping, MONDAY);
    expect(rows.map((row) => [row.name, row.done, row.extra])).toEqual([
      ['Carrots', false, false],
      ['Milk', false, true],
      ['Minced beef', false, false],
      ['Spaghetti', false, false],
      ['Onions', true, false],
    ]);
    expect(shoppingText(rows)).toBe('Carrots\nMilk\nMinced beef ×2\nSpaghetti ×2');

    const milk = rows.find((row) => row.name === 'Milk');
    if (!milk) throw new Error('No milk');
    shopping = setDone(shopping, MONDAY, milk, true);
    shopping = setDone(shopping, MONDAY, onions, false);
    rows = shoppingList(plan, meals, shopping, MONDAY);
    expect(rows.filter((row) => row.done).map((row) => row.name)).toEqual(['Milk']);
    expect(shopping.items.map((item) => item.id)).toEqual(['m']);

    // Next week has its own list.
    expect(shoppingList(plan, meals, shopping, '2026-10-26').map((row) => row.name)).toEqual([
      'Carrots',
      'onions',
    ]);
    expect(removeExtra(shopping, 'm').items).toEqual([]);
  });

  it('lets go of old weeks', () => {
    const shopping = addExtra(
      addExtra(emptyShopping(), '2026-08-03', 'Old', 'a'),
      MONDAY,
      'New',
      'b',
    );
    expect(pruneShopping(shopping, '2026-08-24').items.map((item) => item.id)).toEqual(['b']);
    const kept = pruneShopping(shopping, '2026-08-03');
    expect(kept).toBe(shopping);
  });

  it('accepts only what Meals saves', () => {
    expect(isShoppingState(emptyShopping())).toBe(true);
    expect(
      isShoppingState({ items: [{ id: 'a', week: MONDAY, name: 'A', extra: 1, done: false }] }),
    ).toBe(false);
  });
});
