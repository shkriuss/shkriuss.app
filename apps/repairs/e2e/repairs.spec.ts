// Repairs' own tests. Shared checks (accessibility, security headers, offline
// support, privacy, sync) already run for every app from tests/e2e/.
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import {
  fillRepair,
  NOW,
  partRow,
  repair,
  repairDialog,
  repairItems,
  seed,
  TIME_ZONE,
  vehicle,
  vehicleDialog,
  vehicleItem,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const fleet = [
  vehicle({ id: 'b105', name: 'Bus 105' }),
  vehicle({ id: 'b12', name: 'Bus 12', plate: 'TB-012-BB' }),
  vehicle({ id: 'car', name: 'My car', model: 'Toyota Corolla' }),
];

test('logs a repair with its parts, and suggests what was used before', async ({ page }) => {
  await expect(page.getByText('No repairs yet.', { exact: false })).toBeVisible();
  await expect(page.getByText('No vehicles yet.', { exact: false })).toBeVisible();

  // Checked before it's saved.
  await page.getByRole('button', { name: 'New repair' }).click();
  const dialog = repairDialog(page);
  await expect(dialog.getByRole('heading', { name: 'New repair' })).toBeVisible();
  await expect(dialog.getByLabel('Vehicle')).toBeFocused();
  await expect(dialog.getByLabel('Day')).toHaveValue('2026-10-21');
  await expect(partRow(page, 1).getByLabel('Quantity')).toHaveValue('1');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter the vehicle, like a bus number.')).toBeVisible();
  await expect(
    dialog.getByText('Describe the damage found, the work done, or add a part.'),
  ).toBeVisible();
  await expect(dialog.getByLabel('Vehicle')).toBeFocused();
  await checkA11y(page, 'repair form problems');

  await fillRepair(page, {
    vehicle: 'Bus 105',
    mileage: '123456',
    system: 'Brakes',
    problem: 'Grinding noise from the front axle',
    work: 'Replaced the front pads and discs.\nBled the brakes.',
    parts: [
      { name: 'Brake pads', number: '8-97366-123-0', quantity: '2' },
      { name: 'Brake disc', quantity: '2' },
    ],
  });
  await expect(
    status(page, 'Saved the repair on Bus 105, and added Bus 105 to your vehicles.'),
  ).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Wednesday, October 21, 2026' })).toBeVisible();
  const item = repairItems(page).first();
  await expect(item.locator('[data-title]')).toHaveText('Bus 105');
  await expect(item.locator('[data-meta]')).toHaveText('123,456 km · Brakes');
  await expect(item).toContainText(/Damage found\s*Grinding noise from the front axle/);
  await expect(item.locator('[data-parts] li')).toHaveText([
    'Brake pads × 2 (8-97366-123-0)',
    'Brake disc × 2',
  ]);
  await expect(item.locator('[data-title]')).toBeFocused();
  await expect(page.locator('[data-result-count]')).toHaveText('1 repair in all.');
  await expect(vehicleItem(page, 'Bus 105').locator('[data-summary]')).toHaveText(
    '1 repair · last on Oct 21, 2026 · 123,456 km',
  );
  await checkA11y(page, 'repairs');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'repairs (dark)');

  // The next one: the bus is known, its last mileage shown, a part's number filled in.
  await page.getByRole('button', { name: 'New repair' }).click();
  await dialog.getByLabel('Vehicle').fill('bus 105');
  await expect(dialog.locator('[data-mileage-hint]')).toHaveText(
    'Last noted for Bus 105: 123,456 km on Oct 21, 2026.',
  );
  await partRow(page, 1).getByLabel('Name').fill('Brake pads');
  await partRow(page, 1).getByLabel('Name').blur();
  await expect(partRow(page, 1).getByLabel('Part number (optional)')).toHaveValue('8-97366-123-0');
  await fillRepair(page, { date: '2026-10-22', mileage: '123900', system: 'Brakes' });
  await expect(status(page, 'Saved the repair on Bus 105.')).toBeAttached();
  await expect(page.locator('[data-days] h3')).toHaveText([
    'Thursday, October 22, 2026',
    'Wednesday, October 21, 2026',
  ]);

  await page.reload();
  await expect(repairItems(page)).toHaveCount(2);
  await expect(vehicleItem(page, 'Bus 105').locator('[data-summary]')).toHaveText(
    '2 repairs · last on Oct 22, 2026 · 123,900 km',
  );
});

