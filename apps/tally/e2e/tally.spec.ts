import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { checkA11y, expect, failSaving, test } from '../../../tests/e2e/fixtures.ts';

async function addCounter(page: Page, name: string): Promise<void> {
  await page.getByLabel('New counter').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

const counter = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('what’s typed stays on the device, even before the page’s script runs', async ({
  browser,
  baseURL,
  guard,
}) => {
  // On a slow first visit the form is there before its script. Enter would
  // then send the form the browser's own way, with the text in the address:
  // the CSP's form-action 'none' stops it (audit 4 C-1). A page of its own,
  // without the site's scripts (their requests fail on purpose).
  guard.allowConsole("form-action 'none'");
  guard.allowConsole('net::ERR_FAILED');
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.route('**/_astro/*.js', (route) => route.abort());
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents.push(request.url());
  });
  await page.goto('/');
  const field = page.getByLabel('New counter');
  await field.fill('Pills: Sertraline 50mg');
  const blocked = page.waitForEvent('console', (message) =>
    message.text().includes("form-action 'none'"),
  );
  // What Enter in the field does (sent from here: Playwright would wait for
  // the page the form asks for, which never comes).
  await field.evaluate((input: HTMLInputElement) => input.form?.requestSubmit());
  await blocked;
  expect(documents).toEqual([new URL('/', page.url()).href]);
  await context.close();
});

test('counts up and down and remembers counts after a reload', async ({ page }) => {
  await expect(page.getByText('No counters yet')).toBeVisible();
  await addCounter(page, 'Water');

  const water = counter(page, 'Water');
  const plus = water.getByRole('button', { name: 'Add 1 to Water' });
  const minus = water.getByRole('button', { name: 'Subtract 1 from Water' });
  await expect(minus).toBeDisabled();

  await plus.click();
  await plus.click();
  await plus.click();
  await minus.click();
  await expect(water.locator('[data-value]')).toHaveText('2');
  await expect(page.getByRole('status').filter({ hasText: 'Water: 2' })).toBeAttached();

  await page.reload();
  await expect(counter(page, 'Water').locator('[data-value]')).toHaveText('2');
  await expect(page.getByText('No counters yet')).toBeHidden();
});

