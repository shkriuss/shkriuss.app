// Grammar: checking as you type with the real checker (Harper, as
// WebAssembly in a worker, under the site's strict CSP), fixing (and Undo
// after a fix), American and British English, the dictionary, copy and
// clear, and that the text never leaves the device. Shared checks
// (accessibility, security headers, offline, privacy) run for every app from
// tests/e2e/.
import type { Page } from '@playwright/test';
import { paste } from '../../../tests/e2e/clipboard.ts';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';

// Loading the checker (about 20 MB of WebAssembly) takes a few seconds.
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

/** Opens a second tab once the text is saved (half a second after typing stops), as another device. */
async function secondTab(page: Page): Promise<Page> {
  const typed = await text(page).inputValue();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('shkriuss:grammar') ?? '{}') as {
          data?: { text?: string };
        };
        return saved.data?.text;
      }),
    )
    .toBe(typed);
  const other = await page.context().newPage();
  await other.goto('/');
  await page.bringToFront();
  return other;
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

test('says when the dictionary is full', async ({ page }) => {
  // With 500 words, "Add to my dictionary" added nothing but said "Added"
  // (audit F3-8).
  await page.goto('/');
  const words = Array.from({ length: 500 }, (_, index) => `word${index}`);
  await page.evaluate((list) => {
    const data = { text: '', english: 'american', words: list };
    localStorage.setItem('shkriuss:grammar', JSON.stringify({ v: 1, data }));
  }, words);
  await open(page);
  await text(page).fill('Mtskheta is near Tbilisi.');
  const add = suggestion(page, 'Mtskheta').getByRole('button', {
    name: 'Add to my dictionary: “Mtskheta”',
  });
  await add.click();
  const full = page
    .getByRole('alert')
    .filter({ hasText: 'Your dictionary is full (500 words). Remove one to add another.' });
  await expect(full).toBeVisible();
  await expect(add).toBeFocused();
  await expect(suggestion(page, 'Mtskheta')).toBeVisible();
  await expect(page.locator('[data-words] [data-word="Mtskheta"]')).toHaveCount(0);

  // With room again, the note goes, and the word is added.
  await page.getByRole('button', { name: 'Remove “word0” from my dictionary' }).click();
  await expect(full).toHaveCount(0);
  await add.click();
  await expect(page.getByRole('status').filter({ hasText: 'Added “Mtskheta”' })).toBeAttached();
  await expect(suggestion(page, 'Mtskheta')).toHaveCount(0);
});

test('says how many words to remove when the dictionary has more than it keeps', async ({
  page,
}) => {
  // Sync can bring two devices' dictionaries together past 500 words; then
  // "Remove one to add another" wasn't enough (audit 3 F3-9).
  await page.goto('/');
  const words = Array.from({ length: 600 }, (_, index) => `word${index}`);
  await page.evaluate((list) => {
    const data = { text: '', english: 'american', words: list };
    localStorage.setItem('shkriuss:grammar', JSON.stringify({ v: 1, data }));
  }, words);
  await open(page);
  await text(page).fill('Mtskheta is near Tbilisi.');
  await suggestion(page, 'Mtskheta')
    .getByRole('button', { name: 'Add to my dictionary: “Mtskheta”' })
    .click();
  const full = page.getByRole('alert').filter({
    hasText: 'Your dictionary has 600 words; it can keep 500. Remove 101 to add another.',
  });
  await expect(full).toBeVisible();

  // Down to 499 on another device (the change comes as another tab's does): the note goes.
  await page.evaluate((list) => {
    const key = 'shkriuss:grammar';
    const data = { text: 'Mtskheta is near Tbilisi.', english: 'american', words: list };
    localStorage.setItem(key, JSON.stringify({ v: 1, data }));
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
  }, words.slice(101));
  await expect(full).toHaveCount(0);
});

test('keeps keyboard focus on a suggestion when another tab changes the English', async ({
  page,
}) => {
  // Another tab (or another device, through sync) chose British English:
  // the text was checked again, the suggestions were drawn again, and
  // keyboard focus fell to the top of the page (audit 3 G-1).
  await open(page);
  await page.getByLabel('American (US)').check();
  await text(page).fill('I has a apple. She go home.');
  await expect(status(page)).toHaveText(/suggestions/);
  const other = await secondTab(page);
  const show = page.getByRole('button', { name: 'Show in text: “go”' });
  await show.focus();
  await page.evaluate(() => {
    Object.assign(window, { focusedBefore: document.activeElement });
  });

  await other.getByLabel('British (UK)').check();
  await expect(page.getByLabel('British (UK)')).toBeChecked();
  // Drawn again: focus is on the new copy of the same button.
  await expect
    .poll(() => page.evaluate(() => (Reflect.get(window, 'focusedBefore') as Element).isConnected))
    .toBe(false);
  await expect(show).toBeFocused();
});

