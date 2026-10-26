// Water's own tests. Shared checks (accessibility, security headers, offline
// support, privacy, sync) already run for every app from tests/e2e/.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { toMl } from '../src/lib/water.ts';
import {
  addOther,
  drink,
  history,
  left,
  NOW,
  otherDialog,
  seed,
  TIME_ZONE,
  TODAY,
  todaysDrinks,
  total,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('adds glasses and bottles towards the goal, and removes them', async ({ page }) => {
  await expect(page.locator('[data-date]')).toHaveText('Wednesday, October 21');
  await expect(total(page)).toHaveText('0 ml');
  await expect(left(page)).toHaveText('2,000 ml to go.');
  await expect(page.getByText('Nothing yet today.')).toBeVisible();
  await expect(page.getByText('Nothing logged in the last 7 days yet.')).toBeVisible();

  const glass = page.getByRole('button', { name: 'Glass 250 ml' });
  await glass.click();
  await expect(status(page, 'Added 250 ml. 250 ml of 2,000 ml today.')).toBeAttached();
  await expect(glass).toBeFocused();
  await page.getByRole('button', { name: 'Bottle 500 ml' }).click();
  await expect(total(page)).toHaveText('750 ml');
  await expect(left(page)).toHaveText('1,250 ml to go.');
  await expect(page.getByRole('progressbar', { name: 'Today’s goal' })).toHaveAttribute(
    'value',
    '750',
  );
  await expect(todaysDrinks(page)).toHaveText([/10:00\sAM\s*500 ml/, /10:00\sAM\s*250 ml/]);
  await expect(history(page).first()).toHaveText(/Today\s*750 ml/);
  await expect(page.getByText('On average, 107 ml a day.')).toBeVisible();
  await checkA11y(page, 'today');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'today (dark)');

  // Kept after a reload; removed one by one.
  await page.reload();
  await expect(total(page)).toHaveText('750 ml');
  await page.getByRole('button', { name: 'Remove 500 ml at 10:00 AM' }).click();
  await expect(status(page, 'Removed 500 ml.')).toBeAttached();
  await expect(total(page)).toHaveText('250 ml');
  await expect(page.getByRole('button', { name: 'Remove 250 ml at 10:00 AM' })).toBeFocused();
  await page.getByRole('button', { name: 'Remove 250 ml at 10:00 AM' }).click();
  await expect(page.getByText('Nothing yet today.')).toBeVisible();
  await expect(glass).toBeFocused();
});

test('adds any amount, earlier today or yesterday', async ({ page }) => {
  await page.getByRole('button', { name: 'Other amount' }).click();
  const dialog = otherDialog(page);
  await expect(dialog.getByLabel('Time')).toHaveValue('10:00');
  await expect(dialog.getByLabel('Day')).toHaveValue(TODAY);

  // Checked before it's added.
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByText('Enter an amount.')).toBeVisible();
  await expect(dialog.getByLabel('Amount (ml)')).toBeFocused();
  await dialog.getByLabel('Amount (ml)').fill('5');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByText('Enter at least 10 ml.')).toBeVisible();
  await dialog.getByLabel('Amount (ml)').fill('330');
  await dialog.getByLabel('Time').fill('11:15');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog.getByText('Choose a time that has already come.')).toBeVisible();
  await checkA11y(page, 'add a drink');
  await dialog.getByLabel('Time').fill('08:15');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toBeHidden();
  await expect(todaysDrinks(page)).toHaveText([/8:15\sAM\s*330 ml/]);
  await expect(page.getByRole('button', { name: 'Other amount' })).toBeFocused();

  // Forgot one last night.
  await addOther(page, '400', '22:30', 'Yesterday');
  await expect(status(page, 'Added 400 ml yesterday. 330 ml of 2,000 ml today.')).toBeAttached();
  await expect(todaysDrinks(page)).toHaveCount(1);
  await expect(history(page).nth(1)).toHaveText(/Yesterday\s*400 ml/);

  // Cancelled: nothing added.
  await page.getByRole('button', { name: 'Other amount' }).click();
  await otherDialog(page).getByLabel('Amount (ml)').fill('1000');
  await otherDialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(total(page)).toHaveText('330 ml');
});

