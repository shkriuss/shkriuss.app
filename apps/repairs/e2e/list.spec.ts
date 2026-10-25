// Repairs' list with a keyboard and a screen reader: "Show more", and what a
// search finds.
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { NOW, repair, repairItems, seed, TIME_ZONE, vehicle } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await seed(page, {
    vehicles: [vehicle({ id: 'b105', name: 'Bus 105' }), vehicle({ id: 'b12', name: 'Bus 12' })],
    repairs: Array.from({ length: 60 }, (_, index) =>
      repair({
        id: `r${index}`,
        vehicle: index % 2 ? 'b105' : 'b12',
        date: `2026-08-${String((index % 28) + 1).padStart(2, '0')}`,
        work: index === 7 ? 'Replaced the alternator' : 'Replaced the front pads',
      }),
    ),
  });
});

test('“Show more” puts focus on the first repair it shows', async ({ page }) => {
  // On the last page it hides itself, and focus went to the top of the page (audit G-5).
  await expect(repairItems(page)).toHaveCount(50);
  const more = page.getByRole('button', { name: 'Show more' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(repairItems(page)).toHaveCount(60);
  await expect(more).toBeHidden();
  await expect(repairItems(page).nth(50).locator('[data-action="edit-repair"]')).toBeFocused();
});
