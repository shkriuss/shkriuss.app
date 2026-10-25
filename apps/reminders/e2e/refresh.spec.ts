// Reminders keeps its list up to date as time goes by, without disturbing
// someone who is on it with a keyboard or a screen reader.
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { group, NOW, reminder, seed, TIME_ZONE } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test('draws the list again only when what it shows changes', async ({ page }) => {
  // It was drawn again every minute, and a screen reader read the focused
  // reminder out again each time (audit G-8).
  await page.clock.install({ time: NOW });
  await page.goto('/');
  await seed(page, [
    reminder('a', 'Call the dentist', '2026-10-21', '18:30'),
    reminder('b', 'Water the plants', '2026-10-21', '10:05'),
  ]);
  const box = page.getByRole('checkbox', { name: 'Call the dentist: done', exact: true });
  await box.focus();
  await page.evaluate(() => {
    const seen = window as unknown as { focusEvents: number; focused: Element | null };
    seen.focusEvents = 0;
    seen.focused = document.activeElement;
    document.addEventListener('focusin', () => (seen.focusEvents += 1));
  });
  const focusEvents = () =>
    page.evaluate(() => {
      const seen = window as unknown as { focusEvents: number; focused: Element | null };
      return { events: seen.focusEvents, same: document.activeElement === seen.focused };
    });

  // Three minutes in which nothing on the list changes.
  await page.clock.runFor('03:00');
  expect(await focusEvents()).toEqual({ events: 0, same: true });

  // At 10:05 the other reminder is overdue: the list changes, and focus stays put.
  await page.clock.runFor('03:00');
  await expect(group(page, 'Overdue')).toContainText('Water the plants');
  await expect(box).toBeFocused();
});
