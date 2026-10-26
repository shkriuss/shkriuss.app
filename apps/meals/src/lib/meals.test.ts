import { addDays } from '@shkriuss/dates';
import { footprint, sampleText } from '@shkriuss/sync/testing';
import { describe, expect, it, vi } from 'vitest';
import { MAX_SEALED_CHARS } from '../../../../packages/sync/src/validate.ts';
import {
  addExtra,
  addMeal,
  addPlanned,
  copyProblem,
  copyWeek,
  defaultSlot,
  dueReminders,
  emptyMeals,
  emptyPlan,
  emptyReminders,
  emptyShopping,
  extraProblem,
  findMeal,
  formatDay,
  formatWeek,
  ingredientsText,
  isMealsState,
  isPlanState,
  isRemindersState,
  isShoppingState,
  LIMITS,
  MAX_INGREDIENTS,
  MAX_MEALS,
  MAX_MEALS_TEXT,
  MAX_PLANNED,
  MAX_SHOPPING,
  MEALS_VERSION,
  mealDraftOf,
  mealFromDraft,
  mealProblems,
  mealsText,
  migrateShopping,
  parseIngredients,
  PLAN_DAYS_KEPT,
  PLAN_VERSION,
  plannedFromDraft,
  plannedInWeek,
  plannedOn,
  planProblems,
  prunePlan,
  pruneShopping,
  removeExtra,
  removeMeal,
  removePlanned,
  REMINDER_BODY,
  reminderNotices,
  reminderTime,
  renamePlanned,
  secondVersion,
  setDone,
  setReminder,
  shoppingList,
  shoppingText,
  shoppingWeek,
  sortedMeals,
  suggestions,
  updateMeal,
  updatePlanned,
  weekDays,
  weekName,
  weekStartOf,
  withReminders,
  SHOPPING_VERSION,
  SHOPPING_WEEKS_KEPT,
  SLOTS,
  type Meal,
  type MealsState,
  type Planned,
  type PlanState,
  type ShoppingItem,
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

  // Audit 3 F2-7: a line over 100 characters was cut without a word, in the
  // middle of an emoji, and two long lines that start the same became one.
  it('says when an ingredient line is too long, and cuts an older one between whole characters', () => {
    const line =
      '200 g dark chocolate (70% cocoa or more), chopped finely, plus extra for decorating the top of the cake';
    const draft = { name: 'Cake', ingredients: `Eggs\n${line}`, notes: '' };
    expect(mealProblems(emptyMeals(), draft)).toEqual({
      ingredients: 'Use at most 100 characters on each line.',
    });
    // 100 is fine, and spaces at the ends don't count.
    const hundred = { ...draft, ingredients: `  ${'x'.repeat(100)}  \nEggs` };
    expect(mealProblems(emptyMeals(), hundred)).toEqual({});
    // Cut where it must be: never in the middle of a flag or a family.
    for (const emoji of ['🇬🇪', '👨‍👩‍👧']) {
      expect(parseIngredients(`${'x'.repeat(LIMITS.ingredient - 1)}${emoji}`)).toEqual([
        'x'.repeat(LIMITS.ingredient - 1),
      ]);
    }
    expect(parseIngredients(`${'x'.repeat(LIMITS.ingredient - 2)}🇬🇪`)).toEqual([
      `${'x'.repeat(LIMITS.ingredient - 2)}🇬🇪`,
    ]);
  });

  it('cuts by code points where the browser can’t tell characters apart', async () => {
    // Firefox before 125 has no Intl.Segmenter.
    vi.stubGlobal(
      'Intl',
      Object.assign(Object.create(Intl) as typeof Intl, { Segmenter: undefined }),
    );
    vi.resetModules();
    try {
      const old = await import('./meals.ts');
      expect(old.parseIngredients(`${'x'.repeat(LIMITS.ingredient - 1)}🇬🇪`)).toEqual([
        `${'x'.repeat(LIMITS.ingredient - 1)}🇬`,
      ]);
      expect(old.parseIngredients(`${'x'.repeat(150)}`)).toEqual(['x'.repeat(100)]);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
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

  // Audit F2-6: two devices that each added "Soup" before they first synced
  // have twins, and the second couldn't be saved.
  it('lets a meal keep a name it shares with another', () => {
    const twins = { meals: [...state.meals, { ...meal('soup'), id: 'soup-2' }] };
    const draft = { name: 'Soup', ingredients: 'Leeks', notes: '' };
    expect(mealProblems(twins, draft, 'soup-2')).toEqual({});
    expect(mealProblems(twins, draft, 'soup')).toEqual({});
    // A new name is still checked, and so is a new meal.
    expect(mealProblems(twins, { ...draft, name: 'Bolognese' }, 'soup-2').name).toBe(
      'You already have “Bolognese”.',
    );
    expect(mealProblems(twins, draft).name).toBe('You already have “Soup”.');
  });

  // Audit F2-2: vowel signs were dropped like accents, so different words were "the same".
  it('tells apart words that differ in a vowel sign (Hindi, Thai…)', () => {
    // Sugar, chickpeas and rice in Hindi; chicken and rice in Thai.
    expect(parseIngredients('चीनी\nचना\nचावल\nचीनी')).toEqual(['चीनी', 'चना', 'चावल']);
    expect(parseIngredients('ไก่\nข้าว\nขาว')).toEqual(['ไก่', 'ข้าว', 'ขาว']);
    // दाल (lentils) and दल (a group) are different names.
    const dal = { meals: [meal('दाल')] };
    expect(mealProblems(dal, { name: 'दल', ingredients: '', notes: '' })).toEqual({});
    expect(findMeal(dal, 'दल')).toBeUndefined();
    expect(findMeal(dal, ' दाल ')?.name).toBe('दाल');
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
    expect(copyProblem(copied, 0)).toBeNull();
  });

  it('says so when the plan is too full to copy a week', () => {
    const full = (count: number): PlanState => ({
      planned: [
        ...plan.planned,
        ...Array.from({ length: count - plan.planned.length }, (_, index) =>
          planned(`Meal ${index}`, '2026-12-01'),
        ),
      ],
    });
    // Room for 2 of the 3.
    const some = copyWeek(full(MAX_PLANNED - 2), MONDAY, '2026-10-26', ids());
    expect([some.copied, some.left]).toEqual([2, 1]);
    expect(some.state.planned).toHaveLength(MAX_PLANNED);
    expect(copyProblem(some.copied, some.left)).toBe(
      'The plan holds 2,000 meals at most, so only 2 of last week’s 3 meals were copied.',
    );
    expect(copyProblem(1, 2)).toBe(
      'The plan holds 2,000 meals at most, so only 1 of last week’s 3 meals was copied.',
    );
    // No room at all.
    const none = copyWeek(full(MAX_PLANNED), MONDAY, '2026-10-26', ids());
    expect([none.copied, none.left]).toEqual([0, 3]);
    expect(copyProblem(none.copied, none.left)).toBe(
      'The plan holds 2,000 meals at most, so nothing was copied. Remove some old ones first.',
    );
    // Adding one is stopped too, with a message in the form.
    expect(planProblems(full(MAX_PLANNED), { name: 'Salad', date: MONDAY, slot: 'lunch' })).toEqual(
      { form: 'The plan holds 2,000 meals at most. Remove some old ones first.' },
    );
  });

  it('lets go of planned meals more than a year old', () => {
    const old: PlanState = {
      planned: [planned('Stew', '2025-10-20'), planned('Pie', '2025-10-21'), ...plan.planned],
    };
    // A year before Wednesday 21 October 2026.
    const keepFrom = addDays('2026-10-21', -PLAN_DAYS_KEPT);
    expect(keepFrom).toBe('2025-10-21');
    expect(prunePlan(old, keepFrom).planned.map((entry) => entry.name)).toEqual([
      'Pie',
      'Bolognese',
      'Porridge',
      'Soup',
      'Toast',
    ]);
    expect(prunePlan(plan, keepFrom)).toBe(plan);
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

  // Audit F2-2: sugar and chickpeas (Hindi) made one line, and one tick.
  it('keeps ingredients that differ in a vowel sign on lines of their own', () => {
    const hindi = { meals: [meal('Kheer', ['चीनी']), meal('Chana masala', ['चना'])] };
    const week = { planned: [planned('Kheer', MONDAY), planned('Chana masala', '2026-10-20')] };
    const rows = shoppingList(week, hindi, emptyShopping(), MONDAY);
    expect(rows.map((row) => [row.name, row.count])).toEqual([
      ['चना', 1],
      ['चीनी', 1],
    ]);
    const sugar = rows.find((row) => row.name === 'चीनी');
    if (!sugar) throw new Error('No sugar');
    const ticked = shoppingList(week, hindi, setDone(emptyShopping(), MONDAY, sugar, true), MONDAY);
    expect(ticked.map((row) => [row.name, row.done])).toEqual([
      ['चना', false],
      ['चीनी', true],
    ]);
  });

  // Audit 4 F3-6: wide and narrow letters are folded to ordinary ones now,
  // and a tick is saved under its ingredient as it was folded then.
  it('keeps ticks saved before wide and narrow letters were folded', () => {
    const cake = { meals: [meal('Cake', ['½ cup sugar', '牛乳 １Ｌ', 'ｺｰﾋｰ豆'])] };
    const week = { planned: [planned('Cake', MONDAY)] };
    const tick = (key: string, name: string): ShoppingItem => ({
      id: `${MONDAY}:${key}`,
      week: MONDAY,
      name,
      extra: false,
      done: true,
    });
    // As the version before saved them: "½", "１ｌ" and "ｺｰﾋｰ" as they were.
    const before = {
      items: [
        tick('½ cup sugar', '½ cup sugar'),
        tick('牛乳 １ｌ', '牛乳 １Ｌ'),
        tick('ｺｰﾋｰ豆', 'ｺｰﾋｰ豆'),
      ],
    };
    const rows = shoppingList(week, cake, before, MONDAY);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => !row.done).map((row) => row.name)).toEqual([]);
    // Taken back, the tick from before goes; ticked again, it's saved as now.
    const sugar = rows.find((row) => row.name === '½ cup sugar');
    if (!sugar) throw new Error('No sugar');
    expect(sugar.key).not.toBe('½ cup sugar');
    const back = setDone(before, MONDAY, sugar, false);
    expect(back.items.map((item) => item.name)).toEqual(['牛乳 １Ｌ', 'ｺｰﾋｰ豆']);
    expect(setDone(back, MONDAY, sugar, true).items.at(-1)?.id).toBe(`${MONDAY}:${sugar.key}`);
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

  // Audit 3 F2-9: "The shopping list is full. Tick some things off first."
  // couldn't make room: ticking keeps what was added, and ticks counted too.
  it('holds up to 500 things added by hand, and says how to make room', () => {
    const added = (count: number, extra: boolean) => ({
      items: Array.from({ length: count }, (_, index) => ({
        id: extra ? `x${index}` : `${MONDAY}:thing ${index}`,
        week: MONDAY,
        name: `Thing ${index}`,
        extra,
        done: !extra,
      })),
    });
    const full = added(MAX_SHOPPING, true);
    const problem =
      'You can add up to 500 things by hand, over all the weeks’ lists. Remove some you don’t need first.';
    expect(extraProblem(full, 'Milk')).toBe(problem);
    const [first] = shoppingList(emptyPlan(), emptyMeals(), full, MONDAY);
    if (!first) throw new Error('Nothing on the list');
    expect(extraProblem(setDone(full, MONDAY, first, true), 'Milk')).toBe(problem);
    expect(extraProblem(removeExtra(full, first.key), 'Milk')).toBeNull();
    // Ticks on the planned meals' ingredients don't count.
    expect(extraProblem(added(MAX_SHOPPING, false), 'Milk')).toBeNull();
  });

  it('shows the same ticks and added things on devices whose weeks start on other days', () => {
    // A phone whose weeks start on Monday (19–25 October) and a tablet whose
    // weeks start on Sunday (18–24 October), sharing one synced list.
    const phone = MONDAY;
    const tablet = '2026-10-18';
    let shopping = emptyShopping();
    const rowOn = (week: string, name: string) => {
      const row = shoppingList(plan, meals, shopping, week).find((entry) => entry.name === name);
      if (!row) throw new Error(`No ${name}`);
      return row;
    };
    const seen = (week: string) =>
      shoppingList(plan, meals, shopping, week).map((row) => [row.name, row.done]);

    shopping = setDone(shopping, phone, rowOn(phone, 'Onions'), true);
    shopping = addExtra(shopping, phone, 'Milk', 'm');
    shopping = setDone(shopping, tablet, rowOn(tablet, 'Carrots'), true);
    shopping = addExtra(shopping, tablet, 'Bread', 'b');
    expect(seen(phone)).toEqual([
      ['Bread', false],
      ['Milk', false],
      ['Minced beef', false],
      ['Spaghetti', false],
      ['Carrots', true],
      ['Onions', true],
    ]);
    expect(seen(tablet)).toEqual(seen(phone));
    // A week starting on Saturday (17–23 October) has the same list too.
    expect(seen('2026-10-17')).toEqual(seen(phone));

    // Ticked on both: one tick, not two.
    shopping = setDone(shopping, tablet, rowOn(tablet, 'Onions'), true);
    expect(shopping.items.filter((item) => item.name === 'Onions')).toHaveLength(1);
    // Put back on the list on the tablet: back on the phone's too.
    shopping = setDone(shopping, tablet, rowOn(tablet, 'Onions'), false);
    shopping = setDone(shopping, phone, rowOn(phone, 'Milk'), true);
    expect(rowOn(phone, 'Onions').done).toBe(false);
    expect(rowOn(tablet, 'Milk').done).toBe(true);

    // The weeks before and after keep lists of their own.
    expect(shoppingList(plan, meals, shopping, '2026-10-11').map((row) => row.name)).toEqual([]);
    expect(shoppingList(plan, meals, shopping, '2026-10-25').map((row) => row.name)).toEqual([
      'Carrots',
      'onions',
    ]);
  });

  it('saves each list under the Monday in its week', () => {
    expect(shoppingWeek(MONDAY)).toBe(MONDAY);
    // Weeks starting on Sunday, Saturday or Friday.
    expect(shoppingWeek('2026-10-18')).toBe(MONDAY);
    expect(shoppingWeek('2026-10-17')).toBe(MONDAY);
    expect(shoppingWeek('2026-10-16')).toBe(MONDAY);
    expect(addExtra(emptyShopping(), '2026-10-18', 'Milk', 'm').items[0]?.week).toBe(MONDAY);
  });

  it('moves lists saved by the older version to their week’s Monday', () => {
    const old = {
      items: [
        // From a device whose weeks start on Sunday…
        { id: '2026-10-18:onions', week: '2026-10-18', name: 'Onions', extra: false, done: true },
        { id: 'm', week: '2026-10-18', name: 'Milk', extra: true, done: false },
        // …one whose weeks start on Monday…
        { id: `${MONDAY}:carrots`, week: MONDAY, name: 'Carrots', extra: false, done: true },
        // …and one whose weeks start on Saturday, the week before.
        { id: 'b', week: '2026-10-10', name: 'Bread', extra: true, done: true },
      ],
    };
    const migrated = migrateShopping(old, 1);
    if (!migrated) throw new Error('Not migrated');
    expect(isShoppingState(migrated)).toBe(true);
    // The same ids, so sync matches them with other devices' copies.
    expect(migrated.items.map((item) => [item.id, item.week])).toEqual([
      ['2026-10-18:onions', MONDAY],
      ['m', MONDAY],
      [`${MONDAY}:carrots`, MONDAY],
      ['b', '2026-10-12'],
    ]);
    const seen = (week: string) =>
      shoppingList(plan, meals, migrated, week).map((row) => [row.name, row.done]);
    expect(seen(MONDAY)).toEqual([
      ['Milk', false],
      ['Minced beef', false],
      ['Spaghetti', false],
      ['Carrots', true],
      ['Onions', true],
    ]);
    expect(seen('2026-10-18')).toEqual(seen(MONDAY));
    // A tick from before can be taken back.
    const onions = shoppingList(plan, meals, migrated, MONDAY).find((row) => row.name === 'Onions');
    if (!onions) throw new Error('No onions');
    expect(setDone(migrated, MONDAY, onions, false).items.map((item) => item.id)).toEqual([
      'm',
      `${MONDAY}:carrots`,
      'b',
    ]);

    expect(migrateShopping(old, 2)).toBeUndefined();
    expect(migrateShopping(null, 1)).toBeUndefined();
    expect(migrateShopping({ items: 'x' }, 1)).toBeUndefined();
    expect(isShoppingState(migrateShopping({ items: [{ id: 'a' }] }, 1))).toBe(false);
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

describe('reminders', () => {
  const plan: PlanState = {
    planned: [
      planned('Lentil soup', '2026-10-21', 'dinner'),
      planned('Salad', '2026-10-21', 'dinner'),
      planned('Porridge', '2026-10-21', 'breakfast'),
      planned('Porridge', '2026-10-22', 'breakfast'),
      planned('Toast', '2026-10-20', 'breakfast'),
      planned('Pizza', '2026-10-23', 'lunch'),
    ],
  };
  let reminders = setReminder(emptyReminders(), 'dinner', '18:00');
  reminders = setReminder(reminders, 'breakfast', '07:30');

  it('keeps a time, or none, for each meal of the day', () => {
    // Nothing until one is set, so a new device holds nothing to sync.
    expect(emptyReminders().reminders).toEqual([]);
    expect(reminderTime(reminders, 'dinner')).toBe('18:00');
    expect(reminderTime(reminders, 'lunch')).toBeNull();
    // Turned off: kept as off, so that syncs too.
    expect(setReminder(reminders, 'dinner', null).reminders).toEqual([
      { id: 'breakfast', time: '07:30' },
      { id: 'dinner', time: null },
    ]);
    // Whatever comes back from syncing: each meal of the day at most once, in order.
    expect(
      withReminders([
        { id: 'snack', time: '16:00' },
        { id: 'lunch', time: 'noon' as never },
      ]).reminders,
    ).toEqual([
      { id: 'lunch', time: null },
      { id: 'snack', time: '16:00' },
    ]);
    expect(isRemindersState(reminders)).toBe(true);
    expect(isRemindersState({ reminders: [{ id: 'tea', time: null }] })).toBe(false);
  });

  it('schedules what’s planned, at its meal’s time, from now on', () => {
    const notices = reminderNotices(plan, reminders, '2026-10-21T10:00');
    expect(notices.map((notice) => [notice.start, notice.title])).toEqual([
      ['2026-10-21T18:00', 'Dinner: Lentil soup, Salad'],
      ['2026-10-22T07:30', 'Breakfast: Porridge'],
    ]);
    expect(notices[0]).toEqual({
      id: '2026-10-21~dinner',
      start: '2026-10-21T18:00',
      repeat: 'none',
      until: null,
      offset: 0,
      title: 'Dinner: Lentil soup, Salad',
      body: REMINDER_BODY,
      tag: '2026-10-21~dinner',
      url: '/',
    });
    expect(reminderNotices(plan, emptyReminders(), '2026-10-21T10:00')).toEqual([]);
  });

  it('says which reminders are due', () => {
    expect(dueReminders(plan, reminders, '2026-10-21T07:00', '2026-10-21T07:30')).toEqual([
      { id: '2026-10-21~breakfast', title: 'Breakfast: Porridge' },
    ]);
    expect(dueReminders(plan, reminders, '2026-10-21T07:30', '2026-10-21T17:59')).toEqual([]);
  });
});

describe('room', () => {
  const text = (size: number, seed: number) => (size === 0 ? '' : sampleText(size, seed));

  // Audit 4 F2-13: at its limits, Meals held more than a browser keeps for a
  // site. Everything is saved on the device (in localStorage, about 5 MB for
  // each site), and with sync on, also goes into the copy that goes online.
  // Every limit is filled, at its longest; how many ticks and deleted things
  // there are depends on use, so those are estimates.
  it('has room for everything at its limits, on the device and in the sync copy', async () => {
    // All the text meals can hold: meals at every limit of their own, then
    // the rest of the 500, with names of 30 characters.
    let left = MAX_MEALS_TEXT;
    const meals = Array.from({ length: MAX_MEALS }, (_, index): Meal => {
      let room = left - 30 * (MAX_MEALS - index - 1);
      const take = (max: number) => {
        const size = Math.max(0, Math.min(max, room));
        room -= size;
        left -= size;
        return size;
      };
      const name = text(take(LIMITS.name), index);
      const ingredients = Array.from({ length: MAX_INGREDIENTS }, () => take(LIMITS.ingredient))
        .filter((size) => size > 0)
        .map((size, at) => text(size, index * 100 + at));
      return { id: crypto.randomUUID(), name, ingredients, notes: text(take(LIMITS.notes), index) };
    });
    expect(mealsText({ meals })).toBe(MAX_MEALS_TEXT);
    // All four meals of the day, for a year and more, with the longest names.
    const planned = Array.from({ length: MAX_PLANNED }, (_, index): Planned => ({
      id: crypto.randomUUID(),
      date: addDays('2026-01-01', Math.floor(index / 4)),
      slot: SLOTS[index % 4] ?? 'dinner',
      name: text(LIMITS.name, index % MAX_MEALS),
    }));
    // Everything that can be added by hand, at the longest, over the 9
    // weeks' lists kept; and about 100 ticks a week on the planned meals'
    // ingredients (they're named after the ingredient).
    const weeks = SHOPPING_WEEKS_KEPT + 1;
    const extras = Array.from({ length: MAX_SHOPPING }, (_, index): ShoppingItem => ({
      id: crypto.randomUUID(),
      week: addDays('2026-08-31', 7 * (index % weeks)),
      name: text(LIMITS.ingredient, index),
      extra: true,
      done: index % 2 === 0,
    }));
    const ticks = Array.from({ length: 100 * weeks }, (_, index): ShoppingItem => {
      const week = addDays('2026-08-31', 7 * (index % weeks));
      const name = text(40, 5000 + index);
      return { id: `${week}:${name.toLowerCase()}`, week, name, extra: false, done: true };
    });
    const items = [...extras, ...ticks];
    const sizes = [
      await footprint({
        app: 'meals',
        store: 'shkriuss:meals',
        version: MEALS_VERSION,
        data: { meals },
        items: meals,
        deleted: 100,
      }),
      await footprint({
        app: 'meals',
        store: 'shkriuss:meal-plan',
        version: PLAN_VERSION,
        data: { planned },
        items: planned,
        // Let go of after a year (four a day), or taken off, in the last 180 days.
        deleted: 1000,
      }),
      await footprint({
        app: 'meals',
        store: 'shkriuss:meal-shopping',
        version: SHOPPING_VERSION,
        data: { items },
        items,
        // Each week's list let go of after 8 weeks: 26 weeks' in 180 days.
        deleted: Math.round((26 / weeks) * items.length),
      }),
    ];
    const total = (key: 'saved' | 'syncState' | 'sealed') =>
      sizes.reduce((sum, size) => sum + size[key], 0);
    // One copy for all of them goes online: less than the copies apart.
    expect(total('sealed')).toBeLessThan(MAX_SEALED_CHARS);
    // Safari allows 5 MiB (5,242,880 bytes), and counts 2 bytes for each
    // character of text with any character beyond Latin-1 (like ’ from an
    // iPhone's keyboard, or Georgian). Sync's own records are plain letters
    // and digits: 1 byte each. Some room is left for the rest (reminders).
    expect(2 * total('saved') + total('syncState')).toBeLessThan(4_500_000);
  }, 60_000);

  it('holds only so much text in all the meals together, and says how to make room', () => {
    const big = (id: string, notes: number): Meal => ({
      id,
      name: id,
      ingredients: [],
      notes: 'x'.repeat(notes),
    });
    // Just under the limit, in meals of 5,000 characters of notes.
    const count = Math.floor(MAX_MEALS_TEXT / 5003);
    const full = { meals: Array.from({ length: count }, (_, at) => big(`m${at}`, 5000)) };
    const room = MAX_MEALS_TEXT - mealsText(full);
    const problem = `Your meals hold up to ${MAX_MEALS_TEXT.toLocaleString('en')} characters of names, ingredients and notes, all together. Shorten this one, or delete meals you don’t need, to make room.`;
    const draft = (notes: number) => ({ name: 'Soup', ingredients: '', notes: 'y'.repeat(notes) });
    expect(mealProblems(full, draft(room - 4))).toEqual({});
    expect(mealProblems(full, draft(room - 3))).toEqual({ form: problem });
    // A meal kept can still be changed, and made shorter, but not longer.
    expect(mealProblems(full, { ...mealDraftOf(full.meals[0]), notes: 'shorter' }, 'm0')).toEqual(
      {},
    );
    expect(
      mealProblems(full, { ...mealDraftOf(full.meals[0]), notes: 'z'.repeat(5000) }, 'm0'),
    ).toEqual({});
    const over = { meals: [...full.meals, big('extra', room + 100)] };
    expect(
      mealProblems(over, { ...mealDraftOf(over.meals[0]), notes: 'x'.repeat(4000) }, 'm0'),
    ).toEqual({});
    expect(
      mealProblems(
        over,
        { ...mealDraftOf(over.meals.at(-1)), notes: 'x'.repeat(room + 101) },
        'extra',
      ),
    ).toEqual({ form: problem });
  });
});
