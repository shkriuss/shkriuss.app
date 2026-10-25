// Grammar: checking as you type with the real checker (Harper, as
// WebAssembly in a worker, under the site's strict CSP), fixing (and Undo
// after a fix), American and British English, the dictionary, copy and
// clear, and that the text never leaves the device. Shared checks
// (accessibility, security headers, offline, privacy) run for every app from
// tests/e2e/.
import type { Page } from '@playwright/test';
import { paste } from '../../../tests/e2e/clipboard.ts';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';

// Loading the checker (16 MB of WebAssembly) takes a few seconds.
test.slow();

const READY = 'Type or paste your text above, and suggestions show here.';
const text = (page: Page) => page.getByLabel('Your text');
const status = (page: Page) => page.locator('[data-status]');
const suggestion = (page: Page, problem: string) =>
  page.getByRole('listitem').filter({ has: page.locator('[data-problem]', { hasText: problem }) });

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(status(page)).toHaveText(READY, { timeout: 30_000 });
}

test('checks as you type, and fixes problems with a tap', async ({ page }) => {
  await open(page);
  await page.getByLabel('American (US)').check();
  await text(page).fill('I has a apple.');
  await expect(status(page)).toHaveText('2 suggestions.');
  await expect(suggestion(page, 'has')).toContainText('Agreement');
  await expect(suggestion(page, 'has')).toContainText('I has a apple.');
  await checkA11y(page, 'with suggestions');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'with suggestions (dark)');

  await suggestion(page, 'has').getByRole('button', { name: 'Change to “have”' }).click();
  await expect(text(page)).toHaveValue('I have a apple.');
  await expect(status(page)).toHaveText('1 suggestion.');
  // Straight on to the next one.
  await expect(page.getByRole('button', { name: 'Change to “an”' })).toBeFocused();
  await expect(
    page.getByRole('status').filter({ hasText: 'Changed “has” to “have”.' }),
  ).toBeAttached();
  await page.getByRole('button', { name: 'Change to “an”' }).click();
  await expect(text(page)).toHaveValue('I have an apple.');
  await expect(status(page)).toHaveText('No problems found.');

  // Saved on this device.
  await page.reload();
  await expect(text(page)).toHaveValue('I have an apple.');
  await expect(status(page)).toHaveText('No problems found.', { timeout: 30_000 });
});

test('Undo takes a fix back', async ({ page }) => {
  await open(page);
  await page.getByLabel('American (US)').check();
  await text(page).fill('I has a apple.');
  // While the fix is made the box has focus, with no phone keyboard for it.
  await text(page).evaluate((box) => {
    const seen: (string | null)[] = [];
    Object.assign(window, { inputModes: seen });
    box.addEventListener('focus', () => seen.push(box.getAttribute('inputmode')));
  });
  await suggestion(page, 'has').getByRole('button', { name: 'Change to “have”' }).click();
  await expect(text(page)).toHaveValue('I have a apple.');
  await expect(page.getByRole('button', { name: 'Change to “an”' })).toBeFocused();
  expect(await page.evaluate(() => Reflect.get(window, 'inputModes') as unknown)).toEqual(['none']);
  await expect(text(page)).not.toHaveAttribute('inputmode');

  await text(page).press('ControlOrMeta+z');
  await expect(text(page)).toHaveValue('I has a apple.');
  // Checked again, like any edit.
  await expect(status(page)).toHaveText('2 suggestions.');
});

test('fixes still work in a browser that can’t make them as an edit', async ({ page }) => {
  // Then the text is set the old way (without undo).
  await page.addInitScript(() => {
    Object.defineProperty(document, 'execCommand', { value: () => false });
  });
  await open(page);
  await page.getByLabel('American (US)').check();
  await text(page).fill('I has a apple.');
  await suggestion(page, 'has').getByRole('button', { name: 'Change to “have”' }).click();
  await expect(text(page)).toHaveValue('I have a apple.');
  await expect(status(page)).toHaveText('1 suggestion.');
  await expect(page.getByRole('button', { name: 'Change to “an”' })).toBeFocused();
});

test('checks American or British English', async ({ page }) => {
  await open(page);
  await page.getByLabel('American (US)').check();
  await text(page).fill('The colour of the theatre is grey.');
  await expect(status(page)).toHaveText('3 suggestions.');
  await expect(suggestion(page, 'colour')).toContainText('Spelling');
  await expect(
    suggestion(page, 'colour').getByRole('button', { name: 'Change to “color”' }),
  ).toBeVisible();

  await page.getByLabel('British (UK)').check();
  await expect(status(page)).toHaveText('No problems found.');
  await text(page).fill('The color of the theater is gray.');
  await expect(status(page)).toHaveText('3 suggestions.');

  await page.reload();
  await expect(page.getByLabel('British (UK)')).toBeChecked();
});

