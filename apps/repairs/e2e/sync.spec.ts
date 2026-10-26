// Repairs' vehicles, repairs, settings and photos syncing between two devices
// through the account (packages/sync, docs/adr/0010, docs/adr/0014). The
// connect flow itself is tested for every app in tests/e2e/sync.spec.ts.
import type { Browser, Page } from '@playwright/test';
import { createAccount, hubURL, signInWithKey, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { readStore } from '../../../tests/e2e/storage.ts';
import type { RepairsState } from '../src/lib/repairs.ts';
import {
  addPhotos,
  addRepair,
  fillRepair,
  jpeg,
  naturalWidth,
  NOW,
  picture,
  repairDialog,
  repairItems,
  storedPhotos,
  TIME_ZONE,
  vehicleItem,
  yearDialog,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test('vehicles, repairs and the distance unit sync between devices', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  await page.clock.setFixedTime(NOW);
  const { key } = await createAccount(page);
  await page.goto('/');
  await addRepair(page, {
    vehicle: 'Bus 105',
    mileage: '123456',
    work: 'Replaced the front pads',
    parts: [{ name: 'Brake pads', number: 'BP-1', quantity: '2' }],
  });
  await page.getByLabel('Distance', { exact: true }).selectOption('mi');
  await turnOnSync(page, 'Repairs');

  const tablet = await (
    await browser.newContext({ locale: 'en-US', timezoneId: TIME_ZONE, serviceWorkers: 'block' })
  ).newPage();
  await tablet.clock.setFixedTime(NOW);
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Repairs');
  await expect(repairItems(tablet).locator('[data-meta]')).toHaveText('123,456 mi');
  await expect(repairItems(tablet).locator('[data-parts] li')).toHaveText([
    'Brake pads × 2 (BP-1)',
  ]);
  await expect(tablet.getByLabel('Distance', { exact: true })).toHaveValue('mi');

  // Added on the tablet; the phone sees it, and the new vehicle.
  const uploaded = tablet.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );
  await addRepair(tablet, { vehicle: 'Bus 12', date: '2026-10-22', work: 'Fixed the rear door' });
  await uploaded;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(repairItems(page).locator('[data-title]')).toHaveText(['Bus 12', 'Bus 105']);
  await expect(vehicleItem(page, 'Bus 12')).toHaveCount(1);
  await tablet.context().close();
});

/** A second device, signed in to the same account, with sync on. */
async function tabletFor(browser: Browser, key: string, appURL: string): Promise<Page> {
  const tablet = await (
    await browser.newContext({ locale: 'en-US', timezoneId: TIME_ZONE, serviceWorkers: 'block' })
  ).newPage();
  await tablet.clock.setFixedTime(NOW);
  await signInWithKey(tablet, key);
  await tablet.goto(`${appURL}/`);
  await turnOnSync(tablet, 'Repairs');
  return tablet;
}

/** Resolves once a device has deleted a photo's full-size file online. */
const deletedOnline = (device: Page) =>
  device.waitForResponse(
    (response) =>
      /\/api\/sync\/files\/[\w-]+\.full\?base=\d+$/.test(response.url()) &&
      response.request().method() === 'DELETE' &&
      response.status() === 204,
  );

test('photos sync between devices, and deleting one deletes it on both', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  await page.clock.setFixedTime(NOW);
  const { key } = await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Repairs');
  const tablet = await tabletFor(browser, key, new URL(page.url()).origin);

  // Taken on the phone: the photo goes up first, then the repair.
  await page.getByRole('button', { name: 'New repair' }).click();
  const dialog = repairDialog(page);
  await expect(dialog.getByText('They sync to your other devices', { exact: false })).toBeVisible();
  await dialog.getByLabel('Vehicle').fill('Bus 105');
  await addPhotos(page, [jpeg('door.jpg', await picture(page, { width: 800, height: 600 }))]);
  await expect(dialog.locator('[data-form-photos] img')).toHaveCount(1);
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );
  await fillRepair(page, { work: 'Replaced the door glass' });
  await uploaded;

  // On the tablet: no connection for photos, so it says so…
  guard.allowConsole('net::ERR_FAILED');
  await tablet.route('**/api/sync/files/*', (route) => route.abort());
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  const item = repairItems(tablet).first();
  await expect(item.locator('[data-photos-elsewhere]')).toHaveText('1 photo hasn’t arrived yet');
  // …and once there is one, the next sync brings the thumbnail, and opening it the photo.
  await tablet.unroute('**/api/sync/files/*');
  await tablet.clock.setFixedTime(NOW.getTime() + 60 * 1000);
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  const thumb = item.getByRole('button', { name: 'Photo 1' });
  await expect(thumb).toBeVisible();
  await expect(item.locator('[data-photos-elsewhere]')).toHaveText('');
  await thumb.click();
  const viewer = tablet.getByRole('dialog', { name: 'Photo' });
  await expect.poll(() => naturalWidth(viewer.getByRole('img'))).toBe(800);
  await expect(viewer.getByRole('button', { name: 'Save a copy' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Close' }).click();
  expect(await storedPhotos(tablet)).toBe(1);

  // Removed on the tablet: deleted online, and from the phone at its next sync.
  await item.locator('[data-action="edit-repair"]').click();
  await repairDialog(tablet).getByRole('button', { name: 'Remove photo 1' }).click();
  const deleted = deletedOnline(tablet);
  await fillRepair(tablet, {});
  await deleted;
  expect(await storedPhotos(tablet)).toBe(0);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(repairItems(page).first().locator('[data-row="photos"]')).toHaveCount(0);
  await expect.poll(() => storedPhotos(page)).toBe(0);
  await tablet.context().close();
});

/** Resolves once a device has uploaded its sync copy. */
const copyUploaded = (device: Page) =>
  device.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );

