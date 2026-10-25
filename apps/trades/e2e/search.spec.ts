// Trades' search for screen reader users: what it finds is read out.
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { NOW, seed, TIME_ZONE, trade } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test('says how many closed trades a search finds', async ({ page }) => {
  // The results changed on screen, but nothing was read out (audit G-6).
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await seed(page, [
    trade({ symbol: 'AAPL', setup: 'Breakout' }),
    trade({ symbol: 'MSFT', setup: 'Pullback' }),
  ]);
  const announcer = page.locator('[data-announcer]');
  await page.getByLabel('Search').pressSequentially('breakout');
  await expect(announcer).toHaveText('1 closed trade found.');
  await page.getByLabel('Search').fill('nothing like this');
  await expect(announcer).toHaveText('0 closed trades found.');
  await expect(page.getByText('No closed trades match your search.')).toBeVisible();
});