test('when the suggestion with focus goes, and none is left, focus goes to the heading', async ({
  page,
}) => {
  await open(page);
  await page.getByLabel('American (US)').check();
  await text(page).fill('The colour is nice.');
  await expect(status(page)).toHaveText('1 suggestion.');
  const other = await secondTab(page);
  await page.getByRole('button', { name: 'Show in text: “colour”' }).focus();

  // British English, chosen in the other tab: nothing to suggest any more.
  await other.getByLabel('British (UK)').check();
  await expect(status(page)).toHaveText('No problems found.');
  await expect(page.getByRole('heading', { name: 'Suggestions' })).toBeFocused();
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
  // Read out with its title; and clearing drops Undo, so it says so (audit 5 G-3, G-8).
  await expect(dialog).toHaveAccessibleDescription(
    'Everything in the text box will be removed. This can’t be undone.',
  );
  await dialog.getByRole('button', { name: 'Clear' }).click();
  await expect(text(page)).toHaveValue('');
  await expect(text(page)).toBeFocused();
  await expect(status(page)).toHaveText(READY);
});

test('the English chosen elsewhere while the checker starts: it still checks', async ({ page }) => {
  // Another tab here (or another device, through sync) switches to British
  // while Harper is loading: the new English and the dictionary reach the
  // checker together (audit F3-4). The change comes as another tab's does,
  // with a storage event (a second Grammar tab would load Harper too, and two
  // downloads of it at once can make the browser fail one).
  const starting = page.waitForRequest((request) => request.url().endsWith('.wasm'));
  await page.goto('/');
  await starting;
  await page.evaluate(() => {
    const key = 'shkriuss:grammar';
    const data = { text: '', english: 'british', words: ['Shkriuss'] };
    localStorage.setItem(key, JSON.stringify({ v: 1, data }));
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
  });
  await expect(page.getByLabel('British (UK)')).toBeChecked();
  await text(page).fill('I has a apple. Shkriuss likes the colour.');
  await expect(status(page)).toHaveText('2 suggestions.', { timeout: 30_000 });
});

test('the checker is started again if it stops working', async ({ page }) => {
  // As if it crashed once, after it had started (audit F3-4): its first
  // check fails. The next copy of it works.
  let started = 0;
  await page.route('**/_astro/checker.worker-*.js', async (route) => {
    started += 1;
    const response = await route.fetch();
    const script = await response.text();
    const failing = `${script}
addEventListener('message', (event) => {
  if (event.data.type === 'check') postMessage({ type: 'failed' });
});`;
    await route.fulfill({ response, body: started === 1 ? failing : script });
  });
  await open(page);
  await page.getByLabel('American (US)').check();
  await text(page).fill('I has a apple.');
  await expect(status(page)).toHaveText('2 suggestions.');
  expect(started).toBe(2);
});

test('says when the checker couldn’t be downloaded, and tries again', async ({ page, guard }) => {
  // The connection drops while the checker's file downloads on a first
  // visit: the browser got the blame, and only a reload helped (audit 5 G-5).
  guard.allowConsole('net::ERR_FAILED');
  let cut = true;
  await page.route('**/*.wasm', (route) => (cut ? route.abort() : route.continue()));
  await page.goto('/');
  await expect(status(page)).toHaveText(
    'The grammar checker couldn’t be downloaded. Check your internet connection and try again.',
    { timeout: 30_000 },
  );
  const tryAgain = page.getByRole('button', { name: 'Try again' });
  await expect(tryAgain).toBeVisible();

  // Connected again: it downloads, and checks.
  cut = false;
  await tryAgain.click();
  await expect(tryAgain).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Suggestions' })).toBeFocused();
  await expect(status(page)).toHaveText(READY, { timeout: 30_000 });
  await page.getByLabel('American (US)').check();
  await text(page).fill('I has a apple.');
  await expect(status(page)).toHaveText('2 suggestions.');
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
