// Shared by Water's browser tests: the day it is, finding things on the page,
// and saving drinks and settings straight into storage.
import type { Page } from '@playwright/test';
import { seedStores } from '../../../tests/e2e/storage.ts';
import { DRINKS_VERSION, SETTINGS_VERSION, type Drink, type Setting } from '../src/lib/water.ts';

/** Wednesday 21 October 2026, 10:00 in Tbilisi (the tests' time zone). */
export const NOW = new Date('2026-10-21T10:00:00+04:00');
export const TODAY = '2026-10-21';
export const TIME_ZONE = 'Asia/Tbilisi';

/** Today's drinks, as shown ("10:00 AM 250 ml"), latest first. */
export const todaysDrinks = (page: Page) => page.locator('[data-drinks] li');
/** The last 7 days, as shown ("Yesterday 2,000 ml"), today first. */
export const history = (page: Page) => page.locator('[data-days] li');
export const total = (page: Page) => page.locator('[data-total]');
export const left = (page: Page) => page.locator('[data-left]');
export const otherDialog = (page: Page) => page.locator('[data-other-dialog]');

/** "Other amount", filled in and added. */
export async function addOther(
  page: Page,
  amount: string,
  time?: string,
  day?: 'Today' | 'Yesterday',
): Promise<void> {
  await page.getByRole('button', { name: 'Other amount' }).click();
  await otherDialog(page)
    .getByLabel(/^Amount/)
    .fill(amount);
  if (day) await otherDialog(page).getByLabel('Day').selectOption({ label: day });
  if (time) await otherDialog(page).getByLabel('Time').fill(time);
  await otherDialog(page).getByRole('button', { name: 'Add' }).click();
}

/** Saves drinks and settings straight into storage, then reloads. */
export async function seed(
  page: Page,
  { drinks = [], settings = [] }: { drinks?: Drink[]; settings?: Setting[] },
): Promise<void> {
  await seedStores(page, {
    water: { version: DRINKS_VERSION, data: { drinks } },
    'water-settings': { version: SETTINGS_VERSION, data: { settings } },
  });
}

/** A drink on a day, at a time. */
export const drink = (date: string, time: string, ml: number): Drink => ({
  id: `${date}~${time}~${ml}`,
  date,
  time,
  ml,
});