/** The repairs a device has saved: the work done, the mileage and how many photos. */
const savedRepairs = async (device: Page) =>
  ((await readStore<RepairsState>(device, 'repairs'))?.data.repairs ?? []).map((repair) => ({
    work: repair.work,
    mileage: repair.mileage,
    photos: repair.photos.length,
  }));

// Audit 3 F2-1: saving the phone's form put back the repair as it was when the
// form opened, so the photo added on the tablet meanwhile was taken off the
// repair, and then deleted on both devices.
test('a change made on another device while the form was open stays, photos too', async ({
  page,
  browser,
  guard,
}) => {
  test.setTimeout(90_000);
  guard.allowOrigin(hubURL);
  await page.clock.setFixedTime(NOW);
  const { key } = await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Repairs');
  let uploaded = copyUploaded(page);
  await addRepair(page, { vehicle: 'Bus 105', work: 'Replaced the door glass' });
  await uploaded;
  const tablet = await tabletFor(browser, key, new URL(page.url()).origin);
  await expect(repairItems(tablet)).toHaveCount(1);

  // On the phone: the repair's form is opened (to add a word to the work done).
  await repairItems(page).first().locator('[data-action="edit-repair"]').click();
  await expect(repairDialog(page)).toBeVisible();

  // On the tablet: a photo and the mileage added to the same repair.
  await repairItems(tablet).first().locator('[data-action="edit-repair"]').click();
  await addPhotos(tablet, [jpeg('door.jpg', await picture(tablet, { width: 800, height: 600 }))]);
  await expect(repairDialog(tablet).locator('[data-form-photos] img')).toHaveCount(1);
  uploaded = copyUploaded(tablet);
  await fillRepair(tablet, { mileage: '121000' });
  await uploaded;

  // The phone comes back on screen and syncs, its form still open: the photo shows in it.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(repairDialog(page).locator('[data-form-photos] img')).toHaveCount(1);

  // The phone's form is saved, with the word added: the tablet's changes stay.
  uploaded = copyUploaded(page);
  await fillRepair(page, { work: 'Replaced the door glass and its seal' });
  await uploaded;
  const expected = [{ work: 'Replaced the door glass and its seal', mileage: 121_000, photos: 1 }];
  expect(await savedRepairs(page)).toEqual(expected);
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect.poll(() => savedRepairs(tablet)).toEqual(expected);
  expect(await storedPhotos(tablet)).toBe(1);
  await tablet.context().close();
});

test('deleting a year deletes its photos online too', async ({ page, guard }) => {
  guard.allowOrigin(hubURL);
  await page.clock.setFixedTime(NOW);
  await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Repairs');
  await page.getByRole('button', { name: 'New repair' }).click();
  const dialog = repairDialog(page);
  await dialog.getByLabel('Vehicle').fill('Bus 105');
  await dialog.getByLabel('Day').fill('2025-06-01');
  await addPhotos(page, [jpeg('door.jpg', await picture(page, { width: 800, height: 600 }))]);
  await expect(dialog.locator('[data-form-photos] img')).toHaveCount(1);
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );
  await fillRepair(page, { work: 'Replaced the door glass' });
  await uploaded;

  const deleted = deletedOnline(page);
  await page.getByRole('button', { name: 'Delete a year…' }).click();
  await yearDialog(page).getByRole('button', { name: 'Delete 1 repair' }).click();
  await deleted;
  await expect.poll(() => storedPhotos(page)).toBe(0);
});
