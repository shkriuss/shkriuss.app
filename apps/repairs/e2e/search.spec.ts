// Repairs' search and vehicle filter for screen reader users: what they find
// is read out.
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { NOW, repair, seed, TIME_ZONE, vehicle } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test('says how many repairs a search or a vehicle finds', async ({ page }) => {
  // The results changed on screen, but nothing was read out (audit G-6).
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await seed(page, {
    vehicles: [vehicle({ id: 'b105', name: 'Bus 105' }), vehicle({ id: 'b12', name: 'Bus 12' })],
    repairs: [
      repair({ vehicle: 'b105', work: 'Replaced the alternator' }),
      repair({ vehicle: 'b105', work: 'Replaced the front pads' }),
      repair({ vehicle: 'b12', work: 'Replaced the front pads' }),
    ],
  });
  const announcer = page.locator('[data-announcer]');
  const vehicles = page.getByRole('combobox', { name: 'Vehicle', exact: true });

  await page.getByLabel('Search').pressSequentially('alternator');
  await expect(announcer).toHaveText('1 repair found.');
  await vehicles.selectOption({ label: 'Bus 12' });
  await expect(announcer).toHaveText('0 repairs found.');
  await page.getByLabel('Search').fill('');
  await vehicles.selectOption({ label: 'Bus 105' });
  await expect(announcer).toHaveText('2 repairs found.');
});
