// Reminders syncing between two devices through the account (packages/sync,
// docs/adr/0010). The connect flow itself is tested for every app in
// tests/e2e/sync.spec.ts.
import { createAccount, hubURL, signInWithKey, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { addReminder, NOW, row, TIME_ZONE } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test('reminders, and ticking them done, sync between devices', async ({ page, browser, guard }) => {
  guard.allowOrigin(hubURL);
  await page.clock.setFixedTime(NOW);
  const { key } = await createAccount(page);
  await page.goto('/');
  await addReminder(page, 'Call the dentist', { time: '18:30' });
  await addReminder(page, 'Take my pills', { time: '09:00', repeat: 'Every day' });
  await turnOnSync(page, 'Reminders');

  const tablet = await (
    await browser.newContext({ locale: 'en-US', timezoneId: TIME_ZONE, serviceWorkers: 'block' })
  ).newPage();
  await tablet.clock.setFixedTime(NOW);
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Reminders');
  await expect(row(tablet, 'Call the dentist')).toContainText(/Today at 6:30\sPM/);
  await expect(row(tablet, 'Take my pills')).toContainText('Every day');

  // Done on the tablet; the phone sees it.
  const uploaded = tablet.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );
  await tablet.getByRole('checkbox', { name: 'Call the dentist: done' }).click();
  await uploaded;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.locator('[data-done-count]')).toHaveText('1');
  await page.locator('[data-done-section] summary').click();
  await expect(page.getByRole('checkbox', { name: 'Call the dentist: done' })).toBeChecked();
  await tablet.context().close();
});
