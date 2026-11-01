// Steps: smaller things to do inside a task, added in its form and ticked
// in the list.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { addTask, box, editor, NOW, row, seed, TIME_ZONE } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

const summary = (page: Page, title: string) => row(page, title).locator('summary');
const newStep = (page: Page) => editor(page).getByLabel('New step');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

test('adds steps in the form, and ticks them in the list', async ({ page }) => {
  await addTask(page, 'Prepare for the trip');
  await expect(row(page, 'Prepare for the trip').locator('[data-steps]')).toBeHidden();
  await page.getByRole('button', { name: 'Edit Prepare for the trip' }).click();

  // Enter adds a step; the box is ready for the next one.
  await newStep(page).fill('Book the hotel');
  await newStep(page).press('Enter');
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel('Step 1', { exact: true })).toHaveValue('Book the hotel');
  await expect(newStep(page)).toHaveValue('');
  await expect(newStep(page)).toBeFocused();
  await editor(page).getByRole('button', { name: 'Add step' }).click();
  await expect(editor(page).getByText('Write the step first.')).toBeVisible();
  await newStep(page).fill('Renew passport');
  await expect(editor(page).getByText('Write the step first.')).toBeHidden();
  await editor(page).getByRole('button', { name: 'Add step' }).click();
  await newStep(page).fill('Pack');
  await newStep(page).press('Enter');

  // Change one, tick one, remove one.
  await editor(page).getByLabel('Step 2', { exact: true }).fill('Renew my passport');
  // Enter in a step goes on to "New step" instead of saving.
  await editor(page).getByLabel('Step 2', { exact: true }).press('Enter');
  await expect(newStep(page)).toBeFocused();
  await editor(page).getByLabel('Step 1 done').check();
  await editor(page).getByRole('button', { name: 'Remove step 3' }).click();
  await expect(editor(page).getByLabel('Step 2', { exact: true })).toBeFocused();
  await expect(editor(page).getByLabel('Step 3', { exact: true })).toHaveCount(0);
  await editor(page).getByRole('button', { name: 'Save' }).click();

  await expect(summary(page, 'Prepare for the trip')).toHaveText(/1 of 2 steps$/);
  const hotel = page.getByRole('checkbox', { name: 'Book the hotel' });
  const passport = page.getByRole('checkbox', { name: 'Renew my passport' });
  await expect(hotel).toBeHidden();
  await summary(page, 'Prepare for the trip').click();
  await expect(hotel).toBeChecked();
  await expect(passport).not.toBeChecked();

  // Ticked in the list: saved, and the steps stay open.
  await passport.click();
  await expect(passport).toBeChecked();
  await expect(passport).toBeFocused();
  await expect(summary(page, 'Prepare for the trip')).toHaveText(/2 of 2 steps$/);
  await expect(
    page.getByRole('status').filter({ hasText: 'All steps of Prepare for the trip are done.' }),
  ).toBeAttached();
  await hotel.click();
  await expect(summary(page, 'Prepare for the trip')).toHaveText(/1 of 2 steps$/);

  // Cancel forgets changes to steps.
  await page.getByRole('button', { name: 'Edit Prepare for the trip' }).click();
  await editor(page).getByRole('button', { name: 'Remove step 1' }).click();
  await editor(page).getByRole('button', { name: 'Cancel' }).click();
  await page.reload();
  await expect(summary(page, 'Prepare for the trip')).toHaveText(/1 of 2 steps$/);
});

test('saves a step still in “New step” with the task (audit 6 F1-1)', async ({ page }) => {
  // Typed but not added with "Add step" or Enter: Save dropped it, and said "Saved".
  await addTask(page, 'Trip');
  await page.getByRole('button', { name: 'Edit Trip' }).click();
  await newStep(page).fill('Book the hotel');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(editor(page)).toBeHidden();
  await expect(summary(page, 'Trip')).toHaveText(/0 of 1 step$/);
  // Enter in the title saves the form too.
  await page.getByRole('button', { name: 'Edit Trip' }).click();
  await newStep(page).fill('Pack');
  await editor(page).getByLabel('Title', { exact: true }).press('Enter');
  await expect(editor(page)).toBeHidden();
  await expect(summary(page, 'Trip')).toHaveText(/0 of 2 steps$/);
  await summary(page, 'Trip').click();
  await expect(row(page, 'Trip').getByRole('checkbox', { name: 'Pack' })).toBeVisible();
});

