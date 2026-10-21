// Repairs' vehicles, repairs and settings syncing between two devices through
// the account (packages/sync, docs/adr/0010). The connect flow itself is
// tested for every app in tests/e2e/sync.spec.ts.
import { createAccount, hubURL, signInWithKey, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { addRepair, NOW, repairItems, TIME_ZONE, vehicleItem } from './helpers.ts';

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
