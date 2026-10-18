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

const titleBox = (page: Page) => page.getByRole('textbox', { name: 'Title' });
const bodyBox = (page: Page) => page.getByRole('textbox', { name: 'Note' });
const link = (page: Page, title: string) => page.getByRole('link', { name: title, exact: true });
const titles = (page: Page) => page.locator('[data-notes] [data-open]').allTextContents();
const uploaded = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );

/** Two devices on one account, both syncing Notes. */
async function twoDevices(page: Page, browser: Parameters<typeof otherDevice>[0]) {
  const { key } = await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Notes');
  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Notes');
  return tablet;
}

/** Opens a note, changes its text, and goes back once it's uploaded. */
async function editBody(page: Page, title: string, body: string): Promise<void> {
  await link(page, title).click();
  const upload = uploaded(page);
  await bodyBox(page).fill(body);
  await page.getByRole('button', { name: 'All notes' }).click();
  await upload;
}

test('notes, edits and deletions reach the other device', async ({ page, browser, guard }) => {
  guard.allowOrigin(hubURL);
  const tablet = await twoDevices(page, browser);

  let upload = uploaded(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await titleBox(page).fill('Trip plan');
  await bodyBox(page).fill('Book the train');
  await page.getByRole('button', { name: 'All notes' }).click();
  await upload;

  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await link(tablet, 'Trip plan').click();
  await expect(bodyBox(tablet)).toHaveValue('Book the train');
  await tablet.getByRole('button', { name: 'All notes' }).click();

  // Edited on the tablet, while the phone shows the list.
  await editBody(tablet, 'Trip plan', 'Book the train\nPack snacks');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await link(page, 'Trip plan').click();
  await expect(bodyBox(page)).toHaveValue('Book the train\nPack snacks');

  // Deleted on the phone: gone from the tablet too.
  upload = uploaded(page);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
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
  await titleBox(page).fill('Secret diary');
  expect((await upload).request().postData() ?? '').not.toContain('Secret diary');
  await tablet.context().close();
});

test('keeps both versions of a note changed on two devices at once', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  guard.allowConsole('ERR_INTERNET_DISCONNECTED');
  const tablet = await twoDevices(page, browser);
  const upload = uploaded(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await titleBox(page).fill('Groceries');
  await page.getByRole('button', { name: 'All notes' }).click();
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(link(tablet, 'Groceries')).toBeVisible();

  // The phone goes offline and changes the note; so does the tablet.
  await page.context().setOffline(true);
  await link(page, 'Groceries').click();
  await bodyBox(page).fill('Milk');
  await page.getByRole('button', { name: 'All notes' }).click();
  await editBody(tablet, 'Groceries', 'Bread');

  // Back online, the phone syncs and keeps its version as a second note.
  await page.context().setOffline(false);
  await expect(page.locator('[data-sync-status]')).toHaveText(/both versions are kept/);
  expect(await titles(page)).toEqual(
    expect.arrayContaining(['Groceries', 'Groceries (second version)']),
  );
  await link(page, 'Groceries').click();
  await expect(bodyBox(page)).toHaveValue('Bread');
  await page.getByRole('button', { name: 'All notes' }).click();
  await link(page, 'Groceries (second version)').click();
  await expect(bodyBox(page)).toHaveValue('Milk');

  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(link(tablet, 'Groceries (second version)')).toBeVisible();
  await tablet.context().close();
});
