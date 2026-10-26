// Repairs' own tests. Shared checks (accessibility, security headers, offline
// support, privacy, sync) already run for every app from tests/e2e/.
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { readStore } from '../../../tests/e2e/storage.ts';
import { LIMITS, REPAIRS_VERSION, type VehiclesState } from '../src/lib/repairs.ts';
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
  yearDialog,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

const status = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });
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
    dialog.getByText('Describe the damage found or the work done, or add a part or a photo.'),
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

test('shows 100 repairs at a time', async ({ page }) => {
  await seed(page, {
    vehicles: fleet,
    repairs: Array.from({ length: 110 }, (_, index) =>
      repair({ date: `2026-08-${String((index % 28) + 1).padStart(2, '0')}` }),
    ),
  });
  await expect(repairItems(page)).toHaveCount(100);
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(repairItems(page)).toHaveCount(110);
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

// Audit 3 G-9: a repair opens through its vehicle's name, which was only as
// wide as the name: vehicle "7" was 9 by 44 px.
test('a repair’s vehicle fills its line, a big target however short', async ({ page }) => {
  await seed(page, {
    vehicles: [vehicle({ id: 'v7', name: '7' })],
    repairs: [repair({ vehicle: 'v7' })],
  });
  const title = await repairItems(page)
    .first()
    .locator('[data-action="edit-repair"]')
    .boundingBox();
  const line = await repairItems(page).first().locator('.repair__top').boundingBox();
  expect(title?.width).toBeGreaterThanOrEqual(44);
  expect(title?.width).toBeGreaterThan((line?.width ?? 0) / 2);
});

// Audit 3 F2-1: the vehicle's form saved every field as it was when it opened.
test('a change made in another tab survives a vehicle form open here', async ({ page }) => {
  await seed(page, { vehicles: fleet });
  const other = await page.context().newPage();
  await other.clock.setFixedTime(NOW);
  await other.goto('/');
  await page.getByRole('button', { name: 'Edit Bus 105' }).click();
  // In the other tab: the number plate added.
  await other.getByRole('button', { name: 'Edit Bus 105' }).click();
  await vehicleDialog(other).getByLabel('Number plate (optional)').fill('tb-105-aa');
  await vehicleDialog(other).getByRole('button', { name: 'Save' }).click();
  await expect(vehicleItem(page, 'Bus 105')).toContainText('TB-105-AA');
  // Here, a note: the plate stays.
  await vehicleDialog(page).getByLabel('Notes (optional)').fill('The rear door sticks');
  await vehicleDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(vehicleItem(page, 'Bus 105')).toContainText('TB-105-AA');
  const saved = await readStore<VehiclesState>(page, 'repairs-vehicles');
  expect(saved?.data.vehicles.find((entry) => entry.name === 'Bus 105')).toMatchObject({
    plate: 'TB-105-AA',
    notes: 'The rear door sticks',
  });
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
    // A byte-order mark first, for Excel (audit 3 F2-6).
    '\uFEFFDate,Vehicle,Model,Plate,Mileage (mi),System,Damage found,Work done,Parts replaced,Hours worked,Parts cost (USD),Labour cost (USD),Total cost (USD)',
    '2026-10-21,Bus 105,Isuzu Novociti Life,,120000,Brakes,"Door sensor fault, ""intermittent""",Replaced the front pads,Door sensor (DS-4),,,,',
    '',
  ]);
});

test('deletes a year, after saying what it deletes', async ({ page }) => {
  await page.getByRole('button', { name: 'Delete a year…' }).click();
  await expect(status(page, 'There are no repairs to delete.')).toBeVisible();

  await seed(page, {
    vehicles: fleet,
    repairs: [
      repair({ id: 'a', date: '2024-03-02' }),
      repair({ id: 'b', date: '2024-12-31', vehicle: 'b12' }),
      repair({ id: 'c', date: '2025-06-01' }),
      repair({ id: 'd', work: 'Checked the doors' }),
    ],
  });
  const deleteYear = page.getByRole('button', { name: 'Delete a year…' });
  await deleteYear.click();
  const dialog = yearDialog(page);
  const year = dialog.getByLabel('Year');
  await expect(year).toBeFocused();
  await expect(year.locator('option')).toHaveText([
    '2024 (2 repairs)',
    '2025 (1 repair)',
    '2026 (1 repair)',
  ]);
  // The oldest year to begin with.
  await expect(year).toHaveValue('2024');
  await expect(dialog.locator('[data-year-text]')).toHaveText(
    'The 2 repairs from 2024 will be deleted, with their photos. With sync on, they’re deleted on your other devices too. This can’t be undone.',
  );
  await checkA11y(page, 'delete a year');

  // The spreadsheet first, from the dialog.
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download as a spreadsheet (CSV)' }).click();
  expect((await download).suggestedFilename()).toBe('repairs-2026-10-21.csv');
  await expect(dialog.getByRole('status')).toHaveText('Downloaded your repairs as a spreadsheet.');

  await year.selectOption('2025');
  await expect(dialog.getByRole('button', { name: 'Delete 1 repair' })).toBeVisible();
  // Cancel deletes nothing.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(repairItems(page)).toHaveCount(4);

  await deleteYear.click();
  await dialog.getByRole('button', { name: 'Delete 2 repairs' }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page, 'Deleted 2 repairs from 2024.')).toBeAttached();
  await expect(deleteYear).toBeFocused();
  await expect(repairItems(page)).toHaveCount(2);
  // The vehicles stay.
  await expect(vehicleItem(page, 'Bus 12')).toHaveCount(1);
});

