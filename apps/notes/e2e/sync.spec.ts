// Notes syncing between two devices through the account (packages/sync,
// docs/adr/0010). The connect flow itself is tested for every app in
// tests/e2e/sync.spec.ts.
import type { Page } from '@playwright/test';
import {
  createAccount,
  hubURL,
  otherDevice,
  signInWithKey,
  turnOnSync,
} from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

const editor = (page: Page) => page.getByRole('textbox', { name: 'Note' });
const link = (page: Page, title: string) => page.getByRole('link', { name: title, exact: true });
const uploaded = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );

test('notes, edits and deletions reach the other device', async ({ page, browser, guard }) => {
  guard.allowOrigin(hubURL);
  const { key } = await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Notes');

  let upload = uploaded(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await editor(page).fill('Trip plan\nBook the train');
  await page.getByRole('button', { name: 'All notes' }).click();
  await upload;

  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Notes');
  await link(tablet, 'Trip plan').click();
  await expect(editor(tablet)).toHaveValue('Trip plan\nBook the train');

  // Edited on the tablet, while the phone shows the list.
  upload = uploaded(tablet);
  await editor(tablet).fill('Trip plan\nBook the train\nPack snacks');
  await tablet.getByRole('button', { name: 'All notes' }).click();
  await upload;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await link(page, 'Trip plan').click();
  await expect(editor(page)).toHaveValue('Trip plan\nBook the train\nPack snacks');

  // Deleted on the phone: gone from the tablet too.
  upload = uploaded(page);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this note?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(link(tablet, 'Trip plan')).toBeHidden();
  await expect(tablet.getByText('No notes yet')).toBeVisible();

  // The text never reaches the server readable.
  upload = uploaded(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await editor(page).fill('Secret diary');
  expect((await upload).request().postData() ?? '').not.toContain('Secret diary');
  await tablet.context().close();
});