test('words in my dictionary aren’t marked as misspelled', async ({ page }) => {
  await open(page);
  await page.getByLabel('American (US)').check();
  await text(page).fill('Mtskheta is near Tbilisi.');
  await expect(suggestion(page, 'Mtskheta')).toBeVisible();
  await suggestion(page, 'Mtskheta')
    .getByRole('button', { name: 'Add to my dictionary: “Mtskheta”' })
    .click();
  await expect(suggestion(page, 'Mtskheta')).toHaveCount(0);
  await expect(page.locator('[data-words]')).toContainText('Mtskheta');
  // Still known after switching English.
  await page.getByLabel('British (UK)').check();
  await expect(status(page)).toHaveText('No problems found.');
  await expect(suggestion(page, 'Mtskheta')).toHaveCount(0);

  await page.reload();
  await expect(status(page)).not.toHaveText(/Loading/, { timeout: 30_000 });
  await expect(suggestion(page, 'Mtskheta')).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove “Mtskheta” from my dictionary' }).click();
  await expect(suggestion(page, 'Mtskheta')).toBeVisible();
  await expect(page.getByText('No words yet.')).toBeVisible();
});

test('shows a problem in the text', async ({ page }) => {
  await open(page);
  await text(page).fill('She go to school.');
  await suggestion(page, 'go').getByRole('button', { name: 'Show in text: “go”' }).click();
  await expect(text(page)).toBeFocused();
  expect(
    await text(page).evaluate((box: HTMLTextAreaElement) => [box.selectionStart, box.selectionEnd]),
  ).toEqual([4, 6]);
});

test('copies and clears the text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await text(page).fill('Hello there.');
  await page.getByRole('button', { name: 'Copy text' }).click();
  await expect(page.locator('[data-action-status]')).toHaveText(
    'Copied. You can paste it anywhere.',
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Hello there.');

  await page.getByRole('button', { name: 'Clear' }).click();
  const dialog = page.getByRole('dialog', { name: 'Clear the text?' });
  await dialog.getByRole('button', { name: 'Clear' }).click();
  await expect(text(page)).toHaveValue('');
  await expect(text(page)).toBeFocused();
  await expect(status(page)).toHaveText(READY);
});

test('says when a pasted text doesn’t all fit', async ({ page }) => {
  // The box takes 20,000 characters; the browser keeps the start of a
  // longer paste, and nothing said so (audit F3-3).
  await open(page);
  const hint = 'Type or paste your text (up to 20,000 characters). It’s checked as you type.';
  await expect(text(page)).toHaveAccessibleDescription(hint);
  const essay = Array.from(
    { length: 600 },
    (_, index) => `Paragraph ${index + 1} has a few sentences in it.`,
  ).join(' ');
  await paste(text(page), essay);
  await expect(text(page)).toHaveValue(essay.slice(0, 20_000));
  const cut =
    'Only part of that fit. This box takes up to 20,000 characters, so the rest wasn’t added.';
  await expect(page.getByText(cut, { exact: true })).toBeVisible();
  // Read out at once, and with the box when it's read again.
  await expect(page.getByRole('alert').filter({ hasText: `Your text: ${cut}` })).toBeAttached();
  await expect(text(page)).toHaveAccessibleDescription(`${hint} ${cut}`);
  await checkA11y(page, 'a paste that didn’t all fit');

  // Typing at the limit adds nothing: that's said too.
  await page.keyboard.type('!');
  await expect(text(page)).toHaveValue(essay.slice(0, 20_000));
  const none = 'That didn’t fit. This box takes up to 20,000 characters, so it wasn’t added.';
  await expect(page.getByText(none, { exact: true })).toBeVisible();
  // Gone once the text is changed and all of it fits.
  await page.keyboard.press('Backspace');
  await expect(page.getByText(none, { exact: true })).toBeHidden();
  await expect(text(page)).toHaveAccessibleDescription(hint);
});

test('the text never leaves the device', async ({ page }) => {
  const sent: string[] = [];
  page.on('request', (request) => {
    sent.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`);
  });
  await open(page);
  await text(page).fill('My secret diary entry is here.');
  await expect(status(page)).toHaveText(/suggestion|No problems/);
  expect(sent.filter((line) => !line.startsWith('GET '))).toEqual([]);
  expect(sent.join('\n')).not.toContain('secret');
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('downloads the checker once, then checks offline too', async ({ page, context }) => {
    // Downloads of the checker that didn't come from the offline copy.
    const downloads: string[] = [];
    context.on('response', (response) => {
      if (response.url().endsWith('.wasm') && !response.fromServiceWorker()) {
        downloads.push(response.url());
      }
    });
    await open(page);
    await text(page).fill('I has a apple.');
    await expect(status(page)).toHaveText('2 suggestions.');
    expect(downloads).toHaveLength(1);

    await context.setOffline(true);
    await page.reload();
    await expect(status(page)).toHaveText('2 suggestions.', { timeout: 30_000 });
    await context.setOffline(false);
  });
});
