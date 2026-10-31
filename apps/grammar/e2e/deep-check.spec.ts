// Deep check, with the real model (GECToR Large, 381 MB, downloaded from this
// site only when asked), running on the device under the site's strict CSP
// and Trusted Types, on several cores: checking, accepting, skipping,
// accepting all, Undo after accepting, working offline, and removing it.
// docs/adr/0012.
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
  // Read out at once, so a screen reader doesn't wait in silence (audit 5 G-6).
  await expect(page.locator('[data-announcer]')).toHaveText(
    'Starting Deep check. This takes a few seconds…',
  );
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

  // Undo takes back an accepted change, and all of “Accept all” at once.
  await button(page, 'Change “was” to “were”').click();
  await expect(text(page)).toHaveValue(
    'I have a apple. She goes to school every day. They were happy.',
  );
  await text(page).press('ControlOrMeta+z');
  await expect(text(page)).toHaveValue(
    'I have a apple. She goes to school every day. They was happy.',
  );
  await text(page).fill('I has a apple. She go to school every days.');
  await button(page, 'Accept all 4 changes').click();
  await expect(text(page)).toHaveValue('I have an apple. She goes to school every day.');
  await text(page).press('ControlOrMeta+z');
  await expect(text(page)).toHaveValue('I has a apple. She go to school every days.');

  // A short form typed without an apostrophe is split as the model learned
  // it ("do" + "nt"): kept whole, the model didn't know "dont", and made it
  // "do", the opposite (audit 3 F3-2).
  await text(page).fill('I dont know where he is.');
  await button(page, "Change “nt” to “n't”").click();
  await expect(text(page)).toHaveValue("I don't know where he is.");
  // With curly apostrophes, as iPhones type, the one it adds is curly too,
  // without a space before it (audit 3 F3-5).
  await text(page).fill('It’s late and its raining.');
  await button(page, 'Change “its” to “it’s”').click();
  await expect(text(page)).toHaveValue('It’s late and it’s raining.');

  // The text changed in another tab: checked again and drawn again, the
  // changes keep keyboard focus where it was (audit 3 G-1).
  await text(page).fill('She go to school.');
  const goes = button(page, 'Change “go” to “goes”');
  await goes.focus();
  await page.evaluate(() => {
    const key = 'shkriuss:grammar';
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as { data?: object };
    const data = { ...saved.data, text: 'She go to school. We has fun.' };
    localStorage.setItem(key, JSON.stringify({ v: 1, data }));
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
  });
  await expect(button(page, 'Change “has” to “have”')).toBeVisible({ timeout: 60_000 });
  await expect(goes).toBeFocused();

  // The text never left the device: only files were downloaded.
  expect(requests.filter((line) => !line.startsWith('GET '))).toEqual([]);
  expect(requests.join('\n')).not.toContain('apple');

  await button(page, 'Remove Deep check from this device').click();
  const remove = page.getByRole('dialog', { name: 'Remove Deep check?' });
  // Read out with its title (audit 5 G-3).
  await expect(remove).toHaveAccessibleDescription(
    'It’s removed from this device, freeing its space. You can download it again later.',
  );
  await remove.getByRole('button', { name: 'Remove' }).click();
  await expect(button(page, 'Download Deep check')).toBeFocused();
  expect(await page.evaluate(() => caches.has('deep-check'))).toBe(false);
  await page.reload();
  await expect(button(page, 'Download Deep check')).toBeVisible();
});

test('“Check my text” works again after Deep check is removed while it starts (audit 5 F3-5)', async ({
  page,
}) => {
  await open(page);
  await text(page).fill('She go to school every days.');
  await download(page);
  const check = deep(page).locator('[data-action="deep-run"]');
  await check.click();
  await expect(page.locator('[data-announcer]')).toHaveText(
    'Starting Deep check. This takes a few seconds…',
  );
  await expect(check).toHaveAttribute('aria-disabled', 'true');

  // Removed while it starts: before, the button stayed busy for good, with
  // the progress bar, and the next download found it like that.
  await button(page, 'Remove Deep check from this device').click();
  await page
    .getByRole('dialog', { name: 'Remove Deep check?' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(button(page, 'Download Deep check')).toBeFocused();
  await expect(check).not.toHaveAttribute('aria-disabled');
  await expect(deep(page).locator('[data-deep-check-progress]')).toBeHidden();
  await expect(deepStatus(page)).toHaveText('');

  await download(page);
  await check.click();
  await expect(button(page, 'Change “go” to “goes”')).toBeVisible({ timeout: 120_000 });
});

test('says when a file arrives damaged, instead of blaming the connection (audit 5 F3-10)', async ({
  page,
}) => {
  await open(page);
  // One small file comes back changed: a damaged copy on the site, say.
  await page.route('**/on-demand/deep-check/labels.*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nextra` });
  });
  await button(page, 'Download Deep check').click();
  await expect(deep(page).locator('[data-deep-problem]')).toHaveText(
    /^One of the files arrived damaged, so it wasn’t kept\. Try again\./,
    { timeout: 120_000 },
  );
  await expect(button(page, 'Download Deep check')).toBeFocused();
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
