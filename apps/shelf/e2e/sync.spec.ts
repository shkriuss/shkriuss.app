// Shelf syncing between two devices through the account (packages/sync,
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

const form = (page: Page) => page.getByRole('dialog', { name: /^(New|Edit) item$/ });
const editButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Edit ${name}`, exact: true });
const names = (page: Page) => page.locator('[data-items] [data-action="edit"]');
const uploaded = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );

/** Two devices on one account, both syncing Shelf. */
async function twoDevices(page: Page, browser: Parameters<typeof otherDevice>[0]) {
  const { key } = await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Shelf');
  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Shelf');
  return tablet;
}

async function addItem(page: Page, name: string, price: string): Promise<void> {
  await page.getByRole('button', { name: 'Add item' }).click();
  await form(page).getByLabel('Name').fill(name);
  await form(page).getByLabel('Price (optional)').fill(price);
  await form(page).getByRole('button', { name: 'Save' }).click();
}

async function setPrice(page: Page, name: string, price: string): Promise<void> {
  await editButton(page, name).click();
  await form(page).getByLabel('Price (optional)').fill(price);
  await form(page).getByRole('button', { name: 'Save' }).click();
}

test('items, changes and deletions reach the other device', async ({ page, browser, guard }) => {
  guard.allowOrigin(hubURL);
  const tablet = await twoDevices(page, browser);

  let upload = uploaded(page);
  await addItem(page, 'Olive oil', '18');
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(names(tablet)).toHaveText(['Olive oil']);

  // Changed on the tablet: the phone gets the new price.
  upload = uploaded(tablet);
  await setPrice(tablet, 'Olive oil', '16.50');
  await upload;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.locator('[data-price]')).toHaveText(/^GEL\s16\.50$/);

  // Deleted on the phone: gone from the tablet too.
  upload = uploaded(page);
  await editButton(page, 'Olive oil').click();
  await form(page).getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this item?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(names(tablet)).toHaveCount(0);
  await expect(tablet.getByText('Nothing here yet.')).toBeVisible();

  // Nothing reaches the server readable.
  upload = uploaded(page);
  await addItem(page, 'Secret gift', '99');
  expect((await upload).request().postData() ?? '').not.toContain('Secret gift');
  await tablet.context().close();
});

test('categories reach the other device, and a new one brings none back', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  const chips = (device: Page) => device.locator('[data-categories] button');
  const editCategory = async (device: Page, name: string) => {
    await chips(device).filter({ hasText: name }).click();
    return device.getByRole('dialog', { name: 'Edit category' });
  };

  // Changed on the phone before sync was on: the tablet, which only has
  // the starting categories, takes the phone's list.
  await page.goto('/');
  let category = await editCategory(page, 'Food and drink');
  await category.getByLabel('Name').fill('Groceries');
  await category.getByRole('button', { name: 'Save' }).click();
  category = await editCategory(page, 'Home');
  await category.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this category?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  const tablet = await twoDevices(page, browser);
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  const expected = [
    /^Clothes/,
    /^Groceries/,
    /^Other/,
    /^Personal care/,
    /^Personal items/,
    /^Tech/,
  ];
  await expect(chips(tablet)).toHaveText(expected);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(chips(page)).toHaveText(expected);

  // Added on the tablet: on the phone too.
  const upload = uploaded(tablet);
  await tablet.getByRole('button', { name: 'Add category' }).click();
  await tablet.getByRole('dialog', { name: 'New category' }).getByLabel('Name').fill('Books');
  await tablet
    .getByRole('dialog', { name: 'New category' })
    .getByRole('button', { name: 'Save' })
    .click();
  await upload;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(chips(page).first()).toHaveText(/^Books/);
  await tablet.context().close();
});

test('keeps both versions of an item changed on two devices at once', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  guard.allowConsole('ERR_INTERNET_DISCONNECTED');
  const tablet = await twoDevices(page, browser);
  const upload = uploaded(page);
  await addItem(page, 'Coffee beans', '30');
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(names(tablet)).toHaveText(['Coffee beans']);

  // The phone goes offline and changes the price; so does the tablet.
  await page.context().setOffline(true);
  await setPrice(page, 'Coffee beans', '28');
  const tabletUpload = uploaded(tablet);
  await setPrice(tablet, 'Coffee beans', '32');
  await tabletUpload;

  // Back online, the phone syncs and keeps its version as a second item.
  await page.context().setOffline(false);
  await expect(page.locator('[data-sync-status]')).toHaveText(/both versions are kept/);
  expect(await names(page).allTextContents()).toEqual(
    expect.arrayContaining(['Coffee beans', 'Coffee beans (second version)']),
  );
  const price = (name: string) =>
    page
      .locator('[data-items] > li')
      .filter({ has: editButton(page, name) })
      .locator('[data-price]');
  await expect(price('Coffee beans')).toHaveText(/^GEL\s32\.00$/);
  await expect(price('Coffee beans (second version)')).toHaveText(/^GEL\s28\.00$/);
  await tablet.context().close();
});
