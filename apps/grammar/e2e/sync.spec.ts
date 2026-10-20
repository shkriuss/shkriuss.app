// Grammar's English choice and dictionary syncing between two devices through
// the account (packages/sync, docs/adr/0010), while the text stays on each
// device. The connect flow itself is tested for every app in tests/e2e/sync.spec.ts.
import type { Page } from '@playwright/test';
import {
  createAccount,
  hubURL,
  otherDevice,
  signInWithKey,
  turnOnSync,
} from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

const text = (page: Page) => page.getByLabel('Your text');
const words = (page: Page) => page.locator('[data-words] li [data-word]');

/** "Sync now", and wait until it's done. */
async function syncNow(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Sync now' });
  const fetched = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/sync/copy',
  );
  await button.click();
  await fetched;
  await expect(button).toBeEnabled();
}

const uploaded = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );

/** Opens Grammar with this saved on the device. */
async function openWith(
  page: Page,
  saved: { text: string; english: 'american' | 'british'; words: string[] },
): Promise<void> {
  await page.goto('/');
  await page.evaluate((data) => {
    localStorage.setItem('shkriuss:grammar', JSON.stringify({ v: 1, data }));
  }, saved);
  await page.reload();
  await expect(text(page)).toHaveValue(saved.text);
}

test('the dictionary and English choice sync; the text stays on each device', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  const { key } = await createAccount(page);
  await openWith(page, { text: 'Written on the phone.', english: 'british', words: ['Tbilisi'] });
  await expect(page.locator('[data-sync-off]')).toContainText(
    'Keep your dictionary and your choice of American or British English the same',
  );
  await turnOnSync(page, 'Grammar');

  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await openWith(tablet, {
    text: 'Written on the tablet.',
    english: 'american',
    words: ['Kutaisi'],
  });
  await turnOnSync(tablet, 'Grammar');
  // What was online first wins; the tablet's own word is added.
  await expect(words(tablet)).toHaveText(['Kutaisi', 'Tbilisi']);
  await expect(tablet.getByLabel('British (UK)')).toBeChecked();
  await expect(text(tablet)).toHaveValue('Written on the tablet.');

  await syncNow(page);
  await expect(words(page)).toHaveText(['Kutaisi', 'Tbilisi']);
  await expect(text(page)).toHaveValue('Written on the phone.');

  // Changed on the phone: the tablet follows.
  const upload = uploaded(page);
  await page.getByRole('button', { name: 'Remove “Tbilisi” from my dictionary' }).click();
  await page.getByLabel('American (US)').check();
  await upload;
  await syncNow(tablet);
  await expect(words(tablet)).toHaveText(['Kutaisi']);
  await expect(tablet.getByLabel('American (US)')).toBeChecked();
  await expect(text(tablet)).toHaveValue('Written on the tablet.');

  // Typing sends nothing, even with sync on.
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') sent.push(`${request.method()} ${request.url()}`);
  });
  await text(page).fill('A new secret paragraph.');
  await syncNow(page);
  expect(sent).toEqual([]);
  await syncNow(tablet);
  await expect(text(tablet)).toHaveValue('Written on the tablet.');
  await tablet.context().close();
});