test('says when a task has all the steps it can take, on Save too', async ({ page }) => {
  const boxes = Array.from({ length: 50 }, (_, index) => ({
    id: `box-${index}`,
    title: `Box ${index + 1}`,
    done: false,
  }));
  await seed(page, [{ title: 'Move house', steps: boxes }]);
  await page.getByRole('button', { name: 'Edit Move house' }).click();
  await newStep(page).fill('One more box');
  await editor(page).getByRole('button', { name: 'Add step' }).click();
  await expect(editor(page).getByText('A task can have up to 50 steps.')).toBeVisible();
  // Save doesn't drop it without a word: the form stays open, saying why.
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(editor(page)).toBeVisible();
  await expect(newStep(page)).toBeFocused();
  await expect(newStep(page)).toHaveAccessibleDescription(
    'A task can have up to 50 steps, so this one can’t be added. Clear it to save without it.',
  );
  await newStep(page).fill('');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(editor(page)).toBeHidden();
  await expect(summary(page, 'Move house')).toHaveText(/0 of 50 steps$/);
  // Opened again, the box is no longer marked as wrong.
  await page.getByRole('button', { name: 'Edit Move house' }).click();
  await expect(newStep(page)).not.toHaveAttribute('aria-invalid');
});

test('a repeating task starts its steps again', async ({ page }) => {
  await seed(page, [
    {
      title: 'Clean the flat',
      date: '2026-10-20',
      repeat: 'weekly',
      steps: [
        { id: 'a', title: 'Kitchen', done: true },
        { id: 'b', title: 'Bathroom', done: true },
      ],
    },
  ]);
  await expect(summary(page, 'Clean the flat')).toHaveText(/2 of 2 steps$/);
  await box(page, 'Clean the flat').click();
  const open = page
    .locator('[data-groups] [data-id]')
    .filter({ has: page.getByRole('button', { name: 'Edit Clean the flat' }) });
  await expect(open.locator('summary')).toHaveText(/0 of 2 steps$/);
  await expect(open.locator('[data-due]')).toHaveText('Tue, Oct 27');
});

test('reads tasks saved before there were steps', async ({ page }) => {
  await page.evaluate(() => {
    const task = {
      id: 'old',
      title: 'Saved by the first version',
      notes: '',
      list: '',
      important: false,
      date: null,
      time: null,
      repeat: 'none',
      reminder: null,
      done: null,
      created: 1,
      updated: 1,
    };
    localStorage.setItem('shkriuss:tasks', JSON.stringify({ v: 1, data: { tasks: [task] } }));
  });
  await page.reload();
  await expect(row(page, 'Saved by the first version')).toBeVisible();
  // And it can have steps now.
  await page.getByRole('button', { name: 'Edit Saved by the first version' }).click();
  await newStep(page).fill('First step');
  await newStep(page).press('Enter');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(summary(page, 'Saved by the first version')).toHaveText(/0 of 1 step$/);
});

test('steps are accessible, in both themes', async ({ page }) => {
  await seed(page, [
    {
      title: 'Prepare for the trip',
      steps: [
        { id: 'a', title: 'Book the hotel', done: true },
        { id: 'b', title: 'Pack', done: false },
      ],
    },
  ]);
  await summary(page, 'Prepare for the trip').click();
  await checkA11y(page, 'steps in the list');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'steps in the list (dark)');
  await page.getByRole('button', { name: 'Edit Prepare for the trip' }).click();
  await checkA11y(page, 'steps in the form (dark)');
});
