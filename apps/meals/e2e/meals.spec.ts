// Meals' own tests. Shared checks (accessibility, security headers, offline
// support, privacy, sync) already run for every app from tests/e2e/.
// The locale is en-US, so weeks start on Sunday: "this week" is 18–24 October.
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { readStore } from '../../../tests/e2e/storage.ts';
import {
  day,
  dayMeals,
  mealDialog,
  newMeal,
  NOW,
  plan,
  planDialog,
  seed,
  shoppingNames,
  TIME_ZONE,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

test('plans meals on the days of the week, and changes or removes them', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
  await expect(page.locator('[data-day-title]')).toHaveText([
    'Sunday, October 18',
    'Monday, October 19',
    'Tuesday, October 20',
    'Wednesday, October 21',
    'Thursday, October 22',
    'Friday, October 23',
    'Saturday, October 24',
  ]);
  await expect(day(page, '2026-10-21').getByText('Today')).toBeVisible();

  // Nothing typed: it says what's missing.
  await day(page, '2026-10-21')
    .getByRole('button', { name: /^Add a meal/ })
    .click();
  await expect(page.getByLabel('Day', { exact: true })).toHaveValue('2026-10-21');
  await expect(page.getByLabel('For', { exact: true })).toHaveValue('breakfast');
  await planDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(planDialog(page).getByText('Write what you’ll eat.')).toBeVisible();
  await expect(page.getByLabel('Meal', { exact: true })).toBeFocused();
  await page.getByLabel('Meal', { exact: true }).fill('Porridge');
  await expect(planDialog(page).getByText('Not one of your meals.')).toBeVisible();
  await checkA11y(page, 'add a meal');
  await planDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dayMeals(page, '2026-10-21')).toHaveText([/Breakfast\s*Porridge/]);
  await expect(page.getByRole('button', { name: 'Porridge' })).toBeFocused();

  // The next free meal of the day comes first; another day can be chosen.
  await day(page, '2026-10-21')
    .getByRole('button', { name: /^Add a meal/ })
    .click();
  await expect(page.getByLabel('For', { exact: true })).toHaveValue('lunch');
  await page.getByLabel('Meal', { exact: true }).fill('Khachapuri');
  await page.getByLabel('Day', { exact: true }).selectOption({ label: 'Thursday, October 22' });
  await page.getByLabel('For', { exact: true }).selectOption({ label: 'Dinner' });
  await planDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dayMeals(page, '2026-10-22')).toHaveText([/Dinner\s*Khachapuri/]);

  // Changed: lunch instead.
  await page.getByRole('button', { name: 'Khachapuri' }).click();
  await expect(planDialog(page).getByRole('heading', { name: 'Change meal' })).toBeVisible();
  await page.getByLabel('For', { exact: true }).selectOption({ label: 'Lunch' });
  await planDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dayMeals(page, '2026-10-22')).toHaveText([/Lunch\s*Khachapuri/]);
  await checkA11y(page, 'week');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'week (dark)');

  // Kept after a reload.
  await page.reload();
  await expect(dayMeals(page, '2026-10-21')).toHaveText([/Breakfast\s*Porridge/]);

  // Removed.
  await page.getByRole('button', { name: 'Porridge' }).click();
  await planDialog(page).getByRole('button', { name: 'Remove' }).click();
  await expect(day(page, '2026-10-21').getByText('Nothing planned.')).toBeVisible();
  await expect(
    day(page, '2026-10-21').getByRole('button', { name: 'Add a meal on Wednesday, October 21' }),
  ).toBeFocused();
});

test('moves between weeks, and copies last week’s meals', async ({ page }) => {
  await seed(page, {
    planned: [
      { id: 'a', date: '2026-10-12', slot: 'dinner', name: 'Lentil soup' },
      { id: 'b', date: '2026-10-16', slot: 'lunch', name: 'Salad' },
    ],
  });
  const heading = page.locator('[data-week-heading]');
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(heading).toHaveText('Last week');
  await expect(dayMeals(page, '2026-10-12')).toHaveText([/Dinner\s*Lentil soup/]);
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(heading).toHaveText('Next week');
  await page.getByRole('button', { name: 'Next week' }).click();
  // Further away: just the dates.
  await expect(heading).toHaveText(/^November 1\s*–\s*7$/);
  await page.getByRole('button', { name: 'This week' }).click();
  await expect(heading).toHaveText('This week');
  await expect(heading).toBeFocused();

  await page.getByRole('button', { name: 'Copy last week’s meals' }).click();
  await expect(dayMeals(page, '2026-10-19')).toHaveText([/Dinner\s*Lentil soup/]);
  await expect(dayMeals(page, '2026-10-23')).toHaveText([/Lunch\s*Salad/]);
  await expect(page.getByRole('button', { name: 'Copy last week’s meals' })).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Copied 2 meals from last week.' }),
  ).toBeAttached();
});

