// Shared by Meals' browser tests: the day it is, finding things on the page,
// and saving meals and plans straight into storage.
import type { Page } from '@playwright/test';
import type { Meal, Planned, ShoppingItem } from '../src/lib/meals.ts';

/** Wednesday 21 October 2026, 10:00 in Tbilisi (the tests' time zone). */
export const NOW = new Date('2026-10-21T10:00:00+04:00');
export const TIME_ZONE = 'Asia/Tbilisi';

/** A day on the page, by its date ("2026-10-21"). */
export const day = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);
/** "Breakfast Porridge"-style lines of a day. */
export const dayMeals = (page: Page, date: string) => day(page, date).locator('.planned');
export const planDialog = (page: Page) => page.locator('[data-plan-dialog]');
export const mealDialog = (page: Page) => page.locator('[data-meal-dialog]');
/** The shopping list's lines, as shown ("Onions ×2"). */
export const shoppingNames = (page: Page) => page.locator('[data-shopping] [data-row-name]');

/** "Add a meal" on a day, then fills in the form and saves. */
export async function plan(
  page: Page,
  date: string,
  name: string,
  slot?: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack',
): Promise<void> {
  await day(page, date)
    .getByRole('button', { name: /^Add a meal/ })
    .click();
  await page.getByLabel('Meal', { exact: true }).fill(name);
  if (slot) await page.getByLabel('For', { exact: true }).selectOption({ label: slot });
  await planDialog(page).getByRole('button', { name: 'Save' }).click();
}

/** "New meal", filled in and saved. */
export async function newMeal(page: Page, name: string, ingredients: string[] = []): Promise<void> {
  await page.getByRole('button', { name: 'New meal' }).click();
  await mealDialog(page).getByLabel('Name').fill(name);
  await mealDialog(page).getByLabel('Ingredients (optional)').fill(ingredients.join('\n'));
  await mealDialog(page).getByRole('button', { name: 'Save' }).click();
}

/** Saves meals, a plan and shopping ticks straight into storage, then reloads. */
export async function seed(
  page: Page,
  data: { meals?: Meal[]; planned?: Planned[]; items?: ShoppingItem[] },
): Promise<void> {
  await page.evaluate(({ meals = [], planned = [], items = [] }) => {
    localStorage.setItem('shkriuss:meals', JSON.stringify({ v: 1, data: { meals } }));
    localStorage.setItem('shkriuss:meal-plan', JSON.stringify({ v: 1, data: { planned } }));
    localStorage.setItem('shkriuss:meal-shopping', JSON.stringify({ v: 1, data: { items } }));
  }, data);
  await page.reload();
}
