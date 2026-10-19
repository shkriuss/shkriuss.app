// Holidays, days off and fasts in Georgia (lib/holidays.ts has the dates).
// The clock is fixed to Saturday 17 October 2026, in en-US.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { day, upcoming } from './helpers.ts';

const special = (page: Page) => page.locator('[data-day-special]');
const nextMonth = (page: Page) => page.getByRole('button', { name: 'Next month' }).click();

test('shows days off, Orthodox holidays and fasts on the month and the day', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T10:00:00'));
  await page.goto('/');

  // Svetitskhovloba is a day off and a church holiday: underlined in red, with a ring.
  const svetitskhovloba = day(
    page,
    'Wednesday, October 14, 2026, Svetitskhovloba (Mtskhetoba) (day off)',
  );
  await expect(svetitskhovloba).toHaveClass(/day-cell--off/);
  await expect(svetitskhovloba.locator('.day-cell__ring')).toHaveCount(1);
  await svetitskhovloba.click();
  await expect(special(page).getByRole('listitem')).toHaveText([
    /^Day off · Orthodox holiday\s*Svetitskhovloba \(Mtskhetoba\)\s*სვეტიცხოვლობა$/,
  ]);
  await expect(special(page).locator('[lang="ka"]')).toHaveText('სვეტიცხოვლობა');
  // They're not events: "nothing planned" still says so, and there's nothing to open.
  await expect(page.getByText('Nothing planned on this day.')).toBeVisible();
  await expect(special(page).getByRole('button')).toHaveCount(0);
  await expect(page.locator('[data-special-legend]')).toHaveText(
    /17\s*Day off\s*Orthodox holiday\s*Fast/,
  );

  // December: the Nativity Fast, with a holiday during it.
  await nextMonth(page);
  await nextMonth(page);
  const entry = day(
    page,
    'Friday, December 4, 2026, Entry of the Mother of God into the Temple, Nativity Fast',
  );
  await expect(entry).toHaveClass(/day-cell--fast/);
  await expect(day(page, 'Tuesday, December 1, 2026, Nativity Fast')).toHaveClass(/day-cell--fast/);

  // January: Christmas, after the fast.
  await nextMonth(page);
  await expect(day(page, 'Wednesday, January 6, 2027, Nativity Fast')).toBeVisible();
  await day(page, 'Thursday, January 7, 2027, Christmas (day off)').click();
  await expect(special(page).getByRole('listitem')).toHaveText([
    /^Day off · Orthodox holiday\s*Christmas\s*ქრისტეშობა$/,
  ]);
  await checkA11y(page, 'Christmas');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'Christmas (dark)');
});

test('lists them among the next 7 days, a long fast where it starts', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T10:00:00'));
  await page.goto('/');
  await expect(upcoming(page).getByRole('listitem')).toHaveText([
    /^Mon, Nov 23 · Day off · Orthodox holiday\s*Giorgoba \(St George’s Day\)\s*გიორგობა$/,
    /^Sat, Nov 28 · Fast\s*Nativity Fast starts\s*შობის მარხვა$/,
  ]);
  await expect(page.getByText('Nothing planned in the next 7 days.')).toBeVisible();
});

test('shows only what’s chosen, and remembers the choice', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T10:00:00'));
  await page.goto('/');
  const daysOff = page.getByLabel('Days off in Georgia (public holidays)');
  const feasts = page.getByLabel('Orthodox holidays');
  const fasts = page.getByLabel('Fasts', { exact: true });
  const weekly = page.getByLabel('Every Wednesday and Friday too');
  await expect(daysOff).toBeChecked();
  await expect(feasts).toBeChecked();
  await expect(fasts).toBeChecked();
  await expect(weekly).not.toBeChecked();

  // Without days off, Svetitskhovloba is still a church holiday.
  await daysOff.uncheck();
  const october14 = page.locator('[data-date="2026-10-14"]');
  await expect(october14).toHaveAccessibleName(
    'Wednesday, October 14, 2026, Svetitskhovloba (Mtskhetoba)',
  );
  await expect(october14).not.toHaveClass(/day-cell--off/);
  await expect(page.locator('[data-legend="daysOff"]')).toBeHidden();
  await feasts.uncheck();
  await expect(october14).toHaveAccessibleName('Wednesday, October 14, 2026');

  // Wednesdays and Fridays are part of the fasts.
  await weekly.check();
  await expect(page.locator('[data-date="2026-10-21"]')).toHaveAccessibleName(
    'Wednesday, October 21, 2026, Wednesday fast',
  );
  await fasts.uncheck();
  await expect(weekly).toBeDisabled();
  await expect(page.locator('[data-date="2026-10-21"]')).toHaveAccessibleName(
    'Wednesday, October 21, 2026',
  );
  await expect(page.locator('[data-special-legend]')).toBeHidden();

  await page.reload();
  await expect(daysOff).not.toBeChecked();
  await expect(feasts).not.toBeChecked();
  await expect(fasts).not.toBeChecked();
  await expect(weekly).toBeChecked();
  await expect(october14).toHaveAccessibleName('Wednesday, October 14, 2026');
});