test('says so when the plan is too full to copy last week, and lets go of old meals', async ({
  page,
}) => {
  await seed(page, {
    planned: [
      // More than a year ago: let go when Meals opens.
      { id: 'old', date: '2025-10-01', slot: 'dinner', name: 'Stew' },
      { id: 'a', date: '2026-10-12', slot: 'dinner', name: 'Lentil soup' },
      { id: 'b', date: '2026-10-16', slot: 'lunch', name: 'Salad' },
      ...Array.from({ length: 4998 }, (_, index) => ({
        id: `later-${index}`,
        date: '2026-12-01',
        slot: 'dinner' as const,
        name: 'Soup',
      })),
    ],
  });
  const saved = async () => {
    const plan = (await readStore<{ planned: { id: string }[] }>(page, 'meal-plan'))?.data;
    return { count: plan?.planned.length, old: plan?.planned.some((e) => e.id === 'old') };
  };
  expect(await saved()).toEqual({ count: 5000, old: false });

  // Full: nothing is copied, and the notice at the top says why.
  const copy = page.getByRole('button', { name: 'Copy last week’s meals' });
  await copy.click();
  const notice = page.locator('[data-problem-text]');
  await expect(notice).toHaveText(
    'The plan holds 5,000 meals at most, so nothing was copied. Remove some old ones first.',
  );
  await expect(notice).toBeVisible();
  await expect(copy).toBeFocused();
  await expect(day(page, '2026-10-19').getByText('Nothing planned.')).toBeVisible();
  await checkA11y(page, 'plan full');

  // Once the plan changes, the notice goes.
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.getByRole('button', { name: 'Salad' }).click();
  await planDialog(page).getByRole('button', { name: 'Remove' }).click();
  await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: 'This week' }).click();
  await copy.click();
  await expect(dayMeals(page, '2026-10-19')).toHaveText([/Dinner\s*Lentil soup/]);
});

test('keeps ticks saved by the older version, under the week’s Monday', async ({ page }) => {
  await seed(page, {
    meals: [{ id: 's', name: 'Lentil soup', ingredients: ['Red lentils', 'Carrots'], notes: '' }],
    planned: [{ id: 'p', date: '2026-10-21', slot: 'dinner', name: 'Lentil soup' }],
  });
  // Version 1 saved this week's list under its first day here, Sunday 18 October.
  await page.evaluate(() => {
    const items = [
      { id: '2026-10-18:carrots', week: '2026-10-18', name: 'Carrots', extra: false, done: true },
      { id: 'm', week: '2026-10-18', name: 'Milk', extra: true, done: false },
    ];
    localStorage.setItem('shkriuss:meal-shopping', JSON.stringify({ v: 1, data: { items } }));
  });
  await page.reload();
  await expect(shoppingNames(page)).toHaveText(['Milk', 'Red lentils', 'Carrots']);
  await expect(page.getByRole('checkbox', { name: /Carrots/ })).toBeChecked();

  // Saved again in the new version: under Monday 19 October.
  await page.getByRole('checkbox', { name: /Red lentils/ }).click();
  const saved = await readStore<{ items: { week: string }[] }>(page, 'meal-shopping');
  expect(saved?.v).toBe(2);
  expect(saved?.data.items.map((item) => item.week)).toEqual([
    '2026-10-19',
    '2026-10-19',
    '2026-10-19',
  ]);
});

// Audit 3 F2-1: the forms saved every field as it was when they opened, so
// another tab's (or another device's) change was put back.
test('a change made in another tab survives a form that was open here', async ({ page }) => {
  await newMeal(page, 'Lentil soup', ['Lentils', 'Onions']);
  await plan(page, '2026-10-21', 'Lentil soup', 'Dinner');
  const other = await page.context().newPage();
  await other.clock.setFixedTime(NOW);
  await other.goto('/');

  // Here: the meal's form is opened. In the other tab, its ingredients change.
  const meals = (tab: typeof page) => tab.locator('[data-meals]');
  await meals(page).getByRole('button', { name: 'Lentil soup' }).click();
  await meals(other).getByRole('button', { name: 'Lentil soup' }).click();
  await mealDialog(other).getByLabel('Ingredients (optional)').fill('Lentils\nOnions\nCarrots');
  await mealDialog(other).getByRole('button', { name: 'Save' }).click();
  await expect(meals(page).locator('li')).toHaveText([/Lentil soup\s*3 ingredients/]);
  // Here, notes are added: the carrots stay.
  await mealDialog(page).getByLabel('Notes (optional)').fill('Soak the lentils first.');
  await mealDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(meals(page).locator('li')).toHaveText([/Lentil soup\s*3 ingredients/]);
  await expect(shoppingNames(page)).toContainText(['Carrots']);

  // A planned meal moved to lunch there, while it's renamed here: lunch it stays.
  const planned = (tab: typeof page) =>
    day(tab, '2026-10-21').getByRole('button', { name: /^Lentil soup/ });
  await planned(page).click();
  await planned(other).click();
  await other.getByLabel('For', { exact: true }).selectOption({ label: 'Lunch' });
  await planDialog(other).getByRole('button', { name: 'Save' }).click();
  await expect(dayMeals(page, '2026-10-21')).toHaveText([/Lunch\s*Lentil soup/]);
  await page.getByLabel('Meal', { exact: true }).fill('Lentil soup with bread');
  await planDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dayMeals(page, '2026-10-21')).toHaveText([/Lunch\s*Lentil soup with bread/]);
});

