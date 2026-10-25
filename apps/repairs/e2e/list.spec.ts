// Repairs' list with a keyboard and a screen reader: "Show more", and a
// repair just saved.
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { addRepair, NOW, repair, repairItems, seed, TIME_ZONE, vehicle } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  // 110 repairs on 1–28 August: 3 or 4 a day.
  await seed(page, {
    vehicles: [vehicle({ id: 'b105', name: 'Bus 105' }), vehicle({ id: 'b12', name: 'Bus 12' })],
    repairs: Array.from({ length: 110 }, (_, index) =>
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
  await expect(repairItems(page)).toHaveCount(100);
  const more = page.getByRole('button', { name: 'Show more' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(repairItems(page)).toHaveCount(110);
  await expect(more).toBeHidden();
  await expect(repairItems(page).nth(100).locator('[data-action="edit-repair"]')).toBeFocused();
});

test('a repair saved below the first 100 stays in sight, with focus on it', async ({ page }) => {
  // On 2 August it's the 103rd: it was hidden behind "Show more", and focus
  // went to "New repair" (audit J-12).
  await addRepair(page, { vehicle: 'Bus 12', date: '2026-08-02', work: 'Fitted new wipers' });
  await expect(repairItems(page)).toHaveCount(103);
  const saved = repairItems(page).last();
  await expect(saved).toContainText('Fitted new wipers');
  await expect(saved.locator('[data-action="edit-repair"]')).toBeFocused();
  // The rest are still a "Show more" away.
  await expect(page.getByRole('button', { name: 'Show more' })).toBeVisible();
});