test('keeps keyboard focus on the button after counting', async ({ page }) => {
  await addCounter(page, 'Steps');
  const plus = counter(page, 'Steps').getByRole('button', { name: 'Add 1 to Steps' });
  await plus.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(counter(page, 'Steps').locator('[data-value]')).toHaveText('2');
  await expect(
    counter(page, 'Steps').getByRole('button', { name: 'Add 1 to Steps' }),
  ).toBeFocused();
  // Counted down to 0, "Subtract 1" can't keep focus: "Add 1" takes it.
  await counter(page, 'Steps').getByRole('button', { name: 'Subtract 1 from Steps' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(counter(page, 'Steps').locator('[data-value]')).toHaveText('0');
  await expect(
    counter(page, 'Steps').getByRole('button', { name: 'Add 1 to Steps' }),
  ).toBeFocused();
});

test('explains invalid names', async ({ page }) => {
  const input = page.getByLabel('New counter');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter a name for the counter.')).toBeVisible();
  await expect(input).toHaveAccessibleDescription('Enter a name for the counter.');

  await addCounter(page, 'Coffee');
  await addCounter(page, 'coffee');
  await expect(page.getByText('You already have a counter with that name.')).toBeVisible();
});

test('reads out a name’s problem after Enter in the field', async ({ page }) => {
  // Focus stays in the field, so moving focus there reads nothing (audit G-3).
  const input = page.getByLabel('New counter');
  await input.focus();
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await expect(page.getByRole('alert')).toHaveText('New counter: Enter a name for the counter.');

  await input.fill('Cups');
  await page.keyboard.press('Enter');
  await input.fill('Cups');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText(
    'New counter: You already have a counter with that name.',
  );
  // Gone once the name is changed.
  await input.pressSequentially('!');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('asks before resetting a count to 0', async ({ page }) => {
  await addCounter(page, 'Cups');
  const cups = counter(page, 'Cups');
  for (let tap = 0; tap < 3; tap += 1) {
    await cups.getByRole('button', { name: 'Add 1 to Cups' }).click();
  }
  const reset = cups.getByRole('button', { name: 'Reset Cups to zero' });
  await reset.click();
  const dialog = page.getByRole('dialog', { name: 'Reset “Cups” to 0?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('It’s at 3 now.');
  // Read out with the title, before "Cancel" (audit 5 G-3).
  await expect(dialog).toHaveAccessibleDescription('It’s at 3 now. This can’t be undone.');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await checkA11y(page, 'reset dialog');

  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(cups.locator('[data-value]')).toHaveText('3');
  await expect(reset).toBeFocused();

  await reset.click();
  await dialog.getByRole('button', { name: 'Reset' }).click();
  await expect(cups.locator('[data-value]')).toHaveText('0');
  await expect(page.getByRole('status').filter({ hasText: 'Cups: reset to 0.' })).toBeAttached();
  await expect(cups.getByRole('button', { name: 'Reset Cups to zero' })).toBeFocused();
  await page.reload();
  await expect(counter(page, 'Cups').locator('[data-value]')).toHaveText('0');
});

test('says so, on screen, when counting can’t be saved', async ({ page }) => {
  await addCounter(page, 'Cups');
  await failSaving(page);
  const plus = counter(page, 'Cups').getByRole('button', { name: 'Add 1 to Cups' });
  await plus.click();
  const problem = page.getByRole('alert');
  await expect(problem).toBeVisible();
  await expect(problem).toHaveText(/^Couldn’t save/);
  // The count isn't announced as if it were kept.
  await expect(page.getByRole('status').filter({ hasText: 'Cups: 1' })).toHaveCount(0);
  await expect(plus).toBeFocused();

  await page.reload();
  await expect(counter(page, 'Cups').locator('[data-value]')).toHaveText('0');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('resets and deletes counters (with confirmation)', async ({ page }) => {
  await addCounter(page, 'Books');
  const books = counter(page, 'Books');
  await books.getByRole('button', { name: 'Add 1 to Books' }).click();
  await books.getByRole('button', { name: 'Reset Books to zero' }).click();
  await page
    .getByRole('dialog', { name: 'Reset “Books” to 0?' })
    .getByRole('button', { name: 'Reset' })
    .click();
  await expect(books.locator('[data-value]')).toHaveText('0');

  await books.getByRole('button', { name: 'Delete Books' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this counter?' });
  // Every delete dialog says so (audit 4 G-12), read out with its title (audit 5 G-3).
  await expect(dialog).toContainText(
    '“Books” and its count will be removed. This can’t be undone.',
  );
  await expect(dialog).toHaveAccessibleDescription(
    /^“Books” and its count will be removed\. This\s+can’t be undone\.$/,
  );
  await checkA11y(page, 'delete dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(books).toBeVisible();

  await books.getByRole('button', { name: 'Delete Books' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(books).toHaveCount(0);
  await expect(page.getByText('No counters yet')).toBeVisible();
});

test('passes accessibility checks with counters on the page', async ({ page }) => {
  await addCounter(page, 'Water');
  await addCounter(page, 'A counter with a much longer name than usual');
  await checkA11y(page, 'with counters (light)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'with counters (dark)');
});

test('the − and + buttons stay inside their card, with large text too', async ({ page }) => {
  // With text at 200%, + ran past the card's edge, and on a 320px screen the
  // page scrolled sideways (audit 4 G-11).
  await addCounter(page, 'Water');
  const card = counter(page, 'Water');
  const minus = card.getByRole('button', { name: 'Subtract 1 from Water' });
  const plus = card.getByRole('button', { name: 'Add 1 to Water' });
  for (const [width, size] of [
    [320, '200%'],
    [360, '200%'],
    [412, '200%'],
    [320, '100%'],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate((textSize) => {
      document.documentElement.style.fontSize = textSize;
    }, size);
    const problems = await card.evaluate((element) => {
      const found: string[] = [];
      const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      if (sideways > 0) found.push(`The page scrolls sideways by ${sideways}px`);
      const style = getComputedStyle(element);
      const outer = element.getBoundingClientRect();
      const left = outer.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const right =
        outer.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      for (const button of element.querySelectorAll('.counter__controls button')) {
        const box = button.getBoundingClientRect();
        if (box.left < left - 0.5 || box.right > right + 0.5) {
          found.push(`${button.getAttribute('aria-label')} goes past the card's padding`);
        }
      }
      return found;
    });
    expect(problems, `${width}px, text ${size}`).toEqual([]);
  }

  // At the usual text size they share a row, and + is twice as wide as −.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  const [minusBox, plusBox] = [await minus.boundingBox(), await plus.boundingBox()];
  expect(minusBox && plusBox && Math.abs(minusBox.y - plusBox.y)).toBe(0);
  expect(minusBox && plusBox && Math.abs(plusBox.width - 2 * minusBox.width)).toBeLessThan(1);
});

test('backs up, deletes and restores the data', async ({ page }) => {
  await addCounter(page, 'Water');
  await counter(page, 'Water').getByRole('button', { name: 'Add 1 to Water' }).click();

  // A backup locked with a passphrase.
  await page.getByRole('button', { name: 'Back up' }).click();
  const backupDialog = page.getByRole('dialog', { name: 'Back up your data' });
  await backupDialog.getByLabel('Passphrase', { exact: true }).fill('tally test passphrase');
  await backupDialog.getByLabel('Type it again').fill('tally test passphrase');
  const backupDownload = page.waitForEvent('download');
  await backupDialog.getByRole('button', { name: 'Download backup' }).click();
  const backup = await backupDownload;
  expect(backup.suggestedFilename()).toMatch(/^tally-backup-\d{4}-\d{2}-\d{2}\.json$/);
  expect(await readFile(await backup.path(), 'utf8')).not.toContain('Water');

  // A plain copy anyone can read.
  await page.getByRole('button', { name: 'Back up' }).click();
  const plainDownload = page.waitForEvent('download');
  await backupDialog.getByRole('button', { name: 'Download without a passphrase' }).click();
  const plain = await plainDownload;
  expect(plain.suggestedFilename()).toMatch(/^tally-data-\d{4}-\d{2}-\d{2}\.json$/);
  const file = JSON.parse(await readFile(await plain.path(), 'utf8'));
  expect(file.app).toBe('tally');
  expect(file.data['shkriuss:tally'].data.counters[0]).toMatchObject({ name: 'Water', count: 1 });

  // Something an app downloaded into its own cache (like Grammar's model), and the offline copy.
  await page.evaluate(async () => {
    await (await caches.open('downloads')).put('/big-file', new Response('model'));
    await (await caches.open('shkriuss-offline-copy')).put('/', new Response('page'));
  });
  await page.getByRole('button', { name: 'Delete all data' }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete all data?' });
  await deleteDialog.getByRole('button', { name: 'Delete everything' }).click();
  await page.waitForLoadState('load');
  await expect(page.getByText('No counters yet')).toBeVisible();
  // The download is gone too; the offline copy of the site stays.
  expect(await page.evaluate(() => caches.keys())).toEqual(['shkriuss-offline-copy']);

  // Restore the locked backup.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore' }).click();
  await (await chooser).setFiles(await backup.path());
  const restoreDialog = page.getByRole('dialog', { name: 'Restore a backup' });
  await restoreDialog.getByLabel('Passphrase').fill('tally test passphrase');
  await restoreDialog.getByRole('button', { name: 'Restore' }).click();
  await expect(counter(page, 'Water').locator('[data-value]')).toHaveText('1');
});
