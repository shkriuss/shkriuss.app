// Trades' closed trades: 100 at a time ("Show more"), and a trade just
// saved stays in sight.
import type { Page } from '@playwright/test';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { fillTrade, NOW, seed, TIME_ZONE, trade, tradeDialog, tradeItem } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

/** The day `daysAgo` days before 20 October 2026. */
const day = (daysAgo: number) =>
  new Date(Date.UTC(2026, 9, 20 - daysAgo)).toISOString().slice(0, 10);
const closedItems = (page: Page) => page.locator('[data-closed-list] > li');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  // 110 closed trades, every other day back from 20 October: T0 is the newest.
  await seed(
    page,
    Array.from({ length: 110 }, (_, index) =>
      trade({ symbol: `T${index}`, entryDate: day(2 * index + 1), exitDate: day(2 * index) }),
    ),
  );
});

test('“Show more” puts focus on the first trade it shows', async ({ page }) => {
  await expect(closedItems(page)).toHaveCount(100);
  const more = page.getByRole('button', { name: 'Show more' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(closedItems(page)).toHaveCount(110);
  await expect(more).toBeHidden();
  await expect(closedItems(page).nth(100).locator('[data-action="edit"]')).toBeFocused();
});

test('a trade saved below the first 100 stays in sight, with focus on it', async ({ page }) => {
  // Its exit day makes it the 106th: it was hidden behind "Show more", and
  // focus went to "New trade" (audit J-12).
  await page.getByRole('button', { name: 'New trade' }).click();
  await fillTrade(page, {
    symbol: 'NEW',
    entryDate: day(210),
    entryPrice: '100',
    quantity: '10',
    exitDate: day(209),
    exitPrice: '120',
  });
  await expect(tradeDialog(page)).toBeHidden();
  await expect(closedItems(page)).toHaveCount(106);
  await expect(closedItems(page).last()).toContainText('NEW');
  await expect(tradeItem(page, 'NEW').locator('[data-action="edit"]')).toBeFocused();
  // The rest are still a "Show more" away.
  await expect(page.getByRole('button', { name: 'Show more' })).toBeVisible();
});