test('checks the parts', async ({ page }) => {
  await page.getByRole('button', { name: 'New repair' }).click();
  await fillRepair(page, {
    vehicle: 'Bus 7',
    parts: [{ number: 'X-1' }, { name: 'Bulb', quantity: '0' }],
  });
  const dialog = repairDialog(page);
  await expect(partRow(page, 1).getByText('Enter the part’s name.')).toBeVisible();
  await expect(partRow(page, 2).getByText('Enter a number above 0.')).toBeVisible();
  await expect(partRow(page, 1).getByLabel('Name')).toBeFocused();
  await expect(partRow(page, 1).getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
  await checkA11y(page, 'part problems');

  // Removing the first part: the second becomes Part 1.
  await partRow(page, 1).getByRole('button', { name: 'Remove part 1' }).click();
  await expect(dialog.locator('[data-part-rows] > li')).toHaveCount(1);
  await expect(partRow(page, 1).getByLabel('Name')).toHaveValue('Bulb');
  await expect(partRow(page, 1).getByLabel('Name')).toBeFocused();
  await fillRepair(page, { parts: [{ quantity: '4' }] });
  await expect(repairItems(page).locator('[data-parts] li')).toHaveText(['Bulb × 4']);
});

test('finds repairs by search and by vehicle', async ({ page }) => {
  await seed(page, {
    vehicles: fleet,
    repairs: [
      repair({ date: '2026-10-20', problem: 'Front door won’t close', system: 'Doors' }),
      repair({
        date: '2026-10-21',
        vehicle: 'b12',
        mileage: 301_000,
        parts: [{ name: 'Brake pads', number: '8-97366-123-0', quantity: 2, price: null }],
      }),
      repair({ date: '2026-10-19', vehicle: 'car', mileage: 80_000, work: 'Oil change' }),
    ],
  });
  await expect(page.locator('[data-result-count]')).toHaveText('3 repairs in all.');
  await expect(repairItems(page).locator('[data-title]')).toHaveText([
    'Bus 12',
    'Bus 105',
    'My car',
  ]);

  await page.getByLabel('Search').fill('wont close');
  await expect(repairItems(page).locator('[data-title]')).toHaveText(['Bus 105']);
  await expect(page.locator('[data-result-count]')).toHaveText('1 repair matches your search.');
  await page.getByLabel('Search').fill('97366');
  await expect(repairItems(page).locator('[data-title]')).toHaveText(['Bus 12']);
  await page.getByLabel('Search').fill('gearbox');
  await expect(page.getByText('No repairs match your search.')).toBeVisible();
  await page.getByLabel('Search').fill('');

  // One vehicle: from the filter, or its "Show repairs" button.
  await page
    .getByRole('combobox', { name: 'Vehicle', exact: true })
    .selectOption({ label: 'My car' });
  await expect(repairItems(page).locator('[data-title]')).toHaveText(['My car']);
  await expect(page.locator('[data-result-count]')).toHaveText('1 repair on My car.');
  await vehicleItem(page, 'Bus 12').getByRole('button', { name: 'Show repairs on Bus 12' }).click();
  await expect(page.getByRole('heading', { name: 'Repair history' })).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Vehicle', exact: true })).toHaveValue('b12');
  await expect(repairItems(page).locator('[data-title]')).toHaveText(['Bus 12']);
  await expect(vehicleItem(page, 'Bus 12').locator('[data-details]')).toHaveText(
    'Isuzu Novociti Life · TB-012-BB',
  );

  // A new repair while looking at one vehicle is for that vehicle.
  await page.getByRole('button', { name: 'New repair' }).click();
  await expect(repairDialog(page).getByLabel('Vehicle')).toHaveValue('Bus 12');
  await expect(repairDialog(page).getByLabel('Mileage (km)')).toBeFocused();
  await expect(repairDialog(page).locator('[data-mileage-hint]')).toHaveText(
    'Last noted for Bus 12: 301,000 km on Oct 21, 2026.',
  );
});

test('shows 50 repairs at a time', async ({ page }) => {
  await seed(page, {
    vehicles: fleet,
    repairs: Array.from({ length: 60 }, (_, index) =>
      repair({ date: `2026-08-${String((index % 28) + 1).padStart(2, '0')}` }),
    ),
  });
  await expect(repairItems(page)).toHaveCount(50);
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(repairItems(page)).toHaveCount(60);
  await expect(page.getByRole('button', { name: 'Show more' })).toBeHidden();
});

test('changes and deletes repairs and vehicles', async ({ page }) => {
  await seed(page, {
    vehicles: fleet,
    repairs: [
      repair({
        id: 'a',
        vehicle: 'b12',
        parts: [
          { name: 'Brake pads', number: 'BP-1', quantity: 2, price: null },
          { name: 'Clip', number: '', quantity: 4, price: null },
        ],
      }),
      repair({ id: 'b', date: '2026-10-20', work: 'Adjusted the door' }),
    ],
  });

  await repairItems(page).first().getByRole('button').click();
  const dialog = repairDialog(page);
  await expect(dialog.getByRole('heading', { name: 'Change repair' })).toBeVisible();
  await expect(dialog.getByLabel('Vehicle')).toHaveValue('Bus 12');
  await expect(partRow(page, 2).getByLabel('Name')).toHaveValue('Clip');
  await partRow(page, 2).getByRole('button', { name: 'Remove part 2' }).click();
  await expect(partRow(page, 1).getByLabel('Name')).toBeFocused();
  await fillRepair(page, { work: 'Replaced the rear pads' });
  await expect(status(page, 'Saved the repair on Bus 12.')).toBeAttached();
  await expect(repairItems(page).first()).toContainText('Replaced the rear pads');
  await expect(repairItems(page).first().locator('[data-parts] li')).toHaveText([
    'Brake pads × 2 (BP-1)',
  ]);

  // Deleting a repair asks first.
  await repairItems(page).nth(1).getByRole('button').click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this repair?' });
  await expect(confirm).toContainText('The repair on Bus 105 on Oct 20, 2026 will be removed.');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(status(page, 'Deleted the repair.')).toBeAttached();
  await expect(repairItems(page)).toHaveCount(1);

  // A vehicle: renamed, then deleted with its repairs.
  await vehicleItem(page, 'Bus 12').getByRole('button', { name: 'Edit Bus 12' }).click();
  const form = vehicleDialog(page);
  await expect(form.getByRole('heading', { name: 'Change vehicle' })).toBeVisible();
  await form.getByLabel('Name or number').fill('bus 105');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByText('You already have a vehicle with that name.')).toBeVisible();
  await checkA11y(page, 'vehicle form');
  await form.getByLabel('Name or number').fill('Bus 012');
  await form.getByLabel('Number plate (optional)').fill('tb-112-cc');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(status(page, 'Saved Bus 012.')).toBeAttached();
  await expect(vehicleItem(page, 'Bus 012').locator('[data-details]')).toHaveText(
    'Isuzu Novociti Life · TB-112-CC',
  );
  await expect(repairItems(page).first().locator('[data-title]')).toHaveText('Bus 012');

  await vehicleItem(page, 'Bus 012').getByRole('button', { name: 'Edit Bus 012' }).click();
  await form.getByRole('button', { name: 'Delete' }).click();
  const confirmVehicle = page.getByRole('dialog', { name: 'Delete Bus 012?' });
  await expect(confirmVehicle).toContainText('Bus 012 and its 1 repair will be removed.');
  await confirmVehicle.getByRole('button', { name: 'Delete' }).click();
  await expect(status(page, 'Deleted Bus 012 and its 1 repair.')).toBeAttached();
  await expect(vehicleItem(page, 'Bus 012')).toHaveCount(0);
  await expect(page.getByText('No repairs yet.', { exact: false })).toBeVisible();

  // Adding a vehicle before any repair.
  await page.getByRole('button', { name: 'Add vehicle' }).click();
  await form.getByLabel('Name or number').fill('Bus 200');
  await form.getByLabel('Model (optional)').fill('Isuzu Novociti Life');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(vehicleItem(page, 'Bus 200').locator('[data-summary]')).toHaveText('No repairs yet');
  await expect(
    vehicleItem(page, 'Bus 200').getByRole('button', { name: 'Edit Bus 200' }),
  ).toBeFocused();
});