// Audit 3 G-9: a name button was only as wide as the name.
test('a meal’s name fills its line, a big target however short', async ({ page }) => {
  await newMeal(page, '7');
  const meal = page.locator('[data-meals] li').first();
  const name = await meal.getByRole('button', { name: '7', exact: true }).boundingBox();
  const line = await meal.boundingBox();
  expect(name?.width).toBeGreaterThanOrEqual(44);
  expect(name?.width).toBeGreaterThan((line?.width ?? 0) / 2);
});

test('your meals’ ingredients make the shopping list', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(page.getByText('No meals yet.')).toBeVisible();
  await expect(page.locator('[data-shopping-empty]')).toBeVisible();

  await newMeal(page, 'Spaghetti bolognese', ['Spaghetti', 'Minced beef', 'Onions']);
  await expect(page.locator('[data-meals] li')).toHaveText([/Spaghetti bolognese\s*3 ingredients/]);
  // The same name twice isn't allowed.
  await newMeal(page, 'spaghetti Bolognese');
  await expect(mealDialog(page).getByText('You already have “Spaghetti bolognese”.')).toBeVisible();
  await checkA11y(page, 'meal form');
  await mealDialog(page).getByRole('button', { name: 'Cancel' }).click();

  // "Plan it" from the meal.
  await page.locator('[data-meals]').getByRole('button', { name: 'Spaghetti bolognese' }).click();
  await mealDialog(page).getByRole('button', { name: 'Plan it' }).click();
  await expect(page.getByLabel('Meal', { exact: true })).toHaveValue('Spaghetti bolognese');
  await expect(
    planDialog(page).getByText('Its ingredients go on the shopping list.'),
  ).toBeVisible();
  await expect(page.getByLabel('Day', { exact: true })).toHaveValue('2026-10-21');
  await planDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(shoppingNames(page)).toHaveText(['Minced beef', 'Onions', 'Spaghetti']);
  await expect(page.locator('[data-shopping] [data-row-for]').first()).toHaveText(
    'For Spaghetti bolognese',
  );

  // Another meal sharing an ingredient; planned by typing its name.
  await newMeal(page, 'Lentil soup', ['onions', 'Carrots']);
  await plan(page, '2026-10-22', 'lentil soup', 'Lunch');
  await expect(shoppingNames(page)).toHaveText([
    'Carrots',
    'Minced beef',
    'Onions ×2',
    'Spaghetti',
  ]);

  // Ticked off: to the end of the list, and remembered.
  await page.getByRole('checkbox', { name: /Onions/ }).click();
  await expect(shoppingNames(page)).toHaveText([
    'Carrots',
    'Minced beef',
    'Spaghetti',
    'Onions ×2',
  ]);
  await expect(page.getByRole('checkbox', { name: /Onions/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Onions/ })).toBeFocused();

  // Things added by hand.
  await page.getByLabel('Add to the list').fill('Milk');
  await page.getByLabel('Add to the list').press('Enter');
  await expect(shoppingNames(page)).toHaveText([
    'Carrots',
    'Milk',
    'Minced beef',
    'Spaghetti',
    'Onions ×2',
  ]);
  await expect(page.getByLabel('Add to the list')).toHaveValue('');
  await checkA11y(page, 'shopping list');

  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Onions/ })).toBeChecked();
  await page.getByRole('button', { name: 'Copy the list' }).click();
  await expect(page.locator('[data-shopping-status]')).toHaveText(
    'Copied. You can paste it in a message.',
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Carrots\nMilk\nMinced beef\nSpaghetti',
  );
  await page.getByRole('button', { name: 'Remove “Milk” from the list' }).click();
  await expect(shoppingNames(page)).not.toContainText(['Milk']);

  // Next week has its own list.
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.locator('[data-shopping-empty]')).toBeVisible();
  await page.getByRole('button', { name: 'This week' }).click();

  // Renamed: the plan follows.
  await page.locator('[data-meals]').getByRole('button', { name: 'Spaghetti bolognese' }).click();
  await mealDialog(page).getByLabel('Name').fill('Bolognese');
  await mealDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dayMeals(page, '2026-10-21')).toHaveText([/Breakfast\s*Bolognese/]);
  await expect(page.locator('[data-shopping] [data-row-for]').first()).toHaveText(
    'For Lentil soup',
  );

  // Deleted: still planned, without its ingredients.
  await page.locator('[data-meals]').getByRole('button', { name: 'Lentil soup' }).click();
  await mealDialog(page).getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this meal?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.locator('[data-meals] li')).toHaveText([/Bolognese/]);
  await expect(dayMeals(page, '2026-10-22')).toHaveText([/Lunch\s*lentil soup/]);
  await expect(shoppingNames(page)).toHaveText(['Minced beef', 'Spaghetti', 'Onions']);
  await expect(page.getByRole('button', { name: 'New meal' })).toBeFocused();
});