test('reaching the goal, days in a row and the last 7 days', async ({ page }) => {
  await seed(page, {
    drinks: [
      drink('2026-10-19', '09:00', 2000),
      drink('2026-10-20', '09:00', 1500),
      drink('2026-10-20', '18:00', 600),
      drink('2026-10-17', '12:00', 900),
      drink(TODAY, '08:00', 1500),
    ],
  });
  await expect(page.getByText('Goal reached 2 days in a row.')).toBeVisible();
  await expect(history(page)).toHaveText([
    /Today\s*1,500 ml$/,
    /Yesterday\s*2,100 ml\s*, goal reached$/,
    /Monday, October 19\s*2,000 ml\s*, goal reached$/,
    /Sunday, October 18\s*0 ml$/,
    /Saturday, October 17\s*900 ml$/,
    /Friday, October 16\s*0 ml$/,
    /Thursday, October 15\s*0 ml$/,
  ]);

  await page.getByRole('button', { name: 'Bottle 500 ml' }).click();
  await expect(
    status(page, 'Added 500 ml. 2,000 ml of 2,000 ml today. Goal reached. Well done!'),
  ).toBeAttached();
  await expect(left(page)).toHaveText('Goal reached. Well done!');
  await expect(page.getByText('Goal reached 3 days in a row.')).toBeVisible();
  // More is fine; the bar stays full.
  await page.getByRole('button', { name: 'Glass 250 ml' }).click();
  await expect(total(page)).toHaveText('2,250 ml');
  await expect(page.getByRole('progressbar', { name: 'Today’s goal' })).toHaveAttribute(
    'value',
    '2000',
  );
});

test('in fluid ounces, drinking exactly the goal reaches it', async ({ page }) => {
  // Each bottle is saved as 591 ml, and the goal as 2,957 ml: five bottles
  // are 2,955 ml, but they add up as shown: 100 fl oz (audit F1-1).
  await seed(page, {
    settings: [
      { id: 'unit', unit: 'oz' },
      { id: 'goal', ml: toMl(100, 'oz') },
      { id: 'bottle', ml: toMl(20, 'oz') },
    ],
  });
  const bottle = page.getByRole('button', { name: 'Bottle 20 fl oz' });
  for (let count = 1; count <= 4; count += 1) {
    await bottle.click();
    await expect(todaysDrinks(page)).toHaveCount(count);
  }
  await expect(total(page)).toHaveText('80 fl oz');
  await expect(left(page)).toHaveText('20 fl oz to go.');
  await bottle.click();
  await expect(
    status(page, 'Added 20 fl oz. 100 fl oz of 100 fl oz today. Goal reached. Well done!'),
  ).toBeAttached();
  await expect(total(page)).toHaveText('100 fl oz');
  await expect(left(page)).toHaveText('Goal reached. Well done!');
  await expect(page.getByRole('progressbar', { name: 'Today’s goal' })).toHaveAttribute(
    'value',
    String(toMl(100, 'oz')),
  );
  await expect(page.getByText('Goal reached 1 day in a row.')).toBeVisible();
  await expect(history(page).first()).toHaveText(/goal reached$/);

  // In millilitres the five bottles are 2,955 ml of 2,957 ml, but the day
  // was reached, and stays so (audit 4 F1-9).
  await page.getByLabel('Millilitres (ml)').check();
  await expect(status(page, 'Amounts are in millilitres now.')).toBeAttached();
  await expect(total(page)).toHaveText('2,955 ml');
  await expect(left(page)).toHaveText('Goal reached. Well done!');
  await expect(page.getByText('Goal reached 1 day in a row.')).toBeVisible();
  await expect(history(page).first()).toHaveText(/goal reached$/);
});

test('reads amounts typed with a decimal comma', async ({ page }) => {
  // The fields were type="number", which dropped the comma as it was typed:
  // "8,5" fl oz was logged as 85 (audit 4 G-1).
  await seed(page, { settings: [{ id: 'unit', unit: 'oz' }] });
  await page.getByRole('button', { name: 'Other amount' }).click();
  const field = otherDialog(page).getByLabel(/^Amount/);
  await field.pressSequentially('8,5');
  await expect(field).toHaveValue('8,5');
  await otherDialog(page).getByRole('button', { name: 'Add' }).click();
  await expect(status(page, 'Added 8.5 fl oz.')).toBeAttached();
  await expect(total(page)).toHaveText('8.5 fl oz');
});