// Audit 4 F2-1: "Delete a year…" quietly moved to another year, and its red
// button then deleted that one; "Delete Bus 105?" deleted repairs added after
// it said how many go.
test('deleting a year or a vehicle stops, and says why, when it changes in another tab', async ({
  page,
}) => {
  await seed(page, {
    vehicles: fleet,
    repairs: [
      repair({ date: '2024-03-02' }),
      repair({ date: '2024-12-31', vehicle: 'b12' }),
      repair({ work: 'Checked the doors' }),
      repair({ work: 'New wipers', vehicle: 'b12' }),
    ],
  });
  const other = await page.context().newPage();
  await other.clock.setFixedTime(NOW);
  await other.goto('/');

  // The year chosen is deleted there.
  const deleteYear = page.getByRole('button', { name: 'Delete a year…' });
  const dialog = yearDialog(page);
  await deleteYear.click();
  await expect(dialog.getByRole('button', { name: 'Delete 2 repairs' })).toBeVisible();
  await other.getByRole('button', { name: 'Delete a year…' }).click();
  await yearDialog(other).getByRole('button', { name: 'Delete 2 repairs' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('alert')).toHaveText(
    'The repairs from 2024 were deleted on another device.',
  );
  await expect(deleteYear).toBeFocused();
  await expect(repairItems(page)).toHaveCount(2);

  // A repair on Bus 105 is added there while "Delete Bus 105?" is open.
  await vehicleItem(page, 'Bus 105').getByRole('button', { name: 'Edit Bus 105' }).click();
  await vehicleDialog(page).getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete Bus 105?' });
  await expect(confirm).toContainText('Bus 105 and its 1 repair will be removed.');
  await other.getByRole('button', { name: 'New repair' }).click();
  await fillRepair(other, {
    vehicle: 'Bus 105',
    mileage: '121000',
    problem: 'Brake noise',
    work: 'Replaced the rear pads',
  });
  await expect(confirm).toBeHidden();
  await expect(vehicleDialog(page)).toBeHidden();
  await expect(page.getByRole('alert')).toHaveText(
    'Bus 105 has 2 repairs now, after changes on another device. Nothing was deleted.',
  );
  await expect(vehicleItem(page, 'Bus 105')).toHaveCount(1);
  await expect(repairItems(page)).toHaveCount(3);
  await other.close();
});

// Audit F2-3: Repairs kept more than fit, and there was no way to make room.
test('says when Repairs is nearly full, and how to make room', async ({ page }) => {
  // Just over 90% of the repairs Repairs keeps: one a day, back from 2026.
  const count = LIMITS.repairs * 0.9 + 1;
  await page.evaluate(
    ({ count, version }) => {
      const day = Date.UTC(2026, 9, 21);
      const repairs = Array.from({ length: count }, (_, index) => ({
        id: `r${index}`,
        vehicle: 'b105',
        date: new Date(day - index * 86_400_000).toISOString().slice(0, 10),
        mileage: null,
        system: '',
        problem: '',
        work: 'Checked the doors',
        parts: [],
        hours: null,
        labour: null,
        photos: [],
      }));
      localStorage.setItem('shkriuss:repairs', JSON.stringify({ v: version, data: { repairs } }));
    },
    { count, version: REPAIRS_VERSION },
  );
  await page.reload();
  const note = page.locator('[data-room-note]');
  await expect(note).toHaveText(
    `Repairs is nearly full: there’s room for ${LIMITS.repairs - count} more repairs (it keeps up to ${new Intl.NumberFormat('en-US').format(LIMITS.repairs)}). To make room, download the spreadsheet, then use “Delete a year…” under Units and spreadsheet, below.`,
  );
  await checkA11y(page, 'nearly full');

  // Deleting the oldest year makes room.
  await page.getByRole('button', { name: 'Delete a year…' }).click();
  await yearDialog(page)
    .getByRole('button', { name: /^Delete \d+ repairs$/ })
    .click();
  await expect(status(page, /^Deleted \d+ repairs from \d{4}\.$/)).toBeAttached();
  await expect(note).toBeHidden();
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  // Audit 4 J-6: the forms, "Delete a year…" and the photo viewer load the
  // first time they open, so the page loads less; offline, from the saved copy.
  test('the forms open offline, loaded the first time they’re used', async ({ page, context }) => {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: 'New repair' }).click();
    await expect(repairDialog(page).getByRole('heading', { name: 'New repair' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add vehicle' }).click();
    await expect(vehicleDialog(page).getByRole('heading', { name: 'Add vehicle' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Delete a year…' }).click();
    await expect(status(page, 'There are no repairs to delete.')).toBeVisible();
    await context.setOffline(false);
  });
});