test('miles, and a spreadsheet of every repair', async ({ page }) => {
  await seed(page, {
    vehicles: fleet,
    repairs: [
      repair({
        problem: 'Door sensor fault, "intermittent"',
        parts: [{ name: 'Door sensor', number: 'DS-4', quantity: 1, price: null }],
      }),
    ],
  });
  await page.getByLabel('Distance', { exact: true }).selectOption({ label: 'Miles (mi)' });
  await expect(status(page, 'Mileage is shown in miles now.')).toBeAttached();
  await expect(repairItems(page).locator('[data-meta]')).toHaveText('120,000 mi · Brakes');
  await page.reload();
  await expect(page.getByLabel('Distance', { exact: true })).toHaveValue('mi');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download as a spreadsheet (CSV)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('repairs-2026-10-21.csv');
  const text = await readFile((await file.path()) ?? '', 'utf8');
  expect(text.split('\r\n')).toEqual([
    'Date,Vehicle,Model,Plate,Mileage (mi),System,Damage found,Work done,Parts replaced,Hours worked,Parts cost (USD),Labour cost (USD),Total cost (USD)',
    '2026-10-21,Bus 105,Isuzu Novociti Life,,120000,Brakes,"Door sensor fault, ""intermittent""",Replaced the front pads,Door sensor (DS-4),,,,',
    '',
  ]);
});
