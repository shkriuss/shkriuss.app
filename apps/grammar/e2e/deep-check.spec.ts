// Deep check, with the real model (GECToR Large, 381 MB, downloaded from this
// site only when asked), running on the device under the site's strict CSP
// and Trusted Types, on several cores: checking, accepting, skipping,
// accepting all, working offline, and removing it. docs/adr/0012.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';

// Downloading 381 MB and starting the model take a while.
test.slow();

const READY = 'Type or paste your text above, and suggestions show here.';
const text = (page: Page) => page.getByRole('textbox', { name: 'Your text' });
const deep = (page: Page) => page.locator('[data-deep]');
const deepStatus = (page: Page) => page.locator('[data-deep-status]');
const button = (page: Page, name: string) => deep(page).getByRole('button', { name, exact: true });

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-status]')).toHaveText(READY, { timeout: 30_000 });
}

async function download(page: Page): Promise<void> {
  await button(page, 'Download Deep check').click();
  await expect(button(page, 'Check my text')).toBeVisible({ timeout: 120_000 });
}

test('downloads only when asked, then checks the text and makes its changes', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}${url.search} ${request.postData() ?? ''}`);
  });
  await open(page);
  await expect(deep(page)).toContainText('381 MB');
  // Nothing big is downloaded until asked: only the list of files.
  expect(requests.filter((line) => line.includes('/on-demand/'))).toEqual([
    'GET /on-demand/deep-check/manifest.json ',
  ]);
  await checkA11y(page, 'Deep check, not downloaded');

  await page.getByLabel('American (US)').check();
  await text(page).fill('I has a apple. She go to school every days.');
  await download(page);
  await expect(
    page.getByRole('status').filter({ hasText: 'Deep check is downloaded' }),
  ).toBeAttached();

  await button(page, 'Check my text').click();
  await expect(deepStatus(page)).toHaveText('4 changes suggested.', { timeout: 120_000 });
  await expect(deep(page).getByRole('listitem')).toHaveText([
    /I hashave a apple/,
    /I has aan apple/,
    /She gogoes to school/,
    /every daysday\./,
  ]);
  await checkA11y(page, 'Deep check changes');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'Deep check changes (dark)');

  // Accept one: the text changes, and the next change is ready to tap.
  await button(page, 'Change “has” to “have”').click();
  await expect(text(page)).toHaveValue('I have a apple. She go to school every days.');
  await expect(button(page, 'Change “a” to “an”')).toBeFocused();
  // The quick check (Harper) checks the new text too.
  await expect(page.locator('[data-status]')).toHaveText(/suggestion/);

  // Skip one: it stays hidden, also after an edit.
  await button(page, 'Skip: Change “a” to “an”').click();
  await expect(button(page, 'Change “a” to “an”')).toHaveCount(0);
  await button(page, 'Accept all 2 changes').click();
  await expect(text(page)).toHaveValue('I have a apple. She goes to school every day.');
  await expect(deepStatus(page)).toHaveText('No changes suggested.');
  await text(page).press('End');
  await text(page).pressSequentially(' They was happy.');
  await expect(button(page, 'Change “was” to “were”')).toBeVisible({ timeout: 60_000 });
  await expect(button(page, 'Change “a” to “an”')).toHaveCount(0);

  // The text never left the device: only files were downloaded.
  expect(requests.filter((line) => !line.startsWith('GET '))).toEqual([]);
  expect(requests.join('\n')).not.toContain('apple');

  await button(page, 'Remove Deep check from this device').click();
  await page
    .getByRole('dialog', { name: 'Remove Deep check?' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(button(page, 'Download Deep check')).toBeFocused();
  expect(await page.evaluate(() => caches.has('deep-check'))).toBe(false);
  await page.reload();
  await expect(button(page, 'Download Deep check')).toBeVisible();
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('works offline once downloaded', async ({ page, context }) => {
    await open(page);
    await download(page);

    await context.setOffline(true);
    await page.reload();
    await expect(button(page, 'Check my text')).toBeVisible({ timeout: 30_000 });
    await text(page).fill('She go to school every days.');
    await button(page, 'Check my text').click();
    await expect(button(page, 'Change “go” to “goes”')).toBeVisible({ timeout: 120_000 });
    await context.setOffline(false);
  });
});
