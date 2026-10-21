// Hours worked and costs: part prices, labour, totals by repair, day, list and
// vehicle, the currency, and repairs saved before there were hours and costs.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import {
  addRepair,
  fillRepair,
  NOW,
  partRow,
  repairDialog,
  repairItems,
  TIME_ZONE,
  vehicleItem,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('hours worked and costs, added up by day, list and vehicle', async ({ page }) => {
  // Checked before it's saved.
  await page.getByRole('button', { name: 'New repair' }).click();
  await fillRepair(page, {
    vehicle: 'Bus 105',
    work: 'Replaced the front pads',
    parts: [{ name: 'Brake pads', number: 'BP-1', quantity: '2', price: '-1' }],
    hours: '0',
    labour: '-5',
  });
  const dialog = repairDialog(page);
  await expect(partRow(page, 1).getByText('Enter a price, or leave it empty.')).toBeVisible();
  await expect(
    dialog.getByText('Enter the hours as a number above 0, or leave it empty.'),
  ).toBeVisible();
  await expect(dialog.getByText('Enter an amount, or leave it empty.')).toBeVisible();
  await expect(partRow(page, 1).getByLabel('Price each (optional)')).toBeFocused();
  await checkA11y(page, 'hours and costs problems');

  await fillRepair(page, {
    parts: [{ price: '45' }],
    hours: '2.5',
    labour: '50',
  });
  await expect(status(page, 'Saved the repair on Bus 105')).toBeAttached();
  const item = repairItems(page).first();
  await expect(item.locator('[data-parts] li')).toHaveText(['Brake pads × 2 (BP-1) · $90.00']);
  await expect(item.locator('[data-hours]')).toHaveText('2.5 hours');
  await expect(item.locator('[data-cost]')).toHaveText('$140.00 · parts $90.00, labour $50.00');
  await expect(page.locator('[data-day-total]')).toHaveText('2.5 hours · $140.00');

  // Another on the same day: only hours.
  await addRepair(page, { vehicle: 'Bus 12', work: 'Adjusted the rear door', hours: '1' });
  await expect(repairItems(page).first().locator('[data-hours]')).toHaveText('1 hour');
  await expect(repairItems(page).first().locator('[data-cost]')).toHaveCount(0);
  await expect(page.locator('[data-day-total]')).toHaveText('3.5 hours · $140.00');
  await expect(page.locator('[data-result-count]')).toHaveText(
    '2 repairs in all · 3.5 hours · $140.00.',
  );
  await page.getByRole('combobox', { name: 'Vehicle', exact: true }).selectOption({
    label: 'Bus 12',
  });
  await expect(page.locator('[data-result-count]')).toHaveText('1 repair on Bus 12 · 1 hour.');
  await expect(vehicleItem(page, 'Bus 105').locator('[data-summary]')).toHaveText(
    '1 repair · last on Oct 21, 2026 · $140.00 in all',
  );
  await checkA11y(page, 'hours and costs');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'hours and costs (dark)');

  // A part used before: its number and price are filled in.
  await page.getByRole('combobox', { name: 'Vehicle', exact: true }).selectOption({
    label: 'All vehicles',
  });
  await page.getByRole('button', { name: 'New repair' }).click();
  await partRow(page, 1).getByLabel('Name').fill('brake pads');
  await partRow(page, 1).getByLabel('Name').blur();
  await expect(partRow(page, 1).getByLabel('Part number (optional)')).toHaveValue('BP-1');
  await expect(partRow(page, 1).getByLabel('Price each (optional)')).toHaveValue('45');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Another currency.
  await page.getByLabel('Currency', { exact: true }).selectOption('GEL');
  await expect(status(page, 'Costs are shown in GEL now.')).toBeAttached();
  await expect(repairItems(page).nth(1).locator('[data-cost]')).toHaveText(
    /^GEL\s140\.00 · parts GEL\s90\.00, labour GEL\s50\.00$/,
  );
  await page.getByRole('button', { name: 'New repair' }).click();
  await expect(dialog.locator('[data-labour-hint]')).toHaveText(
    'In GEL. Each part’s price goes with the part.',
  );

  await page.reload();
  await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('GEL');
  await expect(page.locator('[data-result-count]')).toHaveText(
    /^2 repairs in all · 3\.5 hours · GEL\s140\.00\.$/,
  );
});

test('keeps repairs saved before there were hours and costs', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem(
      'shkriuss:repairs-vehicles',
      JSON.stringify({
        v: 1,
        data: {
          vehicles: [
            { id: 'b105', name: 'Bus 105', model: 'Isuzu Novociti Life', plate: '', notes: '' },
          ],
        },
      }),
    );
    localStorage.setItem(
      'shkriuss:repairs',
      JSON.stringify({
        v: 1,
        data: {
          repairs: [
            {
              id: 'old',
              vehicle: 'b105',
              date: '2026-10-20',
              mileage: 120_000,
              system: 'Brakes',
              problem: '',
              work: 'Saved before',
              parts: [{ name: 'Brake pads', number: 'BP-1', quantity: 2 }],
            },
          ],
        },
      }),
    );
  });
  await page.reload();
  const item = repairItems(page).first();
  await expect(item).toContainText('Saved before');
  await expect(item.locator('[data-parts] li')).toHaveText(['Brake pads × 2 (BP-1)']);
  await expect(item.locator('[data-hours]')).toHaveCount(0);

  // Changed and saved again, in the new version.
  await item.getByRole('button').click();
  await fillRepair(page, { hours: '1.5' });
  await expect(item.locator('[data-hours]')).toHaveText('1.5 hours');
  const saved = await page.evaluate(() => localStorage.getItem('shkriuss:repairs'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({
    v: 3,
    data: {
      repairs: [
        {
          id: 'old',
          hours: 1.5,
          labour: null,
          parts: [{ name: 'Brake pads', price: null }],
          photos: [],
        },
      ],
    },
  });
});