test('the goal, the glass and bottle sizes, and the units can be changed', async ({ page }) => {
  await seed(page, { drinks: [drink(TODAY, '08:00', 500)] });
  const goal = page.getByLabel('Daily goal (ml)');
  await expect(goal).toHaveValue('2000');

  await goal.fill('300');
  await goal.press('Enter');
  await expect(page.locator('#setting-goal-error')).toHaveText('Enter at least 500 ml.');
  await expect(goal).toHaveAttribute('aria-invalid', 'true');
  // Read out, focus being in the field (audit 3 G-5).
  await expect(page.getByRole('alert')).toHaveText('Daily goal (ml): Enter at least 500 ml.');
  await checkA11y(page, 'goal problem');
  await goal.fill('2500');
  await goal.press('Enter');
  await expect(status(page, 'Daily goal: 2,500 ml.')).toBeAttached();
  await expect(page.getByText('Enter at least 500 ml.')).toBeHidden();
  await expect(left(page)).toHaveText('2,000 ml to go.');

  await page.getByLabel('Glass (ml)').fill('300');
  await page.getByLabel('Glass (ml)').blur();
  await expect(page.getByRole('button', { name: 'Glass 300 ml' })).toBeVisible();

  // Ounces: what was set is converted, the rest uses round numbers in ounces.
  await page.getByLabel('US fluid ounces (fl oz)').check();
  await expect(status(page, 'Amounts are in US fluid ounces now.')).toBeAttached();
  await expect(page.getByLabel('Daily goal (fl oz)')).toHaveValue('84.5');
  await expect(page.getByLabel('Glass (fl oz)')).toHaveValue('10.1');
  await expect(page.getByLabel('Bottle (fl oz)')).toHaveValue('16');
  await expect(total(page)).toHaveText('16.9 fl oz');
  await expect(page.getByRole('button', { name: 'Bottle 16 fl oz' })).toBeVisible();
  await page.getByRole('button', { name: 'Other amount' }).click();
  await otherDialog(page).getByLabel('Amount (fl oz)').fill('12');
  await otherDialog(page).getByRole('button', { name: 'Add' }).click();
  await expect(todaysDrinks(page).first()).toHaveText(/12 fl oz/);

  // Kept after a reload.
  await page.reload();
  await expect(page.getByLabel('US fluid ounces (fl oz)')).toBeChecked();
  await page.getByLabel('Millilitres (ml)').check();
  await expect(page.getByLabel('Daily goal (ml)')).toHaveValue('2500');
  await expect(todaysDrinks(page).first()).toHaveText(/355 ml/);
});

test('a goal or size that can’t be used is read out after leaving its field too', async ({
  page,
}) => {
  // It was shown but not said, so nothing told a screen reader user it
  // wasn't saved (audit 3 G-5).
  const goal = page.getByLabel('Daily goal (ml)');
  await goal.fill('0');
  await goal.press('Tab');
  await expect(page.locator('#setting-goal-error')).toHaveText('Enter at least 500 ml.');
  await expect(goal).toHaveAttribute('aria-invalid', 'true');
  await expect(status(page, 'Daily goal: Enter at least 500 ml.')).toBeAttached();
  // Focus goes on, where the person sent it.
  await expect(page.getByLabel('Glass (ml)')).toBeFocused();

  await page.getByLabel('Bottle (ml)').fill('5');
  await page.getByLabel('Bottle (ml)').blur();
  await expect(status(page, 'Bottle: Enter at least 10 ml.')).toBeAttached();

  // After Enter, focus stays in the field, which reads it out (once).
  await page.getByLabel('Glass (ml)').fill('2');
  await page.getByLabel('Glass (ml)').press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Glass (ml): Enter at least 10 ml.');
  await expect(status(page, 'Glass: Enter at least 10 ml.')).toHaveCount(0);
});
